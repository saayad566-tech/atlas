// Query AST — a validated, structured form of a screen.
//
// A local model must never emit raw SQL. It emits this JSON; we validate every field
// against the whitelist and the operator set, then compile to the same parameterised
// expression the rule parser produces. Invalid output is rejected, never executed.
import { FIELDS } from './expr';

export interface AstCondition { field: string; op: '>' | '>=' | '<' | '<=' | '=' | '!='; value: number | string }
export interface AstNode { operator: 'AND' | 'OR'; conditions: AstCondition[]; groups?: AstNode[] }
export interface AstResult { ast: AstNode | null; expression: string | null; errors: string[]; valid: boolean }

/** Field labels the expression language accepts (e.g. "Return on Equity"). */
export const ALLOWED_FIELDS: string[] = (FIELDS as Array<{ label?: string; column?: string }>)
  .map((f) => String(f.label ?? f.column ?? '')).filter(Boolean);

const OPS = new Set(['>', '>=', '<', '<=', '=', '!=']);

/** JSON Schema handed to a local model so its output is machine-checkable. */
export const AST_SCHEMA = {
  type: 'object',
  required: ['operator', 'conditions'],
  properties: {
    operator: { enum: ['AND', 'OR'] },
    conditions: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', required: ['field', 'op', 'value'],
        properties: {
          field: { type: 'string', description: `One of: ${ALLOWED_FIELDS.slice(0, 12).join(', ')}…` },
          op: { enum: ['>', '>=', '<', '<=', '=', '!='] },
          value: { type: ['number', 'string'] },
        },
      },
    },
  },
} as const;

export const AST_SYSTEM_PROMPT = `You convert a stock-screening request into JSON.
Output ONLY a JSON object, no prose, matching this shape:
{"operator":"AND","conditions":[{"field":"<field>","op":"<op>","value":<number|string>}]}
Rules:
- field MUST be one of the allowed labels. Never invent a field.
- op MUST be one of > >= < <= = !=
- Numbers only for numeric fields; quote strings for sector comparisons.
- Use AND unless the user clearly wants alternatives.
Allowed fields: ${ALLOWED_FIELDS.join(', ')}`;

/** Validate a model's JSON against the whitelist. Returns errors instead of throwing. */
export function validateAst(input: unknown): { ast: AstNode | null; errors: string[] } {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') return { ast: null, errors: ['AST must be a JSON object'] };
  const o = input as Record<string, unknown>;
  const operator = String(o['operator'] ?? 'AND').toUpperCase();
  if (operator !== 'AND' && operator !== 'OR') errors.push(`operator must be AND or OR, got "${operator}"`);
  const raw = o['conditions'];
  if (!Array.isArray(raw) || raw.length === 0) errors.push('conditions must be a non-empty array');
  const conditions: AstCondition[] = [];
  if (Array.isArray(raw)) {
    raw.forEach((c, i) => {
      const cond = c as Record<string, unknown>;
      const field = String(cond['field'] ?? '').trim();
      const op = String(cond['op'] ?? '').trim();
      const value = cond['value'];
      if (!ALLOWED_FIELDS.includes(field)) errors.push(`condition ${i}: unknown field "${field}"`);
      if (!OPS.has(op)) errors.push(`condition ${i}: bad operator "${op}"`);
      if (typeof value !== 'number' && typeof value !== 'string') errors.push(`condition ${i}: value must be a number or string`);
      if (ALLOWED_FIELDS.includes(field) && OPS.has(op) && (typeof value === 'number' || typeof value === 'string')) {
        conditions.push({ field, op: op as AstCondition['op'], value });
      }
    });
  }
  if (errors.length) return { ast: null, errors };
  return { ast: { operator: operator as 'AND' | 'OR', conditions }, errors: [] };
}

/** Compile a validated AST to the screener's expression language. */
export function astToExpression(ast: AstNode): string {
  const parts = ast.conditions.map((c) => {
    const v = typeof c.value === 'string' ? `"${c.value.replace(/"/g, '')}"` : String(c.value);
    return `${c.field} ${c.op} ${v}`;
  });
  return parts.length === 1 ? parts[0]! : parts.map((p) => `(${p})`).join(` ${ast.operator} `);
}

/** Full pipeline: unknown JSON → validated AST → expression. */
export function compileAst(input: unknown): AstResult {
  const { ast, errors } = validateAst(input);
  if (!ast) return { ast: null, expression: null, errors, valid: false };
  return { ast, expression: astToExpression(ast), errors: [], valid: true };
}

/** Parse the screener expression language back into an AST (for the query builder). */
export function expressionToAst(expression: string): AstResult {
  const errors: string[] = [];
  const operator: 'AND' | 'OR' = /\bOR\b/.test(expression) ? 'OR' : 'AND';
  const parts = expression.split(/\s+(?:AND|OR)\s+/i).map((p) => p.replace(/^\(|\)$/g, '').trim()).filter(Boolean);
  const conditions: AstCondition[] = [];
  for (const part of parts) {
    const m = /^(.+?)\s*(>=|<=|!=|=|>|<)\s*(.+)$/.exec(part);
    if (!m) { errors.push(`could not parse "${part}"`); continue; }
    const field = m[1]!.trim().replace(/^\(|\)$/g, '');
    const op = m[2] as AstCondition['op'];
    const rawVal = m[3]!.trim().replace(/^\(|\)$/g, '');
    const isQuoted = /^".*"$/.test(rawVal);
    const value = isQuoted ? rawVal.slice(1, -1) : Number(rawVal);
    if (!isQuoted && !Number.isFinite(value as number)) { errors.push(`bad value in "${part}"`); continue; }
    conditions.push({ field, op, value: value as number | string });
  }
  if (errors.length || conditions.length === 0) return { ast: null, expression, errors: errors.length ? errors : ['no conditions'], valid: false };
  const ast: AstNode = { operator, conditions };
  const check = validateAst(ast);
  return { ast: check.ast, expression, errors: check.errors, valid: check.errors.length === 0 };
}
