// Multi-year metric history.
//
// A single year tells you what a business is; a series tells you what it is becoming.
// Every ratio here is recomputed from stored statements year by year, so the trend is
// built from the same arithmetic as the headline numbers rather than a separate source.
import type { Database as DB } from 'better-sqlite3';
import { polite } from './polite';

const r2 = (v: number): number => Math.round(v * 100) / 100;
const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const div = (a: number, b: number): number | null => (b !== 0 ? a / b : null);

export interface YearPoint {
  year: string;
  sales: number | null;
  netProfit: number | null;
  opmPct: number | null;
  npmPct: number | null;
  roePct: number | null;
  rocePct: number | null;
  debtToEquity: number | null;
  eps: number | null;
  cfo: number | null;
}

export interface Trend {
  metric: string;
  label: string;
  first: number | null;
  last: number | null;
  changePct: number | null;
  cagrPct: number | null;
  direction: 'improving' | 'deteriorating' | 'stable' | 'unknown';
  verdict: string;
}

export interface MetricHistory {
  symbol: string;
  years: string[];
  series: YearPoint[];
  trends: Trend[];
  note: string;
}

/** Build one year of ratios from a statement row. */
export function yearPoint(row: Record<string, unknown>): YearPoint {
  const sales = n(row['sales']);
  const op = n(row['operating_profit']);
  const np = n(row['net_profit']);
  const equity = n(row['equity_capital']) + n(row['reserves']);
  const debt = n(row['borrowings']);
  const capitalEmployed = equity + debt;
  const epsRaw = row['eps'];
  return {
    year: String(row['fiscal_year'] ?? row['period_end'] ?? '').slice(0, 4),
    sales: sales || null,
    netProfit: np || null,
    opmPct: sales > 0 ? r2((op / sales) * 100) : null,
    npmPct: sales > 0 ? r2((np / sales) * 100) : null,
    roePct: equity > 0 ? r2((np / equity) * 100) : null,
    rocePct: capitalEmployed > 0 ? r2((op / capitalEmployed) * 100) : null,
    debtToEquity: equity > 0 ? r2(debt / equity) : null,
    eps: typeof epsRaw === 'number' && Number.isFinite(epsRaw) ? r2(epsRaw) : (div(np, n(row['equity_capital'])) === null ? null : r2(n(row['equity_capital']))),
    cfo: n(row['cfo']) || null,
  };
}

/**
 * Trend of one metric across the series.
 * Direction depends on the metric: rising leverage is deterioration, rising margin is not.
 */
export function trendOf(metric: string, label: string, values: Array<number | null>, higherIsBetter: boolean): Trend {
  const clean = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const base: Trend = { metric, label, first: null, last: null, changePct: null, cagrPct: null, direction: 'unknown', verdict: 'not enough years to judge' };
  if (clean.length < 2) return base;
  const first = clean[0]!; const last = clean[clean.length - 1]!;
  const changePct = first !== 0 ? r2(((last - first) / Math.abs(first)) * 100) : null;
  const periods = clean.length - 1;
  const cagrPct = first > 0 && last > 0 && periods > 0 ? r2((Math.pow(last / first, 1 / periods) - 1) * 100) : null;
  const moved = changePct === null ? 0 : changePct;
  const material = Math.abs(moved) >= 10;
  const good = higherIsBetter ? moved > 0 : moved < 0;
  const direction: Trend['direction'] = !material ? 'stable' : good ? 'improving' : 'deteriorating';
  const verdict = direction === 'stable'
    ? `${label} has held broadly steady at ${last} over ${clean.length} years.`
    : direction === 'improving'
      ? `${label} moved from ${first} to ${last} (${moved > 0 ? '+' : ''}${moved}%) — improving.`
      : `${label} moved from ${first} to ${last} (${moved > 0 ? '+' : ''}${moved}%) — deteriorating.`;
  return { metric, label, first: r2(first), last: r2(last), changePct, cagrPct, direction, verdict };
}

