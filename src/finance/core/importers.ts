// Import framework: every source, every feature, and an honest status for each.
//
// The goal is that no screen is a dead end. For each feature there is at least one
// path that works offline (CSV, JSON, manual, generated) and, where the network
// allows, a live adapter. Sources that cannot be reached from a given environment
// are REPORTED as blocked at runtime rather than silently failing.
import type { Database as DB } from 'better-sqlite3';
import { httpsGetText } from './net';
import { ensureMarketTables } from './marketdata';

export type SourceKind = 'api' | 'rss' | 'file' | 'manual' | 'generated';
export type SourceStatus = 'live' | 'rate-limited' | 'blocked' | 'unreachable' | 'offline-ok';

export interface SourceDef {
  id: string;
  name: string;
  kind: SourceKind;
  /** What this source can fill. */
  provides: string[];
  url: string;
  /** How to probe it without a key. */
  probe?: string;
  note: string;
}

/** Every source researched, with what it would provide if reachable. */
export const SOURCES: SourceDef[] = [
  { id: 'yahoo', name: 'Yahoo Finance', kind: 'api', url: 'https://query1.finance.yahoo.com',
    provides: ['price', 'statements', 'ratios', 'analysts', 'dividends', 'ownership', 'insider-trades', 'estimates', 'calendar', 'splits', 'volume'],
    probe: 'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=5d&interval=1d',
    note: 'Free, unofficial. Prices, fundamentals timeseries, quoteSummary modules. Needs cookie+crumb.' },
  { id: 'yahoo-rss', name: 'Yahoo Finance RSS', kind: 'rss', url: 'https://feeds.finance.yahoo.com/rss/2.0/headline',
    provides: ['news'],
    probe: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=AAPL&region=US&lang=en-US',
    note: 'Per-symbol headlines, no key.' },
  { id: 'google-news', name: 'Google News RSS', kind: 'rss', url: 'https://news.google.com/rss/search',
    provides: ['news'],
    probe: 'https://news.google.com/rss/search?q=reliance&hl=en-IN&gl=IN&ceid=IN:en',
    note: 'Search headlines by company name. Redirects — must follow.' },
  { id: 'wikipedia', name: 'Wikipedia REST', kind: 'api', url: 'https://en.wikipedia.org/api/rest_v1',
    provides: ['description', 'profile'],
    probe: 'https://en.wikipedia.org/api/rest_v1/page/summary/Infosys',
    note: 'Company descriptions and summaries. No key.' },
  { id: 'worldbank', name: 'World Bank', kind: 'api', url: 'https://api.worldbank.org/v2',
    provides: ['macro'],
    probe: 'https://api.worldbank.org/v2/country/IN/indicator/NY.GDP.MKTP.KD.ZG?format=json&per_page=3',
    note: 'GDP, CPI, unemployment, investment by country. No key.' },
  { id: 'sec-edgar', name: 'SEC EDGAR', kind: 'api', url: 'https://data.sec.gov',
    provides: ['statements', 'filings', 'company-universe'],
    probe: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json',
    note: 'Official US filings and the full ticker list. Blocked from this sandbox; works on a normal network.' },
  { id: 'nse', name: 'NSE India', kind: 'api', url: 'https://www.nseindia.com/api',
    provides: ['price', 'shareholding', 'announcements', 'universe'],
    probe: 'https://www.nseindia.com/api/quote-equity?symbol=RELIANCE',
    note: 'Indian exchange data incl. shareholding. Requires browser headers; blocked here (403).' },
  { id: 'stooq', name: 'Stooq', kind: 'api', url: 'https://stooq.com/q/d/l/',
    provides: ['price'],
    probe: 'https://stooq.com/q/d/l/?s=aapl.us&i=d',
    note: 'Free daily CSV price history. Blocked from this sandbox.' },
  { id: 'openfigi', name: 'OpenFIGI', kind: 'api', url: 'https://api.openfigi.com/v3',
    provides: ['identifiers', 'exchange'],
    note: 'Maps ticker → FIGI, exchange, security type. Blocked here; free with optional key.' },
  { id: 'gleif', name: 'GLEIF', kind: 'api', url: 'https://api.gleif.org/api/v1',
    provides: ['identifiers', 'corporate-hierarchy'],
    note: 'Legal Entity Identifiers and parent/child ownership. Blocked here.' },
  { id: 'frankfurter', name: 'Frankfurter (ECB FX)', kind: 'api', url: 'https://api.frankfurter.app',
    provides: ['fx'],
    note: 'Free FX rates — would close the mixed-currency gap. Blocked here.' },
  { id: 'csv', name: 'CSV file', kind: 'file', url: '',
    provides: ['statements', 'ratios', 'prices', 'anything-tabular'],
    note: 'User-supplied. Always works, offline.' },
  { id: 'json', name: 'JSON import', kind: 'file', url: '',
    provides: ['profile', 'intelligence', 'backup'],
    note: 'Full intelligence packs or a database backup. Always works, offline.' },
  { id: 'manual', name: 'Manual entry', kind: 'manual', url: '',
    provides: ['rating', 'notes', 'portfolio', 'peers', 'assumptions', 'alert-rules'],
    note: 'Forms in the UI. Always works, offline.' },
  { id: 'generated', name: 'Demo generator', kind: 'generated', url: '',
    provides: ['everything'],
    note: 'Deterministic synthetic pack — the offline fallback for every screen.' },
];

