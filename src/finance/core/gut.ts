// The GUT Test — Agora Circle's pre-trade checklist, implemented.
//
// Source: "Agora Circle · Pre Trade Checklist · The GUT Test" (2 pages). It defines three
// questions that must be answered in writing before entry, a 14-item checklist across five
// categories, and one position-sizing formula.
//
// The document's own rule is the spine of this module: "Teeno sawaalon ka jawab clear nahi
// hai? Entry lene ki jaldi mat karo. Missing one answer means no trade, even if the chart
// looks perfect." — a missing answer means no trade, regardless of everything else.

export type AnswerState = 'answered' | 'missing';

export interface GutQuestion {
  n: 1 | 2 | 3;
  question: string;
  /** What the document says a real answer looks like, versus a non-answer. */
  requires: string;
  rejectionExample: string;
  answer: string | null;
  state: AnswerState;
}

export interface ChecklistItem {
  category: 'SETUP' | 'RISK' | 'EXIT' | 'MARKET CONTEXT' | 'MINDSET';
  text: string;
  ticked: boolean;
}

/** The 14 checklist items, verbatim from page 2, in the document's five categories. */
export const CHECKLIST: ReadonlyArray<Omit<ChecklistItem, 'ticked'>> = [
  { category: 'SETUP', text: 'This trade is one of my written, tested setups, not a new idea I saw today' },
  { category: 'SETUP', text: 'Every condition of the setup is present, not "almost" present' },
  { category: 'SETUP', text: 'I know the higher timeframe level (daily support or resistance) near my entry' },
  { category: 'RISK', text: 'Stop loss price is decided and will be placed with the order' },
  { category: 'RISK', text: 'Position size is calculated from my stop, not from how confident I feel' },
  { category: 'RISK', text: "Today's total loss so far is still inside my daily loss limit" },
  { category: 'EXIT', text: 'Target or exit plan is written down, and reward is at least equal to risk' },
  { category: 'EXIT', text: 'I know what I will do if price stalls halfway: trail, partial book, or exit' },
  { category: 'MARKET CONTEXT', text: 'No high impact news or result announcement is due during my holding time' },
  { category: 'MARKET CONTEXT', text: 'The index and sector are not moving hard against my direction' },
  { category: 'MARKET CONTEXT', text: 'The stock did not open with a large gap that my setup avoids' },
  { category: 'MINDSET', text: 'I am not trying to recover a previous loss (no revenge trade)' },
  { category: 'MINDSET', text: 'I am not chasing a candle that has already run (no FOMO entry)' },
  { category: 'MINDSET', text: 'If this trade hits stop loss, I am okay with it and will log it honestly' },
  // Page 1's three GUT questions gate the trade separately from this checklist, so the
  // checklist carries exactly the 14 boxed items on page 2: 3 SETUP, 3 RISK, 2 EXIT,
  // 3 MARKET CONTEXT, 3 MINDSET.
];

export interface GutResult {
  questions: GutQuestion[];
  checklist: ChecklistItem[];
  /** The document's rule: all three questions answered. */
  gutPassed: boolean;
  blockedBy: string[];
  checklistScore: { ticked: number; total: number };
  sizing: SizingResult | null;
  verdict: 'cleared' | 'blocked';
  verdictLine: string;
  disclaimer: string;
}

export interface SizingResult {
  maxLossRupees: number;
  entry: number;
  stop: number;
  riskPerShare: number;
  quantity: number;
  capital: number | null;
  riskPct: number | null;
  note: string;
}

/**
 * Position size: Quantity = Max loss (₹) ÷ (Entry price − Stop loss price)
 * The document's worked example: ₹5,00,000 capital at 1% risk gives ₹5,000 max loss; entry
 * ₹500, stop ₹490, risk per share ₹10, quantity 500.
 */
export function positionSize(entry: number, stop: number, opts: { capital?: number; riskPct?: number; maxLossRupees?: number }): SizingResult | { error: string } {
  if (!Number.isFinite(entry) || !Number.isFinite(stop) || entry <= 0 || stop <= 0) {
    return { error: 'Entry and stop must both be positive prices' };
  }
  if (entry === stop) return { error: 'Entry and stop are the same price, so risk per share is zero' };
  if (stop > entry) return { error: 'Stop is above entry — this sizing formula is for a long trade' };

  let maxLoss: number | null = null;
  let capital: number | null = null;
  let riskPct: number | null = null;

  if (opts.maxLossRupees !== undefined && Number.isFinite(opts.maxLossRupees)) {
    maxLoss = opts.maxLossRupees;
  } else if (opts.capital !== undefined && opts.riskPct !== undefined) {
    capital = opts.capital;
    riskPct = opts.riskPct;
    maxLoss = capital * (riskPct / 100);
  }
  if (maxLoss === null || maxLoss <= 0) {
    return { error: 'Provide either maxLossRupees, or capital and riskPct' };
  }
  if (riskPct !== null && (riskPct <= 0 || riskPct > 5)) {
    return { error: `Risk of ${riskPct}% is outside the 0.5%–1% band the checklist recommends; above 5% is refused` };
  }

  const riskPerShare = entry - stop;
  const quantity = Math.floor(maxLoss / riskPerShare);
  if (quantity < 1) {
    return { error: `Max loss ₹${maxLoss.toFixed(0)} is smaller than one share's risk of ₹${riskPerShare.toFixed(2)}` };
  }

  return {
    maxLossRupees: Math.round(maxLoss * 100) / 100,
    entry, stop, riskPerShare: Math.round(riskPerShare * 100) / 100,
    quantity, capital, riskPct,
    note: `Quantity = Max loss ÷ (Entry − Stop) = ${maxLoss.toFixed(0)} ÷ ${riskPerShare.toFixed(2)} = ${quantity} shares. Actual risk at the stop: ₹${(quantity * riskPerShare).toFixed(0)}.`,
  };
}

