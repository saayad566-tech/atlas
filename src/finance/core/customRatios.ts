// User-defined ratios.
//
// A screener ships a fixed set of metrics; the useful ones are usually the ones you
// invent. A custom ratio is a small arithmetic formula over existing fields, which then
// behaves like any built-in: it can be a column, a sort key, or a screen condition.
//
// The formula is evaluated by a hand-written recursive-descent parser. There is no eval,
// no Function constructor, and no property access — only numbers, field names, + - * /,
// parentheses and a few functions.
import type { Database as DB } from 'better-sqlite3';
import { FIELDS, resolveField } from './expr';

export const RATIO_DDL = `
CREATE TABLE IF NOT EXISTS custom_ratios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  formula TEXT NOT NULL,
  unit TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);
`;

export class RatioError extends Error {}

// ---------- tokeniser ----------
type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string } | { t: 'lp' } | { t: 'rp' } | { t: 'comma' };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9._]/.test(src[j]!)) j++;
      const raw = src.slice(i, j).replace(/_/g, '');
      const v = Number(raw);
      if (!Number.isFinite(v)) throw new RatioError(`Not a number: "${raw}"`);
      out.push({ t: 'num', v }); i = j; continue;
    }
    if (/[A-Za-z]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      out.push({ t: 'id', v: src.slice(i, j) }); i = j; continue;
    }
    if ('+-*/'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    if (c === '(') { out.push({ t: 'lp' }); i++; continue; }
    if (c === ')') { out.push({ t: 'rp' }); i++; continue; }
    if (c === ',') { out.push({ t: 'comma' }); i++; continue; }
    throw new RatioError(`Unexpected character "${c}"`);
  }
  return out;
}

// ---------- parser ----------
// expr   := term (('+'|'-') term)*
// term   := factor (('*'|'/') factor)*
// factor := '-' factor | number | field | func '(' args ')' | '(' expr ')'
class Parser {
  private i = 0;
  constructor(private toks: Tok[], private fields: Record<string, number>) {}

  private peek(): Tok | undefined { return this.toks[this.i]; }
  private eat(): Tok { const t = this.toks[this.i++]; if (!t) throw new RatioError('Unexpected end of formula'); return t; }

  parse(): number {
    const v = this.expr();
    if (this.i < this.toks.length) throw new RatioError('Unexpected trailing input');
    return v;
  }

  private expr(): number {
    let v = this.term();
    for (;;) {
      const t = this.peek();
      if (t?.t === 'op' && (t.v === '+' || t.v === '-')) { this.eat(); const r = this.term(); v = t.v === '+' ? v + r : v - r; }
      else return v;
    }
  }

  private term(): number {
    let v = this.factor();
    for (;;) {
      const t = this.peek();
      if (t?.t === 'op' && (t.v === '*' || t.v === '/')) {
        this.eat(); const r = this.factor();
        if (t.v === '/') { if (r === 0) throw new RatioError('Division by zero'); v = v / r; } else v = v * r;
      } else return v;
    }
  }

  private factor(): number {
    const t = this.eat();
    if (t.t === 'num') return t.v;
    if (t.t === 'op' && t.v === '-') return -this.factor();
    if (t.t === 'lp') { const v = this.expr(); const c = this.eat(); if (c.t !== 'rp') throw new RatioError('Missing ")"'); return v; }
    if (t.t === 'id') {
      const name = t.v.toLowerCase();
      if (this.peek()?.t === 'lp') {
        this.eat();
        const args: number[] = [];
        if (this.peek()?.t !== 'rp') {
          args.push(this.expr());
          while (this.peek()?.t === 'comma') { this.eat(); args.push(this.expr()); }
        }
        const c = this.eat(); if (c.t !== 'rp') throw new RatioError('Missing ")" after function');
        return applyFunc(name, args);
      }
      const key = resolveKey(name, this.fields);
      if (key === null) throw new RatioError(`Unknown field "${t.v}"`);
      return this.fields[key]!;
    }
    throw new RatioError('Unexpected token');
  }
}

function applyFunc(name: string, args: number[]): number {
  const one = (): number => { if (args.length !== 1) throw new RatioError(`${name}() takes one argument`); return args[0]!; };
  switch (name) {
    case 'abs': return Math.abs(one());
    case 'sqrt': { const v = one(); if (v < 0) throw new RatioError('sqrt of a negative number'); return Math.sqrt(v); }
    case 'min': if (args.length < 1) throw new RatioError('min() needs arguments'); return Math.min(...args);
    case 'max': if (args.length < 1) throw new RatioError('max() needs arguments'); return Math.max(...args);
    case 'round': return Math.round(one());
    default: throw new RatioError(`Unknown function "${name}"`);
  }
}

