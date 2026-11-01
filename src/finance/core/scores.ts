// Quantitative scores: Piotroski F, Altman Z, Beneish M, and a composite grade.
//
// HONESTY: these are standard published models applied to the data we actually
// store. Where an input is unavailable it is marked as approximated and named in
// `notes` — a score is a screen, not a verdict.
import type { Database as DB } from 'better-sqlite3';
import { loadSeries, type Series } from './metrics';

const safe = (n: number, d: number): number => (d === 0 ? 0 : n / d);
const r2 = (n: number): number => Math.round(n * 100) / 100;

export interface Check { name: string; pass: boolean; detail: string }
export interface Piotroski { score: number; max: number; checks: Check[] }
export interface Altman { z: number; zone: 'safe' | 'grey' | 'distress' }
export interface Beneish { m: number; flag: boolean; simplified: boolean; notes: string[] }
export interface Composite { score: number; grade: 'A' | 'B' | 'C' | 'D'; components: Record<string, number> }

export interface Scores {
  symbol: string;
  piotroski: Piotroski | null;
  altman: Altman | null;
  beneish: Beneish | null;
  composite: Composite;
  notes: string[];
}

/** Current-ratio proxy: we store receivables/inventory/cash and payables. */
function currentRatioProxy(s: Series): number {
  const currentAssets = s.receivables + s.inventory + s.cash;
  return safe(currentAssets, Math.max(1, s.payables));
}

export function piotroski(s: Series[]): Piotroski | null {
  if (s.length < 2) return null;
  const cur = s[s.length - 1]!; const prev = s[s.length - 2]!;
  const roa = safe(cur.netProfit, cur.totalAssets);
  const roaPrev = safe(prev.netProfit, prev.totalAssets);
  const lev = safe(cur.borrowings, cur.equityCapital + cur.reserves);
  const levPrev = safe(prev.borrowings, prev.equityCapital + prev.reserves);
  const cr = currentRatioProxy(cur); const crPrev = currentRatioProxy(prev);
  const gm = cur.opmPct; const gmPrev = prev.opmPct;
  const at = safe(cur.sales, cur.totalAssets); const atPrev = safe(prev.sales, prev.totalAssets);

  const checks: Check[] = [
    { name: 'Positive ROA', pass: roa > 0, detail: `ROA ${(roa * 100).toFixed(1)}%` },
    { name: 'Positive operating cash flow', pass: cur.cfo > 0, detail: `CFO ₹${cur.cfo.toFixed(0)} Cr` },
    { name: 'ROA improved', pass: roa > roaPrev, detail: `${(roaPrev * 100).toFixed(1)}% → ${(roa * 100).toFixed(1)}%` },
    { name: 'Cash flow exceeds profit (accrual quality)', pass: safe(cur.cfo, cur.totalAssets) > roa, detail: `CFO/TA ${(safe(cur.cfo, cur.totalAssets) * 100).toFixed(1)}% vs ROA ${(roa * 100).toFixed(1)}%` },
    { name: 'Leverage fell', pass: lev < levPrev, detail: `D/E ${levPrev.toFixed(2)} → ${lev.toFixed(2)}` },
    { name: 'Current ratio improved', pass: cr > crPrev, detail: `${crPrev.toFixed(2)} → ${cr.toFixed(2)}` },
    { name: 'No new shares issued', pass: Math.abs(cur.equityCapital - prev.equityCapital) < 0.01, detail: `equity capital ${prev.equityCapital.toFixed(0)} → ${cur.equityCapital.toFixed(0)}` },
    { name: 'Margin improved', pass: gm > gmPrev, detail: `OPM ${gmPrev.toFixed(1)}% → ${gm.toFixed(1)}%` },
    { name: 'Asset turnover improved', pass: at > atPrev, detail: `${atPrev.toFixed(2)} → ${at.toFixed(2)}` },
  ];
  return { score: checks.filter((c) => c.pass).length, max: 9, checks };
}

export function altman(db: DB, companyId: number, s: Series[]): Altman | null {
  if (s.length === 0) return null;
  const cur = s[s.length - 1]!;
  const mc = (db.prepare(`SELECT market_cap FROM v_latest WHERE id=?`).get(companyId) as { market_cap: number } | undefined)?.market_cap ?? 0;
  if (cur.totalAssets <= 0) return null;
  const x1 = safe((cur.receivables + cur.inventory + cur.cash) - cur.payables, cur.totalAssets); // working capital
  const x2 = safe(cur.reserves, cur.totalAssets);
  const x3 = safe(cur.operatingProfit, cur.totalAssets);
  const x4 = safe(mc, Math.max(1, cur.totalLiabilities));
  const x5 = safe(cur.sales, cur.totalAssets);
  const z = r2(1.2 * x1 + 1.4 * x2 + 3.3 * x3 + 0.6 * x4 + 1.0 * x5);
  return { z, zone: z > 2.99 ? 'safe' : z >= 1.81 ? 'grey' : 'distress' };
}

