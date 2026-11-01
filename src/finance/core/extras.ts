// Extra analytics and quality-of-life computations. Pure functions so each one can be
// checked numerically instead of being trusted because it renders.

const r2 = (v: number): number => Math.round(v * 100) / 100;
const safe = (v: number | null | undefined, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// ---------- valuation extras ----------
/** Earnings yield — the inverse of P/E, comparable across rates. */
export function earningsYield(pe: number): number | null { return pe > 0 ? r2(100 / pe) : null; }

/** PEG — P/E divided by growth. Below 1 is traditionally "cheap for the growth". */
export function pegRatio(pe: number, growthPct: number): number | null {
  if (pe <= 0 || growthPct <= 0) return null;
  return r2(pe / growthPct);
}

/** Graham number — sqrt(22.5 × EPS × BVPS). A conservative fair-value floor. */
export function grahamNumber(eps: number, bookValuePerShare: number): number | null {
  if (eps <= 0 || bookValuePerShare <= 0) return null;
  return r2(Math.sqrt(22.5 * eps * bookValuePerShare));
}

// Removed netNetWorkingCapital: needs current assets and total liabilities per period, which v_latest does not expose. Left out rather than shipped with a weak basis.

/** Cash conversion: operating cash flow as a share of net profit. >100% is high quality. */
export function cashConversion(cfo: number, netProfit: number): number | null {
  if (netProfit <= 0) return null;
  return r2((cfo / netProfit) * 100);
}

// ---------- risk extras ----------
// Removed beta: needs a reliable market benchmark; a proxy of stored companies is not a defensible beta. Left out rather than shipped with a weak basis.

/** Annualised volatility from daily returns, percent. */
export function volatility(dailyReturns: number[]): number | null {
  const n = dailyReturns.length;
  if (n < 10) return null;
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / n;
  const variance = dailyReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return r2(Math.sqrt(variance) * Math.sqrt(252) * 100);
}

/** Where the last price sits in its 52-week range: 0 = at the low, 100 = at the high. */
export function rangePosition(last: number, low52: number, high52: number): number | null {
  if (!(high52 > low52)) return null;
  return r2(((last - low52) / (high52 - low52)) * 100);
}

/** Sharpe-like ratio using zero as the risk-free rate. */
export function sharpe(annualReturnPct: number, annualVolPct: number): number | null {
  if (annualVolPct <= 0) return null;
  return r2(annualReturnPct / annualVolPct);
}

/** Maximum drawdown from a price series, percent (negative). */
export function maxDrawdown(prices: number[]): number | null {
  if (prices.length < 2) return null;
  let peak = prices[0]!; let worst = 0;
  for (const p of prices) { if (p > peak) peak = p; if (peak > 0) worst = Math.min(worst, (p - peak) / peak); }
  return r2(worst * 100);
}

// ---------- quality extras ----------
/** Revenue per employee — a rough operating-efficiency gauge. */
export function revenuePerEmployee(sales: number, employees: number): number | null {
  if (employees <= 0 || sales <= 0) return null;
  return r2(sales / employees);
}

/** Working-capital trend: positive means the company is tying up more cash over time. */
export function workingCapitalTrend(currentAssets: number[], currentLiabilities: number[]): 'improving' | 'deteriorating' | 'stable' | null {
  const n = Math.min(currentAssets.length, currentLiabilities.length);
  if (n < 2) return null;
  const wc = (i: number): number => currentAssets[i]! - currentLiabilities[i]!;
  const first = wc(0); const last = wc(n - 1);
  const change = first === 0 ? 0 : (last - first) / Math.abs(first);
  if (change > 0.1) return 'improving';
  if (change < -0.1) return 'deteriorating';
  return 'stable';
}

/** Margin trend direction across a series. */
export function marginTrend(values: number[]): 'expanding' | 'contracting' | 'flat' | null {
  if (values.length < 2) return null;
  const delta = values[values.length - 1]! - values[0]!;
  if (delta > 0.5) return 'expanding';
  if (delta < -0.5) return 'contracting';
  return 'flat';
}

/** Analyst dispersion: how divided the price targets are. */
export function analystDispersion(low: number, high: number, mean: number): { spreadPct: number; verdict: string } | null {
  if (!(mean > 0) || !(high >= low)) return null;
  const spreadPct = r2(((high - low) / mean) * 100);
  const verdict = spreadPct > 60 ? 'very divided' : spreadPct > 30 ? 'divided' : 'broadly aligned';
  return { spreadPct, verdict };
}

/** Simple quality grade from the classic trio: returns, leverage, consistency. */
export function qualityGrade(roe: number, debtToEquity: number, opm: number): 'A' | 'B' | 'C' | 'D' {
  let score = 0;
  if (roe >= 20) score += 3; else if (roe >= 15) score += 2; else if (roe >= 10) score += 1;
  if (debtToEquity <= 0.3) score += 3; else if (debtToEquity <= 0.8) score += 2; else if (debtToEquity <= 1.5) score += 1;
  if (opm >= 20) score += 2; else if (opm >= 10) score += 1;
  return score >= 7 ? 'A' : score >= 5 ? 'B' : score >= 3 ? 'C' : 'D';
}

// ---------- portfolio extras ----------
export interface HoldingLite { symbol: string; sector: string; value: number; pnlPct: number }

/** Allocation by sector, percent of portfolio. */
export function sectorAllocation(holdings: HoldingLite[]): Array<{ sector: string; value: number; pct: number }> {
  const total = holdings.reduce((a, h) => a + h.value, 0);
  if (total <= 0) return [];
  const by = new Map<string, number>();
  for (const h of holdings) by.set(h.sector || 'Unclassified', (by.get(h.sector || 'Unclassified') ?? 0) + h.value);
  return [...by.entries()].map(([sector, value]) => ({ sector, value: r2(value), pct: r2((value / total) * 100) })).sort((a, b) => b.value - a.value);
}

/** Concentration warning when one position or sector dominates. */
export function concentrationWarnings(holdings: HoldingLite[]): string[] {
  const out: string[] = [];
  const total = holdings.reduce((a, h) => a + h.value, 0);
  if (total <= 0) return out;
  for (const h of holdings) {
    const pct = (h.value / total) * 100;
    if (pct >= 40) out.push(`${h.symbol} is ${r2(pct)}% of the portfolio — a single-stock risk`);
  }
  for (const s of sectorAllocation(holdings)) {
    if (s.pct >= 60) out.push(`${s.sector} is ${s.pct}% of the portfolio — sector concentration`);
  }
  return out;
}

/** Herfindahl-based diversification score, 0 (concentrated) to 100 (even). */
export function diversificationScore(holdings: HoldingLite[]): number | null {
  const total = holdings.reduce((a, h) => a + h.value, 0);
  if (total <= 0 || holdings.length < 2) return null;
  const hhi = holdings.reduce((a, h) => a + (h.value / total) ** 2, 0);
  const n = holdings.length;
  const normalised = (hhi - 1 / n) / (1 - 1 / n);
  return r2(Math.max(0, Math.min(100, (1 - normalised) * 100)));
}

/** Rebalancing hint: which positions are furthest from an equal weight. */
export function rebalanceHints(holdings: HoldingLite[], targetPct?: number): Array<{ symbol: string; currentPct: number; targetPct: number; action: string }> {
  const total = holdings.reduce((a, h) => a + h.value, 0);
  if (total <= 0 || holdings.length === 0) return [];
  const target = targetPct ?? r2(100 / holdings.length);
  return holdings.map((h) => {
    const currentPct = r2((h.value / total) * 100);
    const diff = currentPct - target;
    return { symbol: h.symbol, currentPct, targetPct: target, action: diff > 3 ? 'trim' : diff < -3 ? 'add' : 'hold' };
  }).sort((a, b) => Math.abs(b.currentPct - b.targetPct) - Math.abs(a.currentPct - a.targetPct));
}

// ---------- screener extras ----------
/** Distribution of a metric across results, in fixed buckets. */
export function histogram(values: number[], bucketCount = 6): Array<{ from: number; to: number; count: number }> {
  const clean = values.filter((v) => Number.isFinite(v));
  if (!clean.length) return [];
  const min = Math.min(...clean); const max = Math.max(...clean);
  if (min === max) return [{ from: min, to: max, count: clean.length }];
  const width = (max - min) / bucketCount;
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({ from: r2(min + i * width), to: r2(min + (i + 1) * width), count: 0 }));
  for (const v of clean) {
    const idx = Math.min(bucketCount - 1, Math.floor((v - min) / width));
    buckets[idx]!.count++;
  }
  return buckets;
}

