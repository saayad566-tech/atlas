// Pre-listing (pre-IPO) discovery.
//
// Companies that have filed but do not trade yet. Three phases, per the standard
// approach: FILED (S-1/F-1 submitted), PRICED (ticker and offer set), SECONDARY
// (private-market indicative pricing).
//
// The network sources (data.sec.gov, IPO calendar APIs) are not reachable from every
// environment, so the fetcher is injected: the parsing and storage here are real and
// tested against the sources' actual payload shapes, and the caller decides where the
// bytes come from.
import type { Database as DB } from 'better-sqlite3';

export type PreListingStatus = 'FILED' | 'PRICED' | 'WITHDRAWN' | 'GRADUATED';

export interface PreListingCompany {
  cik: string;
  name: string;
  formType: string;
  filedAt: string;
  status: PreListingStatus;
  ticker: string | null;
  exchange: string | null;
  priceLow: number | null;
  priceHigh: number | null;
  shares: number | null;
  source: string;
}

export const PRELISTING_DDL = `
CREATE TABLE IF NOT EXISTS prelisting (
  cik TEXT NOT NULL, market TEXT NOT NULL, name TEXT NOT NULL, form_type TEXT NOT NULL,
  filed_at TEXT NOT NULL, status TEXT NOT NULL, ticker TEXT, exchange TEXT,
  price_low REAL, price_high REAL, shares REAL, source TEXT NOT NULL,
  first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  PRIMARY KEY (market, cik, form_type, filed_at)
);
CREATE INDEX IF NOT EXISTS idx_prelisting_status ON prelisting(market, status, filed_at DESC);
`;

export function ensurePreListing(db: DB): void { db.exec(PRELISTING_DDL); }

/** Forms that signal an intent to list. */
const LISTING_FORMS = new Set(['S-1', 'S-1/A', 'S-1MEF', 'F-1', 'F-1/A', 'DRS', 'DRS/A', '10-12B', '10-12G']);

/**
 * Parse the SEC submissions feed. Real shape:
 * { cik, name, filings: { recent: { form: [], filingDate: [], accessionNumber: [], primaryDocDescription: [] } } }
 */
export function parseEdgarSubmissions(json: unknown): PreListingCompany[] {
  const j = json as {
    cik?: string; name?: string;
    filings?: { recent?: { form?: string[]; filingDate?: string[]; accessionNumber?: string[] } };
  } | null;
  const recent = j?.filings?.recent;
  if (!j || !recent || !Array.isArray(recent.form)) return [];
  const out: PreListingCompany[] = [];
  const n = recent.form.length;
  for (let i = 0; i < n; i++) {
    const form = String(recent.form[i] ?? '').trim().toUpperCase();
    if (!LISTING_FORMS.has(form)) continue;
    const filedAt = String(recent.filingDate?.[i] ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filedAt)) continue;
    // An amendment means the process is live; a base registration is the first signal.
    out.push({
      cik: String(j.cik ?? '').padStart(10, '0'),
      name: String(j.name ?? '').trim() || 'Unknown filer',
      formType: form,
      filedAt,
      status: 'FILED',
      ticker: null, exchange: null, priceLow: null, priceHigh: null, shares: null,
      source: 'sec-edgar',
    });
  }
  return out;
}

/**
 * Normalise an IPO calendar payload. Accepts the common shapes:
 *   [{ symbol, name, exchange, date, price_range, status, ... }]   (FMP / Ninjas)
 */
export function parseIpoCalendar(json: unknown): PreListingCompany[] {
  const arr = Array.isArray(json) ? json : ((json as { data?: unknown[] } | null)?.data ?? []);
  if (!Array.isArray(arr)) return [];
  const out: PreListingCompany[] = [];
  for (const raw of arr) {
    const r = raw as Record<string, unknown>;
    const symbol = String(r['symbol'] ?? r['ticker'] ?? '').trim();
    const name = String(r['name'] ?? r['company'] ?? '').trim();
    if (!name && !symbol) continue;
    const dateRaw = String(r['date'] ?? r['expected_date'] ?? r['ipoDate'] ?? '');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : new Date().toISOString().slice(0, 10);
    const statusRaw = String(r['status'] ?? '').toLowerCase();
    const status: PreListingStatus = /withdrawn|cancel/.test(statusRaw) ? 'WITHDRAWN'
      : /priced/.test(statusRaw) || symbol ? 'PRICED' : 'FILED';
    // Price range arrives as "18.00-21.00" or separate low/high fields.
    let low: number | null = null; let high: number | null = null;
    const range = String(r['price_range'] ?? r['priceRange'] ?? '');
    const m = /([\d.]+)\s*[-–]\s*([\d.]+)/.exec(range);
    if (m) { low = Number(m[1]); high = Number(m[2]); }
    if (typeof r['price_low'] === 'number') low = r['price_low'];
    if (typeof r['price_high'] === 'number') high = r['price_high'];
    const shares = typeof r['shares'] === 'number' ? r['shares']
      : typeof r['offer_shares'] === 'number' ? r['offer_shares'] : null;
    out.push({
      cik: String(r['cik'] ?? symbol ?? name).slice(0, 40),
      name: name || symbol,
      formType: String(r['form'] ?? 'IPO'),
      filedAt: date,
      status,
      ticker: symbol || null,
      exchange: String(r['exchange'] ?? '') || null,
      priceLow: low, priceHigh: high, shares,
      source: 'ipo-calendar',
    });
  }
  return out;
}

