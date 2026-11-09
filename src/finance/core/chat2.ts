// The chat engine, second generation.
//
// The first version answered three kinds of question. This one also compares companies,
// runs a screen from a sentence, performs a small set of actions, and follows the thread of
// the conversation — while keeping the same rule: nothing is stated that is not in the data.
//
// Every answer carries its blocks: prose, and where it helps, a table the UI can render.

import type { Database as DB } from 'better-sqlite3';
import { ask } from './ask';
import { storedBoard } from './nse';
import { policyRate } from './carry';
import { fetchQuotes, type Quote } from './quotes';

export type ChatMode = 'fast' | 'thinking';
export type ChatKind = 'company' | 'compare' | 'screen' | 'market' | 'concept'
  | 'portfolio' | 'action' | 'help' | 'unknown';

export interface ChatBlock {
  type: 'text' | 'table' | 'list';
  text?: string;
  headers?: string[];
  rows?: string[][];
  items?: string[];
}

export interface ChatReply {
  text: string;
  blocks: ChatBlock[];
  kind: ChatKind;
  engine: 'deterministic' | 'local-model' | 'reference' | 'nse' | 'live-quote';
  evidence: string[];
  followUps: string[];
  mode: ChatMode;
  /** What the answer needs to remember for the next turn. */
  context?: { symbol?: string };
  /** Set when an action was actually performed. */
  performed?: { action: string; symbol: string; ok: boolean; detail: string };
  caveat?: string;
}

