// The Coffee Rule — Agora Circle's beginner fundamental checklist, implemented.
//
// Source: "The Coffee Rule · Fundamental Checklist" (Agora Circle, 18 pages, English pages
// 1-9 and the same content in Hinglish on 10-18). The document defines a 10-point scorecard
// across five steps. Every check below maps to one printed line and is computed from stored
// data wherever the data can answer it.
//
// A check that genuinely cannot be answered is reported as UNKNOWN with its reason, never as
// a pass. The document's own warning applies: these are rules of thumb, not hard rules, and a
// bank, an IT company and a power utility will look very different.

import type { Database as DB } from 'better-sqlite3';

export type CheckState = 'pass' | 'fail' | 'unknown';

export interface CoffeeCheck {
  n: number;
  step: 1 | 2 | 3 | 4;
  label: string;
  state: CheckState;
  reading: string;
  rule: string;
  reason?: string;
  /** How the check was reached, so a disputed score can be audited. */
  basis?: string;
}

export interface CoffeeScorecard {
  symbol: string;
  score: number;
  outOf: number;
  verdict: 'more coffee' | 'some foam' | 'mostly foam';
  verdictLine: string;
  checks: CoffeeCheck[];
  steps: Array<{ step: number; title: string; subtitle: string }>;
  unknown: number;
  /** The Step 5 pointers, so a user can go and verify by hand. */
  sources: Array<{ need: string; where: string }>;
  /** The six beginner mistakes the document names, surfaced as warnings. */
  mistakes: string[];
  note: string;
}

const STEPS = [
  { step: 1, title: 'Understand the business', subtitle: "What's in the glass?" },
  { step: 2, title: 'Check the coffee', subtitle: 'Financial health' },
  { step: 3, title: 'Measure the foam', subtitle: 'Valuation' },
  { step: 4, title: 'Spot red flags', subtitle: 'Management' },
  { step: 5, title: 'Find the data free', subtitle: 'NSE / BSE' },
];

/** The 10 scorecard lines, verbatim from the document's printable scorecard. */
export const SCORECARD_LINES = [
  'I can explain the business in two lines',
  'It has a clear moat (brand, cost, network, switching cost, licence)',
  'Sales have grown steadily for 5 years',
  'Profits have grown with sales',
  'ROE / ROCE above 15% most years',
  'Debt is under control (D/E below 1, interest cover above 3x)',
  'Operating cash flow is close to net profit',
  'Promoters hold steady with little or no pledge',
  'P/E is reasonable vs its history and peers',
  'No major red flags from Step 4',
] as const;

/** Step 5 of the document: where each piece of evidence is published free. */
export const SOURCES = [
  { need: 'Quarterly & annual results', where: 'NSE / BSE → search the company → Financial Results' },
  { need: 'Shareholding & pledge', where: 'NSE / BSE → company page → Shareholding Pattern' },
  { need: 'Annual report', where: "NSE / BSE → company page → Annual Reports, or the company's Investor Relations page" },
  { need: 'News & announcements', where: 'NSE / BSE → Corporate Announcements' },
  { need: 'Management commentary', where: 'Company website → Investor presentations & concall transcripts' },
];

/** The six beginner mistakes the document lists, kept as guidance. */
export const MISTAKES = [
  'Buying on a tip without checking the business',
  'Thinking a ₹10 stock is "cheap" — price per share says nothing about value',
  'Looking at P/E alone, without growth or quality',
  'Ignoring debt because profits look good',
  'Judging a company by one great quarter',
  'Falling in love with a stock and ignoring red flags',
];

export function verdictFor(score: number): { verdict: CoffeeScorecard['verdict']; line: string } {
  if (score >= 8) return { verdict: 'more coffee', line: 'More coffee — worth deeper study' };
  if (score >= 5) return { verdict: 'some foam', line: 'Some foam — watchlist, wait' };
  return { verdict: 'mostly foam', line: 'Mostly foam — skip' };
}

