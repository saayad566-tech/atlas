// Balance-sheet strength and cash quality.
//
// EBITDA here is the stored operating profit (before interest and depreciation),
// which is what the statements carry. Net debt is borrowings minus cash.
import type { Database as DB } from 'better-sqlite3';
import { loadSeries, type Series } from './metrics';

export interface Strength {
  symbol: string;
  ebitda: number;
  netDebt: number;
  netDebtToEbitda: number | null;
  debtRepaymentYears: number | null;
  cashConversionPct: number | null;
  workingCapital: number;
  workingCapitalIntensityPct: number | null;
  workingCapitalTrend: number | null;
  interestCover: number | null;
  interestCoverTrend: number | null;
  currentRatioProxy: number | null;
  verdict: 'fortress' | 'solid' | 'stretched' | 'fragile';
  notes: string[];
}

const r2 = (n: number): number => Math.round(n * 100) / 100;
const safe = (n: number, d: number): number => (d === 0 ? 0 : n / d);

function slope(values: number[]): number | null {
  const n = values.length;
  if (n < 3) return null;
  const mx = (n - 1) / 2; const my = values.reduce((a, b) => a + b, 0) / n;
  let num = 0; let den = 0;
  for (let i = 0; i < n; i++) { num += (i - mx) * (values[i]! - my); den += (i - mx) ** 2; }
  return den === 0 ? null : r2(num / den);
}

const workingCapital = (s: Series): number => (s.receivables + s.inventory + s.cash) - s.payables;

export function strength(db: DB, symbol: string): Strength | null {
  const c = db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
  if (!c) return null;
  const s = loadSeries(db, c.id);
  if (s.length === 0) return null;
  const cur = s[s.length - 1]!;

  const ebitda = cur.operatingProfit;
  const netDebt = cur.borrowings - cur.cash;
  const fcf = cur.cfo - Math.abs(cur.depreciation);
  const wc = workingCapital(cur);

  const netDebtToEbitda = ebitda > 0 ? r2(netDebt / ebitda) : null;
  const debtRepaymentYears = fcf > 0 && netDebt > 0 ? r2(netDebt / fcf) : netDebt <= 0 ? 0 : null;
  const cashConversionPct = ebitda > 0 ? r2(safe(cur.cfo, ebitda) * 100) : null;
  const wcIntensity = cur.sales > 0 ? r2((wc / cur.sales) * 100) : null;
  const wcTrend = slope(s.slice(-5).map((x) => (x.sales > 0 ? (workingCapital(x) / x.sales) * 100 : 0)));
  const interestCover = cur.interest > 0 ? r2(ebitda / cur.interest) : null;
  const interestCoverTrend = slope(s.slice(-5).map((x) => (x.interest > 0 ? x.operatingProfit / x.interest : 0)));
  const currentRatioProxy = cur.payables > 0 ? r2((cur.receivables + cur.inventory + cur.cash) / cur.payables) : null;

  // Verdict from the worst of leverage, cover and cash conversion.
  let verdict: Strength['verdict'] = 'solid';
  const nd = netDebtToEbitda ?? 0;
  const ic = interestCover ?? 99;
  const cc = cashConversionPct ?? 100;
  if (nd <= 0 && ic >= 8 && cc >= 90) verdict = 'fortress';
  else if (nd > 4 || ic < 1.5 || cc < 50) verdict = 'fragile';
  else if (nd > 2.5 || ic < 3 || cc < 70) verdict = 'stretched';

  const notes: string[] = ['EBITDA = stored operating profit (before interest and depreciation).', 'Net debt = borrowings − cash.'];
  if (netDebt <= 0) notes.push('Net cash position — the balance sheet carries no net debt.');

  return {
    symbol, ebitda: r2(ebitda), netDebt: r2(netDebt), netDebtToEbitda, debtRepaymentYears,
    cashConversionPct, workingCapital: r2(wc), workingCapitalIntensityPct: wcIntensity,
    workingCapitalTrend: wcTrend, interestCover, interestCoverTrend, currentRatioProxy, verdict, notes,
  };
}
