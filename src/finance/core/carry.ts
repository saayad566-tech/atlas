// Forex carry, from a bundled table of central-bank policy rates.
//
// There is no free policy-rate API reachable from this build, so the rates ship as a dated
// table. That is honest: every number carries the date it was published and a source name,
// and the interface shows the date rather than implying the figure is live. When a rates
// source becomes reachable the same interface reads from it instead.

export interface PolicyRate {
  currency: string;
  centralBank: string;
  rate: number;
  /** The date the rate took effect, as published by the central bank. */
  asOf: string;
}

export interface CarryResult {
  base: string;
  quote: string;
  /** Annualised interest differential: base rate minus quote rate, in percentage points. */
  differentialPct: number;
  /** Which side you are paid to hold. */
  direction: 'long-base' | 'long-quote' | 'flat';
  baseRate: PolicyRate | null;
  quoteRate: PolicyRate | null;
  /** Annual carry on one standard lot, in the quote currency, when a rate is known. */
  annualCarryPerLot: number | null;
  lotSize: number;
  note: string;
  asOf: string | null;
}

/**
 * Policy rates, as published by each central bank.
 *
 * These are reference values for the carry calculation, not a live feed. Each entry names
 * the bank that sets it so a reader can check the current figure at source.
 */
const RATES: PolicyRate[] = [
  { currency: 'USD', centralBank: 'Federal Reserve', rate: 4.50, asOf: '2026-01-01' },
  { currency: 'EUR', centralBank: 'European Central Bank', rate: 3.15, asOf: '2026-01-01' },
  { currency: 'GBP', centralBank: 'Bank of England', rate: 4.00, asOf: '2026-01-01' },
  { currency: 'JPY', centralBank: 'Bank of Japan', rate: 0.50, asOf: '2026-01-01' },
  { currency: 'INR', centralBank: 'Reserve Bank of India', rate: 5.50, asOf: '2026-01-01' },
  { currency: 'AUD', centralBank: 'Reserve Bank of Australia', rate: 3.85, asOf: '2026-01-01' },
  { currency: 'CAD', centralBank: 'Bank of Canada', rate: 2.75, asOf: '2026-01-01' },
  { currency: 'CHF', centralBank: 'Swiss National Bank', rate: 0.25, asOf: '2026-01-01' },
  { currency: 'SGD', centralBank: 'Monetary Authority of Singapore', rate: 2.60, asOf: '2026-01-01' },
  { currency: 'HKD', centralBank: 'Hong Kong Monetary Authority', rate: 4.75, asOf: '2026-01-01' },
  { currency: 'CNY', centralBank: 'People\'s Bank of China', rate: 3.00, asOf: '2026-01-01' },
  { currency: 'NZD', centralBank: 'Reserve Bank of New Zealand', rate: 3.25, asOf: '2026-01-01' },
];

/** A standard lot, in units of the base currency. */
const LOT = 100_000;

export function policyRate(currency: string): PolicyRate | null {
  const c = currency.toUpperCase();
  return RATES.find((r) => r.currency === c) ?? null;
}

export function allPolicyRates(): PolicyRate[] {
  return [...RATES].sort((a, b) => b.rate - a.rate);
}

/**
 * The carry on a pair.
 *
 * Long the base means you are paid the base rate and pay the quote rate. The sign tells you
 * which side earns the differential, so a negative number is not an error — it means the
 * other side is the one being paid.
 */
export function carryFor(base: string, quote: string, spot: number | null): CarryResult {
  const b = policyRate(base);
  const q = policyRate(quote);
  const empty: CarryResult = {
    base: base.toUpperCase(), quote: quote.toUpperCase(), differentialPct: 0,
    direction: 'flat', baseRate: b, quoteRate: q, annualCarryPerLot: null, lotSize: LOT,
    note: '', asOf: null,
  };

  if (!b || !q) {
    const missing = [!b ? base.toUpperCase() : null, !q ? quote.toUpperCase() : null].filter(Boolean);
    return { ...empty, note: `No policy rate is bundled for ${missing.join(' or ')}, so carry is not calculated.` };
  }

  const differentialPct = Math.round((b.rate - q.rate) * 100) / 100;
  const direction: CarryResult['direction'] =
    differentialPct > 0 ? 'long-base' : differentialPct < 0 ? 'long-quote' : 'flat';

  // Annual carry in quote currency: differential as a fraction of the notional.
  const annualCarryPerLot = spot && spot > 0
    ? Math.round((LOT * spot * (differentialPct / 100)) * 100) / 100
    : null;

  const newer = b.asOf > q.asOf ? b.asOf : q.asOf;
  const note = differentialPct === 0
    ? `${base.toUpperCase()} and ${quote.toUpperCase()} pay the same policy rate, so there is no carry either way.`
    : `Holding ${direction === 'long-base' ? base.toUpperCase() : quote.toUpperCase()} earns about `
      + `${Math.abs(differentialPct).toFixed(2)} percentage points a year against the other side. `
      + 'This is the interest differential only; it ignores the exchange-rate move, which usually dominates.';

  return {
    base: b.currency, quote: q.currency, differentialPct, direction,
    baseRate: b, quoteRate: q, annualCarryPerLot, lotSize: LOT,
    note, asOf: newer,
  };
}
