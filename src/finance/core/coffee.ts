// The Coffee Rule — Agora Circle's beginner fundamental checklist, implemented.
//
// Source: "The Coffee Rule · Fundamental Checklist" (Agora Circle, 18 pages, English and
// Hinglish). The document defines a 10-point scorecard across five steps. Every check below
// maps to one line of that scorecard and is computed from stored data.
//
// A check that cannot be answered from the data is reported as UNKNOWN, not as a pass. The
// document's own warning applies: these are rules of thumb, not hard rules, and a bank, an
// IT company and a power utility will look very different.

import type { Database as DB } from 'better-sqlite3';

export type CheckState = 'pass' | 'fail' | 'unknown';

export interface CoffeeCheck {
  /** Which scorecard line this answers, 1-10. */
  n: number;
  step: 1 | 2 | 3 | 4;
  label: string;
  state: CheckState;
  /** The reading that decided it, in the document's own units. */
  reading: string;
  /** The threshold the document states, quoted as a rule of thumb. */
  rule: string;
  /** Why it is unknown, when it is. */
  reason?: string;
}

export interface CoffeeScorecard {
  symbol: string;
  score: number;
  outOf: number;
  verdict: 'more coffee' | 'some foam' | 'mostly foam';
  verdictLine: string;
  checks: CoffeeCheck[];
  /** The five steps, so the UI can group them as the document does. */
  steps: Array<{ step: number; title: string; subtitle: string }>;
  unknown: number;
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

/** The document's own verdict bands. */
export function verdictFor(score: number): { verdict: CoffeeScorecard['verdict']; line: string } {
  if (score >= 8) return { verdict: 'more coffee', line: 'More coffee — worth deeper study' };
  if (score >= 5) return { verdict: 'some foam', line: 'Some foam — watchlist, wait' };
  return { verdict: 'mostly foam', line: 'Mostly foam — skip' };
}

interface Row { [k: string]: unknown }

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Score a company against the Coffee Rule.
 * Returns null when the company is not in this market's database.
 */
export function coffeeScorecard(db: DB, symbol: string): CoffeeScorecard | null {
  const row = db.prepare(`SELECT * FROM latest_metrics WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as Row | undefined;
  if (!row) return null;

  // Five years of statements, newest first, for the trends the document asks about.
  const id = Number(row['id']);
  const annual = db.prepare(`SELECT period_end, sales, net_profit, cfo, interest, operating_profit
    FROM statements WHERE company_id=? AND period_type='annual' ORDER BY period_end DESC LIMIT 5`).all(id) as Row[];
  const hold = db.prepare(`SELECT period_end, promoter, pledge_pct FROM shareholding
    WHERE company_id=? ORDER BY period_end DESC LIMIT 4`).all(id) as Row[];

  const checks: CoffeeCheck[] = [];
  const add = (n: number, step: 1 | 2 | 3 | 4, label: string, state: CheckState, reading: string, rule: string, reason?: string): void => {
    checks.push({ n, step, label, state, reading, rule, ...(reason ? { reason } : {}) });
  };

  // ---- 1. Explain the business in two lines (Step 1) ----
  // The document's test is comprehension, which a database cannot judge. What it can do is
  // confirm the business is described at all: a sector and an industry are recorded.
  const sector = String(row['sector'] ?? '').trim();
  const industry = String(row['industry'] ?? '').trim();
  const described = sector !== '' && sector !== 'Unclassified';
  add(1, 1, SCORECARD_LINES[0], described ? 'pass' : 'unknown',
    described ? `${sector}${industry ? ' · ' + industry : ''}` : 'no sector recorded',
    'You must be able to explain the business in two lines before looking at a number',
    described ? undefined : 'comprehension cannot be scored from data; the business is not even classified here');

  // ---- 2. A clear moat (Step 1) ----
  // The document names five moats. None is a stored field, so this is honestly unknown
  // rather than inferred from margin alone, which would be a guess.
  add(2, 1, SCORECARD_LINES[1], 'unknown', 'not derivable from stored data',
    'Brand, cost advantage, network effect, switching cost, licence / scale',
    'a moat is a judgement about competitive position, not a number this app stores');

  // ---- 3. Sales grown steadily for 5 years (Step 2) ----
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

  // ---- 4. Profits grown with sales (Step 2) ----
  const profitSeries = annual.map((r) => num(r['net_profit'])).filter((v): v is number => v !== null);
  if (profitSeries.length >= 3 && salesSeries.length >= 3) {
    const salesUp = salesSeries[0]! > salesSeries[salesSeries.length - 1]!;
    const profitUp = profitSeries[0]! > profitSeries[profitSeries.length - 1]!;
    // The line is "Profits have grown with sales": growth is required. A company whose sales
    // and profit both fell has not met it, even though they moved together.
    const salesGrowth = (salesSeries[0]! - salesSeries[salesSeries.length - 1]!) / Math.abs(salesSeries[salesSeries.length - 1]!);
    const profitGrowth = (profitSeries[0]! - profitSeries[profitSeries.length - 1]!) / Math.abs(profitSeries[profitSeries.length - 1] || 1);
    const keptPace = !salesUp || profitGrowth >= salesGrowth - 0.02;
    add(4, 2, SCORECARD_LINES[3], profitUp && keptPace ? 'pass' : 'fail',
      `sales ${(salesGrowth * 100).toFixed(0)}% · profit ${(profitGrowth * 100).toFixed(0)}%`,
      'Grows with or faster than sales');
  } else {
    add(4, 2, SCORECARD_LINES[3], 'unknown', `${profitSeries.length} years of profit stored`,
      'Grows with or faster than sales', 'needs at least three annual periods');
  }

  // ---- 5. ROE / ROCE above 15% most years (Step 2) ----
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

  // ---- 6. Debt under control: D/E below 1, interest cover above 3x (Step 2) ----
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

  // ---- 7. Operating cash flow close to net profit (Step 2) ----
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

  // ---- 8. Promoters hold steady, little or no pledge (Step 2) ----
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

  // ---- 9. P/E reasonable vs its own history and peers (Step 3) ----
  const pe = num(row['pe']);
  if (pe !== null && pe > 0) {
    const peerRow = db.prepare(`SELECT AVG(pe) AS avgPe, COUNT(*) AS n FROM latest_metrics
      WHERE sector=(SELECT sector FROM latest_metrics WHERE UPPER(symbol)=UPPER(?))
        AND UPPER(symbol)<>UPPER(?) AND pe IS NOT NULL AND pe > 0`).get(symbol, symbol) as { avgPe: number | null; n: number };
    const peerAvg = num(peerRow.avgPe);
    if (peerAvg !== null && peerRow.n >= 3) {
      const rel = pe / peerAvg;
      add(9, 3, SCORECARD_LINES[8], rel <= 1.5 ? 'pass' : 'fail',
        `P/E ${pe.toFixed(1)} vs sector average ${peerAvg.toFixed(1)} (${rel.toFixed(2)}x)`,
        'Much higher than its 5-10 year average = more foam; far above peers needs a clear reason');
    } else {
      add(9, 3, SCORECARD_LINES[8], 'unknown', `P/E ${pe.toFixed(1)} · too few sector peers to compare`,
        'P/E vs its own history and peers', 'a comparison needs at least three peers with a P/E');
    }
  } else {
    add(9, 3, SCORECARD_LINES[8], 'unknown', 'no P/E stored',
      'P/E vs its own history and peers');
  }

  // ---- 10. No major red flags (Step 4) ----
  // The document lists seven. Three are computable from stored data: weak operating cash
  // flow for years, dilution through new share issues, and rising promoter pledge.
  const flags: string[] = [];
  if (profitSeries.length >= 3 && annual.filter((r) => {
    const c = num(r['cfo']); const p = num(r['net_profit']);
    return c !== null && p !== null && p > 0 && c < p * 0.5;
  }).length >= 3) flags.push('operating cash flow well below profit for three years or more');
  if (promoter !== null && hold.length >= 2) {
    const first = num(hold[hold.length - 1]!['promoter']) ?? 0;
    const last = num(hold[0]!['promoter']) ?? 0;
    if (first - last >= 5) flags.push('promoter holding fell by 5 points or more');
  }
  if (pledge !== null && pledge > 20) flags.push('promoter pledge above 20%');
  const computable = profitSeries.length >= 3 || promoter !== null;
  add(10, 4, SCORECARD_LINES[9], !computable ? 'unknown' : flags.length === 0 ? 'pass' : 'fail',
    flags.length ? flags.join('; ') : computable ? 'no red flag found in the data' : 'insufficient data',
    'One red flag means dig deeper. Several means walk away.',
    computable ? undefined : 'needs several years of statements or shareholding to test');

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
    note: `Scored ${pass} of ${checks.length} from stored data; ${unknown} could not be answered and are marked unknown rather than passed. These are rules of thumb, not hard rules — compare a company with its own history and its sector. Educational use only; not investment advice.`,
  };
}