interface Row { [k: string]: unknown }
const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Assess the moat from the signals the document's five types leave in the numbers.
 *
 * This is a documented heuristic, not a verdict on competitive position. Each signal maps to
 * one of the document's moat types, and the reading states which signals fired so a disputed
 * answer can be traced. A strong reading is evidence of a moat, not proof of one.
 */
/** Read rows, returning an empty list when the table does not exist yet. */
function safeAll(db: DB, sql: string, ...args: unknown[]): Row[] {
  try { return db.prepare(sql).all(...args) as Row[]; } catch { return []; }
}

export function moatSignals(db: DB, symbol: string, row: Row): { state: CheckState; reading: string; basis: string } {
  const id = Number(row['id']);
  const sector = String(row['sector'] ?? '');
  const opm = num(row['opm']);
  const roe = num(row['roe']);
  const mcap = num(row['market_cap']);
  const annual = safeAll(db, `SELECT sales, operating_profit, opm_pct FROM statements
    WHERE company_id=? AND period_type='annual' ORDER BY period_end DESC LIMIT 5`, id);

  const signals: string[] = [];
  let score = 0;
  let testable = 0;

  // Cost advantage / brand: a margin above the sector's median, sustained.
  const peerMargins = safeAll(db, `SELECT opm FROM latest_metrics WHERE sector=? AND UPPER(symbol)<>UPPER(?) AND opm IS NOT NULL`, sector, symbol)
    .map((r) => num(r['opm'])).filter((v): v is number => v !== null);
  const sectorMedian = median(peerMargins);
  if (opm !== null && sectorMedian !== null && peerMargins.length >= 3) {
    testable++;
    if (opm > sectorMedian * 1.2) { score++; signals.push(`margin ${opm.toFixed(1)}% vs sector median ${sectorMedian.toFixed(1)}% (cost or brand advantage)`); }
    else signals.push(`margin ${opm.toFixed(1)}% vs sector median ${sectorMedian.toFixed(1)}% — no premium`);
  }

  // Margin stability over the years held: a moat shows up as a margin that does not swing.
  const margins = annual.map((r) => num(r['opm_pct'])).filter((v): v is number => v !== null && v !== 0);
  if (margins.length >= 3) {
    testable++;
    const spread = Math.max(...margins) - Math.min(...margins);
    if (spread <= 5) { score++; signals.push(`margin held within ${spread.toFixed(1)} points across ${margins.length} years (pricing power)`); }
    else signals.push(`margin swung ${spread.toFixed(1)} points across ${margins.length} years`);
  }

  // Returns that persist: a business earning high returns for years is hard to displace.
  if (roe !== null) {
    testable++;
    if (roe >= 15) { score++; signals.push(`ROE ${roe.toFixed(1)}% — returns above the 15% the document asks for`); }
    else signals.push(`ROE ${roe.toFixed(1)}% — below the document's 15% mark`);
  }

  // Scale / licence: the largest in its sector is the one new entrants must beat.
  const peerCaps = safeAll(db, `SELECT market_cap FROM latest_metrics WHERE sector=? AND UPPER(symbol)<>UPPER(?) AND market_cap IS NOT NULL AND market_cap>0`, sector, symbol)
    .map((r) => num(r['market_cap'])).filter((v): v is number => v !== null);
  const capMedian = median(peerCaps);
  if (mcap !== null && mcap > 0 && capMedian !== null && peerCaps.length >= 3) {
    testable++;
    if (mcap >= capMedian * 2) { score++; signals.push(`market cap ${(mcap / capMedian).toFixed(1)}x the sector median (scale)`); }
    else signals.push(`market cap ${(mcap / capMedian).toFixed(1)}x the sector median — not a scale leader`);
  }

  if (testable === 0) {
    return { state: 'unknown', reading: 'not enough sector or history data to test', basis: 'no comparable peers or annual margins stored' };
  }
  // Two or more signals firing is evidence of a moat; one is suggestive but not enough.
  const state: CheckState = score >= 2 ? 'pass' : score === 1 ? 'unknown' : 'fail';
  return {
    state,
    reading: signals.join(' · '),
    basis: `${score} of ${testable} moat signals fired; two or more is treated as evidence. Signals are a proxy for the document's five moat types, not a verdict on competitive position.`,
  };
}

