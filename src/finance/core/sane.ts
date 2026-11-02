// A sanity boundary for financial numbers.
//
// Stored data can be wrong: a source glitch, a unit error, a placeholder of 1e308. Returning
// that to the user as if it were a real ratio is worse than returning nothing, because a
// screen for "P/E under 15" would silently include a company whose P/E is nonsense.
//
// Every value passes through here on the way out. An impossible number becomes null, and the
// caller can see it is missing rather than being shown a lie.

/** Plausible ranges per ratio. Outside these, the value is treated as unknown. */
export const RATIO_BOUNDS: Record<string, { min: number; max: number; why: string }> = {
  pe: { min: -2000, max: 20000, why: 'a price-to-earnings multiple outside this is a data error' },
  pb: { min: -1000, max: 5000, why: 'a price-to-book outside this is a data error' },
  roe: { min: -100000, max: 100000, why: 'return on equity is a percentage' },
  roce: { min: -100000, max: 100000, why: 'return on capital is a percentage' },
  debt_to_equity: { min: -1000, max: 100000, why: 'a negative or huge ratio is a unit error' },
  opm: { min: -100000, max: 100000, why: 'operating margin is a percentage' },
  npm: { min: -100000, max: 100000, why: 'net margin is a percentage' },
  dividend_yield: { min: 0, max: 100, why: 'a yield above 100% is a data error' },
  current_ratio: { min: 0, max: 10000, why: 'a current ratio cannot be negative' },
  interest_coverage: { min: -100000, max: 100000, why: 'coverage can be negative but not this large' },
  asset_turnover: { min: -10000, max: 10000, why: 'turnover is a ratio of revenue to assets' },
  market_cap: { min: 0, max: 1e15, why: 'a negative market cap is impossible' },
  sales_growth_3y: { min: -100000, max: 100000, why: 'growth is a percentage' },
  profit_growth_3y: { min: -100000, max: 100000, why: 'growth is a percentage' },
};

/** Anything beyond this magnitude is not a real financial quantity. */
const ABSOLUTE_CEILING = 1e15;

/**
 * Return the value if it is a finite, plausible number for that field; otherwise null.
 * Unknown fields get the absolute ceiling only.
 */
export function saneNumber(field: string, value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  if (Math.abs(n) > ABSOLUTE_CEILING) return null;
  const bound = RATIO_BOUNDS[field];
  if (bound && (n < bound.min || n > bound.max)) return null;
  return n;
}

/** Apply the boundary to a whole record of ratios. */
export function saneRatios<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = { ...row };
  for (const key of Object.keys(out)) {
    if (typeof out[key] === 'number') {
      const fixed = saneNumber(key, out[key]);
      if (fixed === null && out[key] !== null) out[key] = null;
    }
  }
  return out as T;
}

/** A count of how many values in a record were rejected, for the data-truth panel. */
export function rejectedCount(row: Record<string, unknown>): number {
  let n = 0;
  for (const key of Object.keys(row)) {
    if (typeof row[key] === 'number' && saneNumber(key, row[key]) === null) n++;
  }
  return n;
}
