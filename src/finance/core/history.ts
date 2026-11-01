// Multi-year metric history.
//
// A single year tells you what a business is; a series tells you what it is becoming.
// Every ratio here is recomputed from stored statements year by year, so the trend is
// built from the same arithmetic as the headline numbers rather than a separate source.
import type { Database as DB } from 'better-sqlite3';

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
