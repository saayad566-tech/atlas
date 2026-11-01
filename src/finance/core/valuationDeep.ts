// Reverse DCF and scenario analysis.
//
// A forward DCF answers "what is this worth if I am right". A reverse DCF answers the more
// useful question: "what is the market already assuming, and do I believe it". That turns a
// valuation into a falsifiable claim rather than a target price.
import { dcfPerShare, type DcfAssumptions } from './valuation';

const r2 = (v: number): number => Math.round(v * 100) / 100;

export interface ReverseDcfResult {
  impliedGrowthPct: number | null;
  price: number;
  basis: { discountPct: number; terminalGrowthPct: number; years: number; fcfPerShare: number };
  verdict: string;
  /** Growth at which the model equals the price, and the range searched. */
  bracket: { low: number; high: number } | null;
}

/**
 * Solve for the growth rate that makes the DCF equal today's price.
 *
 * Monotonic in growth, so a bisection is exact and cheap. Returns null when the price
 * cannot be matched even at the extremes — which is itself informative (the market is
 * pricing something the model cannot express, such as a loss-making growth company).
 */
export function reverseDcf(
  price: number,
  fcfPerShare: number,
  a: Omit<DcfAssumptions, 'growthPct'>,
  bounds: { low: number; high: number } = { low: -20, high: 60 },
): ReverseDcfResult {
  const base = { price, basis: { discountPct: a.discountPct, terminalGrowthPct: a.terminalGrowthPct, years: a.years, fcfPerShare }, bracket: null as ReverseDcfResult['bracket'], impliedGrowthPct: null as number | null, verdict: '' };
  if (!(price > 0) || !(fcfPerShare > 0)) {
    return { ...base, verdict: 'No positive free cash flow per share — a reverse DCF needs cash earnings to discount.' };
  }
  if (a.discountPct <= a.terminalGrowthPct) {
    return { ...base, verdict: 'The discount rate must exceed terminal growth, or the terminal value is infinite.' };
  }
  const valueAt = (g: number): number => dcfPerShare(fcfPerShare, { ...a, growthPct: g }) ?? 0;
  let lo = bounds.low; let hi = bounds.high;
  const vLo = valueAt(lo); const vHi = valueAt(hi);
  if (price < vLo) return { ...base, bracket: bounds, verdict: `Even at ${lo}% growth the model values it above the price — it looks cheap on any assumption in this range.` };
  if (price > vHi) return { ...base, bracket: bounds, verdict: `Even at ${hi}% growth the model falls short of the price — the market is pricing something this model does not capture.` };

  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (valueAt(mid) < price) lo = mid; else hi = mid;
  }
  const implied = r2((lo + hi) / 2);
  const verdict = implied > 25
    ? `The price assumes roughly ${implied}% annual growth for ${a.years} years — an ambitious bar.`
    : implied > 15
      ? `The price assumes about ${implied}% annual growth for ${a.years} years — demanding but not unusual for a quality business.`
      : implied > 8
        ? `The price assumes roughly ${implied}% annual growth — a reasonable middle ground.`
        : implied > 0
          ? `The price assumes only ${implied}% growth — little optimism is baked in.`
          : `The price implies ${implied}% — the market expects this business to shrink.`;
  return { ...base, impliedGrowthPct: implied, bracket: bounds, verdict };
}

export interface Scenario { name: 'bear' | 'base' | 'bull'; growthPct: number; discountPct: number; value: number | null; label: string }

/** Three scenarios around a base case, each with its own growth and discount. */
export function scenarios(fcfPerShare: number, base: DcfAssumptions, spread = { growth: 6, discount: 2 }): Scenario[] {
  const mk = (name: Scenario['name'], g: number, d: number, label: string): Scenario => ({
    name, growthPct: r2(g), discountPct: r2(d), label,
    value: dcfPerShare(fcfPerShare, { ...base, growthPct: g, discountPct: d }),
  });
  return [
    mk('bear', base.growthPct - spread.growth, base.discountPct + spread.discount, 'growth disappoints and the market demands a higher return'),
    mk('base', base.growthPct, base.discountPct, 'the stated assumptions hold'),
    mk('bull', base.growthPct + spread.growth, base.discountPct - spread.discount, 'growth persists and the market is willing to pay for it'),
  ];
}

/** Value across a growth × discount grid, for a sensitivity table. */
export function sensitivityGrid(
  fcfPerShare: number,
  base: DcfAssumptions,
  growthSteps: number[] = [-4, -2, 0, 2, 4],
  discountSteps: number[] = [-2, -1, 0, 1, 2],
): { growths: number[]; discounts: number[]; grid: Array<Array<number | null>> } {
  const growths = growthSteps.map((s) => r2(base.growthPct + s));
  const discounts = discountSteps.map((s) => r2(base.discountPct + s));
  const grid = growths.map((g) => discounts.map((d) => dcfPerShare(fcfPerShare, { ...base, growthPct: g, discountPct: d })));
  return { growths, discounts, grid };
}

/** Where today's price sits between the bear and bull cases. */
export function marginOfSafety(price: number, bear: number | null, base: number | null, bull: number | null): {
  vsBasePct: number | null; position: string;
} {
  if (!(price > 0) || base === null) return { vsBasePct: null, position: 'not enough data' };
  const vsBase = r2(((base - price) / price) * 100);
  const position = bear !== null && price < bear ? 'below the bear case — priced for disaster'
    : bull !== null && price > bull ? 'above the bull case — priced for perfection'
    : vsBase > 20 ? 'comfortably below the base case'
    : vsBase > 0 ? 'below the base case'
    : vsBase > -20 ? 'above the base case'
    : 'well above the base case';
  return { vsBasePct: vsBase, position };
}