export function storePreListing(db: DB, market: string, items: PreListingCompany[]): { inserted: number; updated: number } {
  ensurePreListing(db);
  const now = Date.now();
  const ins = db.prepare(`
    INSERT INTO prelisting (cik,market,name,form_type,filed_at,status,ticker,exchange,price_low,price_high,shares,source,first_seen,last_seen)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(market,cik,form_type,filed_at) DO UPDATE SET
      status=excluded.status, ticker=COALESCE(excluded.ticker,prelisting.ticker),
      exchange=COALESCE(excluded.exchange,prelisting.exchange),
      price_low=COALESCE(excluded.price_low,prelisting.price_low),
      price_high=COALESCE(excluded.price_high,prelisting.price_high),
      shares=COALESCE(excluded.shares,prelisting.shares),
      last_seen=excluded.last_seen`);
  let inserted = 0; let updated = 0;
  for (const it of items) {
    const before = db.prepare(`SELECT 1 AS x FROM prelisting WHERE market=? AND cik=? AND form_type=? AND filed_at=?`).get(market, it.cik, it.formType, it.filedAt);
    ins.run(it.cik, market, it.name, it.formType, it.filedAt, it.status, it.ticker, it.exchange, it.priceLow, it.priceHigh, it.shares, it.source, now, now);
    if (before) updated++; else inserted++;
  }
  return { inserted, updated };
}

export interface PreListingRow extends PreListingCompany { firstSeen: number; lastSeen: number }

export function listPreListing(db: DB, market: string, status?: PreListingStatus, limit = 100): PreListingRow[] {
  try {
    ensurePreListing(db);
    const rows = (status
      ? db.prepare(`SELECT * FROM prelisting WHERE market=? AND status=? ORDER BY filed_at DESC LIMIT ?`).all(market, status, limit)
      : db.prepare(`SELECT * FROM prelisting WHERE market=? ORDER BY filed_at DESC LIMIT ?`).all(market, limit)) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      cik: String(r['cik']), name: String(r['name']), formType: String(r['form_type']),
      filedAt: String(r['filed_at']), status: String(r['status']) as PreListingStatus,
      ticker: r['ticker'] ? String(r['ticker']) : null,
      exchange: r['exchange'] ? String(r['exchange']) : null,
      priceLow: r['price_low'] === null ? null : Number(r['price_low']),
      priceHigh: r['price_high'] === null ? null : Number(r['price_high']),
      shares: r['shares'] === null ? null : Number(r['shares']),
      source: String(r['source']),
      firstSeen: Number(r['first_seen']), lastSeen: Number(r['last_seen']),
    }));
  } catch { return []; }
}

export function preListingSummary(db: DB, market: string): { filed: number; priced: number; withdrawn: number; newest: string | null } {
  try {
    ensurePreListing(db);
    const g = (st: string): number => Number((db.prepare(`SELECT COUNT(*) AS n FROM prelisting WHERE market=? AND status=?`).get(market, st) as { n: number }).n);
    const newest = (db.prepare(`SELECT MAX(filed_at) AS d FROM prelisting WHERE market=?`).get(market) as { d: string | null }).d;
    return { filed: g('FILED'), priced: g('PRICED'), withdrawn: g('WITHDRAWN'), newest };
  } catch { return { filed: 0, priced: 0, withdrawn: 0, newest: null }; }
}


/**
 * A priced listing that now trades has graduated. Call after a directory or company
 * refresh: any PRICED row whose ticker is now present as a live company moves to
 * GRADUATED, so the pre-listing list only shows what is genuinely still upcoming.
 */
export function graduateListed(db: DB, market: string): number {
  try {
    ensurePreListing(db);
    const r = db.prepare(`
      UPDATE prelisting SET status='GRADUATED', last_seen=?
      WHERE market=? AND status='PRICED' AND ticker IS NOT NULL
        AND UPPER(ticker) IN (SELECT UPPER(symbol) FROM companies)`).run(Date.now(), market);
    return r.changes;
  } catch { return 0; }
}