export interface GutInput {
  reason?: string;
  maxLossRupees?: number;
  stopPrice?: number;
  entryPrice?: number;
  capital?: number;
  riskPct?: number;
  ticks?: string[];
}

/** An answer counts only when it names something concrete. "Lag raha hai" is not an answer. */
function isRealAnswer(text: string | undefined): boolean {
  const t = (text ?? '').trim();
  if (t.length < 12) return false;
  if (/^(lag raha|lagta hai|feels? like|maybe|idk|not sure|dunno|na|no idea)\b/i.test(t)) return false;
  return true;
}

export function gutTest(input: GutInput): GutResult {
  const questions: GutQuestion[] = [
    {
      n: 1,
      question: 'Entry ka actual reason kya hai? — What is the actual reason for this entry?',
      requires: 'Name the setup and the exact trigger.',
      rejectionExample: '"Lag raha hai upar jayega" is not a reason. "Price held the daily level and broke the 5 min range" is.',
      answer: input.reason ?? null,
      state: isRealAnswer(input.reason) ? 'answered' : 'missing',
    },
    {
      n: 2,
      question: 'Agar trade galat hua, toh kitna loss afford kar sakta hoon? — How much loss can I afford if this is wrong?',
      requires: 'A rupee amount, written before entry, inside your fixed risk per trade (0.5% to 1% of capital).',
      rejectionExample: 'A percentage with no rupee amount, or an amount you have not checked against your capital.',
      answer: input.maxLossRupees !== undefined && input.maxLossRupees > 0 ? `₹${input.maxLossRupees}` : null,
      state: input.maxLossRupees !== undefined && input.maxLossRupees > 0 ? 'answered' : 'missing',
    },
    {
      n: 3,
      question: 'Kis point par maanunga ki mera setup fail ho gaya? — At what point do I accept the setup failed?',
      requires: 'A price where the idea is proven wrong — not where the loss starts hurting.',
      rejectionExample: 'A stop chosen for the money it risks rather than the level it invalidates.',
      answer: input.stopPrice !== undefined && input.stopPrice > 0 ? String(input.stopPrice) : null,
      state: input.stopPrice !== undefined && input.stopPrice > 0 ? 'answered' : 'missing',
    },
  ];

  const ticks = new Set((input.ticks ?? []).map((t) => t.trim()));
  const checklist: ChecklistItem[] = CHECKLIST.map((c) => ({ ...c, ticked: ticks.has(c.text) }));
  const ticked = checklist.filter((c) => c.ticked).length;

  const blockedBy = questions.filter((q) => q.state === 'missing').map((q) => `Question ${q.n} unanswered`);
  // The document's rule, applied literally: one missing answer means no trade.
  const gutPassed = blockedBy.length === 0;

  let sizing: SizingResult | null = null;
  if (input.entryPrice !== undefined && input.stopPrice !== undefined) {
    const s = positionSize(input.entryPrice, input.stopPrice, {
      ...(input.maxLossRupees !== undefined ? { maxLossRupees: input.maxLossRupees } : {}),
      ...(input.capital !== undefined ? { capital: input.capital } : {}),
      ...(input.riskPct !== undefined ? { riskPct: input.riskPct } : {}),
    });
    if (!('error' in s)) sizing = s;
  }

  return {
    questions,
    checklist,
    gutPassed,
    blockedBy,
    checklistScore: { ticked, total: checklist.length },
    sizing,
    verdict: gutPassed ? 'cleared' : 'blocked',
    verdictLine: gutPassed
      ? 'All three questions answered. Still tick the checklist before the order.'
      : `No trade: ${blockedBy.join(', ')}. Missing one answer means no trade, even if the chart looks perfect.`,
    disclaimer: 'Educational checklist only. Agora Circle does not provide tips, calls or signals. Trading involves risk of loss. Consult a SEBI registered adviser before investing or trading.',
  };
}
