// The morning briefing: a written account of what actually changed, where the signals
// disagree, and what would prove this view wrong.
//
// Deliberately not an LLM. Every sentence is composed from stored numbers, so the briefing
// is reproducible, works offline, and can be tested. An LLM can rewrite it later; it must
// never invent it.
import type { Database as DB } from 'better-sqlite3';

const r1 = (v: number): number => Math.round(v * 10) / 10;
const r2 = (v: number): number => Math.round(v * 100) / 100;

export interface Stance {
  dimension: 'value' | 'quality' | 'momentum' | 'safety';
  score: number;        // 0..100, higher is more favourable
  verdict: string;      // short human phrase
  basis: string;        // the numbers behind it
}

export interface Dissent {
  between: [string, string];
  message: string;
  severity: 'note' | 'flag';
}

export interface Falsifier {
  claim: string;
  wouldChangeIf: string;
}

export interface Briefing {
  market: string;
  generatedAt: string;
  greeting: string;
  headline: string;
  paragraphs: string[];
  stances: Stance[];
  dissent: Dissent[];
  watch: Array<{ when: string; what: string }>;
  falsifiers: Falsifier[];
  confidence: { level: 'high' | 'moderate' | 'low'; reason: string };
  dataAge: { newestDays: number | null; staleCount: number };
}

/** One-year return from stored prices. v_latest has no return column, so it is computed. */
export function oneYearReturn(db: DB, companyId: number): number | null {
  let rows: Array<{ close: number }> = [];
  try { rows = db.prepare(`SELECT close FROM price_history WHERE company_id=? AND close>0 ORDER BY date ASC`).all(companyId) as Array<{ close: number }>; } catch { return null; }
  if (rows.length < 2) return null;
  const first = rows[0]!.close; const last = rows[rows.length - 1]!.close;
  if (!(first > 0)) return null;
  return r1(((last - first) / first) * 100);
}

/** Turn one company's numbers into four stances, so disagreement becomes visible. */
export function stancesFor(row: Record<string, number>, return1y: number | null = null): Stance[] {
  const pe = Number(row['pe'] ?? 0); const pb = Number(row['pb'] ?? 0);
  const roe = Number(row['roe'] ?? 0); const opm = Number(row['opm'] ?? 0);
  const de = Number(row['debt_to_equity'] ?? 0);
  const ret1y = return1y ?? 0;

  // Value: cheaper is better. P/E 10 scores 100, P/E 40 scores 0.
  const valueScore = pe > 0 ? Math.max(0, Math.min(100, 100 - ((pe - 10) / 30) * 100)) : 50;
  const qualityScore = Math.max(0, Math.min(100, roe * 3 + opm * 2));
  const momentumScore = Math.max(0, Math.min(100, 50 + ret1y * 2));
  const safetyScore = Math.max(0, Math.min(100, 100 - de * 40));

  const verdict = (s: number, good: string, bad: string, mid: string): string =>
    s >= 65 ? good : s <= 35 ? bad : mid;

  return [
    { dimension: 'value', score: r1(valueScore), verdict: verdict(valueScore, 'inexpensive', 'expensive', 'fairly priced'), basis: `P/E ${r2(pe)}${pb > 0 ? `, P/B ${r2(pb)}` : ''}` },
    { dimension: 'quality', score: r1(qualityScore), verdict: verdict(qualityScore, 'high quality', 'weak economics', 'average quality'), basis: `ROE ${r1(roe)}%, operating margin ${r1(opm)}%` },
    { dimension: 'momentum', score: r1(momentumScore), verdict: verdict(momentumScore, 'trending up', 'trending down', 'flat'), basis: `1-year return ${r1(ret1y)}%` },
    { dimension: 'safety', score: r1(safetyScore), verdict: verdict(safetyScore, 'conservatively financed', 'heavily indebted', 'moderate leverage'), basis: `debt/equity ${r2(de)}` },
  ];
}

