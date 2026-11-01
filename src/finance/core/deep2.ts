// Deep analysis v2 — capital efficiency, quality trends, anomalies and data quality.
//
// Everything is computed from the stored statements, so it works the same for a demo
// company and a live-fetched one. Each output names the input it needs; where the data
// is missing the field is null rather than a zero that looks real.
import type { Database as DB } from 'better-sqlite3';
import { loadSeries, type Series } from './metrics';
import { waccLite } from './valuation2';

const r2 = (n: number): number => Math.round(n * 100) / 100;
const safe = (n: number, d: number): number => (d === 0 ? 0 : n / d);

export interface TrendPoint { period: string; value: number | null }

export interface Anomaly { period: string; metric: string; changePct: number; note: string }

export interface Deep2 {
  symbol: string;
  // 1-5 capital efficiency
  investedCapital: number | null;
  roic: number | null;
  wacc: number | null;
  eva: number | null;               // economic value added, ₹ Cr
  reinvestmentRate: number | null;  // %
  growthQuality: number | null;     // reinvestment × ROIC
  // 6-12 trends
  dupontTrend: Array<{ period: string; npm: number | null; assetTurnover: number | null; equityMultiplier: number | null; roe: number | null }>;
  roeStability: number | null;      // σ of ROE, percentage points
  earningsQualityTrend: TrendPoint[];
  cashConversionTrend: TrendPoint[];
  wcDaysTrend: TrendPoint[];
  marginTrend: TrendPoint[];
  debtTrend: TrendPoint[];
  // 13-16 quarterly
  quarterlyYoY: Array<{ period: string; sales: number | null; netProfit: number | null }>;
  quarterlyQoQ: Array<{ period: string; salesGrowth: number | null; profitGrowth: number | null }>;
  // 17-20 quality & risk
  capitalAllocation: { cfo: number; capex: number; debtChange: number; verdict: string } | null;
  anomalies: Anomaly[];
  revenueVsReceivables: { salesGrowth: number | null; receivableGrowth: number | null; divergence: number | null } | null;
  // 21-22 scores
  dataQuality: { score: number; missing: string[] };
  valuationVsHistory: { currentPe: number | null; medianPe: number | null; premiumPct: number | null } | null;
  scorecard: { score: number; grade: 'A' | 'B' | 'C' | 'D'; parts: Record<string, number> };
}

const trend = (rows: Series[], pick: (s: Series) => number | null): TrendPoint[] =>
  rows.map((s) => ({ period: s.periodEnd, value: pick(s) }));

