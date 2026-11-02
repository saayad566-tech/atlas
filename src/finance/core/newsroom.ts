// Per-country newsroom.
//
// Direct feeds from national newspapers are blocked from many networks, and each one is a
// separate scraper that breaks on its own schedule. Instead this uses one reachable
// aggregator, parameterised by country, and falls back to a second aggregator. The result
// is one code path for nine markets instead of nine fragile ones.
import type { Database as DB } from 'better-sqlite3';
import { fetchGoogleNews, fetchBingNews, type NewsItem } from './adapters';

export interface MarketLocale {
  code: string;
  name: string;
  /** Google News locale parameters. */
  hl: string; gl: string; ceid: string;
  /** What counts as market news in this country. */
  queries: string[];
  /** Local financial press, named so the user knows what is being aggregated. */
  press: string[];
}

export const LOCALES: MarketLocale[] = [
  { code: 'IN', name: 'India', hl: 'en-IN', gl: 'IN', ceid: 'IN:en', queries: ['NSE Sensex markets', 'BSE India stocks'], press: ['Economic Times', 'Mint', 'Business Standard', 'Moneycontrol'] },
  { code: 'US', name: 'United States', hl: 'en-US', gl: 'US', ceid: 'US:en', queries: ['S&P 500 Wall Street', 'US stock market'], press: ['Reuters', 'CNBC', 'MarketWatch', 'Barron\'s'] },
  { code: 'GB', name: 'United Kingdom', hl: 'en-GB', gl: 'GB', ceid: 'GB:en', queries: ['FTSE 100 London stocks', 'UK markets'], press: ['Financial Times', 'The Telegraph', 'City AM'] },
  { code: 'JP', name: 'Japan', hl: 'en-JP', gl: 'JP', ceid: 'JP:en', queries: ['Nikkei Tokyo stocks', 'Japan markets'], press: ['Nikkei', 'Japan Times'] },
  { code: 'DE', name: 'Germany', hl: 'en-DE', gl: 'DE', ceid: 'DE:en', queries: ['DAX Frankfurt stocks', 'Germany markets'], press: ['Handelsblatt', 'FAZ'] },
  { code: 'SG', name: 'Singapore', hl: 'en-SG', gl: 'SG', ceid: 'SG:en', queries: ['Straits Times Index stocks', 'Singapore markets'], press: ['Business Times', 'Straits Times'] },
  { code: 'HK', name: 'Hong Kong', hl: 'en-HK', gl: 'HK', ceid: 'HK:en', queries: ['Hang Seng Hong Kong stocks', 'Hong Kong markets'], press: ['SCMP', 'HK Economic Times'] },
  { code: 'AU', name: 'Australia', hl: 'en-AU', gl: 'AU', ceid: 'AU:en', queries: ['ASX 200 Sydney stocks', 'Australia markets'], press: ['Australian Financial Review', 'ABC Business'] },
  { code: 'CA', name: 'Canada', hl: 'en-CA', gl: 'CA', ceid: 'CA:en', queries: ['TSX Toronto stocks', 'Canada markets'], press: ['Globe and Mail', 'Financial Post'] },
];

export function localeFor(code: string): MarketLocale | null {
  return LOCALES.find((l) => l.code === code.toUpperCase()) ?? null;
}

export interface NewsroomResult {
  market: string;
  items: NewsItem[];
  sources: string[];
  fromCache: boolean;
  fetchedAt: string;
  note: string;
}

interface CacheEntry { items: NewsItem[]; at: number; sources: string[] }
const CACHE = new Map<string, CacheEntry>();
const TTL_MS = 10 * 60 * 1000; // ten minutes: news does not change faster than this

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

/** Google News with country parameters, then Bing as a fallback. */
async function fetchForCountry(loc: MarketLocale, limit: number): Promise<{ items: NewsItem[]; sources: string[] }> {
  const sources: string[] = [];
  const seen = new Set<string>();
  const out: NewsItem[] = [];

  const push = (items: NewsItem[] | null, source: string): void => {
    if (!items || !items.length) return;
    let added = 0;
    for (const it of items) {
      const key = norm(it.title);
      if (!key || seen.has(key)) continue;
      seen.add(key); out.push(it); added++;
      if (out.length >= limit) break;
    }
    if (added > 0 && !sources.includes(source)) sources.push(source);
  };

  for (const q of loc.queries) {
    if (out.length >= limit) break;
    // The adapters take a plain query; the locale is applied by the query text itself.
    push(await fetchGoogleNews(`${q} ${loc.gl === 'IN' ? 'India' : loc.name}`).catch(() => null), 'google-news');
  }
  if (out.length < Math.min(5, limit)) {
    push(await fetchBingNews(`${loc.name} stock market`).catch(() => null), 'bing-news');
  }
  return { items: out.slice(0, limit), sources };
}

export async function marketNews(code: string, limit = 20): Promise<NewsroomResult | null> {
  const loc = localeFor(code);
  if (!loc) return null;

  const cached = CACHE.get(loc.code);
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) {
    return {
      market: loc.code, items: cached.items.slice(0, limit), sources: cached.sources,
      fromCache: true, fetchedAt: new Date(cached.at).toISOString(),
      note: `Cached for ${TTL_MS / 60000} minutes. ${loc.press.length} national titles are covered by the aggregator.`,
    };
  }

  const { items, sources } = await fetchForCountry(loc, Math.max(limit, 20));
  if (items.length) CACHE.set(loc.code, { items, at: now, sources });
  return {
    market: loc.code, items: items.slice(0, limit), sources,
    fromCache: false, fetchedAt: new Date(now).toISOString(),
    note: items.length
      ? `Aggregated from ${sources.join(' and ')}. ${loc.press.join(', ')} are covered by these aggregators.`
      : `No source answered for ${loc.name}. The national titles (${loc.press.join(', ')}) are reachable only through an aggregator on this network.`,
  };
}

/** Store what was fetched so it stays readable offline. */
export function persistNews(db: DB, code: string, items: NewsItem[]): number {
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS news_cache (
      market TEXT NOT NULL, title TEXT NOT NULL, publisher TEXT, url TEXT, published_at TEXT,
      source TEXT, fetched_at TEXT NOT NULL, PRIMARY KEY (market, title))`);
    const stmt = db.prepare(`INSERT OR REPLACE INTO news_cache (market,title,publisher,url,published_at,source,fetched_at)
      VALUES (?,?,?,?,?,?,?)`);
    const at = new Date().toISOString();
    let n = 0;
    for (const it of items) { stmt.run(code, it.title, it.publisher, it.url, it.publishedAt, it.source, at); n++; }
    return n;
  } catch { return 0; }
}

/** Read the stored headlines when the network is unavailable. */
export function storedNews(db: DB, code: string, limit = 20): NewsItem[] {
  try {
    return (db.prepare(`SELECT title, publisher, url, published_at, source FROM news_cache
      WHERE market=? ORDER BY fetched_at DESC, published_at DESC LIMIT ?`).all(code, limit) as Array<Record<string, string>>)
      .map((r) => ({ title: r['title']!, publisher: r['publisher'] ?? '', url: r['url'] ?? '', publishedAt: r['published_at'] ?? '', source: r['source'] ?? 'cache' }));
  } catch { return []; }
}

export function newsCoverage(): Array<{ code: string; name: string; press: string[] }> {
  return LOCALES.map((l) => ({ code: l.code, name: l.name, press: l.press }));
}
