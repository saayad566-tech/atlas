// SQLite schema for Sift.
//
// Why SQLite over DuckDB: one file, WAL, zero extra native dependency beyond
// better-sqlite3 (already proven), and comfortably fast for thousands of companies
// at 10 years of history. DuckDB is a documented alternative (docs/ARCHITECTURE.md)
// for heavier analytical scans; the query layer is plain SQL either way.
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

export const SCHEMA_VERSION = 3;

export const DDL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY,
  symbol TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sector TEXT NOT NULL DEFAULT 'Unclassified',
  industry TEXT NOT NULL DEFAULT 'Unclassified',
  currency TEXT NOT NULL DEFAULT 'INR',
  source TEXT NOT NULL DEFAULT 'fixture',
  listed_on TEXT NOT NULL DEFAULT 'NSE',
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_companies_sector ON companies(sector);

CREATE TABLE IF NOT EXISTS statements (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_type TEXT NOT NULL CHECK (period_type IN ('annual','quarterly')),
  period_end TEXT NOT NULL,
  fiscal_year INTEGER NOT NULL,
  quarter INTEGER,
  sales REAL NOT NULL DEFAULT 0,
  expenses REAL NOT NULL DEFAULT 0,
  operating_profit REAL NOT NULL DEFAULT 0,
  opm_pct REAL NOT NULL DEFAULT 0,
  other_income REAL NOT NULL DEFAULT 0,
  interest REAL NOT NULL DEFAULT 0,
  depreciation REAL NOT NULL DEFAULT 0,
  profit_before_tax REAL NOT NULL DEFAULT 0,
  tax_pct REAL NOT NULL DEFAULT 0,
  net_profit REAL NOT NULL DEFAULT 0,
  eps REAL NOT NULL DEFAULT 0,
  equity_capital REAL NOT NULL DEFAULT 0,
  reserves REAL NOT NULL DEFAULT 0,
  borrowings REAL NOT NULL DEFAULT 0,
  other_liabilities REAL NOT NULL DEFAULT 0,
  total_liabilities REAL NOT NULL DEFAULT 0,
  fixed_assets REAL NOT NULL DEFAULT 0,
  cwip REAL NOT NULL DEFAULT 0,
  investments REAL NOT NULL DEFAULT 0,
  other_assets REAL NOT NULL DEFAULT 0,
  total_assets REAL NOT NULL DEFAULT 0,
  cfo REAL NOT NULL DEFAULT 0,
  cfi REAL NOT NULL DEFAULT 0,
  cff REAL NOT NULL DEFAULT 0,
  net_cash_flow REAL NOT NULL DEFAULT 0,
  receivables REAL NOT NULL DEFAULT 0,
  inventory REAL NOT NULL DEFAULT 0,
  payables REAL NOT NULL DEFAULT 0,
  cash REAL NOT NULL DEFAULT 0,
  UNIQUE(company_id, period_type, period_end)
);
CREATE INDEX IF NOT EXISTS idx_stmt_company ON statements(company_id, period_type, period_end DESC);

CREATE TABLE IF NOT EXISTS ratios (
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_type TEXT NOT NULL,
  period_end TEXT NOT NULL,
  roe REAL NOT NULL DEFAULT 0,
  roce REAL NOT NULL DEFAULT 0,
  debt_to_equity REAL NOT NULL DEFAULT 0,
  opm REAL NOT NULL DEFAULT 0,
  npm REAL NOT NULL DEFAULT 0,
  pe REAL NOT NULL DEFAULT 0,
  pb REAL NOT NULL DEFAULT 0,
  dividend_yield REAL NOT NULL DEFAULT 0,
  market_cap REAL NOT NULL DEFAULT 0,
  current_ratio REAL NOT NULL DEFAULT 0,
  interest_coverage REAL NOT NULL DEFAULT 0,
  asset_turnover REAL NOT NULL DEFAULT 0,
  sales_growth_3y REAL NOT NULL DEFAULT 0,
  profit_growth_3y REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, period_type, period_end)
);
CREATE INDEX IF NOT EXISTS idx_ratios_company ON ratios(company_id, period_type, period_end DESC);