/** Where the stances pull in opposite directions — the honest part of any analysis. */
export function findDissent(stances: Stance[]): Dissent[] {
  const out: Dissent[] = [];
  const get = (d: string): Stance | undefined => stances.find((s) => s.dimension === d);
  const value = get('value'); const quality = get('quality'); const momentum = get('momentum'); const safety = get('safety');

  if (value && quality && value.score >= 70 && quality.score <= 35) {
    out.push({ between: ['value', 'quality'], message: 'Cheap for a reason: the price is low but the business earns little on its capital. Value traps look exactly like this.', severity: 'flag' });
  }
  if (value && quality && value.score <= 35 && quality.score >= 70) {
    out.push({ between: ['value', 'quality'], message: 'A good business at a full price. Quality is real, but you are paying for it.', severity: 'note' });
  }
  if (momentum && quality && momentum.score >= 70 && quality.score <= 35) {
    out.push({ between: ['momentum', 'quality'], message: 'The price is running ahead of the fundamentals. Momentum without earnings support rarely lasts.', severity: 'flag' });
  }
  if (momentum && value && momentum.score <= 35 && value.score >= 70) {
    out.push({ between: ['momentum', 'value'], message: 'Falling price, undemanding valuation. Either the market knows something or it is oversold.', severity: 'note' });
  }
  if (safety && quality && safety.score <= 35 && quality.score >= 70) {
    out.push({ between: ['safety', 'quality'], message: 'Good returns carried on borrowed money — the returns are real, the risk is in the balance sheet.', severity: 'flag' });
  }
  return out;
}

/** What would prove this read wrong. A view without a falsifier is an opinion. */
export function falsifiersFor(stances: Stance[]): Falsifier[] {
  const out: Falsifier[] = [];
  const get = (d: string): Stance | undefined => stances.find((s) => s.dimension === d);
  const value = get('value'); const quality = get('quality'); const momentum = get('momentum'); const safety = get('safety');
  if (value) out.push({ claim: `It is ${value.verdict}`, wouldChangeIf: 'the P/E moves outside 10–40 without a matching change in earnings' });
  if (quality) out.push({ claim: `The business is ${quality.verdict}`, wouldChangeIf: 'ROE falls below 10% or the operating margin halves for two consecutive periods' });
  if (momentum) out.push({ claim: `The trend is ${value ? momentum.verdict : 'unclear'}`, wouldChangeIf: 'the 1-year return crosses zero in the other direction' });
  if (safety) out.push({ claim: `The balance sheet is ${safety.verdict}`, wouldChangeIf: 'debt/equity rises above 1.5' });
  return out;
}

