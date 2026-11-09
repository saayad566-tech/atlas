// Bulk history backfill.
//
// One symbol at a time, resumable, with progress saved after each one. The quote source is
// rate-limited per host, so this is deliberately sequential: a burst of parallel requests is
// what the polite client exists to prevent.
//
// A symbol that fails is recorded as failed and skipped, not retried forever. The queue can
// be resumed at any point, so a run that is cut short loses nothing.

import type { Database as DB } from 'better-sqlite3';
import { backfillSymbol, type HistoryResult } from './history';

export interface BackfillProgress {
  queued: number;
  done: number;
  failed: number;
  remaining: number;
  lastSymbol: string | null;
  bars: number;
  startedAt: string;
  finishedAt: string | null;
  running: boolean;
}

interface Job {
  symbols: string[];
  index: number;
  results: Array<{ symbol: string; bars: number; error: string | null }>;
  startedAt: string;
  finishedAt: string | null;
  range: string;
}

let job: Job | null = null;

function ensureTable(db: DB): void {
  db.exec(`CREATE TABLE IF NOT EXISTS backfill_state (
    symbol TEXT PRIMARY KEY, bars INTEGER, error TEXT, fetched_at TEXT)`);
}

/** Which symbols already have history, so a resume does not fetch them again. */
export function alreadyFetched(db: DB): Set<string> {
  try {
    ensureTable(db);
    const rows = db.prepare('SELECT symbol FROM backfill_state WHERE bars > 0').all() as Array<{ symbol: string }>;
    return new Set(rows.map((r) => r.symbol));
  } catch { return new Set(); }
}

function record(db: DB, r: HistoryResult): void {
  ensureTable(db);
  db.prepare(`INSERT INTO backfill_state (symbol, bars, error, fetched_at) VALUES (?,?,?,?)
    ON CONFLICT(symbol) DO UPDATE SET bars=excluded.bars, error=excluded.error, fetched_at=excluded.fetched_at`)
    .run(r.symbol, r.bars, r.error, new Date().toISOString());
}

/**
 * Start a backfill over a list of symbols.
 *
 * `skipKnown` leaves out anything already stored, which is what makes a second run cheap.
 */
export function startBackfill(db: DB, symbols: string[], opts: { range?: string; skipKnown?: boolean } = {}): BackfillProgress {
  const known = opts.skipKnown === false ? new Set<string>() : alreadyFetched(db);
  const queue = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))]
    .filter((s) => !known.has(s));
  job = {
    symbols: queue, index: 0, results: [],
    startedAt: new Date().toISOString(), finishedAt: queue.length ? null : new Date().toISOString(),
    range: opts.range ?? 'max',
  };
  return progress();
}

export function progress(): BackfillProgress {
  if (!job) {
    return { queued: 0, done: 0, failed: 0, remaining: 0, lastSymbol: null, bars: 0,
      startedAt: '', finishedAt: null, running: false };
  }
  const done = job.results.filter((r) => !r.error).length;
  const failed = job.results.filter((r) => !!r.error).length;
  return {
    queued: job.symbols.length,
    done, failed,
    remaining: job.symbols.length - job.results.length,
    lastSymbol: job.results.at(-1)?.symbol ?? null,
    bars: job.results.reduce((a, r) => a + r.bars, 0),
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    running: job.finishedAt === null,
  };
}

/**
 * Process up to `limit` symbols from the queue.
 *
 * Returns after the limit or when the queue empties, so a caller can bound the work per
 * request and keep the interface responsive.
 */
export async function stepBackfill(db: DB, limit = 5): Promise<BackfillProgress> {
  if (!job || job.finishedAt !== null) return progress();
  const stop = Math.min(job.index + limit, job.symbols.length);
  for (; job.index < stop; job.index++) {
    const symbol = job.symbols[job.index]!;
    const r = await backfillSymbol(db, symbol, job.range as 'max');
    record(db, r);
    job.results.push({ symbol, bars: r.bars, error: r.error });
  }
  if (job.index >= job.symbols.length) job.finishedAt = new Date().toISOString();
  return progress();
}

/** The most recent backfill results, newest first. */
export function recentBackfill(db: DB, limit = 20): Array<{ symbol: string; bars: number; error: string | null; fetchedAt: string }> {
  try {
    ensureTable(db);
    return db.prepare('SELECT symbol, bars, error, fetched_at AS fetchedAt FROM backfill_state ORDER BY fetched_at DESC LIMIT ?')
      .all(limit) as Array<{ symbol: string; bars: number; error: string | null; fetchedAt: string }>;
  } catch { return []; }
}

export function cancelBackfill(): void {
  if (job) job.finishedAt = new Date().toISOString();
}
