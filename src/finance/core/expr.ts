// Screener expression language → AST → parameterised SQL.
//
// Users write things like:
//   Market Cap > 500 AND ROE > 15 AND Debt to Equity < 0.5
//   (Sales - Expenses) > 100 AND NOT Sector = "Telecom"
//
// The parser builds an AST; the compiler maps it to SQL with a strict field
// whitelist and bound parameters. User input NEVER reaches SQL as text, so the
// usual injection surface does not exist.

export type Ast =
  | { type: 'num'; value: number }
  | { type: 'str'; value: string }
  | { type: 'field'; column: string; label: string }
  | { type: 'unary'; op: 'NOT' | '-'; operand: Ast }
  | { type: 'binary'; op: 'AND' | 'OR'; left: Ast; right: Ast }
  | { type: 'compare'; op: '>' | '<' | '>=' | '<=' | '=' | '!='; left: Ast; right: Ast }
  | { type: 'arith'; op: '+' | '-' | '*' | '/'; left: Ast; right: Ast };

export interface FieldDef { column: string; label: string; kind: 'number' | 'text'; unit?: string }

/** The screener's vocabulary. Anything not here is rejected with a helpful error. */
export const FIELDS: FieldDef[] = [
  { column: 'market_cap', label: 'Market Cap', kind: 'number', unit: '₹ Cr' },
  { column: 'price', label: 'Price', kind: 'number', unit: '₹' },
  { column: 'pe', label: 'P/E', kind: 'number' },
  { column: 'pb', label: 'P/B', kind: 'number' },
  { column: 'roe', label: 'ROE', kind: 'number', unit: '%' },
  { column: 'roce', label: 'ROCE', kind: 'number', unit: '%' },
  { column: 'debt_to_equity', label: 'Debt to Equity', kind: 'number' },
  { column: 'sales', label: 'Sales', kind: 'number', unit: '₹ Cr' },
  { column: 'net_profit', label: 'Net Profit', kind: 'number', unit: '₹ Cr' },
  { column: 'expenses', label: 'Expenses', kind: 'number', unit: '₹ Cr' },
  { column: 'operating_profit', label: 'Operating Profit', kind: 'number', unit: '₹ Cr' },
  { column: 'interest', label: 'Interest', kind: 'number', unit: '₹ Cr' },
  { column: 'depreciation', label: 'Depreciation', kind: 'number', unit: '₹ Cr' },
  { column: 'cfo', label: 'Cash from Operations', kind: 'number', unit: '₹ Cr' },
  { column: 'cash', label: 'Cash', kind: 'number', unit: '₹ Cr' },
  { column: 'opm', label: 'OPM', kind: 'number', unit: '%' },
  { column: 'npm', label: 'NPM', kind: 'number', unit: '%' },
  { column: 'eps', label: 'EPS', kind: 'number', unit: '₹' },
  { column: 'dividend_yield', label: 'Dividend Yield', kind: 'number', unit: '%' },
  { column: 'promoter_holding', label: 'Promoter Holding', kind: 'number', unit: '%' },
  { column: 'pledge', label: 'Pledged', kind: 'number', unit: '%' },
  { column: 'current_ratio', label: 'Current Ratio', kind: 'number' },
  { column: 'interest_coverage', label: 'Interest Coverage', kind: 'number' },
  { column: 'sales_growth_3y', label: 'Sales Growth 3Y', kind: 'number', unit: '%' },
  { column: 'profit_growth_3y', label: 'Profit Growth 3Y', kind: 'number', unit: '%' },
  { column: 'asset_turnover', label: 'Asset Turnover', kind: 'number' },
  { column: 'sector', label: 'Sector', kind: 'text' },
  { column: 'industry', label: 'Industry', kind: 'text' },
  { column: 'symbol', label: 'Symbol', kind: 'text' },
  { column: 'name', label: 'Name', kind: 'text' },
];

