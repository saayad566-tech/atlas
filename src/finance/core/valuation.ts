// Valuation: Graham number, margin of safety, a transparent DCF-lite, and margin
// sensitivity. Assumptions are explicit inputs, never hidden constants.
import type { Database as DB } from 'better-sqlite3';
import { loadSeries } from './metrics';
import { percentileOf } from './factors';

export interface Valuation {
  symbol: string;
  price: number;
  eps: number;
  bookValuePerShare: number;
  grahamNumber: number | null;
  marginOfSafetyPct: number | null;
  earningsYieldPct: number | null;
  pePercentile: number;
  pbPercentile: number;
  dcf: { fairValue: number; upsidePct: number; assumptions: DcfAssumptions } | null;
  sensitivity: { marginDrop200bps: { eps: number; deltaPct: number }; marginRise200bps: { eps: number; deltaPct: number } } | null;
}

export interface DcfAssumptions { growthPct: number; discountPct: number; terminalGrowthPct: number; years: number }

export const DEFAULT_DCF: DcfAssumptions = { growthPct: 10, discountPct: 12, terminalGrowthPct: 4, years: 10 };

/**
 * DCF-lite on free cash flow per share. Deliberately simple and fully disclosed:
 * FCF grows at `growthPct` for `years`, then a Gordon terminal value.
 */
export function dcfPerShare(fcfPerShare: number, a: DcfAssumptions): number | null {
  if (!Number.isFinite(fcfPerShare) || fcfPerShare <= 0) return null;
  if (a.discountPct <= a.terminalGrowthPct) return null;
  const g = a.growthPct / 100; const r = a.discountPct / 100; const tg = a.terminalGrowthPct / 100;
  let pv = 0; let fcf = fcfPerShare;
  for (let y = 1; y <= a.years; y++) { fcf = fcf * (1 + g); pv += fcf / (1 + r) ** y; }
  const terminal = (fcf * (1 + tg)) / (r - tg);
  pv += terminal / (1 + r) ** a.years;
  return Math.round(pv * 100) / 100;
}

export function valuation(db: DB, symbol: string, assumptions: DcfAssumptions = DEFAULT_DCF): Valuation | null {
  const c = db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
  if (!c) return null;
  const s = loadSeries(db, c.id);
  if (s.length === 0) return null;
  const cur = s[s.length - 1]!;
  const row = db.prepare(`SELECT price, pe, pb, market_cap FROM v_latest WHERE id=?`).get(c.id) as { price: number; pe: number; pb: number; market_cap: number } | undefined;
  const price = row?.price ?? 0;
  const equity = cur.equityCapital + cur.reserves;
  // Exact share count from market cap ÷ price when known (correct for any currency).
  const shares = row && row.price > 0 && row.market_cap > 0 ? (row.market_cap * 1e7) / row.price : equity > 0 ? equity / 10 : 0;
  // equity, FCF and profit are stored in crore; per-share values need currency units.
  const bvps = shares > 0 ? (equity * 1e7) / shares : 0;
  const eps = cur.eps || (shares > 0 ? (cur.netProfit * 1e7) / shares : 0);

  const grahamNumber = eps > 0 && bvps > 0 ? Math.round(Math.sqrt(22.5 * eps * bvps) * 100) / 100 : null;
  const marginOfSafetyPct = grahamNumber && price > 0 ? Math.round(((grahamNumber - price) / grahamNumber) * 1000) / 10 : null;
  const earningsYieldPct = price > 0 && eps > 0 ? Math.round((eps / price) * 10000) / 100 : null;

  // FCF per share from the latest year.
  const capex = Math.abs(cur.depreciation) * 1.0;
  const fcf = cur.cfo - capex;
  const fcfPerShare = shares > 0 ? (fcf * 1e7) / shares : 0;
  const fair = dcfPerShare(fcfPerShare, assumptions);
  const dcf = fair !== null && price > 0 ? { fairValue: fair, upsidePct: Math.round(((fair - price) / price) * 1000) / 10, assumptions } : null;

  // Sensitivity: ±200bps operating margin, holding everything else constant.
  let sensitivity: Valuation['sensitivity'] = null;
  if (cur.sales > 0 && shares > 0) {
    const baseEbit = cur.operatingProfit;
    const deltaEbit = cur.sales * 0.02;
    const taxRate = cur.profitBeforeTax > 0 ? Math.max(0, Math.min(1, 1 - cur.netProfit / cur.profitBeforeTax)) : 0.25;
    // baseEbit is in crore; convert to currency before dividing by the share count.
    const down = ((baseEbit - deltaEbit) * 1e7 * (1 - taxRate)) / shares;
    const up = ((baseEbit + deltaEbit) * 1e7 * (1 - taxRate)) / shares;
    sensitivity = {
      marginDrop200bps: { eps: Math.round(down * 100) / 100, deltaPct: eps !== 0 ? Math.round(((down - eps) / Math.abs(eps)) * 1000) / 10 : 0 },
      marginRise200bps: { eps: Math.round(up * 100) / 100, deltaPct: eps !== 0 ? Math.round(((up - eps) / Math.abs(eps)) * 1000) / 10 : 0 },
    };
  }

  return {
    symbol, price, eps: Math.round(eps * 100) / 100, bookValuePerShare: Math.round(bvps * 100) / 100,
    grahamNumber, marginOfSafetyPct, earningsYieldPct,
    pePercentile: percentileOf(db, c.id, 'pe'), pbPercentile: percentileOf(db, c.id, 'pb'),
    dcf, sensitivity,
  };
}
