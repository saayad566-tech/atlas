// Natural language → screener expression.
//
// Two paths, same output:
//   1. RULES (default): deterministic phrase matching, fully offline, no model.
//   2. LLM (opt-in): a local Ollama model is asked for JSON, and whatever it
//      returns is VALIDATED by the expression compiler before use — a model that
//      hallucinates a field simply falls back to the rules.
// Nothing here needs a network or an API key.
import { compileExpression, FIELDS, resolveField, FIELD_ALIASES } from './expr';

export interface NlClause { text: string; expression: string; source: 'rule' | 'llm' }
export interface NlResult {
  expression: string;
  clauses: NlClause[];
  unresolved: string[];
  source: 'rules' | 'llm';
  notes: string[];
}

const FILLER = /^(?:find|show|list|get|give|screen|search|filter|me|companies|company|stocks|stock|with|having|that|which|where|are|is|a|an|the|all|and|please|for)\b[\s,]*/gi;

function stripFiller(clause: string): string {
  let out = clause.trim();
  for (let i = 0; i < 8; i++) {
    const next = out.replace(FILLER, '').trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

function parseNumber(raw: string): number | null {
  const m = /^(-?\d[\d,]*(?:\.\d+)?)\s*(lakh\s+crore|crore|cr|lakh|lac|%|k|m)?/i.exec(raw.trim());
  if (!m) return null;
  let v = Number(m[1]!.replace(/,/g, ''));
  const u = (m[2] ?? '').toLowerCase().replace(/\s+/g, ' ');
  if (u === 'lakh crore') v *= 100000;
  else if (u === 'crore' || u === 'cr') v *= 1;
  else if (u === 'lakh' || u === 'lac') v *= 0.01;
  else if (u === 'k') v *= 1000;
  else if (u === 'm') v *= 1000000;
  return Number.isFinite(v) ? v : null;
}

const COMPARATORS: Array<{ re: RegExp; op: string }> = [
  { re: /\b(?:greater than|more than|above|over|higher than|at least|minimum|min|>=|>)\b/, op: '>' },
  { re: /\b(?:less than|below|under|lower than|at most|maximum|max|<=|<)\b/, op: '<' },
  { re: /\b(?:equal to|equals|is exactly|=|==)\b/, op: '=' },
];

// Phrase → expression, checked before the generic parser.
const SPECIALS: Array<{ re: RegExp; expression: string; note: string }> = [
  { re: /\b(zero|no|nil|without)\s+debt\b|\bdebt[\s-]?free\b/, expression: 'Debt to Equity < 0.1', note: 'debt-free ≈ D/E < 0.1' },
  { re: /\b(low|small|minimal)\s+debt\b/, expression: 'Debt to Equity < 0.5', note: 'low debt ≈ D/E < 0.5' },
  { re: /\b(no|zero|nil)\s+(?:promoter\s+)?pledge\b|\bunpledged\b/, expression: 'Pledged < 0.5', note: 'no pledge ≈ pledged < 0.5%' },
  { re: /\blarge[\s-]?cap\b/, expression: 'Market Cap > 20000', note: 'large cap ≈ market cap > ₹20,000 Cr' },
  { re: /\bmid[\s-]?cap\b/, expression: 'Market Cap > 5000 AND Market Cap < 20000', note: 'mid cap ≈ ₹5,000–20,000 Cr' },
  { re: /\bsmall[\s-]?cap\b/, expression: 'Market Cap < 5000', note: 'small cap ≈ market cap < ₹5,000 Cr' },
  { re: /\bdividend(?:\s+paying)?\b(?!\s+yield)/, expression: 'Dividend Yield > 0.5', note: 'dividend paying ≈ yield > 0.5%' },
  { re: /\b(high|strong|good|great)\s+(roe|return on equity)\b/, expression: 'ROE > 15', note: 'high ROE ≈ above 15%' },
  { re: /\b(low|weak|poor)\s+(roe|return on equity)\b/, expression: 'ROE < 10', note: 'low ROE ≈ below 10%' },
  { re: /\b(high|strong|good)\s+(roce|return on capital)\b/, expression: 'ROCE > 20', note: 'high ROCE ≈ above 20%' },
  { re: /\b(high|strong|fast)\s+growth\b/, expression: 'Sales Growth 3Y > 15', note: 'high growth ≈ 3Y sales CAGR above 15%' },
  { re: /\b(high|fat|wide)\s+(margin|margins|opm)\b/, expression: 'OPM > 20', note: 'high margin ≈ operating margin above 20%' },
  { re: /\b(cheap|undervalued|low)\s+(pe|p\/e|valuation)\b|\blow\s+pe\b/, expression: 'P/E < 15', note: 'cheap ≈ P/E below 15' },
  { re: /\b(expensive|overvalued|high)\s+(pe|p\/e|valuation)\b|\bhigh\s+pe\b/, expression: 'P/E > 30', note: 'expensive ≈ P/E above 30' },
  { re: /\b(high|fat)\s+(dividend|yield)\b/, expression: 'Dividend Yield > 3', note: 'high yield ≈ above 3%' },
  { re: /\b(profitable|in profit|making money)\b/, expression: 'Net Profit > 0', note: 'profitable ≈ positive net profit' },
  { re: /\b(loss[\s-]?making|unprofitable|in loss)\b/, expression: 'Net Profit < 0', note: 'loss-making ≈ negative net profit' },
];

function parseClause(raw: string): { expression: string; note?: string } | null {
  const clause = stripFiller(raw);
  if (!clause) return null;

  // A clause can carry several qualitative phrases ("low debt high roe"); take them all
  // rather than stopping at the first match and silently dropping the rest.
  const matched = SPECIALS.filter((s) => s.re.test(clause));
  if (matched.length > 0) {
    return {
      expression: matched.map((m) => `(${m.expression})`).join(' AND '),
      note: matched.map((m) => m.note).join('; '),
    };
  }

  // Sector / industry inclusion or exclusion.
  const excl = /\b(?:excluding|except|not in|outside)\s+(?:the\s+)?([A-Za-z& ]+?)(?:\s+sector)?$/i.exec(clause);
  if (excl) return { expression: `Sector != "${mapSector(excl[1]!)}"` };
  const incl = /\b(?:in|from|of)\s+(?:the\s+)?([A-Za-z& ]+?)\s+sector\b/i.exec(clause);
  if (incl) return { expression: `Sector = "${mapSector(incl[1]!)}"` };

  // Generic: <field phrase> <comparator> <number>
  const cmp = COMPARATORS.map((c) => ({ ...c, m: c.re.exec(clause) })).filter((c) => c.m).sort((a, b) => (a.m!.index) - (b.m!.index))[0];
  if (!cmp) return null;
  const leftRaw = clause.slice(0, cmp.m!.index).trim();
  const rightRaw = clause.slice(cmp.m!.index + cmp.m![0].length).trim();
  const value = parseNumber(rightRaw);
  if (value === null) return null;

  // The longest alias that appears in the left-hand side wins (case-insensitive).
  const leftLower = leftRaw.toLowerCase();
  const candidates = [...new Set(Object.keys(ALIAS_LIST))].filter((k) => leftLower.includes(k)).sort((a, b) => b.length - a.length);
  if (candidates.length === 0) return null;
  const field = resolveField(candidates[0]!);
  if (!field) return null;
  if (field.kind === 'text') return null;
  return { expression: `${field.label} ${cmp.op} ${value}` };
}

/** Common sector shorthands → the dataset's sector names. */
const SECTOR_ALIASES: Record<string, string> = {
  it: 'Information Technology', tech: 'Information Technology', technology: 'Information Technology', software: 'Information Technology',
  pharma: 'Pharmaceuticals', healthcare: 'Pharmaceuticals', drugs: 'Pharmaceuticals',
  fmcg: 'FMCG', consumer: 'FMCG', 'consumer staples': 'FMCG',
  auto: 'Automobile', automobile: 'Automobile', autos: 'Automobile',
  bank: 'Financials', banks: 'Financials', financial: 'Financials', financials: 'Financials', nbfc: 'Financials', insurance: 'Financials',
  cement: 'Cement', steel: 'Steel & Metals', metals: 'Steel & Metals', metal: 'Steel & Metals',
  energy: 'Energy', oil: 'Energy', power: 'Energy', gas: 'Energy',
  telecom: 'Telecom', durables: 'Consumer Durables', appliances: 'Consumer Durables',
};

function mapSector(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  return SECTOR_ALIASES[key] ?? titleCase(raw);
}

function titleCase(s: string): string {
  return s.trim().split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Built once from the field vocabulary so the rules stay in sync with expr.ts.
const ALIAS_LIST: Record<string, true> = (() => {
  const out: Record<string, true> = {};
  // Share the expression engine's vocabulary so NL and expressions never drift.
  for (const k of Object.keys(FIELD_ALIASES)) out[k] = true;
  for (const f of FIELDS) { out[f.label.toLowerCase()] = true; out[f.column.replace(/_/g, ' ')] = true; }
  return out;
})();

/** Parse a natural-language query into a validated screener expression. */
export function parseQuery(text: string): NlResult {
  const cleaned = (text ?? '').replace(/[?!]/g, ' ').replace(/\s+/g, ' ').trim();
  const notes: string[] = [];
  if (!cleaned) return { expression: '', clauses: [], unresolved: [], source: 'rules', notes: ['Empty query.'] };

  const parts = cleaned.split(/\s+and\s+|,|;|\bplus\b|\bwith\b|\bwhile\b/i).map((p) => p.trim()).filter(Boolean);
  const clauses: NlClause[] = [];
  const unresolved: string[] = [];

  for (const part of parts) {
    const parsed = parseClause(part);
    if (parsed) {
      clauses.push({ text: part, expression: parsed.expression, source: 'rule' });
      if (parsed.note) notes.push(`${part} → ${parsed.expression} (${parsed.note})`);
    } else if (part.length > 2) {
      unresolved.push(part);
    }
  }

  const expression = clauses.map((c) => `(${c.expression})`).join(' AND ');
  // Validate what we built; if it does not compile, report rather than guess.
  if (expression) {
    try { compileExpression(expression); }
    catch (e) { return { expression: '', clauses, unresolved, source: 'rules', notes: [`Could not validate: ${(e as Error).message}`] }; }
  }
  if (clauses.length === 0) notes.push('No rule matched. Try phrasing like "ROE above 15 and debt to equity below 0.5".');
  return { expression, clauses, unresolved, source: 'rules', notes };
}

/** The system prompt used when a local model is available (docs/LLM-PROMPTS.md). */
export function buildLlmPrompt(text: string): string {
  const fields = FIELDS.filter((f) => f.kind === 'number').map((f) => f.label).join(', ');
  return [
    'You translate a stock-screening request into ONE expression.',
    `Allowed numeric fields: ${fields}.`,
    'Allowed text fields: Sector, Industry, Symbol, Name (quote values with double quotes).',
    'Operators: > < >= <= = != AND OR NOT ( ). Numbers may end with Cr, lakh crore or %.',
    'Reply with JSON only: {"expression": "..."}. No prose, no markdown.',
    `Request: ${text}`,
  ].join('\n');
}

export interface LlmOptions { baseUrl?: string; model?: string; timeoutMs?: number; fetchImpl?: typeof fetch }

/**
 * Try a local Ollama model; fall back to the rules on any failure. The model's
 * answer is only accepted if it compiles and mentions at least one real field.
 */
export async function parseQueryWithLlm(text: string, opts: LlmOptions = {}): Promise<NlResult> {
  const baseUrl = opts.baseUrl ?? process.env['SIFT_OLLAMA_URL'] ?? 'http://127.0.0.1:11434';
  const model = opts.model ?? process.env['SIFT_OLLAMA_MODEL'] ?? 'llama3.2';
  const fetchImpl = opts.fetchImpl ?? fetch;
  const fallback = (note: string): NlResult => { const r = parseQuery(text); r.notes.unshift(note); return r; };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
    const res = await fetchImpl(`${baseUrl}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ model, prompt: buildLlmPrompt(text), stream: false, format: 'json', options: { temperature: 0 } }),
    });
    clearTimeout(timer);
    if (!res.ok) return fallback(`Local model unavailable (${res.status}); used the rules.`);
    const body = (await res.json()) as { response?: string };
    const raw = (body.response ?? '').trim();
    const jsonText = raw.startsWith('{') ? raw : (raw.match(/\{[\s\S]*\}/)?.[0] ?? '');
    if (!jsonText) return fallback('Local model returned no JSON; used the rules.');
    const parsed = JSON.parse(jsonText) as { expression?: string };
    const expr = String(parsed.expression ?? '').trim();
    if (!expr) return fallback('Local model returned an empty expression; used the rules.');
    compileExpression(expr); // throws if invalid → caught below
    return { expression: expr, clauses: [{ text, expression: expr, source: 'llm' }], unresolved: [], source: 'llm', notes: [`Parsed by local model ${model}.`] };
  } catch {
    return fallback('Local model not reachable; used the deterministic rules.');
  }
}