export const FIELD_ALIASES: Record<string, string> = {
  'market cap': 'market_cap', marketcap: 'market_cap', mcap: 'market_cap', 'market capitalisation': 'market_cap', 'market capitalization': 'market_cap',
  pe: 'pe', 'p/e': 'pe', 'price to earning': 'pe', 'price to earnings': 'pe', 'pe ratio': 'pe',
  pb: 'pb', 'p/b': 'pb', 'price to book': 'pb',
  roe: 'roe', 'return on equity': 'roe',
  roce: 'roce', 'return on capital employed': 'roce',
  de: 'debt_to_equity', 'debt to equity': 'debt_to_equity', debttoequity: 'debt_to_equity', 'd/e': 'debt_to_equity', 'debt/equity': 'debt_to_equity',
  sales: 'sales', revenue: 'sales', turnover: 'sales',
  'net profit': 'net_profit', profit: 'net_profit', 'net profit margin': 'npm',
  opm: 'opm', 'operating margin': 'opm', 'operating profit margin': 'opm',
  npm: 'npm', 'net margin': 'npm',
  eps: 'eps', 'earning per share': 'eps', 'earnings per share': 'eps',
  expenses: 'expenses', expense: 'expenses', cost: 'expenses',
  'operating profit': 'operating_profit', op: 'operating_profit',
  interest: 'interest', depreciation: 'depreciation',
  cfo: 'cfo', 'cash from operations': 'cfo', 'operating cash flow': 'cfo',
  cash: 'cash',
  'dividend yield': 'dividend_yield', dividendyield: 'dividend_yield',
  promoter: 'promoter_holding', 'promoter holding': 'promoter_holding', 'promoter stake': 'promoter_holding',
  pledge: 'pledge', pledged: 'pledge', 'pledged shares': 'pledge', 'promoter pledge': 'pledge',
  'current ratio': 'current_ratio',
  'interest coverage': 'interest_coverage',
  'sales growth': 'sales_growth_3y', 'sales growth 3y': 'sales_growth_3y', 'revenue growth': 'sales_growth_3y',
  'profit growth': 'profit_growth_3y', 'profit growth 3y': 'profit_growth_3y',
  'asset turnover': 'asset_turnover',
  sector: 'sector', industry: 'industry', symbol: 'symbol', name: 'name', price: 'price', cmp: 'price',
};

const BY_COLUMN = new Map(FIELDS.map((f) => [f.column, f]));

/** Resolve a user-typed field phrase to a column, or null. */
export function resolveField(raw: string): FieldDef | null {
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  const col = FIELD_ALIASES[key] ?? (BY_COLUMN.has(key.replace(/\s+/g, '_')) ? key.replace(/\s+/g, '_') : null);
  if (!col) return null;
  return BY_COLUMN.get(col) ?? null;
}

// ---- tokenizer -------------------------------------------------------------

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'word'; v: string }
  | { t: 'op'; v: string }
  | { t: 'lparen' } | { t: 'rparen' };

const OPS = ['>=', '<=', '!=', '==', '>', '<', '=', '+', '-', '*', '/'];

/** Fold slash spellings (P/E, P/B, D/E) into plain words before tokenising. */
function normaliseSlashAliases(src: string): string {
  return src
    .replace(/\bp\s*\/\s*e\b/gi, 'PE')
    .replace(/\bp\s*\/\s*b\b/gi, 'PB')
    .replace(/\bd\s*\/\s*e\b/gi, 'DE')
    .replace(/\bdebt\s*\/\s*equity\b/gi, 'Debt to Equity');
}

function tokenize(srcRaw: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const s = normaliseSlashAliases(srcRaw);
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(') { out.push({ t: 'lparen' }); i++; continue; }
    if (c === ')') { out.push({ t: 'rparen' }); i++; continue; }
    if (c === '"' || c === "'") {
      const quote = c; i++;
      let buf = '';
      while (i < s.length && s[i] !== quote) { buf += s[i]; i++; }
      if (s[i] !== quote) throw new ExprError(`Unterminated string literal.`);
      i++;
      out.push({ t: 'str', v: buf });
      continue;
    }
    // number, optionally with a suffix (cr / crore / lakh / % / k / m)
    const numMatch = /^-?\d[\d,]*(\.\d+)?/.exec(s.slice(i));
    if (numMatch) {
      let raw = numMatch[0];
      i += raw.length;
      let value = Number(raw.replace(/,/g, ''));
      const rest = s.slice(i).toLowerCase();
      const suffix = /^\s*(lakh\s+crore|crore|cr|lakh|lac|%|k|m)(?![A-Za-z0-9])/.exec(rest);
      if (suffix) {
        const u = suffix[1]!.replace(/\s+/g, ' ');
        if (u === 'lakh crore' || u === 'lakh crore') value *= 100000;
        else if (u === 'crore' || u === 'cr') value *= 1;
        else if (u === 'lakh' || u === 'lac') value *= 0.01;
        else if (u === 'k') value *= 1000;
        else if (u === 'm') value *= 1000000;
        // '%' is a no-op: percentages are stored as plain numbers.
        i += suffix[0].length;
      }
      out.push({ t: 'num', v: value });
      continue;
    }
    const opMatch = OPS.find((o) => s.startsWith(o, i));
    if (opMatch) { out.push({ t: 'op', v: opMatch === '==' ? '=' : opMatch }); i += opMatch.length; continue; }
    // word: letters, digits, underscore, space, slash, dot, hyphen (field names).
    // A field name may contain spaces ("Debt to Equity"), so we must not let the
    // scan swallow a following AND / OR / NOT — split at the first keyword.
    const wMatch = /^[A-Za-z_][A-Za-z0-9 _.]*/.exec(s.slice(i));
    if (wMatch) {
      const raw = wMatch[0];
      const kw = /\b(AND|OR|NOT)\b/i.exec(raw);
      if (kw && kw.index > 0) {
        const before = raw.slice(0, kw.index).trimEnd();
        if (before) out.push({ t: 'word', v: before });
        i += kw.index; // resume scanning at the keyword itself
        continue;
      }
      if (kw && kw.index === 0) {
        out.push({ t: 'word', v: kw[1]!.toUpperCase() });
        i += kw[0].length;
        continue;
      }
      i += raw.length;
      out.push({ t: 'word', v: raw.trimEnd() });
      continue;
    }
    throw new ExprError(`Unexpected character "${c}" at position ${i + 1}.`);
  }
  return out;
}

