// On-device LLM — grounded answers from a LOCAL model only.
//
// Three rules this enforces:
//   1. The endpoint must be loopback. A remote URL is refused, so nothing leaves the device.
//   2. Answers are generated from a context block of COMPUTED metrics, never free-floating.
//   3. Every number in the answer is cross-checked against that context; unsupported
//      figures are flagged rather than shown as fact.
// When no local model is running, a deterministic engine answers from the same context.
import type { Database as DB } from 'better-sqlite3';
import { atlasScore } from './intel';
import { deep2 } from './deep2';
import { valuationReport } from './valuation2';
import { marketIntel } from './marketdata';
import { riskProfile } from './universe';

const LOOPBACK = /^(https?:\/\/)?(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)(:|\/|$)/i;

export interface LlmStatus {
  available: boolean;
  endpoint: string;
  model: string | null;
  reason: string;
  deviceOnly: true;
}

export interface GroundedAnswer {
  question: string;
  answer: string;
  source: 'local-model' | 'deterministic';
  model: string | null;
  context: Array<{ label: string; value: string }>;
  /** Numbers in the answer that do not appear in the context — a cross-check warning. */
  unsupportedNumbers: string[];
  verified: boolean;
}

export class LocalLlm {
  private modelName: string | null = null;

  /** Point the client at the model the user activated in the store. */
  useModel(m: { id: string; name: string } | null): void {
    this.modelName = m ? m.id : null;
  }

  activeModelId(): string | null { return this.modelName; }

  constructor(private endpoint = process.env.ATLAS_LLM_URL ?? 'http://127.0.0.1:11434', private model = process.env.ATLAS_LLM_MODEL ?? 'qwen2.5:1.5b-instruct-q4_K_M') {}

  /** Refuse anything that is not loopback — this is the privacy boundary. */
  private assertLocal(url: string): void {
    if (!LOOPBACK.test(url)) throw new Error('Refused: the model endpoint must be on this device (127.0.0.1 / localhost).');
  }