// ---- a reference of terms --------------------------------------------------
const CONCEPTS: Array<{ keys: string[]; term: string; meaning: string; howAtlasUses: string }> = [
  { keys: ['p/e', 'pe ratio', 'price to earnings', 'times earnings'],
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
  { keys: ['roce', 'return on capital'],
    term: 'ROCE',
    meaning: 'Operating profit divided by all the capital used, including debt — a cleaner measure than ROE for capital-heavy businesses.',
    howAtlasUses: 'Also asked for above 15% in the Coffee Rule.' },
  { keys: ['debt to equity', 'd/e', 'leverage'],
    term: 'Debt to equity',
    meaning: 'Total borrowings divided by shareholders\' equity — how much of the business is funded by lenders.',
    howAtlasUses: 'The checklist asks for below 1, with a note that banks work differently.' },
  { keys: ['interest coverage', 'interest cover'],
    term: 'Interest coverage',
    meaning: 'Operating profit divided by interest cost — how many times over the business can pay its interest.',
    howAtlasUses: 'The checklist asks for above 3 times.' },
  { keys: ['cfo', 'operating cash flow', 'cash flow'],
    term: 'Operating cash flow',
    meaning: 'The cash the business actually generated, as opposed to the profit it reported on paper.',
    howAtlasUses: 'Compared with net profit; profit that is not turning into cash is flagged.' },
  { keys: ['peg'],
    term: 'PEG ratio',
    meaning: 'The P/E divided by the earnings growth rate. Around 1 is reasonable; well above 2 is expensive for the growth.',
    howAtlasUses: 'Used when judging whether a high P/E is justified.' },
  { keys: ['dcf', 'discounted cash flow'],
    term: 'Discounted cash flow',
    meaning: 'The value today of all the cash a business will produce in future, discounted at a required return.',
    howAtlasUses: 'Run forwards to value, and backwards to reveal what growth a price implies.' },
  { keys: ['reverse dcf', 'implied growth'],
    term: 'Reverse DCF',
    meaning: 'Take the market price and solve for the growth it implies, instead of guessing growth to find a value.',
    howAtlasUses: 'If no plausible growth explains the price, Atlas says so rather than inventing one.' },
  { keys: ['moat'],
    term: 'Moat',
    meaning: 'A durable advantage that lets a business defend its returns — brand, cost, network effect, switching costs, or a licence.',
    howAtlasUses: 'Assessed from four sector signals; two or more firing counts as evidence, not proof.' },
  { keys: ['piotroski', 'f-score'],
    term: 'Piotroski F-Score',
    meaning: 'Nine binary tests of profitability, leverage, liquidity and efficiency, scored out of 9.',
    howAtlasUses: 'Reported with the inputs it could test, and marked incomplete when data is missing.' },
  { keys: ['altman', 'z-score'],
    term: 'Altman Z-Score',
    meaning: 'A weighted combination of five ratios estimating the likelihood of financial distress.',
    howAtlasUses: 'A screening signal reported with its inputs, not a prediction.' },
  { keys: ['beneish', 'm-score'],
    term: 'Beneish M-Score',
    meaning: 'Eight variables flagging the statistical likelihood that reported earnings were manipulated.',
    howAtlasUses: 'A flag to look closer, never an accusation.' },
  { keys: ['stop loss', 'stoploss', 'stop-loss'],
    term: 'Stop loss',
    meaning: 'The price at which you accept the idea was wrong and exit. It belongs where the idea is invalidated, not where the loss starts to hurt.',
    howAtlasUses: 'The GUT test will not clear a trade without one.' },
  { keys: ['position size', 'position sizing', 'how many shares'],
    term: 'Position size',
    meaning: 'How many shares to buy from the risk you accept: quantity = max loss ÷ (entry − stop).',
    howAtlasUses: 'Computed in the GUT panel; the worked example gives 500 shares for ₹5,000 risk.' },
  { keys: ['carry', 'interest rate differential'],
    term: 'Carry',
    meaning: 'The interest differential between two currencies — what you earn or pay just for holding a position.',
    howAtlasUses: 'Calculated from central-bank policy rates, shown with the date they took effect.' },
];

function findConcept(q: string) {
  const t = q.toLowerCase();
  let best: typeof CONCEPTS[number] | null = null;
  let bestLen = 0;
  for (const c of CONCEPTS) for (const k of c.keys) {
    if (t.includes(k) && k.length > bestLen) { best = c; bestLen = k.length; }
  }
  return best;
}

// ---- company matching ------------------------------------------------------
interface Row { symbol: string; name: string }

function allCompanies(db: DB): Row[] {
  try { return db.prepare('SELECT symbol, name FROM companies').all() as Row[]; } catch { return []; }
}

/** Every company named in the question, longest name first so "ICICI Bank" beats "ICICI". */
function findCompanies(db: DB, q: string): Row[] {
  const t = q.toLowerCase();
  const rows = allCompanies(db);
  const hits: Array<{ row: Row; len: number; at: number }> = [];
  for (const r of rows) {
    const bare = r.symbol.replace(/\.[A-Z]+$/, '').toLowerCase();
    const name = r.name.toLowerCase();
    const first = name.split(' ')[0]!;
    for (const needle of [bare, name, first]) {
      if (needle.length < 3) continue;
      const at = t.indexOf(needle);
      if (at !== -1) { hits.push({ row: r, len: needle.length, at }); break; }
    }
  }
  // Drop a hit whose match sits inside a longer one for the same company.
  const kept = hits.filter((h) => !hits.some((o) => o.row.symbol === h.row.symbol && o.len > h.len));
  const seen = new Set<string>();
  return kept.sort((a, b) => a.at - b.at)
    .filter((h) => { if (seen.has(h.row.symbol)) return false; seen.add(h.row.symbol); return true; })
    .map((h) => h.row);
}

const fmt = (v: unknown, suffix = ''): string => {
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) && v !== null ? `${x.toFixed(2)}${suffix}` : '—';
};

// ---- screening from a sentence ---------------------------------------------
interface ScreenTerm { field: string; column: string; op: string; value: number }

const SCREEN_FIELDS: Array<{ field: string; column: string; words: string[]; suffix?: string }> = [
  { field: 'P/E', column: 'pe', words: ['p/e', 'pe ', 'price to earnings'] },
  { field: 'P/B', column: 'pb', words: ['p/b', 'pb '] },
  { field: 'ROE', column: 'roe', words: ['roe', 'return on equity'], suffix: '%' },
  { field: 'ROCE', column: 'roce', words: ['roce'], suffix: '%' },
  { field: 'Debt to Equity', column: 'debt_to_equity', words: ['debt to equity', 'debt/equity', 'd/e'] },
  { field: 'Dividend Yield', column: 'dividend_yield', words: ['dividend'], suffix: '%' },
  { field: 'Market Cap', column: 'market_cap', words: ['market cap'] },
  { field: 'Promoter Holding', column: 'promoter_holding', words: ['promoter'], suffix: '%' },
];

const ABOVE = /(above|over|greater than|more than|at least)/i;
const BELOW = /(below|under|less than|at most)/i;