export class ExprError extends Error {
  constructor(message: string) { super(message); this.name = 'ExprError'; }
}

// ---- parser ----------------------------------------------------------------

class Parser {
  private pos = 0;
  constructor(private toks: Tok[]) {}

  private peek(): Tok | undefined { return this.toks[this.pos]; }
  private next(): Tok | undefined { return this.toks[this.pos++]; }
  private isWord(w: string): boolean { const t = this.peek(); return !!t && t.t === 'word' && t.v.toUpperCase() === w; }
  private isOp(o: string): boolean { const t = this.peek(); return !!t && t.t === 'op' && t.v === o; }

  parse(): Ast {
    if (this.toks.length === 0) throw new ExprError('Expression is empty.');
    const ast = this.parseOr();
    if (this.pos < this.toks.length) {
      const t = this.peek()!;
      throw new ExprError(`Unexpected ${t.t === 'word' ? `"${t.v}"` : t.t === 'op' ? `"${t.v}"` : t.t} after a complete expression.`);
    }
    return ast;
  }

  private parseOr(): Ast {
    let left = this.parseAnd();
    while (this.isWord('OR')) { this.next(); const right = this.parseAnd(); left = { type: 'binary', op: 'OR', left, right }; }
    return left;
  }

  private parseAnd(): Ast {
    let left = this.parseNot();
    while (this.isWord('AND')) { this.next(); const right = this.parseNot(); left = { type: 'binary', op: 'AND', left, right }; }
    return left;
  }

  private parseNot(): Ast {
    if (this.isWord('NOT')) { this.next(); return { type: 'unary', op: 'NOT', operand: this.parseNot() }; }
    return this.parseCompare();
  }

  private parseCompare(): Ast {
    const left = this.parseAdd();
    const t = this.peek();
    if (t && t.t === 'op' && ['>', '<', '>=', '<=', '=', '!='].includes(t.v)) {
      this.next();
      const right = this.parseAdd();
      return { type: 'compare', op: t.v as '>' | '<' | '>=' | '<=' | '=' | '!=', left, right };
    }
    return left;
  }

  private parseAdd(): Ast {
    let left = this.parseMul();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.next() as { t: 'op'; v: '+' | '-' }).v;
      const right = this.parseMul();
      left = { type: 'arith', op, left, right };
    }
    return left;
  }

  private parseMul(): Ast {
    let left = this.parseUnary();
    while (this.isOp('*') || this.isOp('/')) {
      const op = (this.next() as { t: 'op'; v: '*' | '/' }).v;
      const right = this.parseUnary();
      left = { type: 'arith', op, left, right };
    }
    return left;
  }

  private parseUnary(): Ast {
    if (this.isOp('-')) { this.next(); return { type: 'unary', op: '-', operand: this.parseUnary() }; }
    return this.parsePrimary();
  }

  private parsePrimary(): Ast {
    const t = this.next();
    if (!t) throw new ExprError('Expression ended unexpectedly.');
    if (t.t === 'num') return { type: 'num', value: t.v };
    if (t.t === 'str') return { type: 'str', value: t.v };
    if (t.t === 'lparen') {
      const inner = this.parseOr();
      const close = this.next();
      if (!close || close.t !== 'rparen') throw new ExprError('Missing closing parenthesis.');
      return inner;
    }
    if (t.t === 'word') {
      if (['AND', 'OR', 'NOT'].includes(t.v.toUpperCase())) throw new ExprError(`"${t.v}" is an operator, not a value.`);
      const f = resolveField(t.v);
      if (!f) {
        const suggestion = FIELDS.slice(0, 6).map((x) => x.label).join(', ');
        throw new ExprError(`Unknown field "${t.v}". Try one of: ${suggestion}…`);
      }
      return { type: 'field', column: f.column, label: f.label };
    }
    throw new ExprError(`Unexpected token in expression.`);
  }
}