  async status(): Promise<LlmStatus> {
    try {
      this.assertLocal(this.endpoint);
    } catch (e) {
      return { available: false, endpoint: this.endpoint, model: null, reason: e instanceof Error ? e.message : 'not local', deviceOnly: true };
    }
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch(`${this.endpoint}/api/tags`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) return { available: false, endpoint: this.endpoint, model: null, reason: `HTTP ${res.status}`, deviceOnly: true };
      const j = (await res.json()) as { models?: Array<{ name: string }> };
      const models = j.models ?? [];
      const found = models.find((m) => m.name === this.model) ?? models[0];
      return { available: !!found, endpoint: this.endpoint, model: found?.name ?? null, reason: found ? 'local model ready' : 'server up, no model pulled', deviceOnly: true };
    } catch {
      return { available: false, endpoint: this.endpoint, model: null, reason: 'no local model server responding', deviceOnly: true };
    }
  }

  private async generate(prompt: string, system: string): Promise<string | null> {
    this.assertLocal(this.endpoint);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 60000);
      const res = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt, system, stream: false, options: { temperature: 0.2, num_predict: 400 } }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) return null;
      const j = (await res.json()) as { response?: string };
      return j.response?.trim() ?? null;
    } catch { return null; }
  }

  /** Build the fact block a question is answered from. Every figure is computed locally. */
  buildContext(db: DB, symbol: string): Array<{ label: string; value: string }> {
    const row = db.prepare(`SELECT * FROM v_latest WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as Record<string, number | string> | undefined;
    if (!row) return [];
    const n = (k: string): string => { const v = Number(row[k] ?? 0); return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '0'; };
    const ctx: Array<{ label: string; value: string }> = [
      { label: 'Company', value: String(row['name'] ?? symbol) },
      { label: 'Symbol', value: String(row['symbol'] ?? symbol) },
      { label: 'Sector', value: String(row['sector'] ?? 'unknown') },
      { label: 'Market cap (Cr)', value: n('market_cap') },
      { label: 'Price', value: n('price') },
      { label: 'P/E', value: n('pe') },
      { label: 'P/B', value: n('pb') },
      { label: 'ROE %', value: n('roe') },
      { label: 'ROCE %', value: n('roce') },
      { label: 'Debt/Equity', value: n('debt_to_equity') },
      { label: 'Operating margin %', value: n('opm') },
      { label: 'Sales growth 3Y %', value: n('sales_growth_3y') },
      { label: 'Dividend yield %', value: n('dividend_yield') },
    ];
    const a = atlasScore(db, symbol);
    if (a) ctx.push({ label: 'Atlas score', value: `${a.score} (${a.grade})` });
    const d = deep2(db, symbol);
    if (d?.roic !== null && d?.roic !== undefined) ctx.push({ label: 'ROIC %', value: String(d.roic) });
    if (d?.wacc !== null && d?.wacc !== undefined) ctx.push({ label: 'WACC %', value: String(d.wacc) });
    if (d?.eva !== null && d?.eva !== undefined) ctx.push({ label: 'EVA (Cr)', value: String(d.eva) });
    const v = valuationReport(db, symbol);
    if (v?.blended !== null && v?.blended !== undefined) ctx.push({ label: 'Blended fair value', value: String(v.blended) });
    if (v?.upsidePct !== null && v?.upsidePct !== undefined) ctx.push({ label: 'Upside %', value: String(v.upsidePct) });
    const mi = marketIntel(db, symbol);
    if (mi?.analysts.consensus) ctx.push({ label: 'Analyst consensus', value: `${mi.analysts.consensus} (${mi.analysts.upsidePct ?? 0}% upside)` });
    const rk = riskProfile(db, symbol);
    if (rk?.annualVolPct !== null && rk?.annualVolPct !== undefined) ctx.push({ label: 'Volatility %', value: String(rk.annualVolPct) });
    return ctx;
  }

  /** Answer a question about a company, grounded in locally computed numbers. */
  async answer(db: DB, symbol: string, question: string): Promise<GroundedAnswer> {
    const context = this.buildContext(db, symbol);
    if (context.length === 0) {
      return { question, answer: 'I have no data for that symbol in this market.', source: 'deterministic', model: null, context, unsupportedNumbers: [], verified: true };
    }
    const factBlock = context.map((c) => `${c.label}: ${c.value}`).join('\n');
    const system = 'You are a financial analyst. Answer ONLY from the FACTS block. If a fact is absent, say you do not know. Never invent a number. Keep it under 120 words.';
    const prompt = `FACTS:\n${factBlock}\n\nQUESTION: ${question}\n\nANSWER:`;

    const status = await this.status();
    let answer: string | null = null;
    if (status.available) answer = await this.generate(prompt, system);

    const source: GroundedAnswer['source'] = answer ? 'local-model' : 'deterministic';
    if (!answer) answer = this.deterministic(symbol, question, context);

    const unsupported = crossCheck(answer, context);
    return {
      question, answer, source, model: status.model, context,
      unsupportedNumbers: unsupported, verified: unsupported.length === 0,
    };
  }

  /** No model? Still answer — from the same facts, with plain rules. */
  private deterministic(symbol: string, question: string, context: Array<{ label: string; value: string }>): string {
    const get = (k: string): string | undefined => context.find((c) => c.label === k)?.value;
    const q = question.toLowerCase();
    const roe = Number(get('ROE %') ?? 0);
    const pe = Number(get('P/E') ?? 0);
    const de = Number(get('Debt/Equity') ?? 0);
    const roic = Number(get('ROIC %') ?? 0);
    const wacc = Number(get('WACC %') ?? 0);
    const upside = Number(get('Upside %') ?? 0);
    const score = get('Atlas score') ?? '—';

    if (/debt|lever|borrow/.test(q)) return `${symbol} carries debt/equity of ${de}. ${de < 0.5 ? 'That is comfortable.' : de < 1.5 ? 'That is moderate.' : 'That is high — it magnifies both returns and distress.'}`;
    if (/cheap|expensive|valu|price/.test(q)) return `At a P/E of ${pe}, the blended fair value implies ${upside > 0 ? '+' : ''}${upside}% ${upside > 0 ? 'upside' : 'downside'}. ${upside > 10 ? 'The models see room.' : upside < -10 ? 'The models see it as expensive.' : 'It looks close to fair value.'}`;
    if (/quality|good|buy|invest|worth/.test(q)) return `Atlas score ${score}. ROE ${roe}%, ROIC ${roic}% against a ${wacc}% cost of capital, debt/equity ${de}. ${roic > wacc ? 'It earns more than its capital costs, which is the core test.' : 'It earns less than its capital costs — growth would destroy value.'}`;
    return `${symbol}: ROE ${roe}%, P/E ${pe}, debt/equity ${de}, ROIC ${roic}% vs WACC ${wacc}%, valuation gap ${upside}%, Atlas score ${score}. Ask about debt, valuation or quality for a focused read.`;
  }
}

/** Numbers in the answer that never appeared in the facts — the anti-hallucination check. */
export function crossCheck(answer: string, context: Array<{ label: string; value: string }>): string[] {
  const known = new Set<string>();
  for (const c of context) {
    for (const m of String(c.value).matchAll(/-?\d+(?:\.\d+)?/g)) known.add(normalise(m[0]));
  }
  const flagged: string[] = [];
  for (const m of answer.matchAll(/-?\d+(?:\.\d+)?/g)) {
    const num = normalise(m[0]);
    if (!known.has(num) && !known.has(String(Number(num)))) flagged.push(m[0]);
  }
  return [...new Set(flagged)];
}

function normalise(s: string): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return String(Math.round(n * 100) / 100);
}
