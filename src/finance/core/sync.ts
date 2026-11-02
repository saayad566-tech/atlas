// Background synchronisation with automatic recovery.
//
// The app is offline-first: everything needed to work is on the device. This engine keeps
// stored data fresh when a network exists, and never blocks the interface while doing it.
//
// Every attempt is written to a durable log, so a developer can trace exactly what synced,
// when, and why a request failed.

import type { Database as DB } from 'better-sqlite3';

export type SyncState = 'queued' | 'running' | 'ok' | 'failed' | 'skipped';

export interface SyncJob {
  id: number;
  kind: string;
  target: string;
  state: SyncState;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface SyncEvent { at: number; jobId: number | null; kind: string; state: SyncState; detail: string }

const DDL = `
CREATE TABLE IF NOT EXISTS sync_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(kind, target)
);
CREATE TABLE IF NOT EXISTS sync_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  job_id INTEGER,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sync_state ON sync_jobs(state, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_sync_events_at ON sync_events(at);
`;

/** Backoff: 2s, 8s, 30s, 2m, 10m — then it stays at 10m and stops growing. */
export function backoffMs(attempts: number): number {
  const steps = [2_000, 8_000, 30_000, 120_000, 600_000];
  return steps[Math.min(attempts, steps.length - 1)]!;
}

export class SyncEngine {
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private db: DB, private execute: (kind: string, target: string) => Promise<{ ok: boolean; detail: string }>) {
    this.db.exec(DDL);
  }

  private log(jobId: number | null, kind: string, state: SyncState, detail: string): void {
    try {
      this.db.prepare(`INSERT INTO sync_events (at, job_id, kind, state, detail) VALUES (?,?,?,?,?)`)
        .run(Date.now(), jobId, kind, state, detail.slice(0, 500));
    } catch { /* logging must never break a sync */ }
  }

  /** Queue work. Re-queueing the same target resets it rather than duplicating. */
  enqueue(kind: string, target: string): SyncJob {
    const now = Date.now();
    this.db.prepare(`INSERT INTO sync_jobs (kind, target, state, attempts, next_attempt_at, created_at, updated_at)
      VALUES (?,?, 'queued', 0, 0, ?, ?)
      ON CONFLICT(kind, target) DO UPDATE SET state='queued', next_attempt_at=0, updated_at=excluded.updated_at`)
      .run(kind, target, now, now);
    const job = this.db.prepare(`SELECT * FROM sync_jobs WHERE kind=? AND target=?`).get(kind, target) as Record<string, unknown>;
    const mapped = this.map(job);
    this.log(mapped.id, kind, 'queued', target);
    return mapped;
  }

  private map(r: Record<string, unknown>): SyncJob {
    return {
      id: Number(r['id']), kind: String(r['kind']), target: String(r['target']),
      state: String(r['state']) as SyncState, attempts: Number(r['attempts']),
      lastError: r['last_error'] === null ? null : String(r['last_error']),
      nextAttemptAt: Number(r['next_attempt_at']), createdAt: Number(r['created_at']), updatedAt: Number(r['updated_at']),
    };
  }

  due(limit = 5): SyncJob[] {
    const now = Date.now();
    return (this.db.prepare(`SELECT * FROM sync_jobs WHERE state IN ('queued','failed') AND next_attempt_at <= ?
      ORDER BY next_attempt_at ASC LIMIT ?`).all(now, limit) as Array<Record<string, unknown>>).map((r) => this.map(r));
  }

  /** Run one job to completion, recording the outcome and scheduling a retry on failure. */
  async runJob(job: SyncJob): Promise<SyncJob> {
    const started = Date.now();
    this.db.prepare(`UPDATE sync_jobs SET state='running', updated_at=? WHERE id=?`).run(started, job.id);
    this.log(job.id, job.kind, 'running', job.target);
    try {
      const r = await this.execute(job.kind, job.target);
      if (r.ok) {
        this.db.prepare(`UPDATE sync_jobs SET state='ok', attempts=attempts+1, last_error=NULL, updated_at=? WHERE id=?`).run(Date.now(), job.id);
        this.log(job.id, job.kind, 'ok', r.detail);
      } else {
        this.fail(job, r.detail);
      }
    } catch (e) {
      this.fail(job, e instanceof Error ? e.message : String(e));
    }
    const after = this.db.prepare(`SELECT * FROM sync_jobs WHERE id=?`).get(job.id) as Record<string, unknown>;
    return this.map(after);
  }

  private fail(job: SyncJob, detail: string): void {
    const attempts = job.attempts + 1;
    const wait = backoffMs(attempts);
    this.db.prepare(`UPDATE sync_jobs SET state='failed', attempts=?, last_error=?, next_attempt_at=?, updated_at=? WHERE id=?`)
      .run(attempts, detail.slice(0, 500), Date.now() + wait, Date.now(), job.id);
    this.log(job.id, job.kind, 'failed', `${detail} — retrying in ${Math.round(wait / 1000)}s`);
  }

  /** Process everything that is due. Safe to call repeatedly; it never overlaps itself. */
  async drain(maxJobs = 10): Promise<{ processed: number; ok: number; failed: number }> {
    if (this.running) return { processed: 0, ok: 0, failed: 0 };
    this.running = true;
    let ok = 0; let failed = 0; let processed = 0;
    try {
      for (let i = 0; i < maxJobs; i++) {
        const jobs = this.due(1);
        if (!jobs.length) break;
        const out = await this.runJob(jobs[0]!);
        processed++;
        if (out.state === 'ok') ok++; else failed++;
      }
    } finally { this.running = false; }
    return { processed, ok, failed };
  }

  /** Start a background pass on an interval. Never blocks a request. */
  start(intervalMs = 30_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.drain(5); }, intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.log(null, 'engine', 'queued', `background sync every ${Math.round(intervalMs / 1000)}s`);
  }

  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  /** Everything a developer needs to trace sync history. */
  status(limit = 50) {
    const jobs = (this.db.prepare(`SELECT * FROM sync_jobs ORDER BY updated_at DESC LIMIT ?`).all(limit) as Array<Record<string, unknown>>).map((r) => this.map(r));
    const events = this.db.prepare(`SELECT at, job_id, kind, state, detail FROM sync_events ORDER BY at DESC LIMIT ?`).all(limit) as Array<Record<string, unknown>>;
    const counts = this.db.prepare(`SELECT state, COUNT(*) AS n FROM sync_jobs GROUP BY state`).all() as Array<{ state: string; n: number }>;
    return {
      jobs,
      events: events.map((e) => ({ at: Number(e['at']), jobId: e['job_id'] === null ? null : Number(e['job_id']),
        kind: String(e['kind']), state: String(e['state']) as SyncState, detail: String(e['detail']) })),
      counts: Object.fromEntries(counts.map((c) => [c.state, c.n])),
      running: this.running,
    };
  }

  /** Retry everything that has failed, immediately, ignoring the backoff. */
  retryFailed(): number {
    const r = this.db.prepare(`UPDATE sync_jobs SET state='queued', next_attempt_at=0, updated_at=? WHERE state='failed'`).run(Date.now());
    this.log(null, 'engine', 'queued', `manual retry of ${r.changes} failed job(s)`);
    return r.changes;
  }
}
