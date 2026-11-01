// Multi-model valuation with user-editable assumptions.
//
// Every number the user can change is stored per company, so a valuation is
// reproducible: load it tomorrow and you get the same answer, with the assumptions
// printed beside it. Models are transparent — no black box.
import type { Database as DB } from 'better-sqlite3';
import { loadSeries } from './metrics';

export interface Assumptions {
  growthPct: number;       // FCF / earnings growth
  discountPct: number;     // required return
  terminalPct: number;     // terminal growth
  years: number;           // explicit forecast horizon
  targetPe: number;        // exit / fair multiple
  targetEvEbitda: number;  // fair EV/EBITDA
  payoutPct: number;       // dividend payout for the DDM
}

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  growthPct: 10, discountPct: 12, terminalPct: 4, years: 10, targetPe: 20, targetEvEbitda: 12, payoutPct: 30,
};

export type Scenario = 'conservative' | 'base' | 'optimistic';

/** Scenario presets are multipliers over the user's base assumptions. */
export function applyScenario(a: Assumptions, scenario: Scenario): Assumptions {
  if (scenario === 'conservative') return { ...a, growthPct: a.growthPct * 0.6, discountPct: a.discountPct + 2, targetPe: a.targetPe * 0.8, targetEvEbitda: a.targetEvEbitda * 0.8 };
  if (scenario === 'optimistic') return { ...a, growthPct: a.growthPct * 1.4, discountPct: Math.max(1, a.discountPct - 1), targetPe: a.targetPe * 1.2, targetEvEbitda: a.targetEvEbitda * 1.2 };
  return { ...a };
}

export interface ModelResult { name: string; value: number | null; weight: number; note: string }

export interface ValuationReport {
  symbol: string;
  price: number;
  assumptions: Assumptions;
  scenario: Scenario;
  wacc: number;
  models: ModelResult[];
  blended: number | null;
  upsidePct: number | null;
  verdict: 'undervalued' | 'fair' | 'overvalued';
  band: { bear: number | null; base: number | null; bull: number | null };
  ev: { marketCap: number; netDebt: number; ev: number; evEbitda: number | null; evSales: number | null };
  sector: { sectorPe: number; premiumPct: number | null };
  peBand: { min: number; median: number; max: number; currentPercentile: number | null };
  notes: string[];
}

const r2 = (n: number): number => Math.round(n * 100) / 100;
const safe = (n: number, d: number): number => (d === 0 ? 0 : n / d);

/** WACC-lite: risk-free + beta × equity-risk-premium + a small size premium. */
export function waccLite(marketCap: number, riskFreePct = 7, erpPct = 6, beta = 1.1): number {
  const sizePremium = marketCap < 5000 ? 2 : marketCap < 20000 ? 1 : 0;
  return r2(riskFreePct + beta * erpPct + sizePremium);
}

export function loadAssumptions(db: DB, companyId: number): { a: Assumptions; scenario: Scenario } {
  const row = db.prepare(`SELECT * FROM valuation_assumptions WHERE company_id=?`).get(companyId) as Record<string, unknown> | undefined;
  if (!row) return { a: { ...DEFAULT_ASSUMPTIONS }, scenario: 'base' };
  return {
    a: {
      growthPct: Number(row['growth_pct'] ?? DEFAULT_ASSUMPTIONS.growthPct),
      discountPct: Number(row['discount_pct'] ?? DEFAULT_ASSUMPTIONS.discountPct),
      terminalPct: Number(row['terminal_pct'] ?? DEFAULT_ASSUMPTIONS.terminalPct),
      years: Number(row['years'] ?? DEFAULT_ASSUMPTIONS.years),
      targetPe: Number(row['target_pe'] ?? DEFAULT_ASSUMPTIONS.targetPe),
      targetEvEbitda: Number(row['target_ev_ebitda'] ?? DEFAULT_ASSUMPTIONS.targetEvEbitda),
      payoutPct: Number(row['payout_pct'] ?? DEFAULT_ASSUMPTIONS.payoutPct),
    },
    scenario: (String(row['scenario'] ?? 'base') as Scenario),
  };
}