/** Feature → which sources can supply it. This is the "a to z" map. */
export const FEATURE_MATRIX: Array<{ feature: string; screen: string; sources: string[] }> = [
  { feature: 'Company search', screen: 'Global search', sources: ['yahoo', 'generated', 'csv'] },
  { feature: 'Company identity (name, sector, exchange)', screen: 'Company header', sources: ['yahoo', 'csv', 'manual'] },
  { feature: 'Business description', screen: 'Overview tab', sources: ['wikipedia', 'yahoo', 'json', 'generated'] },
  { feature: 'Financial statements (10y annual + quarterly)', screen: 'P&L / Balance / Cash Flow', sources: ['yahoo', 'sec-edgar', 'csv', 'generated'] },
  { feature: 'Ratios (ROE, ROCE, D/E, margins)', screen: 'Ratios tab', sources: ['yahoo', 'csv', 'generated'] },
  { feature: 'Scores (Piotroski, Altman, Beneish)', screen: 'Scores panel', sources: ['yahoo', 'csv', 'generated'] },
  { feature: 'Deep metrics (DuPont, CCC, CAGR)', screen: 'Deep analysis', sources: ['yahoo', 'csv', 'generated'] },
  { feature: 'Factors & ranking', screen: 'Rank view', sources: ['yahoo', 'csv', 'generated'] },
  { feature: 'Valuation lab', screen: 'Valuation', sources: ['yahoo', 'manual', 'generated'] },
  { feature: 'Balance-sheet strength', screen: 'Strength panel', sources: ['yahoo', 'csv', 'generated'] },
  { feature: 'Segments, order book, guidance, facilities', screen: 'Business / Plans tabs', sources: ['json', 'manual', 'generated'] },
  { feature: 'Risk register', screen: 'Risks tab', sources: ['json', 'generated'] },
  { feature: 'Price history & analytics', screen: 'Price panel', sources: ['yahoo', 'stooq', 'csv', 'generated'] },
  { feature: 'Dividends', screen: 'Market panel', sources: ['yahoo', 'csv', 'generated'] },
  { feature: 'Analyst consensus & targets', screen: 'Market panel', sources: ['yahoo', 'csv', 'generated'] },
  { feature: 'Ownership & insider trades', screen: 'Market panel', sources: ['yahoo', 'nse', 'csv', 'generated'] },
  { feature: 'Shareholding (promoter/FII/pledge)', screen: 'Shareholding tab', sources: ['nse', 'csv', 'generated'] },
  { feature: 'Earnings estimates & surprises', screen: 'Market panel', sources: ['yahoo', 'csv', 'generated'] },
  { feature: 'Earnings calendar', screen: 'Market panel', sources: ['yahoo', 'manual', 'generated'] },
  { feature: 'News & announcements', screen: 'News tab', sources: ['google-news', 'yahoo-rss', 'generated'] },
  { feature: 'Macro indicators', screen: 'Macro view', sources: ['worldbank', 'csv'] },
  { feature: 'FX / currency conversion', screen: 'Screener', sources: ['frankfurter', 'manual'] },
  { feature: 'Portfolio holdings', screen: 'Portfolio view', sources: ['manual', 'csv'] },
  { feature: 'Watchlist & alerts', screen: 'Watchlist', sources: ['manual'] },
  { feature: 'Ratings, notes, peers, assumptions', screen: 'Company page', sources: ['manual'] },
  { feature: 'Full backup / restore', screen: 'API', sources: ['json'] },
];

// ---- live status -------------------------------------------------------------

const statusCache = new Map<string, { status: SourceStatus; checkedAt: number; detail: string }>();

