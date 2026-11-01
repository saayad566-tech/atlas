// Deeper fundamental measures that the existing scores module does not cover.
// Each is a published formula; where the data is absent the function returns null rather
// than a plausible-looking number.

const r2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Owner earnings (Buffett, 1986 letter): reported profit plus non-cash charges, less the
 * capital needed to maintain competitive position, less any working-capital drag.
 * It answers "what could be taken out of the business without harming it".
 */
export function ownerEarnings(i: {
  netProfit: number; depreciation: number; capex: number; workingCapitalChange: number;
}): { value: number; vsReportedPct: number | null } {
  const value = r2(i.netProfit + i.depreciation - i.capex - i.workingCapitalChange);
  return {
    value,
    vsReportedPct: i.netProfit !== 0 ? r2(((value - i.netProfit) / Math.abs(i.netProfit)) * 100) : null,
  };
}

/**
 * Cash conversion cycle in days: how long cash is tied up.
 * DSO + DIO − DPO. Negative is excellent — suppliers fund the business.
 */
export function cashConversionCycle(i: {
  receivables: number; inventory: number; payables: number; sales: number; cogs: number;
}): { dso: number; dio: number; dpo: number; ccc: number; verdict: string } | null {
  if (i.sales <= 0 || i.cogs <= 0) return null;
  const dso = (i.receivables / i.sales) * 365;
  const dio = (i.inventory / i.cogs) * 365;
  const dpo = (i.payables / i.cogs) * 365;
  const ccc = dso + dio - dpo;
  return {
    dso: r2(dso), dio: r2(dio), dpo: r2(dpo), ccc: r2(ccc),
    verdict: ccc < 0 ? 'suppliers fund the business' : ccc < 60 ? 'tight' : ccc < 120 ? 'moderate' : 'cash-hungry',
  };
}

/**
 * Share-count trend. Dilution is the quietest way to lose per-share value, and it is
 * invisible in most headline metrics.
 */
export function dilution(sharesSeries: number[]): { changePct: number; cagrPct: number | null; verdict: string } | null {
  const clean = sharesSeries.filter((v) => Number.isFinite(v) && v > 0);
  if (clean.length < 2) return null;
  const first = clean[0]!; const last = clean[clean.length - 1]!;
  const changePct = r2(((last - first) / first) * 100);
  const years = clean.length - 1;
  const cagr = years > 0 && first > 0 ? (Math.pow(last / first, 1 / years) - 1) * 100 : null;
  return {
    changePct, cagrPct: cagr === null ? null : r2(cagr),
    verdict: changePct < -1 ? 'buying back stock' : changePct <= 1 ? 'share count stable' : changePct <= 5 ? 'mild dilution' : 'material dilution',
  };
}

/** Common-size statement: every line as a percentage of revenue. */
export function commonSize(rows: Array<{ label: string; value: number }>, revenue: number): Array<{ label: string; value: number; pctOfRevenue: number | null }> {
  if (!(revenue > 0)) return rows.map((r) => ({ ...r, pctOfRevenue: null }));
  return rows.map((r) => ({ ...r, pctOfRevenue: r2((r.value / revenue) * 100) }));
}

/**
 * Return on incremental invested capital — the return earned on *new* money.
 * A company compounding at 25% ROIIC is a different animal from one earning 8% on a
 * growing asset base, even when both report the same ROIC today.
 */
export function incrementalRoic(i: {
  nopatNow: number; nopatPrior: number; investedNow: number; investedPrior: number;
}): { roiicPct: number; verdict: string } | null {
  const deltaNopat = i.nopatNow - i.nopatPrior;
  const deltaInvested = i.investedNow - i.investedPrior;
  if (deltaInvested <= 0) return null;
  const roiic = (deltaNopat / deltaInvested) * 100;
  return {
    roiicPct: r2(roiic),
    verdict: roiic >= 20 ? 'compounding well' : roiic >= 10 ? 'adequate' : roiic >= 0 ? 'marginal' : 'value-destroying growth',
  };
}

/**
 * Dividend safety: is the dividend covered by free cash flow, not just by accounting profit?
 * Payout above 100% of FCF is being funded by debt or the balance sheet.
 */
export function dividendSafety(i: { dividendsPaid: number; freeCashFlow: number; netProfit: number }): { fcfPayoutPct: number | null; profitPayoutPct: number | null; verdict: string } | null {
  if (i.dividendsPaid <= 0) return null;
  const fcfPayout = i.freeCashFlow > 0 ? (i.dividendsPaid / i.freeCashFlow) * 100 : null;
  const profitPayout = i.netProfit > 0 ? (i.dividendsPaid / i.netProfit) * 100 : null;
  let verdict: string;
  if (fcfPayout === null) verdict = 'free cash flow is negative — the dividend is not covered';
  else if (fcfPayout <= 60) verdict = 'comfortably covered by cash flow';
  else if (fcfPayout <= 100) verdict = 'covered, but little room';
  else verdict = 'exceeds free cash flow — funded by debt or reserves';
  return { fcfPayoutPct: fcfPayout === null ? null : r2(fcfPayout), profitPayoutPct: profitPayout === null ? null : r2(profitPayout), verdict };
}

/**
 * Reinvestment rate: how much of NOPAT is being put back into the business.
 * Growth is only worth paying for when the reinvestment earns a return above the cost of
 * capital; this is the input that makes ROIIC meaningful.
 */
export function reinvestmentRate(i: { capex: number; workingCapitalChange: number; depreciation: number; nopat: number }): { ratePct: number | null; verdict: string } {
  const netInvestment = i.capex + i.workingCapitalChange - i.depreciation;
  if (i.nopat <= 0) return { ratePct: null, verdict: 'no positive NOPAT to reinvest from' };
  const rate = (netInvestment / i.nopat) * 100;
  return {
    ratePct: r2(rate),
    verdict: rate < 0 ? 'shrinking the asset base' : rate <= 25 ? 'modest reinvestment' : rate <= 70 ? 'balanced' : 'reinvesting heavily',
  };
}
