// Live universe: turn a Yahoo lookup into a first-class company in the local DB.
//
// Nothing here depends on a fixed list. A user searches, we fetch, and the company
// is stored with source 'yahoo' — screenable, searchable, and refreshable.
import type { Database as DB } from 'better-sqlite3';
import { refreshLatestFor } from './db';
import type { QuoteSummary, PricePoint } from './yahoo';
import { ensureProfiles } from './profile';

export const LIVE_DDL = `
CREATE TABLE IF NOT EXISTS price_history (
  company_id INTEGER NOT NULL, date TEXT NOT NULL, close REAL NOT NULL,
  open REAL, high REAL, low REAL, volume REAL,
  PRIMARY KEY (company_id, date)
);
CREATE TABLE IF NOT EXISTS live_meta (
  company_id INTEGER PRIMARY KEY, exchange TEXT, currency TEXT, beta REAL,
  week52_high REAL, week52_low REAL, target_mean REAL, recommendation TEXT,
  revenue_growth REAL, gross_margin REAL, operating_margin REAL, profit_margin REAL,
  roe_y REAL, roa_y REAL, debt_to_equity_y REAL, current_ratio_y REAL,
  free_cashflow REAL, total_cash REAL, total_debt REAL, employees INTEGER,
  country TEXT, website TEXT, fetched_at INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'yahoo'
);
CREATE INDEX IF NOT EXISTS idx_price_company ON price_history(company_id, date DESC);
-- Covering index: lets the universe median read only the index instead of every row.
CREATE INDEX IF NOT EXISTS idx_price_cover ON price_history(company_id, date DESC, close);
`;

export function ensureLiveTables(db: DB): void {
  db.exec(LIVE_DDL);
  // Databases created before OHLCV existed need the columns added in place.
  const cols = db.prepare('PRAGMA table_info(price_history)').all() as Array<{ name: string }>;
  const have = new Set(cols.map((c) => c.name));
  for (const c of ['open', 'high', 'low', 'volume']) {
    if (!have.has(c)) { try { db.exec(`ALTER TABLE price_history ADD COLUMN ${c} REAL`); } catch { /* already there */ } }
  }
  // price_history is created here, so its index belongs here too.
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_price_date ON price_history(company_id, date)`); } catch { /* older db */ }
}

/** Yahoo reports ratios as fractions (0.148 = 14.8%) and debt/equity as a percent. */
const pct = (v: number): number => Math.round(v * 1000) / 10;

export interface UpsertResult { symbol: string; created: boolean; companyId: number }

/** Create or update a company from a live summary. Idempotent on symbol. */
export function upsertLiveCompany(db: DB, q: QuoteSummary): UpsertResult {
  ensureLiveTables(db);
  const existing = db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(q.symbol) as { id: number } | undefined;
  const now = Date.now();
  let id: number;
  let created = false;
  if (existing) {
    id = existing.id;
    db.prepare(`UPDATE companies SET name=?, sector=?, industry=?, currency=?, source='yahoo', updated_at=? WHERE id=?`)
      .run(q.name, q.sector, q.industry, q.currency || 'USD', now, id);
  } else {
    id = (db.prepare(`SELECT COALESCE(MAX(id),0)+1 AS n FROM companies`).get() as { n: number }).n;
    db.prepare(`INSERT INTO companies (id,symbol,name,sector,industry,currency,source,listed_on,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, q.symbol, q.name, q.sector, q.industry, q.currency || 'USD', 'yahoo', q.exchange || 'LIVE', now);
    created = true;
  }

  // Latest snapshot as a ratios row so the company appears in v_latest and screens.
  const periodEnd = new Date(now).toISOString().slice(0, 10);
  const de = q.debtToEquity > 0 ? (q.debtToEquity > 10 ? q.debtToEquity / 100 : q.debtToEquity) : 0;
  db.prepare(`INSERT OR REPLACE INTO ratios
    (company_id,period_type,period_end,roe,roce,debt_to_equity,opm,npm,pe,pb,dividend_yield,market_cap,current_ratio,interest_coverage,asset_turnover,sales_growth_3y,profit_growth_3y)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, 'annual', periodEnd, pct(q.returnOnEquity), 0, de, pct(q.operatingMargins), pct(q.profitMargins),
      q.pe, q.pb, pct(q.dividendYield), Math.round(q.marketCap / 1e7), q.currentRatio, 0, 0, pct(q.revenueGrowth), pct(q.earningsGrowth));

  db.prepare(`INSERT OR REPLACE INTO quotes (company_id,price,market_cap,pe,updated_at) VALUES (?,?,?,?,?)`)
    .run(id, q.price, Math.round(q.marketCap / 1e7), q.pe, now);

  db.prepare(`INSERT OR REPLACE INTO live_meta
    (company_id,exchange,currency,beta,week52_high,week52_low,target_mean,recommendation,revenue_growth,gross_margin,
     operating_margin,profit_margin,roe_y,roa_y,debt_to_equity_y,current_ratio_y,free_cashflow,total_cash,total_debt,employees,country,website,fetched_at,source)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, q.exchange, q.currency, q.beta, q.week52High, q.week52Low, q.targetMeanPrice, q.recommendation,
      pct(q.revenueGrowth), pct(q.grossMargins), pct(q.operatingMargins), pct(q.profitMargins),
      pct(q.returnOnEquity), pct(q.returnOnAssets), de, q.currentRatio, q.freeCashflow, q.totalCash, q.totalDebt,
      q.employees, q.country, q.website, now, 'yahoo');

  // Profile text (description, HQ, website) so the intelligence tabs have content.
  ensureProfiles(db);
  db.prepare(`INSERT INTO company_profiles (company_id, description, hq_city, hq_country, employees, website, business_model, source, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(company_id) DO UPDATE SET description=excluded.description, hq_country=excluded.hq_country,
      employees=excluded.employees, website=excluded.website, source='yahoo', updated_at=excluded.updated_at`)
    .run(id, q.description || `${q.name} is listed on ${q.exchange || 'an exchange'}.`, '', q.country || '',
      q.employees ?? null, q.website || '', q.sector, 'yahoo', now);

  // Quotes feed v_latest (price, market cap) — refresh this company's row.
  try { refreshLatestFor(db, id); } catch { /* metrics table not ready */ }
  return { symbol: q.symbol, created, companyId: id };
}

