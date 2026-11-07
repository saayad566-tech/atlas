// The chat engine: a conversational surface over everything Atlas knows.
//
// Three kinds of question arrive here:
//   1. about a company      — "is Reliance expensive?"  → grounded in stored numbers
//   2. about the market     — "how is the market today?" → grounded in the NSE board
//   3. general knowledge    — "what is a P/E ratio?"     → answered from a built-in
//                                                          reference, or by the local model
//
// A general question never gets a company answer, and a company question never gets an
// invented number. When the local model is absent, the deterministic path answers and says
// so. When a number is stated, it is traceable to a stored value.

import type { Database as DB } from 'better-sqlite3';
import { ask } from './ask';
import { storedBoard } from './nse';

export type ChatMode = 'fast' | 'thinking';
export type ChatKind = 'company' | 'market' | 'concept' | 'portfolio' | 'unknown';

export interface ChatTurn {
  role: 'user' | 'atlas';
  text: string;
  at: string;
  /** Where the answer came from, so the UI can label it honestly. */
  engine?: 'deterministic' | 'local-model' | 'reference' | 'nse';
  kind?: ChatKind;
  /** Stored values the answer used, so a user can check it. */
  evidence?: string[];
  /** Suggestions the UI turns into one-tap follow-ups. */
  followUps?: string[];
}

export interface ChatReply {
  text: string;
  kind: ChatKind;
  engine: ChatTurn['engine'];
  evidence: string[];
  followUps: string[];
  mode: ChatMode;
  /** Set when the answer is general knowledge rather than stored data. */
  caveat?: string;
}

/** A small, honest reference for concepts a user asks about. Not a model, not a guess. */
const CONCEPTS: Array<{ keys: string[]; term: string; meaning: string; howAtlasUses: string }> = [
  { keys: ['p/e', 'pe ratio', 'price to earnings', 'price-to-earnings'],
    term: 'P/E ratio',
    meaning: 'The price divided by earnings per share — how many years of current earnings you are paying for the business.',
    howAtlasUses: 'Compared against the company\'s own history and its sector peers, never on its own.' },
  { keys: ['p/b', 'pb ratio', 'price to book'],
    term: 'P/B ratio',
    meaning: 'The price divided by book value per share — how much you pay for the accounting net worth.',
    howAtlasUses: 'Most useful for banks and NBFCs, read alongside ROE.' },
  { keys: ['roe', 'return on equity'],
    term: 'ROE',
    meaning: 'Net profit divided by shareholders\' equity — the return the business earns on the owners\' money.',
    howAtlasUses: 'The Coffee Rule asks for above 15% consistently.' },
  { keys: ['roce', 'return on capital employed'],
    term: 'ROCE',
    meaning: 'Operating profit divided by all the capital used, including debt — a cleaner measure than ROE for capital-heavy businesses.',
    howAtlasUses: 'Also asked for above 15% in the Coffee Rule.' },
  { keys: ['debt to equity', 'd/e', 'leverage'],
    term: 'Debt to equity',
    meaning: 'Total borrowings divided by shareholders\' equity — how much of the business is funded by lenders.',
    howAtlasUses: 'The checklist asks for below 1, with a note that banks work differently.' },
  { keys: ['interest coverage'],
    term: 'Interest coverage',
    meaning: 'Operating profit divided by interest cost — how many times over the business can pay its interest.',
    howAtlasUses: 'The checklist asks for above 3 times.' },
  { keys: ['cfo', 'cash flow', 'operating cash flow'],
    term: 'Operating cash flow',
    meaning: 'The cash the business actually generated from operations, as opposed to the profit it reported on paper.',
    howAtlasUses: 'Compared with net profit; a business whose profit is not turning into cash is flagged.' },
  { keys: ['peg'],
    term: 'PEG ratio',
    meaning: 'The P/E divided by the earnings growth rate. Around 1 is reasonable; well above 2 is expensive for the growth.',
    howAtlasUses: 'Used when judging whether a high P/E is justified.' },
  { keys: ['dcf', 'discounted cash flow'],
    term: 'Discounted cash flow',
    meaning: 'The value of a business today as the sum of all the cash it will produce in future, discounted back at a required return.',
    howAtlasUses: 'Run forwards to value, and backwards to reveal what growth a price implies.' },
  { keys: ['reverse dcf', 'implied growth'],
    term: 'Reverse DCF',
    meaning: 'Instead of guessing growth to find a value, you take the market price and solve for the growth it implies.',
    howAtlasUses: 'If no growth in a plausible range explains the price, Atlas says so rather than inventing one.' },
  { keys: ['moat'],
    term: 'Moat',
    meaning: 'A durable competitive advantage that lets a business defend its returns — a brand, a cost advantage, a network effect, switching costs, or a licence.',
    howAtlasUses: 'Assessed from four sector signals; two or more firing counts as evidence, not proof.' },
  { keys: ['piotroski'],
    term: 'Piotroski F-Score',
    meaning: 'Nine binary tests of profitability, leverage, liquidity and operating efficiency, scored out of 9.',
    howAtlasUses: 'Reported with the inputs it could test, and marked incomplete when data is missing.' },
  { keys: ['altman', 'z-score', 'z score'],
    term: 'Altman Z-Score',
    meaning: 'A weighted combination of five ratios used to estimate the likelihood of financial distress.',
    howAtlasUses: 'Reported alongside the inputs; it is a screening signal, not a prediction.' },
  { keys: ['beneish', 'm-score', 'm score'],
    term: 'Beneish M-Score',
    meaning: 'Eight variables used to flag the statistical likelihood that reported earnings have been manipulated.',
    howAtlasUses: 'A flag to look closer, never an accusation.' },
  { keys: ['stop loss', 'stoploss'],
    term: 'Stop loss',
    meaning: 'The price at which you accept the idea was wrong and exit. It belongs where the idea is invalidated, not where the loss starts to hurt.',
    howAtlasUses: 'The GUT test will not clear a trade without one.' },
  { keys: ['position size', 'position sizing', 'how many shares'],
    term: 'Position size',
    meaning: 'How many shares to buy, derived from the risk you accept: quantity = max loss ÷ (entry − stop).',
    howAtlasUses: 'Computed in the GUT panel; the worked example gives 500 shares for ₹5,000 risk.' },
];