function parseScreen(q: string): ScreenTerm[] {
  const t = q.toLowerCase();
  const out: ScreenTerm[] = [];
  for (const f of SCREEN_FIELDS) {
    for (const w of f.words) {
      const at = t.indexOf(w);
      if (at === -1) continue;
      const window = t.slice(at, at + 45);
      const num = /(-?\d+(?:\.\d+)?)/.exec(window);
      if (!num) continue;
      const before = window.slice(0, num.index ?? 0);
      let op: string | null = null;
      if (ABOVE.test(before)) op = '>';
      else if (BELOW.test(before)) op = '<';
      if (!op) continue;
      const value = Number(num[1]);
      if (!Number.isFinite(value)) continue;
      if (!out.some((x) => x.column === f.column)) out.push({ field: f.field, column: f.column, op, value });
      break;
    }
  }
  return out;
}

function runScreen(db: DB, terms: ScreenTerm[], limit = 10): Array<Record<string, unknown>> {
  if (!terms.length) return [];
  const where = terms.map((t) => `(${t.column} IS NOT NULL AND ${t.column} ${t.op} ?)`).join(' AND ');
  const args = terms.map((t) => t.value);
  try {
    return db.prepare(`SELECT symbol, name, sector, pe, roe, debt_to_equity, market_cap
      FROM latest_metrics WHERE ${where} ORDER BY market_cap DESC LIMIT ?`).all(...args, limit) as Array<Record<string, unknown>>;
  } catch { return []; }
}

// ---- intent detection ------------------------------------------------------
const isCompare = (q: string) => /\b(compare|vs\.?|versus|or)\b/i.test(q);
const isScreen = (q: string) => /\b(show me|find|list|screen|which|stocks with|companies with)\b/i.test(q);
const isHelp = (q: string) => /\b(what can you do|help|how do i|what do you do|capabilities)\b/i.test(q);
const isMarket = (q: string) => /\b(market|nifty|sensex|index|indices|breadth|advances|declines)\b/i.test(q);
const isPortfolio = (q: string) => /\b(my portfolio|my holdings|what do i own|my watchlist)\b/i.test(q);
const isAdvice = (q: string) => /\b(should i (buy|sell)|is it a good buy|will it go up|give me a tip|recommend a stock)\b/i.test(q);
const isAction = (q: string) => /\b(add|remove|watch|unwatch|track)\b/i.test(q) && /\b(watchlist|watch list)\b/i.test(q);
const isPrice = (q: string) => /\b(price|quote|trading at|what is .* at|how much is)\b/i.test(q);

/**
 * Answer a turn.
 *
 * `context` carries the company from the previous turn so "what about its debt?" works.
 */