function resolveKey(name: string, fields: Record<string, number>): string | null {
  const norm = name.toLowerCase().replace(/\s+/g, '_');
  if (norm in fields) return norm;
  const def = resolveField(name);
  if (def) {
    const k = def.label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    if (k in fields) return k;
  }
  return null;
}

/** Every field name a formula may reference, for help text and validation. */
export function allowedFields(): string[] {
  return FIELDS.map((f) => f.label.toLowerCase().replace(/[^a-z0-9]+/g, '_')).concat(
    ['market_cap', 'price', 'pe', 'pb', 'roe', 'roce', 'debt_to_equity', 'sales', 'net_profit', 'opm', 'npm', 'eps', 'current_ratio', 'interest_coverage', 'sales_growth_3y', 'profit_growth_3y', 'asset_turnover', 'dividend_yield'],
  ).filter((v, i, a) => a.indexOf(v) === i);
}

/** Validate a formula without a row: every field must exist, structure must parse. */
export function validateFormula(formula: string): { ok: boolean; error: string | null; fields: string[] } {
  const used = new Set<string>();
  try {
    const probe: Record<string, number> = {};
    for (const f of allowedFields()) probe[f] = 1;
    // A dry run with 1s catches unknown fields and malformed structure.
    new Parser(tokenize(formula), probe).parse();
    for (const t of tokenize(formula)) {
      if (t.t === 'id') { const k = resolveKey(t.v.toLowerCase(), probe); if (k) used.add(k); }
    }
    return { ok: true, error: null, fields: [...used] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), fields: [] };
  }
}

/** Evaluate a formula against one row of metrics. */
export function evaluateFormula(formula: string, row: Record<string, number>): number | null {
  try {
    const v = new Parser(tokenize(formula), row).parse();
    return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
  } catch {
    return null;
  }
}

// ---------- storage ----------
export interface CustomRatio { id: number; name: string; formula: string; unit: string | null; note: string | null }

export function ensureRatios(db: DB): void { db.exec(RATIO_DDL); }

export function listRatios(db: DB): CustomRatio[] {
  ensureRatios(db);
  return (db.prepare(`SELECT id,name,formula,unit,note FROM custom_ratios ORDER BY name`).all() as Array<Record<string, unknown>>)
    .map((r) => ({ id: Number(r['id']), name: String(r['name']), formula: String(r['formula']), unit: r['unit'] ? String(r['unit']) : null, note: r['note'] ? String(r['note']) : null }));
}

export function saveRatio(db: DB, name: string, formula: string, unit?: string, note?: string): number {
  ensureRatios(db);
  const check = validateFormula(formula);
  if (!check.ok) throw new RatioError(check.error ?? 'Invalid formula');
  const clean = name.trim();
  if (!/^[A-Za-z][A-Za-z0-9 _-]{0,40}$/.test(clean)) throw new RatioError('Name must start with a letter and be under 41 characters');
  const existing = db.prepare(`SELECT id FROM custom_ratios WHERE name=?`).get(clean) as { id: number } | undefined;
  if (existing) {
    db.prepare(`UPDATE custom_ratios SET formula=?, unit=?, note=? WHERE id=?`).run(formula, unit ?? null, note ?? null, existing.id);
    return existing.id;
  }
  const info = db.prepare(`INSERT INTO custom_ratios (name,formula,unit,note,created_at) VALUES (?,?,?,?,?)`)
    .run(clean, formula, unit ?? null, note ?? null, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

export function deleteRatio(db: DB, id: number): boolean {
  ensureRatios(db);
  return db.prepare(`DELETE FROM custom_ratios WHERE id=?`).run(id).changes > 0;
}

/** Attach every defined ratio to each row. */
export function applyRatios(db: DB, rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const ratios = listRatios(db);
  if (!ratios.length) return rows;
  return rows.map((r) => {
    // Screen rows are camelCase; formulas are written in snake_case. Normalise both so a
    // formula such as "cfo / net_profit" works against a row keyed "netProfit".
    const numeric: Record<string, number> = {};
    for (const [k, v] of Object.entries(r)) {
      const value = typeof v === 'number' ? v : Number(v) || 0;
      numeric[k] = value;
      const snake = k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
      if (!(snake in numeric)) numeric[snake] = value;
    }
    const out = { ...r };
    for (const ratio of ratios) {
      out[`ratio:${ratio.name}`] = evaluateFormula(ratio.formula, numeric);
    }
    return out;
  });
}