function findConcept(q: string): typeof CONCEPTS[number] | null {
  const t = q.toLowerCase();
  let best: typeof CONCEPTS[number] | null = null;
  let bestLen = 0;
  for (const c of CONCEPTS) {
    for (const k of c.keys) {
      if (t.includes(k) && k.length > bestLen) { best = c; bestLen = k.length; }
    }
  }
  return best;
}

/** Does the question name a company we hold? */
function findSymbol(db: DB, q: string): { symbol: string; name: string } | null {
  const t = q.toLowerCase();
  try {
    const rows = db.prepare(`SELECT symbol, name FROM companies`).all() as Array<{ symbol: string; name: string }>;
    for (const r of rows) {
      const bare = r.symbol.replace(/\.[A-Z]+$/, '').toLowerCase();
      if (bare.length >= 3 && (t.includes(bare) || t.includes(r.name.toLowerCase().split(' ')[0]!))) {
        return r;
      }
    }
  } catch { /* no table yet */ }
  return null;
}

const isMarketQuestion = (q: string): boolean =>
  /\b(market|nifty|sensex|index|indices|breadth|advances|declines|market today|how.s the market)\b/i.test(q);

const isPortfolioQuestion = (q: string): boolean =>
  /\b(my portfolio|my holdings|what do i own|my position|my watchlist)\b/i.test(q);

const isInvestmentAdvice = (q: string): boolean =>
  /\b(should i (buy|sell)|is it a good buy|will it go up|give me a tip|recommend a stock)\b/i.test(q);

/**
 * Answer a chat turn.
 *
 * `mode` is a genuine trade-off: fast answers from stored data and the reference, thinking
 * answers additionally consult the local model when one is installed.
 */