/** Which symbols appear in the new screen but not the old one. */
export function screenDiff(previous: string[], current: string[]): { added: string[]; removed: string[]; kept: number } {
  const prev = new Set(previous); const cur = new Set(current);
  return {
    added: current.filter((s) => !prev.has(s)),
    removed: previous.filter((s) => !cur.has(s)),
    kept: current.filter((s) => prev.has(s)).length,
  };
}

/** Count by sector for the current result set. */
export function sectorBreakdown(rows: Array<{ sector?: string }>): Array<{ sector: string; count: number }> {
  const by = new Map<string, number>();
  for (const r of rows) { const s = r.sector || 'Unclassified'; by.set(s, (by.get(s) ?? 0) + 1); }
  return [...by.entries()].map(([sector, count]) => ({ sector, count })).sort((a, b) => b.count - a.count);
}

/** Nearest neighbours by simple metric distance — "companies like this one". */
export function similarCompanies(target: { pe: number; roe: number; opm: number }, pool: Array<{ symbol: string; name: string; pe: number; roe: number; opm: number }>, limit = 5): Array<{ symbol: string; name: string; distance: number }> {
  const scale = (v: number, ref: number): number => (ref === 0 ? 0 : (v - ref) / Math.abs(ref));
  return pool
    .filter((p) => p.pe > 0 && p.roe !== 0)
    .map((p) => ({
      symbol: p.symbol, name: p.name,
      distance: r2(Math.sqrt(scale(p.pe, target.pe) ** 2 + scale(p.roe, target.roe) ** 2 + scale(p.opm, target.opm) ** 2)),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

/** Table to TSV for clipboard copy. */
export function toTsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]!);
  return [cols.join('\t'), ...rows.map((r) => cols.map((c) => String(r[c] ?? '')).join('\t'))].join('\n');
}

/** Market-cap category label. */
export function capCategory(marketCapCr: number): 'large' | 'mid' | 'small' | 'micro' | 'unknown' {
  if (!(marketCapCr > 0)) return 'unknown';
  if (marketCapCr >= 20000) return 'large';
  if (marketCapCr >= 5000) return 'mid';
  if (marketCapCr >= 500) return 'small';
  return 'micro';
}

/** Everything above, in one call, for a company row. */
export function companyExtras(row: Record<string, number>): Record<string, unknown> {
  const pe = safe(row['pe']); const roe = safe(row['roe']); const opm = safe(row['opm']);
  const de = safe(row['debt_to_equity']); const eps = safe(row['eps']);
  const sales = safe(row['sales']); const netProfit = safe(row['net_profit']);
  const cfo = safe(row['cfo']);
  const bvps = safe(row['book_value_per_share'] ?? 0);
  return {
    earningsYield: earningsYield(pe),
    peg: pegRatio(pe, safe(row['profit_growth_3y'])),
    graham: grahamNumber(eps, bvps),
    cashConversion: cashConversion(cfo, netProfit),
    revenuePerEmployee: revenuePerEmployee(sales, safe(row['employees'])),
    quality: qualityGrade(roe, de, opm),
    capCategory: capCategory(safe(row['market_cap'])),
  };
}
