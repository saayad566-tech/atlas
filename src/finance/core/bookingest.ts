// Book ingestion: turn a written rule into a runnable screen.
//
// A user pastes a chapter, an article or a set of notes. This reads it, finds the rules, and
// turns the ones that are machine-checkable into a screen the app can run immediately.
//
// The engine records what it cannot express instead of inventing it. A sentence with no
// parseable condition becomes an omission with its source text attached, not a guess.

export type RuleKind = 'formula' | 'threshold' | 'edge-case' | 'entry' | 'exit' | 'risk' | 'sizing';

export interface ExtractedRule {
  kind: RuleKind;
  /** The sentence this came from, verbatim. */
  source: string;
  /** The section heading it sat under, when one was found. */
  section: string;
  /** The expression Atlas can run, when the sentence contained one. */
  expression: string | null;
  /** Why it could not be expressed, when it could not. */
  omission: string | null;
}

export interface IngestResult {
  title: string;
  sections: number;
  sentences: number;
  rules: ExtractedRule[];
  /** A screen built from the entry and exit conditions, when one could be built. */
  screen: { name: string; expression: string; runs: boolean; reason?: string } | null;
  omissions: number;
  note: string;
}

/** Atlas's screenable fields, with the words a document might use for each. */
const FIELDS: Array<{ field: string; words: string[] }> = [
  { field: 'P/E', words: ['p/e', 'pe ratio', 'price to earnings', 'price-to-earnings', 'times earnings', 'times forward earnings'] },
  { field: 'P/B', words: ['p/b', 'pb ratio', 'price to book'] },
  { field: 'ROE', words: ['roe', 'return on equity'] },
  { field: 'ROCE', words: ['roce', 'return on capital'] },
  { field: 'Debt to Equity', words: ['debt to equity', 'debt/equity', 'd/e', 'leverage'] },
  { field: 'Interest Coverage', words: ['interest coverage', 'interest cover'] },
  { field: 'Operating Margin', words: ['operating margin', 'opm', 'operating margins'] },
  { field: 'Net Margin', words: ['net margin', 'npm', 'profit margin'] },
  { field: 'Dividend Yield', words: ['dividend yield', 'dividend'] },
  { field: 'Promoter Holding', words: ['promoter holding', 'promoter stake', 'promoter'] },
  { field: 'Market Cap', words: ['market cap', 'market capitalisation', 'market capitalization'] },
  { field: 'Sales Growth', words: ['sales growth', 'revenue growth', 'topline growth'] },
  { field: 'Profit Growth', words: ['profit growth', 'earnings growth', 'bottomline growth'] },
];

const OPS: Array<{ re: RegExp; op: string }> = [
  { re: /(?:at least|minimum|min|not less than|greater than or equal|>=|above or equal)/i, op: '>=' },
  { re: /(?:at most|maximum|max|not more than|less than or equal|<=|below or equal)/i, op: '<=' },
  { re: /(?:greater than|more than|above|over|exceeds?|higher than|>)/i, op: '>' },
  { re: /(?:less than|below|under|lower than|<)/i, op: '<' },
  { re: /(?:equals?|equal to|=|is exactly)/i, op: '=' },
];

const KIND_HINTS: Array<{ kind: RuleKind; re: RegExp }> = [
  { kind: 'exit', re: /\b(exit|sell when|book profit|take profit|target|stop loss|stop-loss)\b/i },
  { kind: 'entry', re: /\b(buy when|enter when|entry|buy if|purchase when)\b/i },
  { kind: 'risk', re: /\b(risk|drawdown|max loss|avoid|caution|warning)\b/i },
  { kind: 'sizing', re: /\b(position size|position sizing|how many shares|allocate|allocation|% of capital)\b/i },
  { kind: 'edge-case', re: /\b(except|unless|however|but if|caveat|special case|edge case)\b/i },
  { kind: 'formula', re: /\b(=|equals|calculated as|formula|divided by|multiplied by)\b/i },
  { kind: 'threshold', re: /\b(above|below|at least|at most|greater|less|over|under|minimum|maximum)\b/i },
  // Rank and relative rules are real rules even though Atlas cannot screen them: recording
  // them as omissions is the honest behaviour, dropping them silently is not.
  { kind: 'threshold', re: /\b(rank|ranked|decile|quartile|percentile|cross-section|relative to the (market|universe)|top \d+%)\b/i },
];

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 25 && s.length < 600);
}

/**
 * Find every screenable condition in a sentence.
 *
 * A sentence can hold more than one — "Buy when the P/E is below 20 and the debt to equity is
 * less than 1" is two rules. Each field is matched to the number nearest its own mention, so a
 * number belonging to one field is never attached to another.
 */