export function chatReply(
  db: DB,
  question: string,
  opts: { mode?: ChatMode; symbol?: string; context?: { symbol?: string } } = {},
): ChatReply {
  const q = question.trim();
  const mode: ChatMode = opts.mode ?? 'fast';
  const base = { mode, blocks: [] as ChatBlock[] };

  if (!q) {
    return { ...base, text: 'Ask me about a company, the market, or a term you want explained.',
      kind: 'unknown', engine: 'deterministic', evidence: [],
      followUps: ['What can you do?', 'How is the market today?'] };
  }

  // ---- help ----
  if (isHelp(q)) {
    const items = [
      'About a company — "is Reliance expensive?", "what is the debt on TCS?"',
      'Compare two — "compare Reliance and TCS"',
      'Screen in a sentence — "banks with ROE above 15"',
      'The market — "how is the market today?"',
      'A term — "what is a P/E ratio?", "what is a moat?"',
      'Your holdings — "what do I own?"',
      'A small action — "add Reliance to my watchlist"',
    ];
    return { ...base, text: 'Here is what I can do from what is stored on this device:',
      blocks: [{ type: 'list', items }], kind: 'help', engine: 'deterministic', evidence: [],
      followUps: ['Compare Reliance and TCS', 'How is the market today?'] };
  }

  // ---- action ----
  if (isAction(q)) {
    const found = findCompanies(db, q);
    if (!found.length) {
      return { ...base, text: 'I could not match that to a company stored here, so nothing was changed.',
        kind: 'action', engine: 'deterministic', evidence: [], followUps: ['What can you do?'] };
    }
    const c = found[0]!;
    const removing = /\b(remove|unwatch|stop tracking)\b/i.test(q);
    try {
      const id = (db.prepare('SELECT id FROM companies WHERE symbol = ?').get(c.symbol) as { id: number } | undefined)?.id;
      if (!id) throw new Error('that company is not in this market');
      const existing = db.prepare('SELECT 1 FROM watchlist WHERE company_id = ?').get(id);
      if (removing) {
        db.prepare('DELETE FROM watchlist WHERE company_id = ?').run(id);
      } else if (!existing) {
        db.prepare('INSERT INTO watchlist (company_id, added_at) VALUES (?, ?)').run(id, Date.now());
      }
      const detail = removing
        ? (existing ? `Removed ${c.name} from your watchlist.` : `${c.name} was not on your watchlist.`)
        : (existing ? `${c.name} is already on your watchlist.` : `Added ${c.name} to your watchlist.`);
      return { ...base, text: detail, kind: 'action', engine: 'deterministic',
        evidence: [`${c.symbol} — ${c.name}`], followUps: ['What do I own?', `Is ${c.symbol} expensive?`],
        performed: { action: removing ? 'remove' : 'add', symbol: c.symbol, ok: true, detail } };
    } catch (e) {
      return { ...base, text: 'I could not change the watchlist. ' + (e instanceof Error ? e.message.slice(0, 80) : ''),
        kind: 'action', engine: 'deterministic', evidence: [], followUps: [],
        performed: { action: 'add', symbol: c.symbol, ok: false, detail: 'the write failed' } };
    }
  }

  // ---- compare ----
  if (isCompare(q)) {
    const found = findCompanies(db, q);
    if (found.length >= 2) {
      const rows = found.slice(0, 4).map((c) => {
        const r = db.prepare('SELECT pe, roe, debt_to_equity, opm, market_cap FROM latest_metrics WHERE symbol = ?').get(c.symbol) as Record<string, unknown> | undefined;
        return [c.symbol, fmt(r?.['pe']), fmt(r?.['roe'], '%'), fmt(r?.['debt_to_equity']), fmt(r?.['opm'], '%')];
      });
      return {
        ...base,
        text: `Side by side, from the data stored on this device:`,
        blocks: [{ type: 'table', headers: ['Symbol', 'P/E', 'ROE', 'Debt/Equity', 'Operating margin'], rows }],
        kind: 'compare', engine: 'deterministic',
        evidence: found.slice(0, 4).map((c) => `${c.symbol} — ${c.name}`),
        followUps: [`Is ${found[0]!.symbol} expensive?`, `What is the debt on ${found[1]!.symbol}?`],
        context: { symbol: found[0]!.symbol },
        caveat: 'A comparison of stored figures, not a recommendation.',
      };
    }
    if (found.length === 1) {
      return { ...base, text: `I found ${found[0]!.name}, but no second company to compare it with. Name both, or import the market that holds the other.`,
        kind: 'compare', engine: 'deterministic', evidence: [found[0]!.symbol], followUps: [`Is ${found[0]!.symbol} expensive?`] };
    }
  }

  // ---- screen ----
  if (isScreen(q)) {
    const terms = parseScreen(q);
    if (terms.length) {
      const rows = runScreen(db, terms);
      const described = terms.map((t) => `${t.field} ${t.op} ${t.value}`).join(' and ');
      if (!rows.length) {
        return { ...base, text: `Nothing stored matches ${described}. That may be the data, or the filter may be too tight.`,
          kind: 'screen', engine: 'deterministic', evidence: [], followUps: ['Show me companies with ROE above 15'] };
      }
      return {
        ...base,
        text: `${rows.length} companies match ${described}, largest first:`,
        blocks: [{ type: 'table', headers: ['Symbol', 'Name', 'Sector', 'P/E', 'ROE', 'D/E'],
          rows: rows.map((r) => [String(r['symbol']), String(r['name']).slice(0, 26), String(r['sector']).slice(0, 16),
            fmt(r['pe']), fmt(r['roe'], '%'), fmt(r['debt_to_equity'])]) }],
        kind: 'screen', engine: 'deterministic',
        evidence: [`filter: ${described}`],
        // Carry the first result forward so "what about its debt?" works straight after a screen.
        context: { symbol: String(rows[0]!['symbol']) },
        followUps: [`Is ${String(rows[0]!['symbol'])} expensive?`, 'What is a P/E ratio?'],
        caveat: 'A screen of stored data, not investment advice.',
      };
    }
  }

  // ---- market ----
  if (isMarket(q)) {
    const board = storedBoard(db);
    if (board && board.indices.length) {
      const nifty = board.indices.find((i) => /NIFTY 50/i.test(i.index)) ?? board.indices[0]!;
      const up = board.indices.filter((i) => (i.percentChange ?? 0) > 0).length;
      const down = board.indices.filter((i) => (i.percentChange ?? 0) < 0).length;
      const top = [...board.indices].sort((a, b) => (b.percentChange ?? 0) - (a.percentChange ?? 0)).slice(0, 5);
      return {
        ...base,
        text: `${nifty.index} is at ${fmt(nifty.last)}, ${(nifty.percentChange ?? 0) >= 0 ? 'up' : 'down'} `
          + `${Math.abs(nifty.percentChange ?? 0).toFixed(2)}% today. Across ${board.indices.length} indices, ${up} are up and ${down} are down.`,
        blocks: [{ type: 'table', headers: ['Index', 'Last', 'Change'],
          rows: top.map((i) => [i.index, fmt(i.last), `${(i.percentChange ?? 0) >= 0 ? '+' : ''}${(i.percentChange ?? 0).toFixed(2)}%`]) }],
        kind: 'market', engine: 'nse',
        evidence: [`board as of ${board.fetchedAt ? new Date(board.fetchedAt).toLocaleString() : 'last refresh'}`],
        followUps: ['Compare Reliance and TCS', 'What is a P/E ratio?'],
      };
    }
    return { ...base, text: 'I have no market board stored yet. Open Settings and read the RBI page, or press Fetch in the market view.',
      kind: 'market', engine: 'deterministic', evidence: [], followUps: ['What can you do?'] };
  }

  // ---- portfolio ----
  if (isPortfolio(q)) {
    try {
      const holds = db.prepare(`SELECT c.symbol AS symbol, p.quantity AS quantity, p.avg_cost AS avg_cost
        FROM portfolio p JOIN companies c ON c.id = p.company_id`).all() as Array<{ symbol: string; quantity: number; avg_cost: number }>;
      const watch = db.prepare(`SELECT c.symbol AS symbol FROM watchlist w JOIN companies c ON c.id = w.company_id`)
        .all() as Array<{ symbol: string }>;
      if (!holds.length && !watch.length) {
        return { ...base, text: 'You have no holdings or watchlist entries yet. Ask me to add a company to your watchlist.',
          kind: 'portfolio', engine: 'deterministic', evidence: [], followUps: ['What can you do?'] };
      }
      const invested = holds.reduce((a, h) => a + h.quantity * h.avg_cost, 0);
      return {
        ...base,
        text: `You hold ${holds.length} position${holds.length === 1 ? '' : 's'} worth ₹${invested.toFixed(0)} at cost, and ${watch.length} on the watchlist.`,
        blocks: holds.length ? [{ type: 'table', headers: ['Symbol', 'Quantity', 'Avg cost', 'Value'],
          rows: holds.map((h) => [h.symbol, String(h.quantity), `₹${h.avg_cost.toFixed(2)}`, `₹${(h.quantity * h.avg_cost).toFixed(0)}`]) }] : [],
        kind: 'portfolio', engine: 'deterministic',
        evidence: watch.slice(0, 8).map((w) => `watching ${w.symbol}`),
        followUps: holds.length ? [`Is ${holds[0]!.symbol} expensive?`] : ['What can you do?'],
      };
    } catch { /* fall through */ }
  }

  // ---- a company, or a follow-up about the last one ----
  const target = opts.symbol
    ? { symbol: opts.symbol, name: opts.symbol }
    : findCompanies(db, q)[0]
      ?? (opts.context?.symbol && !findConcept(q) ? { symbol: opts.context.symbol, name: opts.context.symbol } : null);

  if (target && !findConcept(q)) {
    const a = ask(db, target.symbol, q);
    if (a) {
      return {
        ...base, text: a.answer, kind: 'company', engine: 'deterministic',
        evidence: (a.evidence ?? []).map((e) => `${e.label}: ${e.value}`),
        followUps: [`Is ${target.symbol} expensive?`, `What is the debt on ${target.symbol}?`, `Compare ${target.symbol} and another`],
        context: { symbol: target.symbol },
        ...(isAdvice(q) ? { caveat: 'This is analysis of stored data, not investment advice. Atlas does not place orders or give tips.' } : {}),
      };
    }
  }

  // ---- a price question about something we do not hold ----
  if (isPrice(q) && !target) {
    return { ...base, text: 'Tell me the symbol and I will fetch its live price, for example "price of RELIANCE.NS".',
      kind: 'company', engine: 'deterministic', evidence: [], followUps: ['What can you do?'] };
  }

  // ---- a term ----
  const concept = findConcept(q);
  if (concept) {
    return { ...base, text: `${concept.term}: ${concept.meaning}\n\nIn Atlas: ${concept.howAtlasUses}`,
      kind: 'concept', engine: 'reference', evidence: [concept.term],
      followUps: ['What is ROE?', 'What can you do?'],
      caveat: 'An explanation of a term, not advice about any particular investment.' };
  }

  // ---- a company-shaped question we cannot answer ----
  const companyShaped = /\b(expensive|cheap|debt|growing|good|risky|worth)\b/i.test(q);
  if (companyShaped) {
    const mentioned = /\b([A-Z][A-Za-z&.-]{2,}(?:\s+[A-Z][A-Za-z&.-]{1,}){0,3})\b/.exec(q)?.[1];
    return { ...base,
      text: mentioned
        ? `I do not have "${mentioned}" stored on this device, so I will not guess at its numbers. Import the market that holds it, or check the spelling.`
        : 'I could not match that to a company stored here. Import a country bundle, or name the symbol directly.',
      kind: 'company', engine: 'deterministic', evidence: [],
      followUps: ['What can you do?'],
      caveat: 'Atlas only answers about companies it actually holds; it does not invent figures.' };
  }

  // ---- honest fallback ----
  return { ...base,
    text: 'I did not understand that one. Here is what I can do — and I will not guess at anything outside it.',
    blocks: [{ type: 'list', items: [
      'Ask about a company — "is Reliance expensive?"',
      'Compare two — "compare Reliance and TCS"',
      'Screen — "companies with ROE above 15"',
      'The market — "how is the market today?"',
      'A term — "what is a moat?"',
    ] }],
    kind: 'unknown', engine: 'deterministic', evidence: [],
    followUps: ['What can you do?'],
    caveat: 'No general-purpose model is loaded; answers come from stored data and a built-in reference.' };
}

