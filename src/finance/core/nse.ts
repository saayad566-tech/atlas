// Live market data from the National Stock Exchange of India.
//
// NSE publishes its index board and market status as public JSON. It is the primary source
// for Indian market state: official, complete, and not rate-limited the way third-party
// quote APIs are. Requests identify the app honestly and are spaced out.
//
// What this does NOT do: disguise itself, rotate identities, or defeat a block. If NSE
// declines a request, that is reported and the caller falls back to stored data.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Database as DB } from 'better-sqlite3';

const run = promisify(execFile);

/**
 * Fetch through curl when it is available.
 *
 * NSE is slow through a proxy and its JSON endpoints need the cookie from the homepage, which
 * curl handles in one jar. The internal client is the fallback for machines without curl.
 */
async function curlGet(url: string, jar: string, extra: string[] = []): Promise<{ status: number; body: string }> {
  const { stdout } = await run('curl', [
    '-s', '-L', '--max-time', '25', '-b', jar, '-c', jar,
    '-A', UA, '-H', 'Accept: application/json, text/plain, */*',
    '-H', 'Accept-Language: en-IN,en;q=0.9',
    '-H', 'Referer: https://www.nseindia.com/',
    '-w', '\n%{http_code}', ...extra, url,
  ], { maxBuffer: 32 * 1024 * 1024 });
  const idx = stdout.lastIndexOf('\n');
  const status = Number(stdout.slice(idx + 1).trim()) || 0;
  return { status, body: stdout.slice(0, idx) };
}

const UA = 'Atlas/3.6 (+https://github.com/saayad566-tech/atlas; personal research tool)';
const HOME = 'https://www.nseindia.com/';

/** One index row from the NSE board. */
export interface NseIndex {
  key: string;
  index: string;
  symbol: string;
  last: number | null;
  variation: number | null;
  percentChange: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  yearHigh: number | null;
  yearLow: number | null;
}

export interface NseBoard {
  fetchedAt: string;
  source: 'nse';
  indices: NseIndex[];
  breadth: { advances: number; declines: number; unchanged: number } | null;
  asOf: string | null;
}

export interface NseStatus {
  market: string;
  status: string;
  tradeDate: string;
  index: string;
  last: number | null;
  percentChange: number | null;
  message: string;
}

const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const x = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(x) ? x : null;
};

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

/** A per-process cookie jar: NSE hands out a cookie on the homepage and the JSON needs it. */
let jar: string | null = null;
let primed = false;

function jarPath(): string {
  if (!jar) jar = join(tmpdir(), `atlas-nse-${randomBytes(6).toString('hex')}.txt`);
  return jar;
}

async function prime(): Promise<void> {
  if (primed) return;
  try {
    await curlGet(HOME, jarPath(), ['-H', 'Accept: text/html,application/xhtml+xml']);
    primed = true;
  } catch { /* the caller reports the refusal */ }
}

