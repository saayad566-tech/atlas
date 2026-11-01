// Second feature batch: quick filters, watchlist table, screen history, notes/ratings.
import type { Database as DB } from 'better-sqlite3';

/** One-click filters users actually want, each a validated expression. */
export const QUICK_FILTERS: Array<{ id: string; label: string; expression: string; why: string }> = [
  { id: 'largecap', label: 'Large cap', expression: 'Market Cap > 20000', why: 'market cap above ₹20,000 Cr' },
  { id: 'midcap', label: 'Mid cap', expression: 'Market Cap > 5000 AND Market Cap < 20000', why: '₹5,000–20,000 Cr' },
  { id: 'smallcap', label: 'Small cap', expression: 'Market Cap > 0 AND Market Cap < 5000', why: 'below ₹5,000 Cr' },
  { id: 'dividend', label: 'Dividend payers', expression: 'Dividend Yield > 2', why: 'yield above 2%' },
  { id: 'growth', label: 'High growth', expression: 'Sales Growth 3Y > 15', why: '3-year sales CAGR above 15%' },
  { id: 'quality', label: 'High quality', expression: 'ROE > 18 AND Debt to Equity < 0.5', why: 'ROE >18% with low debt' },
  { id: 'value', label: 'Cheap', expression: 'P/E < 15 AND P/E > 0', why: 'P/E below 15' },
  { id: 'debtfree', label: 'Debt free', expression: 'Debt to Equity < 0.1', why: 'essentially no borrowings' },
  { id: 'cash', label: 'Cash rich', expression: 'Current Ratio > 2', why: 'current ratio above 2' },
  { id: 'momentum', label: 'Momentum', expression: 'Market Cap > 1000 AND ROE > 12', why: 'profitable and liquid' },
];

/** Watchlist as a metrics table, not just a list of names. */
export function watchlistTable(db: DB): Array<Record<string, unknown>> {
  return db.prepare(`
    SELECT c.symbol, c.name, c.sector,
           ROUND(v.market_cap,0) AS marketCap, ROUND(v.pe,1) AS pe, ROUND(v.roe,1) AS roe,
           ROUND(v.opm,1) AS opm, ROUND(v.debt_to_equity,2) AS debtToEquity,
           ROUND(v.dividend_yield,2) AS dividendYield, w.added_at AS addedAt
    FROM watchlist w JOIN companies c ON c.id = w.company_id
    LEFT JOIN v_latest v ON v.id = c.id
    ORDER BY v.market_cap DESC`).all() as Array<Record<string, unknown>>;
}

export function removeFromWatchlist(db: DB, symbol: string): boolean {
  const row = db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
  if (!row) return false;
  return db.prepare(`DELETE FROM watchlist WHERE company_id=?`).run(row.id).changes > 0;
}

/** Recent screens, recorded server-side so they survive a different browser. */
export function recordScreen(db: DB, expression: string, count: number): void {
  try {
    db.prepare(`CREATE TABLE IF NOT EXISTS screen_history (expression TEXT PRIMARY KEY, last_run_at INTEGER NOT NULL, last_count INTEGER NOT NULL)`).run();
    db.prepare(`INSERT INTO screen_history (expression,last_run_at,last_count) VALUES (?,?,?)
      ON CONFLICT(expression) DO UPDATE SET last_run_at=excluded.last_run_at, last_count=excluded.last_count`).run(expression, Date.now(), count);
  } catch { /* history is best-effort */ }
}

export function screenHistory(db: DB, limit = 10): Array<{ expression: string; lastRunAt: number; lastCount: number }> {
  try {
    return (db.prepare(`SELECT expression, last_run_at AS lastRunAt, last_count AS lastCount FROM screen_history ORDER BY last_run_at DESC LIMIT ?`).all(limit) as Array<Record<string, unknown>>)
      .map((r) => ({ expression: String(r['expression']), lastRunAt: Number(r['lastRunAt']), lastCount: Number(r['lastCount']) }));
  } catch { return []; }
}

/** Company note (one per company) — read and write. */
export function getNote(db: DB, symbol: string): string {
  const row = db.prepare(`SELECT n.body FROM notes n JOIN companies c ON c.id=n.company_id WHERE UPPER(c.symbol)=UPPER(?)`).get(symbol) as { body: string } | undefined;
  return row?.body ?? '';
}

export function setNote(db: DB, symbol: string, body: string): boolean {
  const c = db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
  if (!c) return false;
  db.prepare(`INSERT INTO notes (company_id, body, updated_at) VALUES (?,?,?)
    ON CONFLICT(company_id) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at`).run(c.id, body.slice(0, 20000), Date.now());
  return true;
}