/** Fetch live prices for named symbols, used when a question asks for a price. */
export async function livePrices(db: DB, symbols: string[]): Promise<{ quotes: Quote[]; text: string; blocks: ChatBlock[] }> {
  const batch = await fetchQuotes(symbols);
  const good = batch.quotes.filter((q) => !q.error);
  const blocks: ChatBlock[] = good.length ? [{
    type: 'table', headers: ['Symbol', 'Price', 'Change', 'As of'],
    rows: good.map((q) => [q.symbol, `${q.price ?? '—'} ${q.currency}`,
      q.changePct === null ? '—' : `${q.changePct >= 0 ? '+' : ''}${q.changePct}%`,
      q.asOf ? new Date(q.asOf).toLocaleString() : '—']),
  }] : [];
  const text = good.length
    ? `Live prices for ${good.length} symbol${good.length === 1 ? '' : 's'}:`
    : 'The quote source could not be reached, so no live price is shown rather than a stale one.';
  return { quotes: batch.quotes, text, blocks };
}

export function chatGreeting(companyCount: number): ChatReply {
  return {
    text: companyCount > 0
      ? `Atlas is ready with ${companyCount.toLocaleString()} companies on this device.\n\nAsk me about a company, compare two, screen in a sentence, or ask what a term means. Everything runs offline.`
      : 'Atlas is ready.\n\nImport a country bundle from the Import screen to load companies, or ask me what a term means.',
    blocks: [{ type: 'list', items: [
      'Is Reliance expensive?',
      'Compare Reliance and TCS',
      'Companies with ROE above 15',
      'What is a moat?',
    ] }],
    kind: 'help', engine: 'deterministic', evidence: [],
    followUps: ['What can you do?', 'How is the market today?'],
    mode: 'fast',
  };
}