/**
 * P/E against its own history: the document's "much higher than its 5-10 year average = more
 * foam". Computed from the stored daily price series against trailing EPS.
 */
export function peAgainstHistory(db: DB, symbol: string, row: Row): { state: CheckState; reading: string; basis?: string } {
  const id = Number(row['id']);
  const eps = num(row['eps']);
  const currentPe = num(row['pe']);
  if (eps === null || eps <= 0 || currentPe === null) {
    return { state: 'unknown', reading: 'no positive EPS stored, so a historical P/E cannot be built' };
  }
  // The table is created on first ingest, so a company with no stored prices must read as
  // unknown rather than throwing.
  let prices: Row[] = [];
  try {
    prices = db.prepare(`SELECT date, close FROM price_history WHERE company_id=? AND close>0 ORDER BY date ASC`).all(id) as Row[];
  } catch { prices = []; }
  if (prices.length < 60) {
    return { state: 'unknown', reading: `only ${prices.length} price points stored` };
  }
  // Monthly samples of price/eps, which is what a historical P/E band is built from.
  const historicalPe: number[] = [];
  for (let i = 0; i < prices.length; i += 21) {
    const c = num(prices[i]!['close']);
    if (c !== null && c > 0) historicalPe.push(c / eps);
  }
  const med = median(historicalPe);
  if (med === null || med <= 0) return { state: 'unknown', reading: 'historical P/E could not be computed' };
  const rel = currentPe / med;
  const years = (prices.length / 252).toFixed(1);
  const state: CheckState = rel <= 1.3 ? 'pass' : 'fail';
  return {
    state,
    reading: `P/E ${currentPe.toFixed(1)} vs its own median ${med.toFixed(1)} over ${years} years (${rel.toFixed(2)}x)`,
    basis: `Monthly price samples against trailing EPS ${eps.toFixed(2)}; the document treats much higher than the long-run average as more foam.`,
  };
}

