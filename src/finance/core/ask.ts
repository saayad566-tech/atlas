// Ask: answer a question about a company from stored data.
//
// Deliberately not a language model. Each intent is matched, the answer is composed from
// real numbers, and when the data cannot support an answer it says so. That makes every
// reply reproducible and checkable — which an LLM answer about financials is not.
import type { Database as DB } from 'better-sqlite3';
import { stancesFor, findDissent } from './briefing';
import { metricHistory } from './history';

const r2 = (v: number): number => Math.round(v * 100) / 100;
const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export interface Answer {
  question: string;
  intent: string;
  answer: string;
  evidence: Array<{ label: string; value: string }>;
  confidence: 'high' | 'moderate' | 'low';
  caveat: string | null;
}

const INTENTS: Array<{ id: string; match: RegExp }> = [
  { id: 'cheap', match: /cheap|expensive|valuation|value|overpriced|undervalued/i },
  { id: 'quality', match: /quality|good business|moat|profitable|efficient/i },
  { id: 'debt', match: /debt|leverage|borrow|balance sheet|solvent/i },
  { id: 'growth', match: /growth|grow|expanding|momentum|trend/i },
  { id: 'risk', match: /risk|danger|worried|downside|safe/i },
  { id: 'dividend', match: /dividend|payout|income|yield/i },
  { id: 'buy', match: /should i (buy|invest|sell)|worth (buying|investing)|recommend/i },
  { id: 'overview', match: /what (is|does)|about|overview|tell me|summary/i },
];

