// The news pipeline.
//
// One harvest queries several public feeds, parses whatever format comes back, deduplicates
// on the article URL, and stores everything with the date it was published and the date it
// was fetched. Stored articles are what makes "past news" possible: the feed only carries
// the last day or so, but once an article is seen it stays searchable.
//
// The parser handles RSS 2.0 and Atom without a dependency. A feed that returns HTML, or
// nothing, is reported as failed rather than parsed into nonsense.

import type { Database as DB } from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { polite } from './polite';
import { decodeEntities } from './html';

export interface NewsArticle {
  /** A stable identity derived from the link, so the same article is never stored twice. */
  id: string;
  title: string;
  link: string;
  source: string;
  summary: string;
  /** When the publisher says it was published, as ISO. */
  publishedAt: string | null;
  /** When this pipeline saw it, as ISO. */
  fetchedAt: string;
  market: string;
  /** Symbols the article appears to concern, extracted from the title. */
  symbols: string[];
}

export interface HarvestResult {
  market: string;
  query: string;
  feedsTried: number;
  feedsOk: number;
  seen: number;
  fresh: number;
  stored: number;
  errors: Array<{ feed: string; error: string }>;
  fetchedAt: string;
}

export interface FeedSource {
  id: string;
  name: string;
  build: (query: string, locale: { hl: string; gl: string; ceid: string }) => string;
}

/**
 * The feeds this pipeline reads.
 *
 * Each is a public RSS endpoint. Where a national publisher blocks automated reads, its own
 * feed is absent rather than scraped through a workaround.
 */