export function parseExpression(src: string): Ast {
  return new Parser(tokenize(src)).parse();
}

// ---- compiler --------------------------------------------------------------

export interface Compiled { sql: string; params: unknown[]; fields: string[] }

function collectFields(ast: Ast, acc: Set<string>): void {
  switch (ast.type) {
    case 'field': acc.add(ast.column); break;
    case 'unary': collectFields(ast.operand, acc); break;
    case 'binary': collectFields(ast.left, acc); collectFields(ast.right, acc); break;
    case 'compare': collectFields(ast.left, acc); collectFields(ast.right, acc); break;
    case 'arith': collectFields(ast.left, acc); collectFields(ast.right, acc); break;
    default: break;
  }
}

function isBooleanNode(ast: Ast): boolean {
  return ast.type === 'binary' || ast.type === 'compare' || (ast.type === 'unary' && ast.op === 'NOT');
}

function compileNode(ast: Ast, params: unknown[]): string {
  switch (ast.type) {
    case 'num': params.push(ast.value); return '?';
    case 'str': params.push(ast.value); return '?';
    case 'field': return ast.column;
    case 'unary':
      if (ast.op === 'NOT') {
        if (!isBooleanNode(ast.operand)) throw new ExprError('NOT must be followed by a condition.');
        return `(NOT ${compileNode(ast.operand, params)})`;
      }
      return `(-${compileNode(ast.operand, params)})`;
    case 'binary':
      return `(${compileNode(ast.left, params)} ${ast.op} ${compileNode(ast.right, params)})`;
    case 'compare': {
      // Guard: comparing a text field with a number is a user error worth naming.
      const textSide = [ast.left, ast.right].find((n) => n.type === 'field' && BY_COLUMN.get(n.column)?.kind === 'text');
      if (textSide && textSide.type === 'field') {
        const other = textSide === ast.left ? ast.right : ast.left;
        if (other.type !== 'str') throw new ExprError(`"${textSide.label}" is text — compare it with a quoted value, e.g. Sector = "IT".`);
        if (!['=', '!='].includes(ast.op)) throw new ExprError(`"${textSide.label}" only supports = and !=.`);
      }
      return `(${compileNode(ast.left, params)} ${ast.op} ${compileNode(ast.right, params)})`;
    }
    case 'arith':
      if (ast.op === '/') return `(${compileNode(ast.left, params)} / NULLIF(${compileNode(ast.right, params)}, 0))`;
      return `(${compileNode(ast.left, params)} ${ast.op} ${compileNode(ast.right, params)})`;
    default: throw new ExprError('Unsupported expression.');
  }
}

/** Compile a user expression into a SQL boolean expression over `v_latest`. */
export function compileExpression(src: string): Compiled {
  const ast = parseExpression(src);
  if (!isBooleanNode(ast)) throw new ExprError('The expression must be a condition, e.g. "ROE > 15".');
  const params: unknown[] = [];
  const sql = compileNode(ast, params);
  const fields = new Set<string>();
  collectFields(ast, fields);
  return { sql, params, fields: [...fields] };
}

/** Human-readable echo of a parsed expression (used in the UI and logs). */
export function describeAst(ast: Ast): string {
  switch (ast.type) {
    case 'num': return String(ast.value);
    case 'str': return `"${ast.value}"`;
    case 'field': return ast.label;
    case 'unary': return ast.op === 'NOT' ? `NOT (${describeAst(ast.operand)})` : `-${describeAst(ast.operand)}`;
    case 'binary': return `(${describeAst(ast.left)} ${ast.op} ${describeAst(ast.right)})`;
    case 'compare': return `${describeAst(ast.left)} ${ast.op} ${describeAst(ast.right)}`;
    case 'arith': return `${describeAst(ast.left)} ${ast.op} ${describeAst(ast.right)}`;
    default: return '';
  }
}