/** Probe a source. Cached for 10 minutes so the UI can call it freely. */
export async function checkSource(id: string, force = false): Promise<{ id: string; status: SourceStatus; detail: string }> {
  const def = SOURCES.find((s) => s.id === id);
  if (!def) return { id, status: 'unreachable', detail: 'Unknown source' };
  if (def.kind !== 'api' && def.kind !== 'rss') {
    return { id, status: 'offline-ok', detail: def.note };
  }
  const cached = statusCache.get(id);
  if (!force && cached && Date.now() - cached.checkedAt < 10 * 60 * 1000) return { id, status: cached.status, detail: cached.detail };
  let status: SourceStatus = 'blocked';
  let detail = '';
  try {
    const res = await httpsGetText(def.probe ?? def.url, { Accept: '*/*' });
    if (res.status >= 200 && res.status < 400) { status = 'live'; detail = `HTTP ${res.status}`; }
    else if (res.status === 429) { status = 'rate-limited'; detail = 'HTTP 429 — throttled, retry later'; }
    else if (res.status === 401 || res.status === 403) { status = 'blocked'; detail = `HTTP ${res.status} — refused`; }
    else { status = 'unreachable'; detail = `HTTP ${res.status}`; }
  } catch (e) {
    // A timeout or DNS failure is "unreachable", not "blocked" — the difference matters
    // because one is worth retrying and the other is not.
    status = 'unreachable';
    detail = e instanceof Error ? (e.message.includes('timeout') ? 'timeout' : e.message) : 'unreachable';
  }
  statusCache.set(id, { status, checkedAt: Date.now(), detail });
  return { id, status, detail };
}

export async function checkAllSources(): Promise<Array<{ id: string; name: string; kind: SourceKind; status: SourceStatus; detail: string; provides: string[]; note: string }>> {
  // Probe in PARALLEL: sequentially this took 15 × timeout and made the Import screen
  // hang. Offline sources resolve instantly; network probes run together.
  const results = await Promise.all(SOURCES.map(async (s) => {
    const r = await checkSource(s.id);
    return { id: s.id, name: s.name, kind: s.kind, status: r.status, detail: r.detail, provides: s.provides, note: s.note };
  }));
  return results;
}

/** Feature → sources, annotated with the current status of each source. */
export async function matrixWithStatus(): Promise<Array<{ feature: string; screen: string; paths: Array<{ source: string; status: SourceStatus; detail: string }> }>> {
  const statuses = new Map((await checkAllSources()).map((s) => [s.id, s]));
  return FEATURE_MATRIX.map((f) => ({
    feature: f.feature, screen: f.screen,
    paths: f.sources.map((id) => {
      const st = statuses.get(id);
      return { source: id, status: st?.status ?? 'unreachable', detail: st?.detail ?? '' };
    }),
  }));
}

// ---- news adapter ------------------------------------------------------------

export const NEWS_DDL = `
CREATE TABLE IF NOT EXISTS news (
  company_id INTEGER NOT NULL, date TEXT NOT NULL, title TEXT NOT NULL, source TEXT NOT NULL,
  url TEXT NOT NULL, fetched_at INTEGER NOT NULL,
  PRIMARY KEY (company_id, title, source)
);
`;

/** Minimal RSS/Atom item extraction — no XML dependency needed. */
export function parseRss(xml: string, source: string, limit = 20): Array<{ title: string; date: string; url: string; source: string }> {
  const items: Array<{ title: string; date: string; url: string; source: string }> = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  for (const b of blocks.slice(0, limit)) {
    const title = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i.exec(b)?.[1] ?? '';
    const link = /<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i.exec(b)?.[1] ?? '';
    const pub = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(b)?.[1] ?? '';
    const clean = title.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
    if (!clean) continue;
    const d = pub ? new Date(pub) : new Date();
    items.push({ title: clean.slice(0, 300), date: isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10), url: link.trim(), source });
  }
  return items;
}

/** Fetch headlines for a company from the reachable RSS feeds. */
export async function fetchNews(db: DB, symbol: string, companyName: string): Promise<{ stored: number; sources: string[] }> {
  ensureMarketTables(db);
  db.exec(NEWS_DDL);
  const c = db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
  if (!c) return { stored: 0, sources: [] };
  const used: string[] = [];
  let stored = 0;
  const feeds: Array<{ source: string; url: string }> = [
    { source: 'google-news', url: `https://news.google.com/rss/search?q=${encodeURIComponent(companyName)}&hl=en-IN&gl=IN&ceid=IN:en` },
    // The old Yahoo RSS feed now 404s; Google News carries the load and is listed first.
  ];
  for (const f of feeds) {
    try {
      const res = await httpsGetText(f.url, { Accept: 'application/rss+xml, application/xml, */*' });
      if (res.status !== 200 || !res.body.includes('<item')) continue;
      const items = parseRss(res.body, f.source);
      const ins = db.prepare(`INSERT OR REPLACE INTO news (company_id,date,title,source,url,fetched_at) VALUES (?,?,?,?,?,?)`);
      for (const it of items) { ins.run(c.id, it.date, it.title, it.source, it.url, Date.now()); stored++; }
      if (items.length) used.push(f.source);
    } catch { /* try the next feed */ }
  }
  return { stored, sources: used };
}

export function listNews(db: DB, symbol: string, limit = 20): Array<{ date: string; title: string; source: string; url: string }> {
  db.exec(NEWS_DDL);
  const c = db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
  if (!c) return [];
  return db.prepare(`SELECT date, title, source, url FROM news WHERE company_id=? ORDER BY date DESC LIMIT ?`).all(c.id, limit) as Array<{ date: string; title: string; source: string; url: string }>;
}
