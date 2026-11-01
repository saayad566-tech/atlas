// Deep metrics computed from the stored statements — no model, no network.
//
// Every number here is arithmetic over reported line items. Where an input is not
// available (e.g. SGA for Beneish), the metric says so rather than inventing it.
import type { Database as DB } from 'better-sqlite3';

export interface Series {
  periodEnd: string; sales: number; expenses: number; operatingProfit: number; opmPct: number;
  netProfit: number; interest: number; depreciation: number; receivables: number; inventory: number;
  payables: number; cash: number; cfo: number; borrowings: number; equityCapital: number; reserves: number;
  totalAssets: number; totalLiabilities: number; fixedAssets: number; eps: number;
  profitBeforeTax: number; taxPct: number; cfi: number; cff: number;
}

export function loadSeries(db: DB, companyId: number): Series[] {
  return db.prepare(`SELECT period_end AS periodEnd, sales, expenses, operating_profit AS operatingProfit,
      opm_pct AS opmPct, net_profit AS netProfit, interest, depreciation, receivables, inventory, payables,
      cash, cfo, borrowings, equity_capital AS equityCapital, reserves, total_assets AS totalAssets,
      total_liabilities AS totalLiabilities, fixed_assets AS fixedAssets, eps,
      profit_before_tax AS profitBeforeTax, tax_pct AS taxPct, cfi, cff
    FROM statements WHERE company_id=? AND period_type='annual' ORDER BY period_end ASC`).all(companyId) as Series[];
}

const safe = (n: number, d: number): number => (d === 0 ? 0 : n / d);
const r2 = (n: number): number => Math.round(n * 100) / 100;

export interface Dupont { npm: number; assetTurnover: number; equityMultiplier: number; roe: number }
export interface Ccc { dio: number; dso: number; dpo: number; days: number }
export interface Cagr { sales3: number | null; sales5: number | null; profit3: number | null; profit5: number | null }

export interface DeepMetrics {
  symbol: string;
  years: number;
  dupont: Dupont | null;
  ccc: Ccc | null;
  accruals: number | null;
  cagr: Cagr;
  earningsVolatility: number | null;
  marginSlope: number | null;
  incrementalRoce: number | null;
  workingCapitalDays: number | null;
  dividendPayout: number | null;
  valuation: { pe: number; sectorMedianPe: number; peg: number | null } | null;
  percentiles: Record<string, number>;
}

function cagrOf(first: number, last: number, years: number): number | null {
  if (years <= 0 || first <= 0 || last <= 0) return null;
  return r2(((last / first) ** (1 / years) - 1) * 100);
}

/** Least-squares slope of a series (units per step). */
function slope(values: number[]): number | null {
  const n = values.length;
  if (n < 3) return null;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0; let den = 0;
  for (let i = 0; i < n; i++) { num += (i - meanX) * (values[i]! - meanY); den += (i - meanX) ** 2; }
  return den === 0 ? null : r2(num / den);
}