export function deep2(db: DB, symbol: string): Deep2 | null {
  const c = db.prepare(`SELECT id, sector FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number; sector: string } | undefined;
  if (!c) return null;
  const s = loadSeries(db, c.id);
  if (s.length === 0) {
    return {
      symbol: symbol.toUpperCase(), investedCapital: null, roic: null, wacc: null, eva: null, reinvestmentRate: null, growthQuality: null,
      dupontTrend: [], roeStability: null, earningsQualityTrend: [], cashConversionTrend: [], wcDaysTrend: [], marginTrend: [], debtTrend: [],
      quarterlyYoY: [], quarterlyQoQ: [], capitalAllocation: null, anomalies: [], revenueVsReceivables: null,
      dataQuality: { score: 0, missing: ['statements'] }, valuationVsHistory: null,
      scorecard: { score: 0, grade: 'D', parts: {} },
    };
  }
  const cur = s[s.length - 1]!;
  const prev = s.length > 1 ? s[s.length - 2]! : null;
  const equity = cur.equityCapital + cur.reserves;
  const mc = (db.prepare(`SELECT market_cap FROM v_latest WHERE id=?`).get(c.id) as { market_cap: number } | undefined)?.market_cap ?? 0;

  // ---- 1-5 capital efficiency -------------------------------------------------
  // Invested capital = equity + debt − cash (the capital actually deployed).
  const investedCapital = equity + cur.borrowings - cur.cash;
  const nopat = cur.operatingProfit * (1 - (cur.taxPct || 25) / 100);
  const roic = investedCapital > 0 ? r2((nopat / investedCapital) * 100) : null;
  const wacc = waccLite(mc);
  const eva = roic !== null ? r2((nopat - (wacc / 100) * investedCapital)) : null;
  const reinvestmentRate = nopat !== 0 ? r2(((Math.abs(cur.cfi) + Math.max(0, cur.borrowings - (prev?.borrowings ?? cur.borrowings))) / Math.abs(nopat)) * 100) : null;
  const growthQuality = roic !== null && reinvestmentRate !== null ? r2((reinvestmentRate / 100) * roic) : null;

  // ---- 6-12 trends ------------------------------------------------------------
  const dupontTrend = s.slice(-5).map((x) => {
    const eq = x.equityCapital + x.reserves;
    const npm = x.sales > 0 ? (x.netProfit / x.sales) * 100 : null;
    const at = x.totalAssets > 0 ? x.sales / x.totalAssets : null;
    const em = eq > 0 ? x.totalAssets / eq : null;
    return {
      period: x.periodEnd,
      npm: npm === null ? null : r2(npm),
      assetTurnover: at === null ? null : r2(at),
      equityMultiplier: em === null ? null : r2(em),
      roe: npm !== null && at !== null && em !== null ? r2((npm / 100) * at * em * 100) : null,
    };
  });

  const roes = dupontTrend.map((d) => d.roe).filter((v): v is number => v !== null);
  let roeStability: number | null = null;
  if (roes.length >= 3) {
    const mean = roes.reduce((a, b) => a + b, 0) / roes.length;
    roeStability = r2(Math.sqrt(roes.reduce((acc, v) => acc + (v - mean) ** 2, 0) / roes.length));
  }

  const earningsQualityTrend = trend(s.slice(-5), (x) => r2(safe(x.netProfit - x.cfo, x.totalAssets) * 100));
  const cashConversionTrend = trend(s.slice(-5), (x) => (x.operatingProfit > 0 ? r2(safe(x.cfo, x.operatingProfit) * 100) : null));
  const wcDaysTrend = trend(s.slice(-5), (x) => {
    const cogs = Math.max(1, x.expenses);
    const dio = safe(x.inventory, cogs) * 365;
    const dso = safe(x.receivables, x.sales) * 365;
    const dpo = safe(x.payables, cogs) * 365;
    return r2(dio + dso - dpo);
  });
  const marginTrend = trend(s.slice(-5), (x) => r2(x.opmPct));
  const debtTrend = trend(s.slice(-5), (x) => {
    const eq = x.equityCapital + x.reserves;
    return eq > 0 ? r2(x.borrowings / eq) : null;
  });

  // ---- 13-16 quarterly --------------------------------------------------------
  const q = db.prepare(`SELECT period_end, sales, net_profit FROM statements WHERE company_id=? AND period_type='quarterly' ORDER BY period_end ASC`).all(c.id) as Array<{ period_end: string; sales: number; net_profit: number }>;
  const quarterlyYoY = q.map((row, i) => {
    const yearAgo = q[i - 4];
    return {
      period: row.period_end,
      sales: yearAgo && yearAgo.sales > 0 ? r2((row.sales / yearAgo.sales - 1) * 100) : null,
      netProfit: yearAgo && yearAgo.net_profit > 0 ? r2((row.net_profit / yearAgo.net_profit - 1) * 100) : null,
    };
  }).slice(-8);
  const quarterlyQoQ = q.map((row, i) => {
    const prevQ = q[i - 1];
    return {
      period: row.period_end,
      salesGrowth: prevQ && prevQ.sales > 0 ? r2((row.sales / prevQ.sales - 1) * 100) : null,
      profitGrowth: prevQ && prevQ.net_profit > 0 ? r2((row.net_profit / prevQ.net_profit - 1) * 100) : null,
    };
  }).slice(-8);

  // ---- 17-20 quality & risk ---------------------------------------------------
  const capex = Math.abs(cur.cfi);
  const debtChange = prev ? cur.borrowings - prev.borrowings : 0;
  let verdict = 'balanced';
  if (cur.cfo > capex && debtChange <= 0) verdict = 'self-funding, deleveraging';
  else if (cur.cfo > capex && debtChange > 0) verdict = 'self-funding, investing';
  else if (cur.cfo < capex && debtChange > 0) verdict = 'growth funded by debt';
  else if (cur.cfo < capex) verdict = 'capex above operating cash flow';
  const capitalAllocation = { cfo: r2(cur.cfo), capex: r2(capex), debtChange: r2(debtChange), verdict };

  const anomalies: Anomaly[] = [];
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1]!; const b = s[i]!;
    const check = (metric: string, av: number, bv: number): void => {
      if (Math.abs(av) < 1) return;
      const ch = ((bv - av) / Math.abs(av)) * 100;
      if (Math.abs(ch) >= 50) anomalies.push({ period: b.periodEnd, metric, changePct: r2(ch), note: `${metric} moved ${ch > 0 ? '+' : ''}${r2(ch)}% year on year` });
    };
    check('Sales', a.sales, b.sales);
    check('Net profit', a.netProfit, b.netProfit);
    check('Borrowings', a.borrowings, b.borrowings);
    check('Receivables', a.receivables, b.receivables);
  }

  let revenueVsReceivables: Deep2['revenueVsReceivables'] = null;
  if (prev && prev.sales > 0 && prev.receivables > 0) {
    const sg = r2((cur.sales / prev.sales - 1) * 100);
    const rg = r2((cur.receivables / prev.receivables - 1) * 100);
    revenueVsReceivables = { salesGrowth: sg, receivableGrowth: rg, divergence: r2(rg - sg) };
  }

  // ---- 21-22 data quality & valuation history ---------------------------------
  const required: Array<[string, number]> = [
    ['sales', cur.sales], ['net profit', cur.netProfit], ['operating profit', cur.operatingProfit],
    ['total assets', cur.totalAssets], ['equity', equity], ['borrowings', cur.borrowings],
    ['cash', cur.cash], ['cfo', cur.cfo], ['receivables', cur.receivables], ['inventory', cur.inventory],
    ['payables', cur.payables], ['interest', cur.interest], ['depreciation', cur.depreciation],
  ];
  const missing = required.filter(([, v]) => !v || v === 0).map(([k]) => k);
  const dataQuality = { score: Math.round(((required.length - missing.length) / required.length) * 100), missing };

  const peRows = db.prepare(`SELECT pe FROM ratios WHERE company_id=? AND period_type='annual' AND pe > 0 ORDER BY period_end`).all(c.id) as Array<{ pe: number }>;
  let valuationVsHistory: Deep2['valuationVsHistory'] = null;
  if (peRows.length >= 3) {
    const pes = peRows.map((r) => r.pe).sort((a, b) => a - b);
    const median = pes[Math.floor(pes.length / 2)]!;
    const current = pes[pes.length - 1]!;
    valuationVsHistory = { currentPe: r2(current), medianPe: r2(median), premiumPct: median > 0 ? r2(((current - median) / median) * 100) : null };
  }

  // ---- scorecard --------------------------------------------------------------
  const parts: Record<string, number> = {
    roic: roic === null ? 40 : Math.max(0, Math.min(100, (roic / 25) * 100)),
    stability: roeStability === null ? 50 : Math.max(0, Math.min(100, 100 - roeStability * 4)),
    cashConversion: (() => { const v = cashConversionTrend.at(-1)?.value; return v === null || v === undefined ? 50 : Math.max(0, Math.min(100, v)); })(),
    growthQuality: growthQuality === null ? 40 : Math.max(0, Math.min(100, (growthQuality / 20) * 100)),
    dataQuality: dataQuality.score,
  };
  const score = Math.round(parts['roic']! * 0.25 + parts['stability']! * 0.2 + parts['cashConversion']! * 0.2 + parts['growthQuality']! * 0.2 + parts['dataQuality']! * 0.15);
  const grade: Deep2['scorecard']['grade'] = score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 45 ? 'C' : 'D';

  return {
    symbol: symbol.toUpperCase(), investedCapital: r2(investedCapital), roic, wacc, eva, reinvestmentRate, growthQuality,
    dupontTrend, roeStability, earningsQualityTrend, cashConversionTrend, wcDaysTrend, marginTrend, debtTrend,
    quarterlyYoY, quarterlyQoQ, capitalAllocation, anomalies, revenueVsReceivables,
    dataQuality, valuationVsHistory, scorecard: { score, grade, parts },
  };
}