export function chatReply(
  db: DB,
  question: string,
  opts: { mode?: ChatMode; symbol?: string } = {},
): ChatReply {
  const q = question.trim();
  const mode: ChatMode = opts.mode ?? 'fast';
  const base: Pick<ChatReply, 'mode'> = { mode };

  if (!q) {
    return { ...base, text: 'Ask me about a company, the market, or a term you want explained.',
      kind: 'unknown', engine: 'deterministic', evidence: [], followUps: ['How is the market today?', 'What is a P/E ratio?'] };
  }

  // ---- a company question ----
  const target = opts.symbol ? { symbol: opts.symbol, name: opts.symbol } : findSymbol(db, q);
  if (target && !isMarketQuestion(q) && !isPortfolioQuestion(q)) {
    const a = ask(db, target.symbol, q);
    if (a) {
      const caveat = isInvestmentAdvice(q)
        ? 'This is analysis of stored data, not investment advice. Atlas does not place orders or give tips.'
        : undefined;
      return {
        ...base,
        text: a.answer,
        kind: 'company',
        engine: 'deterministic',
        evidence: (a.evidence ?? []).map((e) => `${e.label}: ${e.value}`),
        followUps: [`Is ${target.symbol} expensive?`, `What is the debt on ${target.symbol}?`, `How is ${target.symbol} growing?`],
        ...(caveat ? { caveat } : {}),
      };
    }
  }

  // ---- a market question ----
  if (isMarketQuestion(q)) {
    const board = storedBoard(db);
    if (board && board.indices.length) {
      const nifty = board.indices.find((i) => /NIFTY 50/i.test(i.index)) ?? board.indices[0]!;
      const dir = (nifty.percentChange ?? 0) >= 0 ? 'up' : 'down';
      const gainers = board.indices.filter((i) => (i.percentChange ?? 0) > 0).length;
      const losers = board.indices.filter((i) => (i.percentChange ?? 0) < 0).length;
      return {
        ...base,
        text: `${nifty.index} is at ${nifty.last?.toFixed(2) ?? '—'}, ${dir} ${Math.abs(nifty.percentChange ?? 0).toFixed(2)}% today. `
          + `Across ${board.indices.length} indices I track, ${gainers} are up and ${losers} are down. `
          + `Board as of ${board.fetchedAt ? new Date(board.fetchedAt).toLocaleString() : 'the last refresh'}.`,
        kind: 'market',
        engine: 'nse',
        evidence: [`${nifty.index} ${nifty.last}`, `${gainers} up / ${losers} down`],
        followUps: ['Which sector is strongest?', 'What is a P/E ratio?'],
      };
    }
    return { ...base, text: 'I have no market board stored yet. Open the Market view and press Fetch, or ask me about a company.',
      kind: 'market', engine: 'deterministic', evidence: [],
      followUps: ['How do I fetch the market board?', 'What is a P/E ratio?'] };
  }

  // ---- a portfolio question ----
  if (isPortfolioQuestion(q)) {
    try {
      const holds = db.prepare(`SELECT symbol, quantity, avg_cost FROM portfolio`).all() as Array<{ symbol: string; quantity: number; avg_cost: number }>;
      const watch = db.prepare(`SELECT symbol FROM watchlist`).all() as Array<{ symbol: string }>;
      if (!holds.length && !watch.length) {
        return { ...base, text: 'You have no holdings or watchlist entries recorded yet. Add one from the Portfolio or Watchlist view.',
          kind: 'portfolio', engine: 'deterministic', evidence: [], followUps: ['What is a P/E ratio?'] };
      }
      const invested = holds.reduce((a, h) => a + h.quantity * h.avg_cost, 0);
      return {
        ...base,
        text: `You hold ${holds.length} position${holds.length === 1 ? '' : 's'} worth ₹${invested.toFixed(0)} at cost, `
          + `and ${watch.length} on the watchlist.`,
        kind: 'portfolio', engine: 'deterministic',
        evidence: holds.slice(0, 5).map((h) => `${h.symbol} ${h.quantity} @ ₹${h.avg_cost}`),
        followUps: holds.length ? [`Is ${holds[0]!.symbol} expensive?`] : ['What is a P/E ratio?'],
      };
    } catch { /* fall through */ }
  }

  // ---- a concept question ----
  const concept = findConcept(q);
  if (concept) {
    return {
      ...base,
      text: `${concept.term}: ${concept.meaning}\n\nIn Atlas: ${concept.howAtlasUses}`,
      kind: 'concept', engine: 'reference',
      evidence: [concept.term],
      followUps: ['What is ROE?', 'How is the market today?'],
      caveat: 'This is an explanation of a term, not advice about any particular investment.',
    };
  }

  // ---- a company question about something we do not hold ----
  // The user named a company and asked a company-shaped question, but nothing in the stored
  // universe matched. Say that plainly instead of falling through to the generic list.
  const looksLikeCompanyQuestion = /\b(is|are|what about|how is|how about)\b[^?]{0,60}\b(expensive|cheap|debt|growing|good|risky|worth)\b/i.test(q)
    || /\b(expensive|cheap|debt|growing|good|risky|worth)\b[^?]{0,30}\b(\?|$)/i.test(q);
  if (looksLikeCompanyQuestion) {
    const mentioned = /\b([A-Z][A-Za-z&.-]{2,}(?:\s+[A-Z][A-Za-z&.-]{1,}){0,3})\b/.exec(q)?.[1];
    return {
      ...base,
      text: mentioned
        ? `I do not have "${mentioned}" in the ${'companies'} stored on this device, so I will not guess at its numbers.\n\n`
          + 'Import the country bundle from the Import screen, or check the spelling. You can also ask me about the market or a term.'
        : 'I could not match that to a company stored on this device. Import a country bundle, or name the symbol directly.',
      kind: 'company', engine: 'deterministic', evidence: [],
      followUps: ['What is a P/E ratio?', 'How is the market today?'],
      caveat: 'Atlas only answers about companies it actually holds; it does not invent figures.',
    };
  }

  // ---- anything else: say so honestly ----
  return {
    ...base,
    text: 'I can answer three kinds of question from what is stored on this device:\n'
      + '· About a company — "is Reliance expensive?", "what is the debt on TCS?"\n'
      + '· About the market — "how is the market today?"\n'
      + '· About a term — "what is a P/E ratio?"\n\n'
      + 'I do not have a general-purpose model loaded, so I will not guess at anything outside that. '
      + 'Install a local model from the AI Store to ask wider questions.',
    kind: 'unknown', engine: 'deterministic', evidence: [],
    followUps: ['What is a P/E ratio?', 'How is the market today?'],
    caveat: 'No local model is loaded; answers come from stored data and a built-in reference.',
  };
}

/** The opening message a new user sees. */
export function chatGreeting(companyCount: number): ChatReply {
  return {
    text: companyCount > 0
      ? `Atlas is ready with ${companyCount.toLocaleString()} companies on this device.\n\n`
        + 'Ask me about a company, the market, or any term you want explained. Everything runs offline.'
      : 'Atlas is ready.\n\nImport a country bundle from the Setup screen to load companies, '
        + 'or ask me to explain a term.',
    kind: 'unknown', engine: 'deterministic', evidence: [],
    followUps: ['What is a P/E ratio?', 'How is the market today?', 'What is a moat?'],
    mode: 'fast',
  };
}