export function metricHistory(db: DB, symbol: string): MetricHistory | null {
  const c = db.prepare(`SELECT id, symbol FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number; symbol: string } | undefined;
  if (!c) return null;
  const rows = db.prepare(`SELECT * FROM statements WHERE company_id=? AND period_type='annual' ORDER BY period_end ASC`).all(c.id) as Array<Record<string, unknown>>;
  if (rows.length === 0) return null;

  const series = rows.map(yearPoint).filter((p) => p.year !== '');
  const trends: Trend[] = [
    trendOf('sales', 'Revenue', series.map((p) => p.sales), true),
    trendOf('opmPct', 'Operating margin', series.map((p) => p.opmPct), true),
    trendOf('npmPct', 'Net margin', series.map((p) => p.npmPct), true),
    trendOf('roePct', 'Return on equity', series.map((p) => p.roePct), true),
    trendOf('rocePct', 'Return on capital employed', series.map((p) => p.rocePct), true),
    trendOf('debtToEquity', 'Debt to equity', series.map((p) => p.debtToEquity), false),
  ];

  return {
    symbol: c.symbol,
    years: series.map((p) => p.year),
    series,
    trends,
    note: `Recomputed from ${series.length} annual statements. A change under 10% is treated as stable rather than a trend.`,
  };
}

/** Earnings surprise history, when the market pack has stored it. */
export function earningsSurprises(db: DB, symbol: string): Array<{ period: string; estimate: number | null; actual: number | null; surprisePct: number | null; beat: boolean | null }> {
  try {
    const rows = db.prepare(`
      SELECT period_end, eps_estimate, eps_actual FROM earnings_surprises
      WHERE company_id=(SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?))
      ORDER BY period_end DESC LIMIT 12`).all(symbol) as Array<{ period_end: string; eps_estimate: number | null; eps_actual: number | null }>;
    return rows.map((r) => {
      const est = r.eps_estimate; const act = r.eps_actual;
      const surprise = est !== null && act !== null && est !== 0 ? r2(((act - est) / Math.abs(est)) * 100) : null;
      return { period: r.period_end, estimate: est, actual: act, surprisePct: surprise, beat: surprise === null ? null : surprise >= 0 };
    });
  } catch { return []; }
}

// ===========================================================================
// Long history backfill and corporate actions.
// Added alongside the metric/trend API above, not in place of it.
// ===========================================================================
export interface Bar { date: string; open: number; high: number; low: number; close: number; volume: number | null }
export interface DivEvent { date: string; amount: number }
export interface SplitEvent { date: string; ratio: number }

export interface HistoryResult {
  symbol: string;
  bars: number;
  from: string | null;
  to: string | null;
  dividends: number;
  splits: number;
  stored: number;
  fromCache: boolean;
  error: string | null;
}

const RANGE_FOR: Record<string, string> = {
  max: 'max', '10y': '10y', '5y': '5y', '2y': '2y', '1y': '1y', '6m': '6mo', '3m': '3mo', '1m': '1mo',
};

// Number(null) is 0 and Number('') is 0, so a missing value would become a real zero —
// a halted session would be stored as a zero-price bar. Guard before converting.
const numOf = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : null;
};

/** Parse a chart response into bars and corporate actions. Exported for testing. */
export function parseHistory(body: string): {
  bars: Bar[]; dividends: DivEvent[]; splits: SplitEvent[]; currency: string; error: string | null;
} {
  const empty = { bars: [], dividends: [], splits: [], currency: '', error: null as string | null };
  let json: unknown;
  try { json = JSON.parse(body); } catch { return { ...empty, error: 'the history response was not JSON' }; }
  const chart = (json as { chart?: { result?: Array<Record<string, unknown>>; error?: { description?: string } } })?.chart;
  if (chart?.error?.description) return { ...empty, error: String(chart.error.description).slice(0, 120) };
  const result = chart?.result?.[0] as Record<string, unknown> | undefined;
  if (!result) return { ...empty, error: 'no history for that symbol' };

  const meta = (result['meta'] ?? {}) as Record<string, unknown>;
  const stamps = (result['timestamp'] as number[] | undefined) ?? [];
  const indicators = (result['indicators'] ?? {}) as Record<string, Array<Record<string, unknown>>>;
  const q = indicators['quote']?.[0] ?? {};
  const opens = (q['open'] as Array<number | null> | undefined) ?? [];
  const highs = (q['high'] as Array<number | null> | undefined) ?? [];
  const lows = (q['low'] as Array<number | null> | undefined) ?? [];
  const closes = (q['close'] as Array<number | null> | undefined) ?? [];
  const volumes = (q['volume'] as Array<number | null> | undefined) ?? [];

  const bars: Bar[] = [];
  for (let i = 0; i < stamps.length; i++) {
    const close = numOf(closes[i]);
    // A bar with no close is a halted or holiday session: skip it rather than store a zero.
    if (close === null) continue;
    bars.push({
      date: new Date(stamps[i]! * 1000).toISOString().slice(0, 10),
      open: numOf(opens[i]) ?? close,
      high: numOf(highs[i]) ?? close,
      low: numOf(lows[i]) ?? close,
      close,
      volume: numOf(volumes[i]),
    });
  }

  const evRaw = (result['events'] ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
  const dividends: DivEvent[] = Object.values(evRaw['dividends'] ?? {})
    .map((d) => ({ date: new Date(Number(d['date']) * 1000).toISOString().slice(0, 10), amount: numOf(d['amount']) ?? 0 }))
    .filter((d) => d.amount > 0);
  const splits: SplitEvent[] = Object.values(evRaw['splits'] ?? {})
    .map((s) => ({
      date: new Date(Number(s['date']) * 1000).toISOString().slice(0, 10),
      ratio: (numOf(s['numerator']) ?? 1) / (numOf(s['denominator']) ?? 1),
    }))
    .filter((s) => s.ratio > 0 && s.ratio !== 1);

  return { bars, dividends, splits, currency: String(meta['currency'] ?? ''), error: null };
}

function ensureTables(db: DB): void {
  db.exec(`CREATE TABLE IF NOT EXISTS price_history_long (
    symbol TEXT NOT NULL, date TEXT NOT NULL, open REAL, high REAL, low REAL, close REAL, volume REAL,
    PRIMARY KEY (symbol, date))`);
  // A corporate_actions table already exists, keyed on company_id with a text detail column.
  // This keeps the fetched actions in its own table so the two never collide.
  db.exec(`CREATE TABLE IF NOT EXISTS price_actions (
    symbol TEXT NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL, value REAL NOT NULL,
    PRIMARY KEY (symbol, date, kind))`);
  db.exec(`CREATE TABLE IF NOT EXISTS history_state (
    symbol TEXT PRIMARY KEY, bars INTEGER, first_date TEXT, last_date TEXT, fetched_at TEXT)`);
}

/** Store the bars and actions for a symbol, replacing what was there. */
export function storeHistory(db: DB, symbol: string, parsed: ReturnType<typeof parseHistory>): number {
  ensureTables(db);
  const insBar = db.prepare(`INSERT INTO price_history_long (symbol, date, open, high, low, close, volume)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(symbol, date) DO UPDATE SET
    open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close, volume=excluded.volume`);
  const insAct = db.prepare(`INSERT INTO price_actions (symbol, date, kind, value)
    VALUES (?,?,?,?) ON CONFLICT(symbol, date, kind) DO UPDATE SET value=excluded.value`);

  let stored = 0;
  const tx = db.transaction(() => {
    for (const b of parsed.bars) { insBar.run(symbol, b.date, b.open, b.high, b.low, b.close, b.volume); stored++; }
    for (const d of parsed.dividends) insAct.run(symbol, d.date, 'dividend', d.amount);
    for (const s of parsed.splits) insAct.run(symbol, s.date, 'split', s.ratio);
  });
  tx();

  const first = parsed.bars[0]?.date ?? null;
  const last = parsed.bars.at(-1)?.date ?? null;
  db.prepare(`INSERT INTO history_state (symbol, bars, first_date, last_date, fetched_at)
    VALUES (?,?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET
    bars=excluded.bars, first_date=excluded.first_date, last_date=excluded.last_date, fetched_at=excluded.fetched_at`)
    .run(symbol, stored, first, last, new Date().toISOString());
  return stored;
}

/**
 * Fetch and store the history for one symbol.
 *
 * `range` accepts Yahoo's own values: max, 10y, 5y, 2y, 1y, 6mo, 3mo, 1mo.
 */
export async function backfillSymbol(db: DB, symbol: string, range: keyof typeof RANGE_FOR = 'max'): Promise<HistoryResult> {
  const r = RANGE_FOR[range] ?? 'max';
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
    + `?range=${r}&interval=1d&events=div%2Csplit`;
  const res = await polite.get(url);
  if (!res.ok || !res.body) {
    return { symbol, bars: 0, from: null, to: null, dividends: 0, splits: 0, stored: 0,
      fromCache: res.cached, error: res.error ?? `the history source returned HTTP ${res.status}` };
  }
  const parsed = parseHistory(res.body);
  if (parsed.error) {
    return { symbol, bars: 0, from: null, to: null, dividends: 0, splits: 0, stored: 0,
      fromCache: res.cached, error: parsed.error };
  }
  const stored = storeHistory(db, symbol, parsed);
  return {
    symbol, bars: parsed.bars.length,
    from: parsed.bars[0]?.date ?? null, to: parsed.bars.at(-1)?.date ?? null,
    dividends: parsed.dividends.length, splits: parsed.splits.length,
    stored, fromCache: res.cached, error: null,
  };
}

/** What history is already stored for a symbol. */
export function historySummary(db: DB, symbol: string): { bars: number; first: string | null; last: string | null; fetchedAt: string | null } | null {
  try {
    ensureTables(db);
    const row = db.prepare('SELECT bars, first_date, last_date, fetched_at FROM history_state WHERE symbol = ?')
      .get(symbol) as { bars: number; first_date: string; last_date: string; fetched_at: string } | undefined;
    return row ? { bars: row.bars, first: row.first_date, last: row.last_date, fetchedAt: row.fetched_at } : null;
  } catch { return null; }
}

/** The corporate actions stored for a symbol, newest first. */
export function actionsFor(db: DB, symbol: string): Array<{ date: string; kind: string; value: number }> {
  try {
    ensureTables(db);
    return db.prepare('SELECT date, kind, value FROM price_actions WHERE symbol = ? ORDER BY date DESC')
      .all(symbol) as Array<{ date: string; kind: string; value: number }>;
  } catch { return []; }
}