async function getJson<T>(path: string): Promise<{ ok: boolean; data: T | null; error: string | null }> {
  await prime();
  try {
    const r = await curlGet(`https://www.nseindia.com${path}`, jarPath());
    if (r.status !== 200) return { ok: false, data: null, error: `NSE returned HTTP ${r.status}` };
    return { ok: true, data: JSON.parse(r.body) as T, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // execFile reports the whole command line on failure, which is noise to a user. Say what
    // actually happened instead.
    const friendly = /ENOENT/.test(msg) ? 'curl is not available on this device'
      : /max-time|timed out/i.test(msg) ? 'NSE did not respond in time'
      : /Could not resolve|Failed to connect|Connection refused/i.test(msg) ? 'NSE could not be reached from this network'
      : 'NSE request failed';
    return { ok: false, data: null, error: friendly };
  }
}

/** Parse the NSE index payload. Separated from the fetch so it can be tested without a network. */
export function parseBoard(payload: unknown): NseBoard | null {
  const d = payload as { data?: Array<Record<string, unknown>>; timestamp?: string;
    advances?: string | number; declines?: string | number; unchanged?: string | number } | null;
  if (!d || !Array.isArray(d.data)) return null;
  const indices: NseIndex[] = d.data.map((row) => ({
    key: String(row['key'] ?? ''),
    index: String(row['index'] ?? ''),
    symbol: String(row['indexSymbol'] ?? ''),
    last: n(row['last']),
    variation: n(row['variation']),
    percentChange: n(row['percentChange']),
    open: n(row['open']),
    high: n(row['high']),
    low: n(row['low']),
    previousClose: n(row['previousClose']),
    yearHigh: n(row['yearHigh']),
    yearLow: n(row['yearLow']),
  })).filter((i) => i.index !== '');
  if (!indices.length) return null;
  return {
    fetchedAt: new Date().toISOString(), source: 'nse', indices,
    breadth: d.advances !== undefined
      ? { advances: n(d.advances) ?? 0, declines: n(d.declines) ?? 0, unchanged: n(d.unchanged) ?? 0 }
      : null,
    asOf: d.timestamp ?? null,
  };
}

/** Parse the market-status payload. */
export function parseStatus(payload: unknown): NseStatus[] {
  const d = payload as { marketState?: Array<Record<string, unknown>> } | null;
  if (!d || !Array.isArray(d.marketState)) return [];
  return d.marketState.map((m) => ({
    market: String(m['market'] ?? ''),
    status: String(m['marketStatus'] ?? ''),
    tradeDate: String(m['tradeDate'] ?? ''),
    index: String(m['index'] ?? ''),
    last: n(m['last']),
    percentChange: n(m['percentChange']),
    message: String(m['marketStatusMessage'] ?? ''),
  })).filter((m) => m.market !== '');
}

/** Fetch the full index board: 139 indices plus market breadth. */
export async function fetchNseBoard(): Promise<{ ok: boolean; board: NseBoard | null; error: string | null }> {
  const r = await getJson<{ data?: Array<Record<string, unknown>>; timestamp?: string;
    advances?: string | number; declines?: string | number; unchanged?: string | number }>('/api/allIndices');
  if (!r.ok || !r.data) return { ok: false, board: null, error: r.error ?? 'empty response' };

  const indices: NseIndex[] = (r.data.data ?? []).map((row) => ({
    key: String(row['key'] ?? ''),
    index: String(row['index'] ?? ''),
    symbol: String(row['indexSymbol'] ?? ''),
    last: n(row['last']),
    variation: n(row['variation']),
    percentChange: n(row['percentChange']),
    open: n(row['open']),
    high: n(row['high']),
    low: n(row['low']),
    previousClose: n(row['previousClose']),
    yearHigh: n(row['yearHigh']),
    yearLow: n(row['yearLow']),
  })).filter((i) => i.index !== '');

  if (!indices.length) return { ok: false, board: null, error: 'NSE returned no indices' };

  return {
    ok: true,
    board: {
      fetchedAt: new Date().toISOString(),
      source: 'nse',
      indices,
      breadth: r.data.advances !== undefined
        ? { advances: n(r.data.advances) ?? 0, declines: n(r.data.declines) ?? 0, unchanged: n(r.data.unchanged) ?? 0 }
        : null,
      asOf: r.data.timestamp ?? null,
    },
    error: null,
  };
}

/** Market open/closed state, straight from the exchange. */
export async function fetchNseStatus(): Promise<{ ok: boolean; rows: NseStatus[]; error: string | null }> {
  const r = await getJson<{ marketState?: Array<Record<string, unknown>> }>('/api/marketStatus');
  if (!r.ok || !r.data) return { ok: false, rows: [], error: r.error ?? 'empty response' };
  const rows: NseStatus[] = (r.data.marketState ?? []).map((m) => ({
    market: String(m['market'] ?? ''),
    status: String(m['marketStatus'] ?? ''),
    tradeDate: String(m['tradeDate'] ?? ''),
    index: String(m['index'] ?? ''),
    last: n(m['last']),
    percentChange: n(m['percentChange']),
    message: String(m['marketStatusMessage'] ?? ''),
  })).filter((m) => m.market !== '');
  return { ok: rows.length > 0, rows, error: rows.length ? null : 'NSE returned no market state' };
}

/** Persist the board so the panel works offline between refreshes. */
export function storeBoard(db: DB, board: NseBoard): number {
  db.exec(`CREATE TABLE IF NOT EXISTS nse_indices (
    index_name TEXT PRIMARY KEY, symbol TEXT, last REAL, variation REAL, percent_change REAL,
    open REAL, high REAL, low REAL, previous_close REAL, year_high REAL, year_low REAL,
    fetched_at TEXT NOT NULL)`);
  const stmt = db.prepare(`INSERT INTO nse_indices
    (index_name, symbol, last, variation, percent_change, open, high, low, previous_close, year_high, year_low, fetched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(index_name) DO UPDATE SET
      symbol=excluded.symbol, last=excluded.last, variation=excluded.variation,
      percent_change=excluded.percent_change, open=excluded.open, high=excluded.high,
      low=excluded.low, previous_close=excluded.previous_close, year_high=excluded.year_high,
      year_low=excluded.year_low, fetched_at=excluded.fetched_at`);
  const tx = db.transaction(() => {
    for (const i of board.indices) {
      stmt.run(i.index, i.symbol, i.last, i.variation, i.percentChange, i.open, i.high,
        i.low, i.previousClose, i.yearHigh, i.yearLow, board.fetchedAt);
    }
  });
  tx();
  return board.indices.length;
}

/** Read the stored board, so the panel has data with no network. */
export function storedBoard(db: DB): NseBoard | null {
  try {
    const rows = db.prepare(`SELECT * FROM nse_indices ORDER BY index_name`).all() as Array<Record<string, unknown>>;
    if (!rows.length) return null;
    return {
      fetchedAt: String(rows[0]!['fetched_at']),
      source: 'nse',
      indices: rows.map((r) => ({
        key: '', index: String(r['index_name']), symbol: String(r['symbol'] ?? ''),
        last: n(r['last']), variation: n(r['variation']), percentChange: n(r['percent_change']),
        open: n(r['open']), high: n(r['high']), low: n(r['low']),
        previousClose: n(r['previous_close']), yearHigh: n(r['year_high']), yearLow: n(r['year_low']),
      })),
      breadth: null,
      asOf: null,
    };
  } catch { return null; }
}
