// Strategy library and the visual condition builder.
//
// The library stores backtest configurations so a rule can be re-run rather than
// re-typed. The builder compiles a list of conditions into the expression language, so a
// user can assemble a screen without learning the syntax — and can see the expression it
// produced, which keeps the builder honest.
import type { Database as DB } from 'better-sqlite3';
import { resolveField } from './expr';

export const STRATEGY_DDL = `
CREATE TABLE IF NOT EXISTS strategies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  market TEXT NOT NULL,
  lookback_days INTEGER NOT NULL,
  top_n INTEGER NOT NULL,
  rebalance_days INTEGER NOT NULL,
  cost_pct REAL NOT NULL,
  last_return_pct REAL,
  last_benchmark_pct REAL,
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(name, market)
);
`;

export interface Strategy {
  id: number; name: string; market: string;
  lookbackDays: number; topN: number; rebalanceDays: number; costPct: number;
  lastReturnPct: number | null; lastBenchmarkPct: number | null;
  note: string | null; createdAt: string;
}

export function ensureStrategies(db: DB): void { db.exec(STRATEGY_DDL); }

export function listStrategies(db: DB, market: string): Strategy[] {
  ensureStrategies(db);
  return (db.prepare(`SELECT * FROM strategies WHERE market=? ORDER BY created_at DESC`).all(market) as Array<Record<string, unknown>>)
    .map((r) => ({
      id: Number(r['id']), name: String(r['name']), market: String(r['market']),
      lookbackDays: Number(r['lookback_days']), topN: Number(r['top_n']),
      rebalanceDays: Number(r['rebalance_days']), costPct: Number(r['cost_pct']),
      lastReturnPct: r['last_return_pct'] === null ? null : Number(r['last_return_pct']),
      lastBenchmarkPct: r['last_benchmark_pct'] === null ? null : Number(r['last_benchmark_pct']),
      note: r['note'] ? String(r['note']) : null, createdAt: String(r['created_at']),
    }));
}

export function saveStrategy(db: DB, s: {
  name: string; market: string; lookbackDays: number; topN: number;
  rebalanceDays: number; costPct: number; note?: string;
}): number {
  ensureStrategies(db);
  const name = s.name.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,40}$/.test(name)) throw new Error('Name must start with a letter or digit and be under 41 characters');
  const existing = db.prepare(`SELECT id FROM strategies WHERE name=? AND market=?`).get(name, s.market) as { id: number } | undefined;
  if (existing) {
    db.prepare(`UPDATE strategies SET lookback_days=?, top_n=?, rebalance_days=?, cost_pct=?, note=? WHERE id=?`)
      .run(Math.round(s.lookbackDays), Math.round(s.topN), Math.round(s.rebalanceDays), s.costPct, s.note ?? null, existing.id);
    return existing.id;
  }
  const info = db.prepare(`INSERT INTO strategies (name,market,lookback_days,top_n,rebalance_days,cost_pct,note,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(name, s.market, Math.round(s.lookbackDays), Math.round(s.topN), Math.round(s.rebalanceDays), s.costPct, s.note ?? null, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

/** Remember the result of the last run so the library shows performance, not just settings. */
export function recordStrategyResult(db: DB, id: number, returnPct: number, benchmarkPct: number): boolean {
  ensureStrategies(db);
  return db.prepare(`UPDATE strategies SET last_return_pct=?, last_benchmark_pct=? WHERE id=?`)
    .run(returnPct, benchmarkPct, id).changes > 0;
}

export function deleteStrategy(db: DB, id: number): boolean {
  ensureStrategies(db);
  return db.prepare(`DELETE FROM strategies WHERE id=?`).run(id).changes > 0;
}

// ---------------------------------------------------------------------------
// Visual condition builder → expression
// ---------------------------------------------------------------------------
export type ConditionOp = '>' | '>=' | '<' | '<=' | '=' | '!=';
export interface Condition { field: string; op: ConditionOp; value: number }

const OPS: ConditionOp[] = ['>', '>=', '<', '<=', '=', '!='];

/**
 * Compile a list of conditions into a screen expression.
 * Every field is validated against the known schema, so the builder cannot emit an
 * expression the engine will reject.
 */
export function compileConditions(conditions: Condition[], join: 'AND' | 'OR' = 'AND'): { ok: boolean; expression: string; error: string | null; fields: string[] } {
  if (!conditions.length) return { ok: false, expression: '', error: 'Add at least one condition.', fields: [] };
  const parts: string[] = [];
  const fields: string[] = [];
  for (const c of conditions) {
    const def = resolveField(c.field);
    if (!def) return { ok: false, expression: '', error: `Unknown field "${c.field}".`, fields };
    if (def.kind !== 'number') return { ok: false, expression: '', error: `"${c.field}" is text, not a number.`, fields };
    if (!OPS.includes(c.op)) return { ok: false, expression: '', error: `Unknown operator "${c.op}".`, fields };
    if (!Number.isFinite(c.value)) return { ok: false, expression: '', error: `"${c.field}" needs a numeric value.`, fields };
    fields.push(def.label);
    parts.push(`${def.label} ${c.op} ${c.value}`);
  }
  return { ok: true, expression: parts.join(` ${join} `), error: null, fields };
}
