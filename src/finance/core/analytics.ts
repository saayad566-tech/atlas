// Analytics over a screen's results and across sectors.
import type { Database as DB } from 'better-sqlite3';
import type { ScreenerRow } from './types';

export interface Stat { min: number; p25: number; median: number; p75: number; max: number; mean: number }
export type Stats = Record<string, Stat>;

const quantile = (sorted: number[], q: number): number => {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos); const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
};

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Distribution statistics for the numeric columns of a result set. */
export function screenStats(rows: ScreenerRow[]): Stats {
  // A column getter may return null when the value is genuinely missing; the filter below drops those.
  const cols: Array<[string, (r: ScreenerRow) => number | null]> = [
    ['marketCap', (r) => r.marketCap], ['pe', (r) => r.pe], ['pb', (r) => r.pb], ['roe', (r) => r.roe],
    ['roce', (r) => r.roce], ['debtToEquity', (r) => r.debtToEquity], ['sales', (r) => r.sales],
    ['netProfit', (r) => r.netProfit], ['opm', (r) => r.opm], ['npm', (r) => r.npm],
    ['salesGrowth3y', (r) => r.salesGrowth3y], ['profitGrowth3y', (r) => r.profitGrowth3y],
    ['promoterHolding', (r) => r.promoterHolding], ['pledge', (r) => r.pledge],
  ];
  const out: Stats = {};
  for (const [key, get] of cols) {
    const vals = rows.map(get).filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
    if (vals.length === 0) continue;
    out[key] = {
      min: r2(vals[0]!), p25: r2(quantile(vals, 0.25)), median: r2(quantile(vals, 0.5)),
      p75: r2(quantile(vals, 0.75)), max: r2(vals[vals.length - 1]!),
      mean: r2(vals.reduce((a, b) => a + b, 0) / vals.length),
    };
  }
  return out;
}

export interface SectorBenchmark {
  sector: string; companies: number; medianPe: number; medianRoe: number; medianOpm: number;
  medianDebtToEquity: number; medianSalesGrowth: number; medianMarketCap: number;
}

export function sectorBenchmarks(db: DB): SectorBenchmark[] {
  const rows = db.prepare(`SELECT sector, pe, roe, opm, debt_to_equity AS de, sales_growth_3y AS sg, market_cap AS mc FROM v_latest`).all() as Array<Record<string, number | string>>;
  const bySector = new Map<string, { pe: number[]; roe: number[]; opm: number[]; de: number[]; sg: number[]; mc: number[] }>();
  for (const r of rows) {
    const sec = String(r['sector']);
    if (!bySector.has(sec)) bySector.set(sec, { pe: [], roe: [], opm: [], de: [], sg: [], mc: [] });
    const b = bySector.get(sec)!;
    b.pe.push(Number(r['pe'])); b.roe.push(Number(r['roe'])); b.opm.push(Number(r['opm']));
    b.de.push(Number(r['de'])); b.sg.push(Number(r['sg'])); b.mc.push(Number(r['mc']));
  }
  const med = (a: number[]): number => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? r2(quantile(s, 0.5)) : 0; };
  return [...bySector.entries()].map(([sector, b]) => ({
    sector, companies: b.pe.length, medianPe: med(b.pe), medianRoe: med(b.roe), medianOpm: med(b.opm),
    medianDebtToEquity: med(b.de), medianSalesGrowth: med(b.sg), medianMarketCap: med(b.mc),
  })).sort((a, b) => b.companies - a.companies);
}

const SERIES_METRICS: Record<string, string> = {
  sales: 'sales', net_profit: 'net_profit', opm_pct: 'opm_pct', operating_profit: 'operating_profit',
  cfo: 'cfo', borrowings: 'borrowings', reserves: 'reserves', total_assets: 'total_assets',
  eps: 'eps', receivables: 'receivables', interest: 'interest', depreciation: 'depreciation',
};

/** Time series for one metric, oldest → newest. */
export function metricSeries(db: DB, symbol: string, metric: string, periodType: 'annual' | 'quarterly' = 'annual'): Array<{ periodEnd: string; value: number }> {
  const col = SERIES_METRICS[metric];
  if (!col) throw new Error(`Unknown metric "${metric}". Try: ${Object.keys(SERIES_METRICS).join(', ')}`);
  const c = db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
  if (!c) return [];
  return (db.prepare(`SELECT period_end AS periodEnd, ${col} AS value FROM statements WHERE company_id=? AND period_type=? ORDER BY period_end ASC`).all(c.id, periodType) as Array<{ periodEnd: string; value: number }>)
    .map((r) => ({ periodEnd: r.periodEnd, value: r2(r.value) }));
}

export const SERIES_METRIC_NAMES = Object.keys(SERIES_METRICS);
