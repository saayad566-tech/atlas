// Background job queue for data refresh.
//
// Fetching thousands of symbols cannot happen inside a request: the source throttles,
// and a crash must not lose progress. This is a small persistent queue with pacing,
// retry with backoff, and resume-after-restart.
import type { Database as DB } from 'better-sqlite3';

export const JOB_DDL = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, symbol TEXT, status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at INTEGER NOT NULL,
  started_at INTEGER, finished_at INTEGER, next_attempt_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, next_attempt_at);
`;

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface Job { id: string; kind: string; symbol: string | null; status: JobStatus; attempts: number; lastError: string | null }

export function ensureJobTables(db: DB): void { db.exec(JOB_DDL); }

export class JobQueue {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private db: DB,
    private handler: (job: Job) => Promise<void>,
    private opts: { paceMs?: number; maxAttempts?: number; concurrency?: number } = {},
  ) { ensureJobTables(db); }

  enqueue(kind: string, symbol: string | null, id?: string): void {
    ensureJobTables(this.db);
    const jid = id ?? `${kind}:${symbol ?? '-'}`;
    this.db.prepare(`INSERT OR REPLACE INTO jobs (id,kind,symbol,status,attempts,created_at,next_attempt_at) VALUES (?,?,?,'queued',0,?,0)`)
      .run(jid, kind, symbol, Date.now());
  }

  /** Queue a batch of symbols, skipping any that are already queued or running. */
  enqueueMany(kind: string, symbols: string[]): number {
    let added = 0;
    const tx = this.db.transaction(() => {
      for (const s of symbols) {
        const existing = this.db.prepare(`SELECT status FROM jobs WHERE id=?`).get(`${kind}:${s}`) as { status: string } | undefined;
        if (existing && (existing.status === 'queued' || existing.status === 'running')) continue;
        this.db.prepare(`INSERT OR REPLACE INTO jobs (id,kind,symbol,status,attempts,created_at,next_attempt_at) VALUES (?,?,?,'queued',0,?,0)`)
          .run(`${kind}:${s}`, kind, s, Date.now());
        added++;
      }
    });
    tx();
    return added;
  }

  stats(): Record<string, number> {
    ensureJobTables(this.db);
    const rows = this.db.prepare(`SELECT status, COUNT(*) AS n FROM jobs GROUP BY status`).all() as Array<{ status: string; n: number }>;
    const out: Record<string, number> = { queued: 0, running: 0, done: 0, failed: 0 };
    for (const r of rows) out[r.status] = r.n;
    return out;
  }

  /** Process until the queue is empty or the budget runs out. Resumable across restarts. */
  async drain(budgetMs = 25000): Promise<{ processed: number; failed: number }> {
    if (this.running) return { processed: 0, failed: 0 };
    this.running = true;
    const pace = this.opts.paceMs ?? 400;
    const maxAttempts = this.opts.maxAttempts ?? 3;
    const started = Date.now();
    let processed = 0; let failed = 0;
    try {
      for (;;) {
        if (Date.now() - started > budgetMs) break;
        const job = this.db.prepare(`SELECT * FROM jobs WHERE status='queued' AND next_attempt_at <= ? ORDER BY created_at LIMIT 1`).get(Date.now()) as Record<string, unknown> | undefined;
        if (!job) break;
        const id = String(job['id']);
        this.db.prepare(`UPDATE jobs SET status='running', started_at=?, attempts=attempts+1 WHERE id=?`).run(Date.now(), id);
        try {
          await this.handler({ id, kind: String(job['kind']), symbol: job['symbol'] === null ? null : String(job['symbol']), status: 'running', attempts: Number(job['attempts']) + 1, lastError: null });
          this.db.prepare(`UPDATE jobs SET status='done', finished_at=?, last_error=NULL WHERE id=?`).run(Date.now(), id);
          processed++;
        } catch (e) {
          failed++;
          const attempts = Number(job['attempts']) + 1;
          const msg = e instanceof Error ? e.message : String(e);
          if (attempts >= maxAttempts) {
            this.db.prepare(`UPDATE jobs SET status='failed', finished_at=?, last_error=? WHERE id=?`).run(Date.now(), msg.slice(0, 300), id);
          } else {
            // Exponential backoff, capped at 5 minutes.
            const delay = Math.min(300000, 2000 * 2 ** attempts);
            this.db.prepare(`UPDATE jobs SET status='queued', last_error=?, next_attempt_at=? WHERE id=?`).run(msg.slice(0, 300), Date.now() + delay, id);
          }
        }
        await new Promise((r) => setTimeout(r, pace));
      }
    } finally {
      this.running = false;
    }
    return { processed, failed };
  }

  start(intervalMs = 15000): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.drain(); }, intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /** Recover jobs left 'running' by a crash. */
  recover(): number {
    ensureJobTables(this.db);
    return this.db.prepare(`UPDATE jobs SET status='queued', next_attempt_at=0 WHERE status='running'`).run().changes;
  }
}
