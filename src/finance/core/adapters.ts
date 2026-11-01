// Real fetch-and-parse adapters for sources reachable from a proxied network.
//
// Node's fetch ignores https_proxy, so every adapter goes through the proxy-aware client
// the rest of the app already uses. Parsing is separated from fetching so shapes can be
// tested without the network, and an adapter returns null when it cannot answer so the
// failover engine moves on rather than storing an empty result.

export interface NewsItem { title: string; publisher: string; url: string; publishedAt: string; source: string }
export interface MacroPoint { indicator: string; country: string; year: string; value: number | null; source: string }
export interface EntityFacts { name: string; description: string | null; country: string | null; website: string | null; source: string }

const UA = 'Atlas research admin@example.com';

type Getter = (url: string, headers: Record<string, string>) => Promise<{ status: number; body: string }>;

async function defaultGet(url: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  const { httpsGetText } = await import('./net');
  const r = await httpsGetText(url, headers);
  return { status: r.status, body: r.body };
}

function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

// ---------- Bing News RSS ----------
export function parseBingNews(xml: string, limit = 20): NewsItem[] {
  const out: NewsItem[] = [];
  const blocks = xml.split(/<item>/i).slice(1);
  for (const b of blocks) {
    const title = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i.exec(b)?.[1]?.trim();
    const link = /<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i.exec(b)?.[1]?.trim();
    const date = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(b)?.[1]?.trim() ?? '';
    const src = /<News:Source>([\s\S]*?)<\/News:Source>/i.exec(b)?.[1]?.trim()
      ?? /<source[^>]*>([\s\S]*?)<\/source>/i.exec(b)?.[1]?.trim() ?? '';
    if (title && link) out.push({ title: decodeEntities(title), publisher: decodeEntities(src) || 'Bing News', url: link, publishedAt: date, source: 'bing-news' });
    if (out.length >= limit) break;
  }
  return out;
}