export const FEEDS: FeedSource[] = [
  {
    id: 'google-news',
    name: 'Google News',
    build: (q, l) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${l.hl}&gl=${l.gl}&ceid=${l.ceid}`,
  },
  {
    id: 'bing-news',
    name: 'Bing News',
    build: (q) => `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=RSS`,
  },
];

const LOCALES: Record<string, { hl: string; gl: string; ceid: string; query: string }> = {
  IN: { hl: 'en-IN', gl: 'IN', ceid: 'IN:en', query: 'nifty OR sensex OR "stock market india"' },
  US: { hl: 'en-US', gl: 'US', ceid: 'US:en', query: 'wall street OR "stock market" OR nasdaq' },
  GB: { hl: 'en-GB', gl: 'GB', ceid: 'GB:en', query: 'ftse OR "london stock exchange"' },
  JP: { hl: 'en-US', gl: 'US', ceid: 'US:en', query: 'nikkei OR "tokyo stock exchange"' },
  DE: { hl: 'en-US', gl: 'US', ceid: 'US:en', query: 'dax OR "frankfurt stock exchange"' },
  CN: { hl: 'en-US', gl: 'US', ceid: 'US:en', query: 'shanghai composite OR "china stocks"' },
  HK: { hl: 'en-US', gl: 'US', ceid: 'US:en', query: 'hang seng OR "hong kong stocks"' },
  AU: { hl: 'en-AU', gl: 'AU', ceid: 'AU:en', query: 'asx OR "australian stock market"' },
  CA: { hl: 'en-CA', gl: 'CA', ceid: 'CA:en', query: 'tsx OR "toronto stock exchange"' },
};

/** The search terms for a market; falls back to a generic query rather than failing. */
export function queryFor(market: string): { query: string; locale: { hl: string; gl: string; ceid: string } } {
  const l = LOCALES[market.toUpperCase()];
  if (l) return { query: l.query, locale: { hl: l.hl, gl: l.gl, ceid: l.ceid } };
  return { query: 'stock market', locale: { hl: 'en-US', gl: 'US', ceid: 'US:en' } };
}

const stripTags = (s: string): string => decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Read one tag's text out of a block. Handles CDATA. */
function tag(block: string, name: string): string {
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i');
  const m = re.exec(block);
  if (!m) return '';
  return stripTags(m[1]!.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, ''));
}

/** Parse an RSS or Atom document into articles. Exported for testing without a network. */
export function parseFeed(xml: string, source: string, market: string, fetchedAt = new Date().toISOString()): NewsArticle[] {
  const out: NewsArticle[] = [];
  // RSS items and Atom entries are close enough to handle together.
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];
  for (const block of blocks) {
    const title = tag(block, 'title');
    if (!title) continue;
    // Atom uses <link href="...">, RSS uses <link>text</link>.
    let link = tag(block, 'link');
    if (!link) {
      const href = /<link[^>]*href="([^"]+)"/i.exec(block)?.[1] ?? '';
      link = decodeEntities(href);
    }
    const published = tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated') || tag(block, 'dc:date');
    const summary = tag(block, 'description') || tag(block, 'summary') || tag(block, 'content');
    const src = tag(block, 'source') || source;
    const when = published ? new Date(published) : null;
    out.push({
      id: articleId(link || title),
      title: title.slice(0, 300),
      link: link.slice(0, 600),
      source: src.slice(0, 60),
      summary: summary.slice(0, 600),
      publishedAt: when && !Number.isNaN(when.getTime()) ? when.toISOString() : null,
      fetchedAt,
      market: market.toUpperCase(),
      symbols: [],
    });
  }
  return out;
}

/** A stable identity for an article: the link when there is one, else the title. */
export function articleId(key: string): string {
  return createHash('sha256').update(key.trim().toLowerCase()).digest('hex').slice(0, 20);
}

function ensureTable(db: DB): void {
  db.exec(`CREATE TABLE IF NOT EXISTS news_articles (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, link TEXT, source TEXT, summary TEXT,
    published_at TEXT, fetched_at TEXT NOT NULL, market TEXT NOT NULL, symbols TEXT)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_news_pub ON news_articles(published_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_news_market ON news_articles(market, published_at DESC)`);
}

/** Store articles, ignoring ones already held. Returns how many were new. */
export function storeArticles(db: DB, articles: NewsArticle[]): number {
  ensureTable(db);
  // INSERT OR IGNORE reports changes=0 for an article already held, which is what makes the
  // "new this run" count meaningful. An upsert would report a change on every re-harvest.
  const insert = db.prepare(`INSERT OR IGNORE INTO news_articles
    (id, title, link, source, summary, published_at, fetched_at, market, symbols)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  // A re-harvest should still refresh the "last seen" time on an article we already hold.
  const touch = db.prepare('UPDATE news_articles SET fetched_at = ? WHERE id = ?');
  let fresh = 0;
  const tx = db.transaction(() => {
    for (const a of articles) {
      const res = insert.run(a.id, a.title, a.link, a.source, a.summary, a.publishedAt,
        a.fetchedAt, a.market, a.symbols.join(','));
      if (res.changes > 0) fresh++;
      else touch.run(a.fetchedAt, a.id);
    }
  });
  tx();
  return fresh;
}

/**
 * Harvest the news for a market.
 *
 * Each feed is tried in turn; a feed that fails is recorded and the others still run, so one
 * blocked publisher cannot empty the page.
 */
export async function harvest(db: DB, market: string, opts: { limit?: number; feeds?: string[] } = {}): Promise<HarvestResult> {
  const code = market.toUpperCase();
  const { query, locale } = queryFor(code);
  const feeds = FEEDS.filter((f) => !opts.feeds || opts.feeds.includes(f.id));
  const errors: HarvestResult['errors'] = [];
  let feedsOk = 0;
  let seen = 0;
  const collected: NewsArticle[] = [];

  for (const feed of feeds) {
    try {
      const r = await polite.get(feed.build(query, locale));
      if (!r.ok) { errors.push({ feed: feed.id, error: `HTTP ${r.status}` }); continue; }
      const articles = parseFeed(r.body, feed.name, code);
      if (!articles.length) { errors.push({ feed: feed.id, error: 'the feed returned no items' }); continue; }
      feedsOk++;
      seen += articles.length;
      collected.push(...articles);
    } catch (e) {
      errors.push({ feed: feed.id, error: e instanceof Error ? e.message.slice(0, 80) : 'failed' });
    }
  }

  // The same story often appears in both feeds; the id collapses them.
  const unique = new Map<string, NewsArticle>();
  for (const a of collected) if (!unique.has(a.id)) unique.set(a.id, a);
  const list = [...unique.values()].slice(0, opts.limit ?? 200);
  const stored = storeArticles(db, list);

  return {
    market: code, query, feedsTried: feeds.length, feedsOk,
    seen, fresh: list.length, stored,
    errors, fetchedAt: new Date().toISOString(),
  };
}

export interface NewsQuery {
  market?: string;
  text?: string;
  from?: string;
  to?: string;
  limit?: number;
}

/** Read stored news. This is what makes past news available after the feed has moved on. */
export function search(db: DB, q: NewsQuery = {}): NewsArticle[] {
  try {
    ensureTable(db);
    const where: string[] = [];
    const args: unknown[] = [];
    if (q.market) { where.push('market = ?'); args.push(q.market.toUpperCase()); }
    if (q.text) { where.push('(title LIKE ? OR summary LIKE ?)'); args.push(`%${q.text}%`, `%${q.text}%`); }
    if (q.from) { where.push("COALESCE(published_at, fetched_at) >= ?"); args.push(q.from); }
    if (q.to) { where.push("COALESCE(published_at, fetched_at) <= ?"); args.push(q.to); }
    const sql = `SELECT id, title, link, source, summary, published_at AS publishedAt,
      fetched_at AS fetchedAt, market, symbols FROM news_articles
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY COALESCE(published_at, fetched_at) DESC LIMIT ?`;
    const rows = db.prepare(sql).all(...args, Math.min(q.limit ?? 50, 500)) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r['id']), title: String(r['title']), link: String(r['link'] ?? ''),
      source: String(r['source'] ?? ''), summary: String(r['summary'] ?? ''),
      publishedAt: r['publishedAt'] ? String(r['publishedAt']) : null,
      fetchedAt: String(r['fetchedAt']), market: String(r['market']),
      symbols: String(r['symbols'] ?? '').split(',').filter(Boolean),
    }));
  } catch { return []; }
}

