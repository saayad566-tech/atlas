// Cross-sectional factor model.
//
// Each factor is a 0–100 percentile computed across the whole universe (or within
// a sector for the neutral variant). A percentile is not an opinion — it is the
// company's rank on that measure relative to every other company stored locally.
import type { Database as DB } from 'better-sqlite3';
import { loadSeries } from './metrics';

export interface FactorSet {
  value: number;
  quality: number;
  growth: number;
  momentum: number;
  lowVol: number;
  size: number;
  composite: number;
  /** Sector-neutral z-scores for the underlying metrics. */
  zScores: Record<string, number>;
}

/** Percentile (0–100) of one company on a SQL expression, optionally within sector. */
export function percentileOf(db: DB, companyId: number, expr: string, sectorNeutral = false): number {
  // The window function must run over the whole table; filtering by id inside the
  // same SELECT would leave PERCENT_RANK with a single row (always 0).
  const over = sectorNeutral ? `PARTITION BY sector ORDER BY ${expr}` : `ORDER BY ${expr}`;
  const r = db.prepare(`WITH ranked AS (SELECT id, PERCENT_RANK() OVER (${over}) * 100 AS pct FROM v_latest)
    SELECT pct FROM ranked WHERE id=?`).get(companyId) as { pct: number } | undefined;
  return r ? Math.round(r.pct * 10) / 10 : 0;
}

/** Sector-neutral z-score: how many sector standard deviations from the sector mean. */
export function zScore(db: DB, companyId: number, expr: string): number {
  const r = db.prepare(`
    WITH s AS (
      SELECT id, sector, ${expr} AS x FROM v_latest
    ), agg AS (
      SELECT sector, AVG(x) AS mu, SQRT(AVG(x*x) - AVG(x)*AVG(x)) AS sd FROM s GROUP BY sector
    )
    SELECT CASE WHEN a.sd > 0 THEN (s.x - a.mu) / a.sd ELSE 0 END AS z
    FROM s JOIN agg a ON a.sector = s.sector WHERE s.id = ?`).get(companyId) as { z: number } | undefined;
  return r ? Math.round(r.z * 100) / 100 : 0;
}

const avg = (...xs: number[]): number => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;

/** Earnings-momentum: latest 3y growth minus the prior year's growth (acceleration). */
function earningsMomentum(db: DB, companyId: number): number {
  const s = loadSeries(db, companyId);
  if (s.length < 3) return 50;
  const last = s[s.length - 1]!; const prev = s[s.length - 2]!; const prev2 = s[s.length - 3]!;
  const g1 = prev.sales > 0 ? (last.sales / prev.sales - 1) * 100 : 0;
  const g0 = prev2.sales > 0 ? (prev.sales / prev2.sales - 1) * 100 : 0;
  // Map acceleration (-50..+50 pts) onto 0..100.
  return Math.max(0, Math.min(100, Math.round(50 + (g1 - g0) * 2)));
}

/** Earnings-volatility inverse: steadier profits score higher. */
function lowVolatility(db: DB, companyId: number): number {
  const s = loadSeries(db, companyId);
  const growths: number[] = [];
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1]!.netProfit; const b = s[i]!.netProfit;
    if (a > 0) growths.push((b / a - 1) * 100);
  }
  if (growths.length < 3) return 50;
  const mean = growths.reduce((x, y) => x + y, 0) / growths.length;
  const sd = Math.sqrt(growths.reduce((acc, g) => acc + (g - mean) ** 2, 0) / growths.length);
  return Math.max(0, Math.min(100, Math.round(100 - sd))); // sd 0 → 100, sd 100 → 0
}

export function factorsFor(db: DB, symbol: string): FactorSet | null {
  const c = db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
  if (!c) return null;
  const id = c.id;

  // Value: cheap on earnings and book, decent yield → high percentile.
  const pePct = percentileOf(db, id, 'pe');
  const pbPct = percentileOf(db, id, 'pb');
  const dyPct = percentileOf(db, id, 'dividend_yield');
  const value = avg(100 - pePct, 100 - pbPct, dyPct);

  // Quality: returns and margins.
  const quality = avg(percentileOf(db, id, 'roe'), percentileOf(db, id, 'roce'), percentileOf(db, id, 'opm'));

  // Growth: sales and profit growth.
  const growth = avg(percentileOf(db, id, 'sales_growth_3y'), percentileOf(db, id, 'profit_growth_3y'));

  const momentum = earningsMomentum(db, id);
  const lowVol = lowVolatility(db, id);
  const size = percentileOf(db, id, 'market_cap');

  // Composite: quality and value weighted highest; low-vol and momentum smaller.
  const composite = Math.round(value * 0.25 + quality * 0.30 + growth * 0.20 + momentum * 0.10 + lowVol * 0.05 + size * 0.10);

  const zScores = {
    roe: zScore(db, id, 'roe'), roce: zScore(db, id, 'roce'), pe: zScore(db, id, 'pe'),
    debtToEquity: zScore(db, id, 'debt_to_equity'), salesGrowth: zScore(db, id, 'sales_growth_3y'),
    opm: zScore(db, id, 'opm'), marketCap: zScore(db, id, 'market_cap'),
  };

  return { value, quality, growth, momentum, lowVol, size, composite, zScores };
}

/** Rank every company by composite factor score. */
export function rankUniverse(db: DB, opts: { limit?: number; sector?: string } = {}): Array<{ symbol: string; name: string; sector: string; composite: number; value: number; quality: number; growth: number; marketCap: number }> {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 50));
  const rows = db.prepare(`SELECT id, symbol, name, sector, market_cap FROM v_latest ${opts.sector ? 'WHERE sector=?' : ''} ORDER BY market_cap DESC LIMIT 500`)
    .all(...(opts.sector ? [opts.sector] : [])) as Array<{ id: number; symbol: string; name: string; sector: string; market_cap: number }>;
  const scored = rows.map((r) => {
    const f = factorsFor(db, r.symbol)!;
    return { symbol: r.symbol, name: r.name, sector: r.sector, composite: f.composite, value: f.value, quality: f.quality, growth: f.growth, marketCap: r.market_cap };
  });
  scored.sort((a, b) => b.composite - a.composite);
  return scored.slice(0, limit);
}