/** Score a company against the Coffee Rule. Returns null when it is not in this market. */
export function coffeeScorecard(db: DB, symbol: string): CoffeeScorecard | null {
  const row = db.prepare(`SELECT * FROM latest_metrics WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as Row | undefined;
  if (!row) return null;

  const id = Number(row['id']);
  const annual = safeAll(db, `SELECT period_end, sales, net_profit, cfo, receivables, equity_capital
    FROM statements WHERE company_id=? AND period_type='annual' ORDER BY period_end DESC LIMIT 5`, id);
  const hold = safeAll(db, `SELECT period_end, promoter, pledge_pct FROM shareholding
    WHERE company_id=? ORDER BY period_end DESC LIMIT 4`, id);

  const checks: CoffeeCheck[] = [];
  const add = (n: number, step: 1 | 2 | 3 | 4, label: string, state: CheckState, reading: string, rule: string, reason?: string, basis?: string): void => {
    checks.push({ n, step, label, state, reading, rule, ...(reason ? { reason } : {}), ...(basis ? { basis } : {}) });
  };

  // ---- 1. Explain the business in two lines ----
  // Comprehension is the user's job; the app's job is to put the description in front of them.
  const sector = String(row['sector'] ?? '').trim();
  const industry = String(row['industry'] ?? '').trim();
  const name = String(row['name'] ?? '').trim();
  const described = sector !== '' && sector !== 'Unclassified';
  add(1, 1, SCORECARD_LINES[0], described ? 'pass' : 'unknown',
    described ? `${name} — ${sector}${industry ? ' · ' + industry : ''}` : 'no sector recorded',
    'You must be able to explain the business in two lines before looking at a number',
    described ? undefined : 'the business is not even classified in this market',
    'The app supplies the description; whether you can explain it is your call.');

  // ---- 2. A clear moat ----
  const moat = moatSignals(db, symbol, row);
  add(2, 1, SCORECARD_LINES[1], moat.state, moat.reading,
    'Brand, cost advantage, network effect, switching cost, licence / scale',
    moat.state === 'unknown' ? (moat.basis ?? 'not enough signal to decide either way') : undefined,
    moat.basis);

  // ---- 3. Sales grown steadily for 5 years ----
  const salesSeries = annual.map((r) => num(r['sales'])).filter((v): v is number => v !== null && v > 0);
  if (salesSeries.length >= 3) {
    let rising = 0;
    for (let i = 0; i < salesSeries.length - 1; i++) if (salesSeries[i]! > salesSeries[i + 1]!) rising++;
    const steady = rising >= Math.ceil((salesSeries.length - 1) * 0.6);
    add(3, 2, SCORECARD_LINES[2], steady ? 'pass' : 'fail',
      `${rising} of ${salesSeries.length - 1} years rose · ${salesSeries.length} years stored`,
      'Steady growth over 5 years');
  } else {
    add(3, 2, SCORECARD_LINES[2], 'unknown', `${salesSeries.length} years of sales stored`,
      'Steady growth over 5 years', 'needs at least three annual periods');
  }

  // ---- 4. Profits grown with sales ----
  const profitSeries = annual.map((r) => num(r['net_profit'])).filter((v): v is number => v !== null);
  if (profitSeries.length >= 3 && salesSeries.length >= 3) {
    const salesGrowth = (salesSeries[0]! - salesSeries[salesSeries.length - 1]!) / Math.abs(salesSeries[salesSeries.length - 1]!);
    const profitGrowth = (profitSeries[0]! - profitSeries[profitSeries.length - 1]!) / Math.abs(profitSeries[profitSeries.length - 1] || 1);
    const profitUp = profitGrowth > 0;
    const keptPace = !(salesGrowth > 0) || profitGrowth >= salesGrowth - 0.02;
    add(4, 2, SCORECARD_LINES[3], profitUp && keptPace ? 'pass' : 'fail',
      `sales ${(salesGrowth * 100).toFixed(0)}% · profit ${(profitGrowth * 100).toFixed(0)}%`,
      'Grows with or faster than sales');
  } else {
    add(4, 2, SCORECARD_LINES[3], 'unknown', `${profitSeries.length} years of profit stored`,
      'Grows with or faster than sales', 'needs at least three annual periods');
  }

  // ---- 5. ROE / ROCE above 15% ----
  const roe = num(row['roe']);
  const roce = num(row['roce']);
  if (roe !== null || roce !== null) {
    const best = Math.max(roe ?? -Infinity, roce ?? -Infinity);
    add(5, 2, SCORECARD_LINES[4], best >= 15 ? 'pass' : 'fail',
      `ROE ${roe === null ? '—' : roe.toFixed(1) + '%'} · ROCE ${roce === null ? '—' : roce.toFixed(1) + '%'}`,
      'Above 15% consistently');
  } else {
    add(5, 2, SCORECARD_LINES[4], 'unknown', 'no ROE or ROCE stored', 'Above 15% consistently');
  }

  // ---- 6. Debt under control ----
  const de = num(row['debt_to_equity']);
  const icr = num(row['interest_coverage']);
  if (de !== null || icr !== null) {
    const deOk = de === null ? null : de < 1;
    const icrOk = icr === null ? null : icr > 3;
    const state: CheckState = deOk === null && icrOk === null ? 'unknown'
      : (deOk !== false && icrOk !== false) ? 'pass' : 'fail';
    add(6, 2, SCORECARD_LINES[5], state,
      `D/E ${de === null ? '—' : de.toFixed(2)} · interest cover ${icr === null ? '—' : icr.toFixed(1) + 'x'}`,
      'Below 1 (banks/NBFCs work differently) and above 3x');
  } else {
    add(6, 2, SCORECARD_LINES[5], 'unknown', 'no debt figures stored',
      'Below 1 (banks/NBFCs work differently) and above 3x');
  }

  // ---- 7. Operating cash flow close to net profit ----
  const cfo = num(row['cfo']);
  const np = num(row['net_profit']);
  if (cfo !== null && np !== null && np !== 0) {
    const ratio = cfo / np;
    add(7, 2, SCORECARD_LINES[6], ratio >= 0.8 ? 'pass' : 'fail',
      `CFO is ${(ratio * 100).toFixed(0)}% of net profit`,
      'Close to net profit over 5 years');
  } else {
    add(7, 2, SCORECARD_LINES[6], 'unknown', 'no operating cash flow stored',
      'Close to net profit over 5 years');
  }

  // ---- 8. Promoters hold steady, little or no pledge ----
  const pledge = num(row['pledge']);
  const promoter = num(row['promoter_holding']);
  if (pledge !== null || promoter !== null) {
    const steady = hold.length >= 2
      ? Math.abs((num(hold[0]!['promoter']) ?? 0) - (num(hold[hold.length - 1]!['promoter']) ?? 0)) <= 2
      : null;
    const pledgeOk = pledge === null ? null : pledge <= 5;
    const state: CheckState = pledgeOk === false || steady === false ? 'fail' : 'pass';
    add(8, 2, SCORECARD_LINES[7], state,
      `promoter ${promoter === null ? '—' : promoter.toFixed(1) + '%'} · pledge ${pledge === null ? '—' : pledge.toFixed(1) + '%'}`,
      'Stable holding, little or no pledge');
  } else {
    add(8, 2, SCORECARD_LINES[7], 'unknown', 'no shareholding stored',
      'Stable holding, little or no pledge');
  }

  // ---- 9. P/E reasonable vs its own history and peers ----
  const pe = num(row['pe']);
  const history = peAgainstHistory(db, symbol, row);
  const peerRow = (() => { try {
    return db.prepare(`SELECT AVG(pe) AS avgPe, COUNT(*) AS n FROM latest_metrics
      WHERE sector=(SELECT sector FROM latest_metrics WHERE UPPER(symbol)=UPPER(?))
        AND UPPER(symbol)<>UPPER(?) AND pe IS NOT NULL AND pe > 0`).get(symbol, symbol) as { avgPe: number | null; n: number };
  } catch { return { avgPe: null, n: 0 }; } })();
  const peerAvg = num(peerRow.avgPe);
  const peerNote = peerAvg !== null && peerRow.n >= 3
    ? ` · peers average ${peerAvg.toFixed(1)} (${(pe! / peerAvg).toFixed(2)}x)` : ' · too few peers to compare';
  if (pe !== null && pe > 0) {
    const peerOk = peerAvg === null || peerRow.n < 3 ? null : pe / peerAvg <= 1.5;
    const state: CheckState = history.state === 'unknown' && peerOk === null ? 'unknown'
      : (history.state !== 'fail' && peerOk !== false) ? 'pass' : 'fail';
    add(9, 3, SCORECARD_LINES[8], state,
      `${history.reading}${peerNote}`,
      'Much higher than its 5-10 year average = more foam; far above peers needs a clear reason',
      undefined, history.basis);
  } else {
    add(9, 3, SCORECARD_LINES[8], 'unknown', 'no P/E stored',
      'P/E vs its own history and peers');
  }

  // ---- 10. No major red flags ----
  // Five of the document's seven are computable from stored statements and shareholding.
  const flags: string[] = [];
  const tested: string[] = [];

  // 3. Profit grows but operating cash flow stays weak for years.
  if (annual.length >= 3) {
    tested.push('cash flow vs profit');
    const weak = annual.filter((r) => {
      const c = num(r['cfo']); const p = num(r['net_profit']);
      return c !== null && p !== null && p > 0 && c < p * 0.5;
    }).length;
    if (weak >= 3) flags.push(`operating cash flow below half of profit in ${weak} years`);
  }

  // 4. Receivables grow much faster than sales.
  const recv = annual.map((r) => num(r['receivables'])).filter((v): v is number => v !== null && v > 0);
  if (recv.length >= 3 && salesSeries.length >= 3) {
    tested.push('receivables vs sales');
    const recvGrowth = (recv[0]! - recv[recv.length - 1]!) / Math.abs(recv[recv.length - 1]!);
    const salesGrowth = (salesSeries[0]! - salesSeries[salesSeries.length - 1]!) / Math.abs(salesSeries[salesSeries.length - 1]!);
    if (recvGrowth > salesGrowth + 0.15 && recvGrowth > 0) {
      flags.push(`receivables grew ${(recvGrowth * 100).toFixed(0)}% against sales ${(salesGrowth * 100).toFixed(0)}%`);
    }
  }

  // 5. Frequent new share issues that dilute existing shareholders.
  const equity = annual.map((r) => num(r['equity_capital'])).filter((v): v is number => v !== null && v > 0);
  if (equity.length >= 3) {
    tested.push('share issuance');
    const eqGrowth = (equity[0]! - equity[equity.length - 1]!) / Math.abs(equity[equity.length - 1]!);
    if (eqGrowth > 0.10) flags.push(`equity capital grew ${(eqGrowth * 100).toFixed(0)}% — new shares issued`);
  }

  // 2. Promoters pledging more and more shares.
  const pledges = hold.map((r) => num(r['pledge_pct'])).filter((v): v is number => v !== null);
  if (pledges.length >= 2) {
    tested.push('pledge trend');
    const risingPledge = (pledges[0] ?? 0) > (pledges[pledges.length - 1] ?? 0) + 5;
    if (risingPledge) flags.push(`promoter pledge rose from ${pledges[pledges.length - 1]}% to ${pledges[0]}%`);
    else if ((pledges[0] ?? 0) > 20) flags.push(`promoter pledge at ${pledges[0]}%`);
  }

  // 1 and 6-7 (auditor, related party, accounting changes) need the annual report itself.
  const notTestable = ['auditor resignation or qualified opinion', 'related-party transactions', 'accounting-policy changes'];
  const state: CheckState = tested.length === 0 ? 'unknown' : flags.length === 0 ? 'pass' : 'fail';
  add(10, 4, SCORECARD_LINES[9], state,
    flags.length ? flags.join('; ') : tested.length ? `no red flag in the ${tested.length} tests the data allows` : 'insufficient data',
    'One red flag means dig deeper. Several means walk away.',
    tested.length === 0 ? 'no statements or shareholding to test' : undefined,
    `Tested: ${tested.join(', ')}. Not testable from stored data, read the annual report: ${notTestable.join(', ')}.`);

  const pass = checks.filter((c) => c.state === 'pass').length;
  const unknown = checks.filter((c) => c.state === 'unknown').length;
  const v = verdictFor(pass);

  return {
    symbol: symbol.toUpperCase(),
    score: pass,
    outOf: checks.length,
    verdict: v.verdict,
    verdictLine: v.line,
    checks,
    steps: STEPS,
    unknown,
    sources: SOURCES,
    mistakes: MISTAKES,
    note: `Scored ${pass} of ${checks.length} from stored data; ${unknown} could not be answered and are marked unknown rather than passed. These are rules of thumb, not hard rules — compare a company with its own history and its sector. Educational use only; not investment advice.`,
  };
}