CREATE TABLE IF NOT EXISTS shareholding (
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_end TEXT NOT NULL,
  promoter REAL NOT NULL DEFAULT 0,
  fii REAL NOT NULL DEFAULT 0,
  dii REAL NOT NULL DEFAULT 0,
  public REAL NOT NULL DEFAULT 0,
  pledge_pct REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, period_end)
);

CREATE TABLE IF NOT EXISTS peers (
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  peer_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, peer_id)
);

CREATE TABLE IF NOT EXISTS quotes (
  company_id INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  price REAL NOT NULL DEFAULT 0,
  market_cap REAL NOT NULL DEFAULT 0,
  pe REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- Flat snapshot used by the screener. One row per company, latest annual figures.
DROP VIEW IF EXISTS v_latest;
-- v_latest was a VIEW: every screen recomputed the joins, costing 1.8 ms at 200 companies
-- and 16.9 ms at 2,000. It is now a materialised table refreshed after writes, with a
-- view of the same name so no query had to change.
CREATE TABLE IF NOT EXISTS latest_metrics (
  id INTEGER PRIMARY KEY, symbol TEXT, name TEXT, sector TEXT, industry TEXT, source TEXT,
  market_cap REAL, price REAL, pe REAL, pb REAL, roe REAL, roce REAL, debt_to_equity REAL,
  sales REAL, expenses REAL, operating_profit REAL, interest REAL, depreciation REAL,
  cfo REAL, cash REAL, net_profit REAL, opm REAL, npm REAL, eps REAL, dividend_yield REAL,
  promoter_holding REAL, pledge REAL, current_ratio REAL, interest_coverage REAL,
  sales_growth_3y REAL, profit_growth_3y REAL, asset_turnover REAL
);

CREATE VIEW IF NOT EXISTS v_latest AS SELECT * FROM latest_metrics;

-- The SELECT that fills it (kept identical to the old view body).
INSERT INTO latest_metrics
SELECT
  c.id, c.symbol, c.name, c.sector, c.industry, c.source,
  COALESCE(q.market_cap, r.market_cap, 0) AS market_cap,
  COALESCE(q.price, 0) AS price,
  COALESCE(q.pe, r.pe, 0) AS pe,
  COALESCE(r.pb, 0) AS pb,
  COALESCE(r.roe, 0) AS roe,
  COALESCE(r.roce, 0) AS roce,
  COALESCE(r.debt_to_equity, 0) AS debt_to_equity,
  COALESCE(s.sales, 0) AS sales,
  COALESCE(s.expenses, 0) AS expenses,
  COALESCE(s.operating_profit, 0) AS operating_profit,
  COALESCE(s.interest, 0) AS interest,
  COALESCE(s.depreciation, 0) AS depreciation,
  COALESCE(s.cfo, 0) AS cfo,
  COALESCE(s.cash, 0) AS cash,
  COALESCE(s.net_profit, 0) AS net_profit,
  COALESCE(r.opm, 0) AS opm,
  COALESCE(r.npm, 0) AS npm,
  COALESCE(s.eps, 0) AS eps,
  COALESCE(r.dividend_yield, 0) AS dividend_yield,
  COALESCE(sh.promoter, 0) AS promoter_holding,
  COALESCE(sh.pledge_pct, 0) AS pledge,
  COALESCE(r.current_ratio, 0) AS current_ratio,
  COALESCE(r.interest_coverage, 0) AS interest_coverage,
  COALESCE(r.sales_growth_3y, 0) AS sales_growth_3y,
  COALESCE(r.profit_growth_3y, 0) AS profit_growth_3y,
  COALESCE(r.asset_turnover, 0) AS asset_turnover
FROM companies c
LEFT JOIN ratios r ON r.company_id = c.id AND r.period_type = 'annual'
  AND r.period_end = (SELECT MAX(period_end) FROM ratios WHERE company_id = c.id AND period_type = 'annual')
LEFT JOIN statements s ON s.company_id = c.id AND s.period_type = 'annual'
  AND s.period_end = (SELECT MAX(period_end) FROM statements WHERE company_id = c.id AND period_type = 'annual')
LEFT JOIN shareholding sh ON sh.company_id = c.id
  AND sh.period_end = (SELECT MAX(period_end) FROM shareholding WHERE company_id = c.id)
LEFT JOIN quotes q ON q.company_id = c.id
WHERE NOT EXISTS (SELECT 1 FROM latest_metrics lm WHERE lm.id = c.id);

CREATE TABLE IF NOT EXISTS saved_screens (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, expression TEXT NOT NULL,
  created_at INTEGER NOT NULL, last_run_at INTEGER, last_count INTEGER
);
CREATE TABLE IF NOT EXISTS watchlist (
  company_id INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL, note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS notes (
  company_id INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  body TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS prefs (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS valuation_assumptions (
  company_id INTEGER PRIMARY KEY, growth_pct REAL, discount_pct REAL, terminal_pct REAL, years INTEGER,
  target_pe REAL, target_ev_ebitda REAL, payout_pct REAL, weights TEXT, scenario TEXT, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS portfolio (
  company_id INTEGER PRIMARY KEY, quantity REAL NOT NULL, avg_cost REAL NOT NULL,
  bought_at INTEGER NOT NULL, note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS my_ratings (
  company_id INTEGER PRIMARY KEY, rating INTEGER NOT NULL, thesis TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY, metric TEXT NOT NULL, op TEXT NOT NULL, threshold REAL NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS peer_overrides (
  company_id INTEGER NOT NULL, peer_id INTEGER NOT NULL, rank INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, peer_id)
);

CREATE TABLE IF NOT EXISTS macro (
  indicator TEXT NOT NULL, country TEXT NOT NULL, year INTEGER NOT NULL, value REAL NOT NULL,
  fetched_at INTEGER NOT NULL, PRIMARY KEY (indicator, country, year)
);

CREATE VIRTUAL TABLE IF NOT EXISTS companies_fts USING fts5(
  symbol, name, sector, content='companies', content_rowid='id'
);
CREATE TRIGGER IF NOT EXISTS companies_ai AFTER INSERT ON companies BEGIN
  INSERT INTO companies_fts(rowid, symbol, name, sector) VALUES (new.id, new.symbol, new.name, new.sector);
END;
CREATE TRIGGER IF NOT EXISTS companies_ad AFTER DELETE ON companies BEGIN
  INSERT INTO companies_fts(companies_fts, rowid, symbol, name, sector) VALUES ('delete', old.id, old.symbol, old.name, old.sector);
END;
CREATE TRIGGER IF NOT EXISTS companies_au AFTER UPDATE ON companies BEGIN
  INSERT INTO companies_fts(companies_fts, rowid, symbol, name, sector) VALUES ('delete', old.id, old.symbol, old.name, old.sector);
  INSERT INTO companies_fts(rowid, symbol, name, sector) VALUES (new.id, new.symbol, new.name, new.sector);
END;

-- Hot-path indexes for screening and history reads.
CREATE INDEX IF NOT EXISTS idx_ratios_pe ON ratios(pe);
CREATE INDEX IF NOT EXISTS idx_ratios_roe ON ratios(roe);
CREATE INDEX IF NOT EXISTS idx_ratios_period ON ratios(company_id, period_type, period_end);
CREATE INDEX IF NOT EXISTS idx_stmt_period ON statements(company_id, period_type, period_end);
CREATE INDEX IF NOT EXISTS idx_companies_symbol ON companies(symbol);
`;

/** The exact SELECT that fills latest_metrics, extracted from the DDL — never duplicated. */
const LATEST_FILL = /INSERT INTO latest_metrics([\s\S]*?);\n/.exec(DDL)?.[1] ?? '';

/** Refresh ONE company's row — used on every ratio recompute so the table never goes stale. */
export function refreshLatestFor(db: Database.Database, companyId: number): void {
  if (!LATEST_FILL) return;
  db.prepare('DELETE FROM latest_metrics WHERE id = ?').run(companyId);
  // The fill SELECT is company-agnostic; run it filtered by wrapping it.
  db.exec(`INSERT INTO latest_metrics${LATEST_FILL.replace('WHERE NOT EXISTS (SELECT 1 FROM latest_metrics lm WHERE lm.id = c.id)', `WHERE c.id = ${Number(companyId)}`)}`);
}

/** Rebuild the materialised metrics table. Call after any write that changes ratios. */
export function refreshLatest(db: Database.Database): number {
  if (!LATEST_FILL) return 0;
  db.exec('DELETE FROM latest_metrics');
  db.exec(`INSERT INTO latest_metrics${LATEST_FILL}`);
  return (db.prepare('SELECT COUNT(*) AS n FROM latest_metrics').get() as { n: number }).n;
}

export interface Db {
  db: Database.Database;
  file: string;
}

/**
 * Open a database with settings chosen for a single-user device that still has to survive
 * a concurrent writer (a background sync while the UI reads).
 *
 * - WAL lets readers continue while a write is in flight.
 * - busy_timeout makes a second writer WAIT rather than fail with SQLITE_BUSY.
 * - synchronous=NORMAL is the right trade in WAL: durable across app crashes, and the
 *   database cannot be corrupted by an OS crash, only lose the last transaction.
 * - A negative cache_size is kibibytes, so -16000 is ~16 MB of page cache.
 */
/**
 * Indexes that keep the common reads fast. Each one exists for a specific query shape the
 * app actually runs, not speculatively.
 */
const PERF_INDEXES: Array<{ table: string; sql: string }> = [
  { table: 'companies', sql: 'CREATE INDEX IF NOT EXISTS idx_companies_symbol ON companies(symbol)' },
  { table: 'companies', sql: 'CREATE INDEX IF NOT EXISTS idx_companies_sector ON companies(sector)' },
  { table: 'price_history', sql: 'CREATE INDEX IF NOT EXISTS idx_price_company_date ON price_history(company_id, date)' },
  { table: 'price_history', sql: 'CREATE INDEX IF NOT EXISTS idx_price_date ON price_history(date)' },
  { table: 'statements', sql: 'CREATE INDEX IF NOT EXISTS idx_stmt_company_period ON statements(company_id, period_end)' },
  { table: 'ratios', sql: 'CREATE INDEX IF NOT EXISTS idx_ratios_company ON ratios(company_id)' },
  { table: 'universe_symbols', sql: 'CREATE INDEX IF NOT EXISTS idx_universe_market_sector ON universe_symbols(market, sector)' },
  { table: 'universe_symbols', sql: 'CREATE INDEX IF NOT EXISTS idx_universe_symbol ON universe_symbols(symbol)' },
];

/** Create only the indexes whose table exists yet; the rest are made on first use. */
function applyPerfIndexes(db: Database.Database): void {
  const present = new Set(
    (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>).map((r) => r.name),
  );
  for (const ix of PERF_INDEXES) {
    if (!present.has(ix.table)) continue;
    try { db.exec(ix.sql); } catch { /* an index is an optimisation, never a blocker */ }
  }
}

export function openDatabase(file: string): Db {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -16000');
  db.pragma('temp_store = MEMORY');
  db.pragma('foreign_keys = ON');
  try { db.pragma('mmap_size = 134217728'); } catch { /* not supported everywhere */ }
  db.exec(DDL);
  applyPerfIndexes(db);
  db.prepare(`INSERT INTO meta(key,value) VALUES('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(SCHEMA_VERSION));
  return { db, file };
}

/**
 * Run a write, retrying when SQLite reports the database is busy.
 *
 * Two writers can legitimately collide — a background sync and a user action. Rather than
 * surface SQLITE_BUSY to the user, wait briefly and try again, with backoff, and give up
 * only after the budget is spent so a stuck writer cannot hang the app forever.
 */
export function withWriteRetry<T>(fn: () => T, attempts = 6, baseDelayMs = 25): T {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return fn(); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const busy = /SQLITE_BUSY|SQLITE_LOCKED|database is locked/i.test(msg);
      lastErr = e;
      if (!busy) throw e;
      const wait = baseDelayMs * Math.pow(2, i) + Math.floor(Math.random() * 15);
      const until = Date.now() + wait;
      // A deliberate short spin: this is the retry budget, not a background job.
      while (Date.now() < until) { /* wait out the backoff */ }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export function getMeta(db: Database.Database, key: string): string | null {
  const r = db.prepare(`SELECT value FROM meta WHERE key=?`).get(key) as { value?: string } | undefined;
  return r?.value ?? null;
}

export function setMeta(db: Database.Database, key: string, value: string): void {
  db.prepare(`INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, value);
}