export function saveAssumptions(db: DB, symbol: string, a: Partial<Assumptions>, scenario: Scenario = 'base'): { ok: boolean; assumptions: Assumptions } {
  const c = db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
  if (!c) throw new Error(`No company "${symbol}".`);
  const merged = { ...DEFAULT_ASSUMPTIONS, ...loadAssumptions(db, c.id).a, ...a };
  db.prepare(`INSERT INTO valuation_assumptions (company_id,growth_pct,discount_pct,terminal_pct,years,target_pe,target_ev_ebitda,payout_pct,weights,scenario,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(company_id) DO UPDATE SET growth_pct=excluded.growth_pct, discount_pct=excluded.discount_pct,
      terminal_pct=excluded.terminal_pct, years=excluded.years, target_pe=excluded.target_pe,
      target_ev_ebitda=excluded.target_ev_ebitda, payout_pct=excluded.payout_pct, scenario=excluded.scenario, updated_at=excluded.updated_at`)
    .run(c.id, merged.growthPct, merged.discountPct, merged.terminalPct, merged.years, merged.targetPe, merged.targetEvEbitda, merged.payoutPct, '{}', scenario, Date.now());
  return { ok: true, assumptions: merged };
}

export function resetAssumptions(db: DB, symbol: string): { ok: boolean } {
  const c = db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
  if (!c) throw new Error(`No company "${symbol}".`);
  db.prepare(`DELETE FROM valuation_assumptions WHERE company_id=?`).run(c.id);
  return { ok: true };
}

/** P/E band from stored annual ratios. */
function peBand(db: DB, companyId: number): ValuationReport['peBand'] {
  const rows = db.prepare(`SELECT pe FROM ratios WHERE company_id=? AND period_type='annual' AND pe > 0 ORDER BY period_end`).all(companyId) as Array<{ pe: number }>;
  if (rows.length === 0) return { min: 0, median: 0, max: 0, currentPercentile: null };
  const pes = rows.map((r) => r.pe).sort((a, b) => a - b);
  const median = pes[Math.floor(pes.length / 2)]!;
  const current = pes[pes.length - 1]!;
  const below = pes.filter((p) => p <= current).length;
  return { min: r2(pes[0]!), median: r2(median), max: r2(pes[pes.length - 1]!), currentPercentile: Math.round((below / pes.length) * 100) };
}

function modelsFor(db: DB, companyId: number, a: Assumptions, price: number): { models: ModelResult[]; ev: ValuationReport['ev'] } {
  const s = loadSeries(db, companyId);
  const cur = s[s.length - 1];
  if (!cur) return { models: [], ev: { marketCap: 0, netDebt: 0, ev: 0, evEbitda: null, evSales: null } };
  const equity = cur.equityCapital + cur.reserves;
  const mc0 = (db.prepare(`SELECT market_cap, price FROM v_latest WHERE id=?`).get(companyId) as { market_cap: number; price: number } | undefined);
  // Exact share count from market cap ÷ price; the face-value fallback only works for
  // the demo pack (₹10 face value), so it is used only when no price is known.
  const shares = mc0 && mc0.price > 0 && mc0.market_cap > 0 ? (mc0.market_cap * 1e7) / mc0.price : equity > 0 ? equity / 10 : 0;
  const eps = cur.eps || (shares > 0 ? cur.netProfit / shares : 0);
  const bvps = shares > 0 ? equity / shares : 0;
  const fcf = cur.cfo - Math.abs(cur.depreciation);
  const fcfPerShare = shares > 0 ? (fcf * 1e7) / shares : 0;   // fcf is in crore
  const mc = (db.prepare(`SELECT market_cap FROM v_latest WHERE id=?`).get(companyId) as { market_cap: number } | undefined)?.market_cap ?? 0;
  const netDebt = cur.borrowings - cur.cash;
  const ev = mc + netDebt;
  const ebitda = cur.operatingProfit;

  // 1. Graham number
  const graham = eps > 0 && bvps > 0 ? Math.sqrt(22.5 * eps * bvps) : null;
  // 2. DCF on FCF per share
  let dcf: number | null = null;
  if (fcfPerShare > 0 && a.discountPct > a.terminalPct) {
    const g = a.growthPct / 100; const r = a.discountPct / 100; const tg = a.terminalPct / 100;
    let pv = 0; let f = fcfPerShare;
    for (let y = 1; y <= a.years; y++) { f *= 1 + g; pv += f / (1 + r) ** y; }
    pv += (f * (1 + tg)) / (r - tg) / (1 + r) ** a.years;
    dcf = pv;
  }
  // 3. Earnings multiple
  const peModel = eps > 0 ? a.targetPe * eps : null;
  // 4. EV/EBITDA multiple
  const evModel = ebitda > 0 && shares > 0 ? ((a.targetEvEbitda * ebitda - netDebt) * 1e7) / shares : null;
  // 5. Dividend discount
  const dps = eps * (a.payoutPct / 100);
  const ddm = dps > 0 && a.discountPct > a.terminalPct ? dps / ((a.discountPct - a.terminalPct) / 100) : null;

  const models: ModelResult[] = [
    { name: 'Graham number', value: graham === null ? null : r2(graham), weight: 0.15, note: '√(22.5 × EPS × book value per share)' },
    { name: 'DCF (FCF)', value: dcf === null ? null : r2(dcf), weight: 0.35, note: `${a.years}y at ${a.growthPct}% growth, ${a.discountPct}% discount, ${a.terminalPct}% terminal` },
    { name: 'Earnings multiple', value: peModel === null ? null : r2(peModel), weight: 0.30, note: `${a.targetPe}× target P/E on EPS ₹${r2(eps)}` },
    { name: 'EV/EBITDA', value: evModel === null ? null : r2(evModel), weight: 0.20, note: `${a.targetEvEbitda}× on EBITDA ₹${Math.round(ebitda)} Cr, less net debt` },
    { name: 'Dividend discount', value: ddm === null ? null : r2(ddm), weight: 0.00, note: `${a.payoutPct}% payout at ${a.discountPct}% discount (reference only)` },
  ];
  void price;
  return { models, ev: { marketCap: r2(mc), netDebt: r2(netDebt), ev: r2(ev), evEbitda: ebitda > 0 ? r2(ev / ebitda) : null, evSales: cur.sales > 0 ? r2(ev / cur.sales) : null } };
}