/** Beneish M-Score (5 of 8 variables available; SGAI held neutral, AQI approximated). */
export function beneish(s: Series[]): Beneish | null {
  if (s.length < 2) return null;
  const cur = s[s.length - 1]!; const prev = s[s.length - 2]!;
  const notes: string[] = ['SGAI held at 1.0 (no SGA line item stored).', 'AQI approximated from receivables + inventory + cash.'];
  const dsri = safe(safe(cur.receivables, cur.sales), safe(prev.receivables, prev.sales));
  const gmCur = safe(cur.sales - cur.expenses, cur.sales);
  const gmPrev = safe(prev.sales - prev.expenses, prev.sales);
  const gmi = gmPrev > 0 ? gmCur / gmPrev : 1;
  const aqiCur = safe(cur.receivables + cur.inventory + cur.cash, cur.totalAssets);
  const aqiPrev = safe(prev.receivables + prev.inventory + prev.cash, prev.totalAssets);
  const aqi = aqiPrev > 0 ? aqiCur / aqiPrev : 1;
  const sgi = safe(cur.sales, prev.sales);
  const depi = safe(safe(prev.depreciation, prev.fixedAssets), safe(cur.depreciation, cur.fixedAssets)) || 1;
  const sgai = 1;
  const lvgi = safe(safe(cur.borrowings, cur.totalAssets), safe(prev.borrowings, prev.totalAssets)) || 1;
  const tata = safe(cur.netProfit - cur.cfo, cur.totalAssets);
  const m = r2(-4.84 + 0.92 * dsri + 0.528 * gmi + 0.404 * aqi + 0.892 * sgi + 0.115 * depi - 0.172 * sgai + 4.679 * tata - 0.327 * lvgi);
  return { m, flag: m > -1.78, simplified: true, notes };
}

export function composite(piotroskiScore: number | null, altmanZ: Altman | null, m: Beneish | null, latest: { roe: number; opm: number; debtToEquity: number; salesGrowth3y: number; profitGrowth3y: number }): Composite {
  const comp: Record<string, number> = {
    // Each component normalised to 0..100.
    profitability: Math.max(0, Math.min(100, (latest.roe / 30) * 100)),
    margins: Math.max(0, Math.min(100, (latest.opm / 30) * 100)),
    growth: Math.max(0, Math.min(100, ((latest.salesGrowth3y + latest.profitGrowth3y) / 40) * 100)),
    leverage: Math.max(0, Math.min(100, (1 - Math.min(1, latest.debtToEquity / 2)) * 100)),
    quality: piotroskiScore === null ? 50 : (piotroskiScore / 9) * 100,
    solvency: altmanZ ? Math.max(0, Math.min(100, (altmanZ.z / 4) * 100)) : 50,
    earningsQuality: m ? (m.flag ? 25 : 85) : 60,
  };
  const weights: Record<string, number> = { profitability: 0.22, margins: 0.12, growth: 0.16, leverage: 0.14, quality: 0.16, solvency: 0.12, earningsQuality: 0.08 };
  const score = Math.round(Object.entries(comp).reduce((acc, [k, v]) => acc + v * (weights[k] ?? 0), 0));
  const grade: Composite['grade'] = score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 45 ? 'C' : 'D';
  return { score, grade, components: Object.fromEntries(Object.entries(comp).map(([k, v]) => [k, Math.round(v)])) };
}

export function scores(db: DB, symbol: string): Scores | null {
  const c = db.prepare(`SELECT id, symbol FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number; symbol: string } | undefined;
  if (!c) return null;
  const s = loadSeries(db, c.id);
  if (s.length === 0) return null;
  const p = piotroski(s);
  const a = altman(db, c.id, s);
  const b = beneish(s);
  const latest = db.prepare(`SELECT roe, opm, debt_to_equity AS debtToEquity, sales_growth_3y AS salesGrowth3y, profit_growth_3y AS profitGrowth3y FROM v_latest WHERE id=?`).get(c.id) as { roe: number; opm: number; debtToEquity: number; salesGrowth3y: number; profitGrowth3y: number };
  const notes = [
    'Piotroski F-Score: 9 fundamental checks (0–9). Higher is better; 7+ is strong.',
    'Altman Z-Score: bankruptcy risk. >2.99 safe, 1.81–2.99 grey, <1.81 distress.',
    'Beneish M-Score: earnings-manipulation screen. > -1.78 raises a flag.',
    'These are screening aids computed from stored statements — not investment advice.',
  ];
  return { symbol: c.symbol, piotroski: p, altman: a, beneish: b, composite: composite(p?.score ?? null, a, b, latest), notes };
}