function extractExpressions(sentence: string): string[] {
  const lower = sentence.toLowerCase();
  const out: string[] = [];
  const used = new Set<number>();

  // Every field mention, with its position, longest word first so "p/e ratio" beats "pe".
  const mentions: Array<{ field: string; at: number; len: number }> = [];
  for (const f of FIELDS) {
    for (const w of f.words) {
      let from = 0;
      for (;;) {
        const at = lower.indexOf(w, from);
        if (at === -1) break;
        mentions.push({ field: f.field, at, len: w.length });
        from = at + w.length;
      }
    }
  }
  // Drop a mention that sits inside a longer one for the same field.
  const kept = mentions.filter((m) => !mentions.some((o) =>
    o !== m && o.field === m.field && o.len > m.len && m.at >= o.at && m.at < o.at + o.len));

  for (const m of kept) {
    // The number may sit after the field ("P/E below 20") or before it ("above 40 times
    // earnings"), so both directions are searched within a bounded window.
    const next = kept.filter((o) => o.at > m.at).sort((a, b) => a.at - b.at)[0];
    const prev = kept.filter((o) => o.at < m.at).sort((a, b) => b.at - a.at)[0];
    const fwdStart = m.at;
    const fwdEnd = Math.min(next ? next.at : sentence.length, m.at + 60);
    const backStart = Math.max(prev ? prev.at + prev.len : 0, m.at - 45);
    const forward = sentence.slice(fwdStart, fwdEnd);
    const backward = sentence.slice(backStart, m.at);
    const num = /(-?\d+(?:\.\d+)?)/.exec(forward) ?? /(-?\d+(?:\.\d+)?)/.exec(backward);
    if (!num) continue;
    const inForward = /(-?\d+(?:\.\d+)?)/.exec(forward) !== null;
    const window = inForward ? forward : backward;
    const value = Number(num[1]);
    if (used.has(value) && kept.length > 1) { /* the same number can legitimately repeat */ }

    // Direction: look just before the number, then just after it.
    const at = num.index ?? 0;
    const before = window.slice(Math.max(0, at - 32), at);
    const after = window.slice(at + num[1]!.length, at + num[1]!.length + 12);
    let op: string | null = null;
    for (const o of OPS) { if (o.re.test(before)) { op = o.op; break; } }
    if (!op) for (const o of OPS) { if (o.re.test(after)) { op = o.op; break; } }
    if (!op) continue;

    const expr = `${m.field} ${op} ${value}`;
    if (!out.includes(expr)) out.push(expr);
  }
  return out;
}

/**
 * Ingest a document.
 *
 * Deterministic and offline: no model is consulted. A rule that cannot be expressed is
 * reported as an omission with its source sentence, never approximated.
 */
export function ingestDocument(text: string, title = 'Untitled document'): IngestResult {
  const raw = text.trim();
  if (!raw) {
    return { title, sections: 0, sentences: 0, rules: [], screen: null, omissions: 0,
      note: 'Nothing was pasted, so there was nothing to read.' };
  }

  // Split into sections on markdown headings or ALL-CAPS lines, which is how most notes and
  // chapters are organised.
  const lines = raw.split('\n');
  const sections: Array<{ heading: string; body: string[] }> = [{ heading: title, body: [] }];
  for (const line of lines) {
    const h = /^\s*(#{1,4})\s+(.+)$/.exec(line);
    const caps = /^\s*([A-Z][A-Z0-9 ,'&/-]{6,})\s*$/.exec(line);
    if (h || caps) {
      sections.push({ heading: (h ? h[2] : caps![1])!.trim(), body: [] });
    } else {
      sections[sections.length - 1]!.body.push(line);
    }
  }

  const rules: ExtractedRule[] = [];
  let sentenceCount = 0;

  for (const section of sections) {
    const body = section.body.join('\n').trim();
    if (!body) continue;
    for (const sentence of splitSentences(body)) {
      sentenceCount++;
      // Only sentences that read like a rule are candidates.
      const isRule = KIND_HINTS.some((k) => k.re.test(sentence));
      if (!isRule) continue;

      let kind: RuleKind = 'threshold';
      for (const k of KIND_HINTS) { if (k.re.test(sentence)) { kind = k.kind; break; } }

      const exprs = extractExpressions(sentence);
      if (!exprs.length) {
        rules.push({
          kind, source: sentence, section: section.heading, expression: null,
          omission: /rank|cross-section|relative to the market|percentile of the universe/i.test(sentence)
            ? 'rank-based or cross-sectional rule — Atlas screens single instruments, not a ranked universe'
            : 'no machine-checkable condition found in the sentence',
        });
      } else {
        // One rule per condition, each carrying the same source sentence.
        for (const expression of exprs) {
          rules.push({ kind, source: sentence, section: section.heading, expression, omission: null });
        }
      }
    }
  }

  // Build a screen from the entry conditions, then the exit conditions.
  const entryExprs = rules.filter((r) => r.kind === 'entry' && r.expression).map((r) => r.expression!);
  const thresholdExprs = rules.filter((r) => (r.kind === 'threshold' || r.kind === 'risk') && r.expression).map((r) => r.expression!);
  const pool = entryExprs.length ? entryExprs : thresholdExprs;

  let screen: IngestResult['screen'] = null;
  if (pool.length) {
    // Only one condition per field, to avoid `P/E > 5 AND P/E > 10`.
    const byField = new Map<string, string>();
    for (const e of pool) byField.set(e.split(' ')[0]!, e);
    const expression = [...byField.values()].join(' AND ');
    screen = { name: `From: ${title.slice(0, 48)}`, expression, runs: true };
  } else if (rules.length) {
    screen = { name: `From: ${title.slice(0, 48)}`, expression: '', runs: false,
      reason: 'no entry or threshold condition could be parsed, so no screen was produced' };
  }

  const omissions = rules.filter((r) => r.omission).length;
  return {
    title,
    sections: sections.filter((s) => s.body.join('').trim()).length,
    sentences: sentenceCount,
    rules,
    screen,
    omissions,
    note: `${rules.length} rule${rules.length === 1 ? '' : 's'} found in ${sentenceCount} sentences across `
      + `${sections.filter((s) => s.body.join('').trim()).length} section(s). ${omissions} could not be expressed and are `
      + 'listed with their source rather than approximated. Reading a document is not investment advice.',
  };
}