/** Replace the stored price history for a company. */
export function storePrices(db: DB, symbol: string, points: PricePoint[]): number {
  ensureLiveTables(db);
  const c = db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
  if (!c || points.length === 0) return 0;
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM price_history WHERE company_id=?`).run(c.id);
    const ins = db.prepare(`INSERT OR REPLACE INTO price_history (company_id,date,close,open,high,low,volume) VALUES (?,?,?,?,?,?,?)`);
    for (const p of points) {
      ins.run(c.id, p.date, p.close, p.open ?? p.close, p.high ?? p.close, p.low ?? p.close, p.volume ?? 0);
    }
  });
  tx();
  return points.length;
}

export interface PriceAnalytics {
  symbol: string;
  points: number;
  last: number | null;
  first: number | null;
  returns: { m1: number | null; m3: number | null; m6: number | null; y1: number | null };
  volatilityPct: number | null;
  maxDrawdownPct: number | null;
  week52: { high: number | null; low: number | null; positionPct: number | null };
  momentum12_1: number | null;
  sparkline: number[];
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Price-based analytics from stored history (no network). */
export function priceAnalytics(db: DB, symbol: string): PriceAnalytics | null {
  ensureLiveTables(db);
  const c = db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
  if (!c) return null;
  const rows = db.prepare(`SELECT date, close FROM price_history WHERE company_id=? ORDER BY date ASC`).all(c.id) as Array<{ date: string; close: number }>;
  if (rows.length === 0) {
    return { symbol, points: 0, last: null, first: null, returns: { m1: null, m3: null, m6: null, y1: null }, volatilityPct: null, maxDrawdownPct: null, week52: { high: null, low: null, positionPct: null }, momentum12_1: null, sparkline: [] };
  }
  const closes = rows.map((r) => r.close);
  const last = closes[closes.length - 1]!;
  // Horizon returns are DATE-based, not index-based: a trading year is ~250 sessions
  // (holidays), so "252 rows back" would be null for a one-year series.
  const lastTs = Date.parse(rows[rows.length - 1]!.date);
  const closeAt = (daysAgo: number): number | null => {
    const target = lastTs - daysAgo * 86400000;
    let best: number | null = null;
    for (const r of rows) { if (Date.parse(r.date) <= target) best = r.close; else break; }
    return best;
  };
  const spanDays = (lastTs - Date.parse(rows[0]!.date)) / 86400000;
  const ret = (daysAgo: number): number | null => {
    // If the series starts slightly inside the horizon (a "1y" chart is ~364 days),
    // use its first point rather than reporting nothing.
    const b = closeAt(daysAgo) ?? (spanDays >= daysAgo * 0.9 ? rows[0]!.close : null);
    return b !== null && b > 0 ? r2(((last / b) - 1) * 100) : null;
  };

  const daily: number[] = [];
  for (let i = 1; i < closes.length; i++) { const a = closes[i - 1]!; if (a > 0) daily.push(closes[i]! / a - 1); }
  const mean = daily.reduce((x, y) => x + y, 0) / (daily.length || 1);
  const variance = daily.reduce((acc, d) => acc + (d - mean) ** 2, 0) / (daily.length || 1);
  const volatilityPct = daily.length > 5 ? r2(Math.sqrt(variance) * Math.sqrt(252) * 100) : null;

  let peak = closes[0]!; let maxDd = 0;
  for (const c2 of closes) { if (c2 > peak) peak = c2; const dd = (c2 / peak - 1) * 100; if (dd < maxDd) maxDd = dd; }

  const window = closes.slice(-252);
  const high = Math.max(...window); const low = Math.min(...window);
  const positionPct = high > low ? r2(((last - low) / (high - low)) * 100) : null;

  // 12-1 momentum: return from ~252 sessions ago to ~21 sessions ago.
  const startIdx = Math.max(0, closes.length - 252);
  const endIdx = Math.max(0, closes.length - 21);
  const momentum = closes[endIdx] && closes[startIdx] && closes[startIdx]! > 0 && endIdx > startIdx
    ? r2(((closes[endIdx]! / closes[startIdx]!) - 1) * 100) : null;

  const sparkline = closes.length > 60 ? closes.filter((_, i) => i % Math.ceil(closes.length / 60) === 0).slice(-60) : closes;

  return {
    symbol, points: closes.length, last: r2(last), first: r2(closes[0]!),
    returns: { m1: ret(30), m3: ret(91), m6: ret(182), y1: ret(365) },
    volatilityPct, maxDrawdownPct: r2(maxDd),
    week52: { high: r2(high), low: r2(low), positionPct },
    momentum12_1: momentum, sparkline,
  };
}

/** Market breadth over the locally stored universe. */
export function marketBreadth(db: DB): { companies: number; above52wLowPct: number; positiveMomentumPct: number; medianDrawdownPct: number; withPrices: number } {
  ensureLiveTables(db);
  const companies = (db.prepare(`SELECT COUNT(*) AS n FROM companies`).get() as { n: number }).n;
  const ids = db.prepare(`SELECT DISTINCT company_id FROM price_history`).all() as Array<{ company_id: number }>;
  let above = 0; let positive = 0; const dds: number[] = [];
  for (const row of ids) {
    const sym = (db.prepare(`SELECT symbol FROM companies WHERE id=?`).get(row.company_id) as { symbol: string } | undefined)?.symbol;
    if (!sym) continue;
    const a = priceAnalytics(db, sym);
    if (!a || a.last === null || a.week52.low === null) continue;
    if (a.last > a.week52.low) above++;
    if ((a.momentum12_1 ?? 0) > 0) positive++;
    if (a.maxDrawdownPct !== null) dds.push(a.maxDrawdownPct);
  }
  dds.sort((x, y) => x - y);
  return {
    companies, withPrices: ids.length,
    above52wLowPct: ids.length ? r2((above / ids.length) * 100) : 0,
    positiveMomentumPct: ids.length ? r2((positive / ids.length) * 100) : 0,
    medianDrawdownPct: dds.length ? r2(dds[Math.floor(dds.length / 2)]!) : 0,
  };
}

/** Companies fetched from the live source, newest first. */
export function liveCompanies(db: DB, limit = 50): Array<{ symbol: string; name: string; sector: string; exchange: string; currency: string; price: number; marketCap: number; fetchedAt: number }> {
  ensureLiveTables(db);
  return (db.prepare(`
    SELECT c.symbol, c.name, c.sector, m.exchange, m.currency, q.price, q.market_cap AS marketCap, m.fetched_at AS fetchedAt
    FROM live_meta m JOIN companies c ON c.id=m.company_id LEFT JOIN quotes q ON q.company_id=c.id
    ORDER BY m.fetched_at DESC LIMIT ?`).all(limit) as Array<Record<string, unknown>>).map((r) => ({
      symbol: String(r['symbol']), name: String(r['name']), sector: String(r['sector']),
      exchange: String(r['exchange'] ?? ''), currency: String(r['currency'] ?? ''),
      price: Number(r['price'] ?? 0), marketCap: Number(r['marketCap'] ?? 0), fetchedAt: Number(r['fetchedAt'] ?? 0),
    }));
}