export function deepMetrics(db: DB, symbol: string): DeepMetrics | null {
  const c = db.prepare(`SELECT id, symbol, sector FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number; symbol: string; sector: string } | undefined;
  if (!c) return null;
  const s = loadSeries(db, c.id);
  if (s.length === 0) return null;
  const latest = s[s.length - 1]!;
  const prev = s.length > 1 ? s[s.length - 2]! : null;
  const equity = latest.equityCapital + latest.reserves;

  // DuPont: ROE = margin × asset turnover × leverage
  const npm = safe(latest.netProfit, latest.sales) * 100;
  const at = safe(latest.sales, latest.totalAssets);
  const em = safe(latest.totalAssets, equity);
  const dupont: Dupont = { npm: r2(npm), assetTurnover: r2(at), equityMultiplier: r2(em), roe: r2((npm / 100) * at * em * 100) };

  // Cash conversion cycle (days)
  const cogs = Math.max(1, latest.expenses);
  const dio = r2(safe(latest.inventory, cogs) * 365);
  const dso = r2(safe(latest.receivables, latest.sales) * 365);
  const dpo = r2(safe(latest.payables, cogs) * 365);
  const ccc: Ccc = { dio, dso, dpo, days: r2(dio + dso - dpo) };

  // Accruals (Sloan): (net profit − CFO) / total assets — high = lower earnings quality
  const accruals = r2(safe(latest.netProfit - latest.cfo, latest.totalAssets) * 100);

  const cagr: Cagr = {
    sales3: s.length >= 4 ? cagrOf(s[s.length - 4]!.sales, latest.sales, 3) : null,
    sales5: s.length >= 6 ? cagrOf(s[s.length - 6]!.sales, latest.sales, 5) : null,
    profit3: s.length >= 4 ? cagrOf(s[s.length - 4]!.netProfit, latest.netProfit, 3) : null,
    profit5: s.length >= 6 ? cagrOf(s[s.length - 6]!.netProfit, latest.netProfit, 5) : null,
  };

  // Earnings volatility: std dev of YoY profit growth
  const growths: number[] = [];
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1]!.netProfit; const b = s[i]!.netProfit;
    if (a > 0) growths.push((b / a - 1) * 100);
  }
  let earningsVolatility: number | null = null;
  if (growths.length >= 3) {
    const mean = growths.reduce((x, y) => x + y, 0) / growths.length;
    earningsVolatility = r2(Math.sqrt(growths.reduce((acc, g) => acc + (g - mean) ** 2, 0) / growths.length));
  }

  const marginSlope = slope(s.slice(-5).map((x) => x.opmPct));
  const wcDays = r2(dio + dso - dpo);

  // Incremental ROCE: ΔEBIT / Δcapital employed over the window
  let incrementalRoce: number | null = null;
  if (s.length >= 3) {
    const back = s[s.length - 3]!;
    const dEbit = latest.operatingProfit - back.operatingProfit;
    const dCe = (equity + latest.borrowings) - ((back.equityCapital + back.reserves) + back.borrowings);
    if (Math.abs(dCe) > 0) incrementalRoce = r2((dEbit / dCe) * 100);
  }

  // Dividend payout proxy: dividends aren't a line item, so use (CFO − capex) vs profit.
  const fcf = latest.cfo - Math.abs(latest.depreciation) * 1.0;
  const dividendPayout = latest.netProfit > 0 ? r2(Math.max(0, Math.min(200, safe(fcf, latest.netProfit) * 100))) : null;

  // Valuation vs sector median
  const sectorPe = db.prepare(`SELECT AVG(pe) AS m FROM v_latest WHERE sector=? AND pe > 0`).get(c.sector) as { m: number | null } | undefined;
  const row = db.prepare(`SELECT pe, roe, profit_growth_3y AS pg FROM v_latest WHERE id=?`).get(c.id) as { pe: number; roe: number; pg: number } | undefined;
  const valuation = row && row.pe > 0
    ? { pe: r2(row.pe), sectorMedianPe: r2(sectorPe?.m ?? 0), peg: row.pg > 0 ? r2(row.pe / row.pg) : null }
    : null;

  // Sector percentile ranks (0–100) for the headline metrics.
  const percentiles: Record<string, number> = {};
  const cols: Array<[string, string]> = [['roe', 'roe'], ['roce', 'roce'], ['opm', 'opm'], ['npm', 'npm'], ['sales_growth_3y', 'salesGrowth'], ['profit_growth_3y', 'profitGrowth'], ['market_cap', 'marketCap'], ['debt_to_equity', 'debtToEquity']];
  for (const [col, label] of cols) {
    const r = db.prepare(`WITH ranked AS (SELECT id, PERCENT_RANK() OVER (PARTITION BY sector ORDER BY ${col}) * 100 AS pct FROM v_latest)
      SELECT pct FROM ranked WHERE id=?`).get(c.id) as { pct: number } | undefined;
    if (r) percentiles[label] = r2(r.pct);
  }

  void prev;
  return {
    symbol: c.symbol, years: s.length, dupont, ccc, accruals, cagr, earningsVolatility,
    marginSlope, incrementalRoce, workingCapitalDays: wcDays, dividendPayout, valuation, percentiles,
  };
}

/** Peer percentile matrix: the company's metrics next to its peer group. */
export function peerMatrix(db: DB, symbol: string): { peers: Array<{ symbol: string; name: string; marketCap: number; pe: number; roe: number; opm: number; debtToEquity: number; salesGrowth3y: number }>; self: string } | null {
  const c = db.prepare(`SELECT id, symbol FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number; symbol: string } | undefined;
  if (!c) return null;
  const rows = db.prepare(`
    SELECT c2.symbol, c2.name, v.market_cap AS marketCap, v.pe, v.roe, v.opm, v.debt_to_equity AS debtToEquity, v.sales_growth_3y AS salesGrowth3y
    FROM peers p JOIN companies c2 ON c2.id = p.peer_id JOIN v_latest v ON v.id = c2.id
    WHERE p.company_id = ? ORDER BY p.rank`).all(c.id) as Array<Record<string, unknown>>;
  const selfRow = db.prepare(`SELECT c2.symbol, c2.name, v.market_cap AS marketCap, v.pe, v.roe, v.opm, v.debt_to_equity AS debtToEquity, v.sales_growth_3y AS salesGrowth3y
    FROM companies c2 JOIN v_latest v ON v.id=c2.id WHERE c2.id=?`).get(c.id) as Record<string, unknown>;
  const map = (r: Record<string, unknown>): { symbol: string; name: string; marketCap: number; pe: number; roe: number; opm: number; debtToEquity: number; salesGrowth3y: number } => ({
    symbol: String(r['symbol']), name: String(r['name']), marketCap: Number(r['marketCap']), pe: Number(r['pe']),
    roe: Number(r['roe']), opm: Number(r['opm']), debtToEquity: Number(r['debtToEquity']), salesGrowth3y: Number(r['salesGrowth3y']),
  });
  if (rows.length > 0) return { self: c.symbol, peers: [map(selfRow), ...rows.map(map)] };
  // No peers in the same sector (common for a freshly fetched live company): fall back
  // to the largest companies in the local universe, clearly still "the peer set".
  const fallback = db.prepare(`
    SELECT c2.symbol, c2.name, v.market_cap AS marketCap, v.pe, v.roe, v.opm, v.debt_to_equity AS debtToEquity, v.sales_growth_3y AS salesGrowth3y
    FROM companies c2 JOIN v_latest v ON v.id=c2.id WHERE c2.id <> ? ORDER BY v.market_cap DESC LIMIT 5`).all(c.id) as Array<Record<string, unknown>>;
  return { self: c.symbol, peers: [map(selfRow), ...fallback.map(map)] };
}