export function ask(db: DB, symbol: string, question: string): Answer | null {
  const row = db.prepare(`SELECT * FROM v_latest WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as Record<string, number> | undefined;
  if (!row) return null;
  const c = db.prepare(`SELECT id, name FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number; name: string } | undefined;
  const name = c?.name ?? symbol;

  let y1: number | null = null;
  try {
    const s = db.prepare(`SELECT close FROM price_history WHERE company_id=? AND close>0 ORDER BY date ASC`).all(c!.id) as Array<{ close: number }>;
    if (s.length >= 2 && s[0]!.close > 0) y1 = r2(((s[s.length - 1]!.close / s[0]!.close) - 1) * 100);
  } catch { /* no prices */ }

  const stances = stancesFor(row, y1);
  const dissent = findDissent(stances);
  const get = (d: string) => stances.find((s) => s.dimension === d);
  const intent = INTENTS.find((i) => i.match.test(question))?.id ?? 'overview';
  const ev = (label: string, value: string) => ({ label, value });

  const base = (a: Omit<Answer, 'question' | 'intent'>): Answer => ({ question, intent, ...a });

  switch (intent) {
    case 'cheap': {
      const v = get('value');
      const pe = n(row['pe']); const pb = n(row['pb']);
      return base({
        answer: pe > 0
          ? `${name} trades at ${r2(pe)}× earnings${pb > 0 ? ` and ${r2(pb)}× book` : ''}. On the numbers alone that reads as ${v?.verdict ?? 'unclear'}.${dissent.some((d) => d.severity === 'flag') ? ' Be careful: ' + dissent[0]!.message : ''}`
          : `${name} has no positive earnings, so a P/E cannot be computed — valuation has to rest on assets or cash flow instead.`,
        evidence: [ev('P/E', pe > 0 ? r2(pe).toString() : 'n/a'), ev('P/B', pb > 0 ? r2(pb).toString() : 'n/a'), ev('Value score', v ? `${v.score}/100` : 'n/a')],
        confidence: pe > 0 ? 'high' : 'low',
        caveat: 'A low multiple is not the same as cheap — it can price in a decline.',
      });
    }
    case 'quality': {
      const q = get('quality');
      return base({
        answer: q
          ? `${name} scores ${q.score}/100 on quality: ${q.verdict}. The evidence is ${q.basis}.`
          : `Quality cannot be scored for ${name} — the return and margin figures are missing.`,
        evidence: [ev('ROE', `${r2(n(row['roe']))}%`), ev('ROCE', `${r2(n(row['roce']))}%`), ev('Operating margin', `${r2(n(row['opm']))}%`), ev('Quality score', q ? `${q.score}/100` : 'n/a')],
        confidence: q ? 'high' : 'low',
        caveat: 'Quality here is accounting return, not a judgement about the business model.',
      });
    }
    case 'debt': {
      const s = get('safety');
      const de = n(row['debt_to_equity']); const ic = n(row['interest_coverage']);
      return base({
        answer: `Debt to equity is ${r2(de)}${ic > 0 ? `, with interest covered ${r2(ic)}×` : ''}. The balance sheet reads as ${s?.verdict ?? 'unclear'}.`,
        evidence: [ev('Debt/equity', r2(de).toString()), ev('Interest coverage', ic > 0 ? `${r2(ic)}×` : 'n/a'), ev('Safety score', s ? `${s.score}/100` : 'n/a')],
        confidence: 'high',
        caveat: 'Leverage is only dangerous relative to cash flow stability, which this does not measure.',
      });
    }
    case 'growth': {
      const h = metricHistory(db, symbol);
      const rev = h?.trends.find((t) => t.metric === 'sales');
      const pat = h?.trends.find((t) => t.metric === 'npmPct');
      return base({
        answer: rev
          ? `Revenue ${rev.direction === 'stable' ? 'has been broadly flat' : `is ${rev.direction}`}: ${rev.first} → ${rev.last}${rev.cagrPct !== null ? ` (${rev.cagrPct}% a year)` : ''}. Net margin is ${pat?.direction ?? 'unclear'}.`
          : `No statement history is stored for ${name}, so growth cannot be measured.`,
        evidence: [ev('Sales 3y growth', `${r2(n(row['sales_growth_3y']))}%`), ev('Profit 3y growth', `${r2(n(row['profit_growth_3y']))}%`), ev('Years of data', h ? String(h.years.length) : '0')],
        confidence: h ? 'high' : 'low',
        caveat: 'Growth without a return above the cost of capital destroys value.',
      });
    }
    case 'risk': {
      const flags = dissent.filter((d) => d.severity === 'flag');
      return base({
        answer: flags.length
          ? `The main thing to watch: ${flags[0]!.message}`
          : `No dimension contradicts another for ${name}. The weakest reading is ${[...stances].sort((a, b) => a.score - b.score)[0]?.dimension ?? 'unclear'}.`,
        evidence: stances.map((s) => ev(s.dimension, `${s.score}/100 — ${s.verdict}`)),
        confidence: 'moderate',
        caveat: 'This reads stored fundamentals only. It does not know about litigation, regulation or events.',
      });
    }
    case 'dividend': {
      const dy = n(row['dividend_yield']);
      return base({
        answer: dy > 0 ? `${name} yields ${r2(dy)}% at the current price.` : `${name} pays no dividend, or none is stored.`,
        evidence: [ev('Dividend yield', `${r2(dy)}%`), ev('Payout (profit)', 'see dividend safety in deep fundamentals')],
        confidence: dy > 0 ? 'high' : 'moderate',
        caveat: 'A yield is only safe if free cash flow covers it — check the payout against cash, not profit.',
      });
    }
    case 'buy': {
      return base({
        answer: `${name} looks ${stances.filter((s) => s.score >= 65).map((s) => s.verdict).join(' and ') || 'unremarkable'}, with ${stances.filter((s) => s.score <= 35).map((s) => s.verdict).join(' and ') || 'no obvious weakness'}.${dissent.length ? ' ' + dissent[0]!.message : ''}`,
        evidence: stances.map((s) => ev(s.dimension, `${s.score}/100 — ${s.verdict}`)),
        confidence: 'low',
        caveat: 'This is analysis of stored numbers, not investment advice. Position size and your own circumstances are not inputs here.',
      });
    }
    default: {
      return base({
        answer: `${name} operates in ${String(row['sector'] ?? 'an unclassified sector')}, trades at ${r2(n(row['price']))}, and scores ${stances.reduce((a, s) => a + s.score, 0) / stances.length | 0}/100 on average across value, quality, momentum and safety.`,
        evidence: [ev('Sector', String(row['sector'] ?? '—')), ev('Price', r2(n(row['price'])).toString()), ev('Market cap (₹ Cr)', r2(n(row['market_cap'])).toString())],
        confidence: 'high',
        caveat: null,
      });
    }
  }
}