/** How much news is stored, and over what span. */
export function coverage(db: DB): { total: number; markets: number; oldest: string | null; newest: string | null } {
  try {
    ensureTable(db);
    const row = db.prepare(`SELECT COUNT(*) AS total, COUNT(DISTINCT market) AS markets,
      MIN(COALESCE(published_at, fetched_at)) AS oldest, MAX(COALESCE(published_at, fetched_at)) AS newest
      FROM news_articles`).get() as Record<string, unknown> | undefined;
    return {
      total: Number(row?.['total'] ?? 0), markets: Number(row?.['markets'] ?? 0),
      oldest: row?.['oldest'] ? String(row['oldest']) : null,
      newest: row?.['newest'] ? String(row['newest']) : null,
    };
  } catch { return { total: 0, markets: 0, oldest: null, newest: null }; }
}

/** Drop articles older than a cutoff, so the store does not grow without limit. */
export function prune(db: DB, keepDays = 180): number {
  try {
    ensureTable(db);
    const cutoff = new Date(Date.now() - keepDays * 86_400_000).toISOString();
    const res = db.prepare('DELETE FROM news_articles WHERE COALESCE(published_at, fetched_at) < ?').run(cutoff);
    return res.changes;
  } catch { return 0; }
}

/**
 * Harvest news about one company.
 *
 * The query uses the company's name rather than its symbol, because a search for "TCS.NS"
 * returns nothing while "Tata Consultancy" returns the actual coverage.
 */
export async function harvestSymbol(db: DB, symbol: string, name: string, opts: { limit?: number } = {}): Promise<HarvestResult> {
  const code = symbol.replace(/\.[A-Z]+$/, '');
  const query = `"${name}" OR "${code}" stock`;
  const locale = { hl: 'en-IN', gl: 'IN', ceid: 'IN:en' };
  const collected: NewsArticle[] = [];
  const errors: HarvestResult['errors'] = [];
  let feedsOk = 0;
  let seen = 0;

  for (const feed of FEEDS) {
    try {
      const r = await polite.get(feed.build(query, locale));
      if (!r.ok) { errors.push({ feed: feed.id, error: `HTTP ${r.status}` }); continue; }
      const articles = parseFeed(r.body, feed.name, 'SYMBOL');
      if (!articles.length) { errors.push({ feed: feed.id, error: 'the feed returned no items' }); continue; }
      feedsOk++; seen += articles.length;
      // Tag every article with the symbol it was searched for, so it can be found again.
      for (const a of articles) { a.symbols = [symbol.toUpperCase()]; a.market = 'SYMBOL'; }
      collected.push(...articles);
    } catch (e) {
      errors.push({ feed: feed.id, error: e instanceof Error ? e.message.slice(0, 80) : 'failed' });
    }
  }

  const unique = new Map<string, NewsArticle>();
  for (const a of collected) if (!unique.has(a.id)) unique.set(a.id, a);
  const list = [...unique.values()].slice(0, opts.limit ?? 100);
  const stored = storeArticles(db, list);
  return { market: 'SYMBOL', query, feedsTried: FEEDS.length, feedsOk, seen,
    fresh: list.length, stored, errors, fetchedAt: new Date().toISOString() };
}

/** Stored articles that mention a symbol. */
export function forSymbol(db: DB, symbol: string, limit = 20): NewsArticle[] {
  try {
    ensureTable(db);
    const rows = db.prepare(`SELECT id, title, link, source, summary, published_at AS publishedAt,
      fetched_at AS fetchedAt, market, symbols FROM news_articles
      WHERE symbols LIKE ? ORDER BY COALESCE(published_at, fetched_at) DESC LIMIT ?`)
      .all(`%${symbol.toUpperCase()}%`, limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r['id']), title: String(r['title']), link: String(r['link'] ?? ''),
      source: String(r['source'] ?? ''), summary: String(r['summary'] ?? ''),
      publishedAt: r['publishedAt'] ? String(r['publishedAt']) : null,
      fetchedAt: String(r['fetchedAt']), market: String(r['market']),
      symbols: String(r['symbols'] ?? '').split(',').filter(Boolean),
    }));
  } catch { return []; }
}