function blend(models: ModelResult[]): number | null {
  const usable = models.filter((m) => m.value !== null && m.weight > 0);
  if (usable.length === 0) return null;
  const totalW = usable.reduce((acc, m) => acc + m.weight, 0);
  return r2(usable.reduce((acc, m) => acc + (m.value! * m.weight), 0) / totalW);
}

export function valuationReport(db: DB, symbol: string, scenarioOverride?: Scenario): ValuationReport | null {
  const c = db.prepare(`SELECT id, sector FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number; sector: string } | undefined;
  if (!c) return null;
  const loaded = loadAssumptions(db, c.id);
  const scenario: Scenario = scenarioOverride ?? loaded.scenario;
  const base = loaded.a;
  const a = applyScenario(base, scenario);
  const price = (db.prepare(`SELECT price FROM v_latest WHERE id=?`).get(c.id) as { price: number } | undefined)?.price ?? 0;
  const mc = (db.prepare(`SELECT market_cap FROM v_latest WHERE id=?`).get(c.id) as { market_cap: number } | undefined)?.market_cap ?? 0;

  const { models, ev } = modelsFor(db, c.id, a, price);
  const blended = blend(models);
  const upsidePct = blended !== null && price > 0 ? r2(((blended - price) / price) * 100) : null;

  const bear = blend(modelsFor(db, c.id, applyScenario(base, 'conservative'), price).models);
  const bull = blend(modelsFor(db, c.id, applyScenario(base, 'optimistic'), price).models);

  const sectorPe = (db.prepare(`SELECT AVG(pe) AS m FROM v_latest WHERE sector=? AND pe > 0`).get(c.sector) as { m: number | null } | undefined)?.m ?? 0;
  const curPe = (db.prepare(`SELECT pe FROM v_latest WHERE id=?`).get(c.id) as { pe: number } | undefined)?.pe ?? 0;

  const verdict: ValuationReport['verdict'] = upsidePct === null ? 'fair' : upsidePct > 15 ? 'undervalued' : upsidePct < -15 ? 'overvalued' : 'fair';

  return {
    symbol: symbol.toUpperCase(), price: r2(price), assumptions: a, scenario,
    wacc: waccLite(mc, 7, 6, 1.1),
    models, blended, upsidePct, verdict,
    band: { bear, base: blended, bull },
    ev,
    sector: { sectorPe: r2(sectorPe), premiumPct: sectorPe > 0 && curPe > 0 ? r2(((curPe - sectorPe) / sectorPe) * 100) : null },
    peBand: peBand(db, c.id),
    notes: [
      'Fair value is a weighted blend of the models that produced a number; weights are fixed per model and shown beside each.',
      'Scenarios scale growth, discount rate and target multiple — they are sensitivities, not forecasts.',
      'Not investment advice. Every assumption is editable and saved with the company.',
    ],
  };
}