export async function fetchBingNews(query: string, get: Getter = defaultGet): Promise<NewsItem[] | null> {
  const url = `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`;
  const res = await get(url, { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml' });
  if (res.status !== 200) return null;
  const items = parseBingNews(res.body);
  return items.length ? items : null;
}

// ---------- Google News RSS ----------
export function parseGoogleNews(xml: string, limit = 20): NewsItem[] {
  const out: NewsItem[] = [];
  for (const b of xml.split(/<item>/i).slice(1)) {
    const title = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i.exec(b)?.[1]?.trim();
    const link = /<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i.exec(b)?.[1]?.trim();
    const date = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(b)?.[1]?.trim() ?? '';
    const src = /<source[^>]*>([\s\S]*?)<\/source>/i.exec(b)?.[1]?.trim() ?? 'Google News';
    if (title && link) out.push({ title: decodeEntities(title), publisher: decodeEntities(src), url: link, publishedAt: date, source: 'google-news' });
    if (out.length >= limit) break;
  }
  return out;
}

export async function fetchGoogleNews(query: string, get: Getter = defaultGet): Promise<NewsItem[] | null> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
  const res = await get(url, { 'User-Agent': UA });
  if (res.status !== 200) return null;
  const items = parseGoogleNews(res.body);
  return items.length ? items : null;
}

// ---------- World Bank ----------
export function parseWorldBank(json: unknown): MacroPoint[] {
  const arr = json as unknown[];
  if (!Array.isArray(arr) || arr.length < 2 || !Array.isArray(arr[1])) return [];
  return (arr[1] as Array<Record<string, unknown>>)
    .map((r) => ({
      indicator: String((r['indicator'] as { value?: string })?.value ?? ''),
      country: String((r['country'] as { value?: string })?.value ?? ''),
      year: String(r['date'] ?? ''),
      value: typeof r['value'] === 'number' ? (r['value'] as number) : null,
      source: 'worldbank',
    }))
    .filter((p) => p.year);
}

export async function fetchWorldBank(country: string, indicator = 'NY.GDP.MKTP.CD', get: Getter = defaultGet): Promise<MacroPoint[] | null> {
  const url = `https://api.worldbank.org/v2/country/${encodeURIComponent(country)}/indicator/${encodeURIComponent(indicator)}?format=json&per_page=10`;
  const res = await get(url, { 'User-Agent': UA });
  if (res.status !== 200) return null;
  try { const points = parseWorldBank(JSON.parse(res.body)); return points.length ? points : null; } catch { return null; }
}

// ---------- IMF ----------
export function parseImf(json: unknown, indicator: string): MacroPoint[] {
  const j = json as { values?: Record<string, Record<string, Record<string, number>>> } | undefined;
  const byIndicator = j?.values?.[indicator];
  if (!byIndicator) return [];
  const out: MacroPoint[] = [];
  for (const [country, series] of Object.entries(byIndicator)) {
    for (const [year, value] of Object.entries(series)) {
      out.push({ indicator, country, year, value: typeof value === 'number' ? value : null, source: 'imf' });
    }
  }
  return out.sort((a, b) => b.year.localeCompare(a.year));
}

export async function fetchImf(indicator = 'NGDP_RPCH', country = 'IND', get: Getter = defaultGet): Promise<MacroPoint[] | null> {
  const url = `https://www.imf.org/external/datamapper/api/v1/${encodeURIComponent(indicator)}/${encodeURIComponent(country)}`;
  const res = await get(url, { 'User-Agent': UA });
  if (res.status !== 200) return null;
  try { const points = parseImf(JSON.parse(res.body), indicator); return points.length ? points : null; } catch { return null; }
}

// ---------- Wikidata ----------
export function parseWikidata(json: unknown): EntityFacts | null {
  const j = json as { results?: { bindings?: Array<Record<string, { value?: string }>> } } | undefined;
  const b = j?.results?.bindings?.[0];
  if (!b) return null;
  // The label service binds ?itemLabel; ?name is bound only when explicitly selected.
  const name = b['name']?.value ?? b['itemLabel']?.value;
  if (!name) return null;
  return {
    name,
    description: b['description']?.value ?? null,
    country: b['countryLabel']?.value ?? null,
    website: b['website']?.value ?? null,
    source: 'wikidata',
  };
}

async function tryWikidataLabel(companyName: string, get: Getter): Promise<EntityFacts | null> {
  // ?item must be selected for the label service to bind ?itemLabel.
  const sparql = `SELECT ?item ?itemLabel ?description ?countryLabel ?website WHERE {
    ?item rdfs:label "${companyName.replace(/"/g, '')}"@en .
    OPTIONAL { ?item schema:description ?description FILTER(LANG(?description) = "en") }
    OPTIONAL { ?item wdt:P17 ?country }
    OPTIONAL { ?item wdt:P856 ?website }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  } LIMIT 1`;
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`;
  const res = await get(url, { 'User-Agent': UA, Accept: 'application/sparql-results+json' });
  if (res.status !== 200) return null;
  try { return parseWikidata(JSON.parse(res.body)); } catch { return null; }
}

export async function fetchWikidata(companyName: string, get: Getter = defaultGet): Promise<EntityFacts | null> {
  // Wikidata matches labels exactly, and registered names carry legal suffixes.
  const base = companyName.replace(/"/g, '').trim();
  for (const variant of [base, `${base} Limited`, `${base} Ltd`, `${base} Inc.`, `${base} PLC`, `${base} Corporation`]) {
    const hit = await tryWikidataLabel(variant, get);
    if (hit) return hit;
  }
  return null;
}

/** Which sources have a real implementation — the honest counterpart to the registry. */
export const IMPLEMENTED: Record<string, string[]> = {
  news: ['google-news', 'bing-news'],
  macro: ['worldbank', 'imf'],
  profile: ['wikidata', 'yahoo-profile', 'wikipedia-profile'],
  quotes: ['yahoo-quote'],
  history: ['yahoo-chart'],
  fundamentals: ['yahoo-fund'],
  statements: ['yahoo-fund', 'sec-xbrl'],
  dividends: ['yahoo-div'],
  splits: ['yahoo-split'],
  earnings: ['yahoo-earn'],
  analysts: ['yahoo-rec'],
  holdings: ['yahoo-hold'],
  insiders: ['yahoo-insider'],
  sectors: ['yahoo-screener', 'yahoo-exchange', 'wikipedia'],
  ipo: ['sec-s1', 'ipo-calendar'],
};