/** Compose the written briefing for one company. */
export function briefCompany(db: DB, symbol: string, market: string): Briefing | null {
  const row = db.prepare(`SELECT * FROM v_latest WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as Record<string, number> | undefined;
  if (!row) return null;
  const name = db.prepare(`SELECT name FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { name: string } | undefined;

  const cid = (db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined)?.id ?? 0;
  const ret1y = cid ? oneYearReturn(db, cid) : null;
  const stances = stancesFor(row, ret1y);
  const dissent = findDissent(stances);
  const falsifiers = falsifiersFor(stances);

  // These tables only exist once prices or the market pack have been loaded.
  let newestDays: number | null = null;
  try {
    const ageRow = db.prepare(`SELECT MAX(date) AS d FROM price_history WHERE company_id=(SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?))`).get(symbol) as { d: string | null } | undefined;
    newestDays = ageRow?.d ? Math.floor((Date.now() - new Date(ageRow.d).getTime()) / 86_400_000) : null;
  } catch { /* no price table yet */ }

  let upcoming: Array<{ kind: string; date: string }> = [];
  try {
    upcoming = db.prepare(`
      SELECT kind, date FROM calendar_events
      WHERE company_id=(SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)) AND date >= date('now')
      ORDER BY date ASC LIMIT 3`).all(symbol) as Array<{ kind: string; date: string }>;
  } catch { /* no calendar table yet */ }

  const price = Number(row['price'] ?? 0);
  const strong = stances.filter((s) => s.score >= 65);
  const weak = stances.filter((s) => s.score <= 35);

  const paragraphs: string[] = [];
  paragraphs.push(
    `${name?.name ?? symbol} trades at ${price > 0 ? price : 'an unknown price'}` +
    `${ret1y !== null ? `, ${ret1y > 0 ? 'up' : 'down'} ${Math.abs(ret1y)}% over the year` : ''}. ` +
    (strong.length ? `It looks ${strong.map((s) => s.verdict).join(' and ')}.` : 'No dimension stands out as clearly favourable.') +
    (weak.length ? ` The weak spot is ${weak.map((s) => s.verdict).join(' and ')}.` : '')
  );
  if (dissent.length) {
    paragraphs.push(`Signals disagree: ${dissent[0]!.message}`);
  }
  if (newestDays !== null) {
    paragraphs.push(newestDays <= 1
      ? 'Prices are current as of today.'
      : `The most recent price is ${newestDays} day${newestDays === 1 ? '' : 's'} old — treat the levels as indicative.`);
  }

  const agreement = stances.filter((s) => s.score >= 65).length + stances.filter((s) => s.score <= 35).length;
  const confidence: Briefing['confidence'] = dissent.some((d) => d.severity === 'flag')
    ? { level: 'low', reason: 'the dimensions contradict each other' }
    : newestDays !== null && newestDays > 7
      ? { level: 'moderate', reason: 'the price data is not recent' }
      : agreement >= 2
        ? { level: 'high', reason: 'several independent dimensions agree' }
        : { level: 'moderate', reason: 'the signals are mixed but not contradictory' };

  const headline = dissent.some((d) => d.severity === 'flag')
    ? `${name?.name ?? symbol}: attractive on one measure, unconvincing on another`
    : strong.length >= 2
      ? `${name?.name ?? symbol}: favourable on ${strong.length} of 4 dimensions`
      : weak.length >= 2
        ? `${name?.name ?? symbol}: weak on ${weak.length} of 4 dimensions`
        : `${name?.name ?? symbol}: no strong signal either way`;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return {
    market, generatedAt: new Date().toISOString(), greeting, headline, paragraphs, stances, dissent,
    watch: upcoming.map((u) => ({ when: u.date, what: u.kind })),
    falsifiers, confidence,
    dataAge: { newestDays, staleCount: newestDays !== null && newestDays > 7 ? 1 : 0 },
  };
}

/** A market-level briefing: what moved, what is thin, what is coming. */
export function briefMarket(db: DB, market: string): Briefing {
  const stats = db.prepare(`SELECT COUNT(*) AS n FROM companies`).get() as { n: number };
  const ids = db.prepare(`SELECT id FROM companies`).all() as Array<{ id: number }>;
  let advancingCount = 0;
  for (const c of ids) { const r = oneYearReturn(db, c.id); if (r !== null && r > 0) advancingCount++; }
  const advancing = { n: advancingCount };
  const breadth = stats.n > 0 ? r1((advancing.n / stats.n) * 100) : 0;

  let newestDays: number | null = null;
  try {
    const newest = db.prepare(`SELECT MAX(date) AS d FROM price_history`).get() as { d: string | null };
    newestDays = newest.d ? Math.floor((Date.now() - new Date(newest.d).getTime()) / 86_400_000) : null;
  } catch { /* no price table yet */ }

  const paragraphs: string[] = [];
  paragraphs.push(
    stats.n === 0
      ? 'This market is empty. Sync the directory or fetch a company to begin.'
      : `${stats.n} companies are loaded. ${advancing.n} of them are up over the past year (${breadth}% breadth).`
  );
  if (newestDays !== null) paragraphs.push(newestDays <= 1 ? 'Prices are current.' : `The newest price is ${newestDays} days old.`);
  if (stats.n > 0 && breadth > 70) paragraphs.push('Broad participation — most names are rising, which usually means the move is not concentrated in a few leaders.');
  if (stats.n > 0 && breadth < 30) paragraphs.push('Narrow participation — most names are falling. Be selective.');

  const hour = new Date().getHours();
  return {
    market, generatedAt: new Date().toISOString(),
    greeting: hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening',
    headline: stats.n === 0 ? 'An empty market' : `${breadth}% of loaded companies are up over the year`,
    paragraphs, stances: [], dissent: [], watch: [], falsifiers: [],
    confidence: { level: stats.n > 20 ? 'moderate' : 'low', reason: stats.n > 20 ? 'based on the loaded universe' : 'too few companies loaded to generalise' },
    dataAge: { newestDays, staleCount: 0 },
  };
}
