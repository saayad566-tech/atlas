// Country universes — the full index constituent list for a market.
//
// "All stocks" needs a real list, not a demo pack. Wikipedia publishes the constituent
// table for every major index and is reachable without a key, so that is the source.
// Parsing is generic: find the widest wikitable and take the column that looks like a
// ticker, rather than hand-tuning nine page layouts.
import { httpsGetText } from './net';
import type { MarketDef } from './markets';

export interface Constituent { symbol: string; name: string; sector: string }

export interface UniverseSource { market: string; page: string; indexName: string; expected: number }

export const INDEX_SOURCES: Record<string, UniverseSource> = {
  IN: { market: 'IN', page: 'https://en.wikipedia.org/wiki/NIFTY_50', indexName: 'NIFTY 50', expected: 50 },
  US: { market: 'US', page: 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies', indexName: 'S&P 500', expected: 500 },
  GB: { market: 'GB', page: 'https://en.wikipedia.org/wiki/FTSE_100_Index', indexName: 'FTSE 100', expected: 100 },
  JP: { market: 'JP', page: 'https://en.wikipedia.org/wiki/Nikkei_225', indexName: 'Nikkei 225', expected: 225 },
  DE: { market: 'DE', page: 'https://en.wikipedia.org/wiki/DAX', indexName: 'DAX', expected: 40 },
  SG: { market: 'SG', page: 'https://en.wikipedia.org/wiki/Straits_Times_Index', indexName: 'Straits Times Index', expected: 30 },
  HK: { market: 'HK', page: 'https://en.wikipedia.org/wiki/Hang_Seng_Index', indexName: 'Hang Seng', expected: 80 },
  AU: { market: 'AU', page: 'https://en.wikipedia.org/wiki/S%26P/ASX_50', indexName: 'S&P/ASX 50', expected: 50 },
  CA: { market: 'CA', page: 'https://en.wikipedia.org/wiki/S%26P/TSX_60', indexName: 'S&P/TSX 60', expected: 60 },
};

const stripTags = (s: string): string => s
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
  // Wikipedia emits non-breaking and thin spaces; they survived trim() and broke tickers
  // like "SGX: A17U" after the prefix was stripped.
  .replace(/[\u00A0\u2007\u2009\u202F]/g, ' ')
  .trim();

/** All wikitable row/cell grids on a page. */
function tables(html: string): string[][][] {
  const out: string[][][] = [];
  for (const t of html.matchAll(/<table[^>]*class="[^"]*wikitable[^"]*"[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows: string[][] = [];
    for (const r of t[1]!.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...r[1]!.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => stripTags(c[1]!));
      if (cells.length) rows.push(cells);
    }
    if (rows.length) out.push(rows);
  }
  return out;
}

/** A plausible ticker — and explicitly NOT a date, a decimal weight or a year. */
const looksLikeTicker = (s: string): boolean => {
  if (!/^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(s)) return false;
  if (/^\d{1,2}[.\-/]\d{1,2}([.\-/]\d{2,4})?$/.test(s)) return false;  // 03.09.1990, 21.12
  if (/^\d+\.\d+$/.test(s)) return false;                              // 40.63 — a weight
  if (/^(19|20)\d{2}$/.test(s)) return false;                            // a year
  return true;
};

/** Parse a Wikipedia index page into constituents. */
export function parseConstituents(html: string, market: string): Constituent[] {
  const grid = tables(html);
  if (!grid.length) return [];
  void market;

  // The prefix must be stripped BEFORE testing, or "SGX: A17U" counts as zero and the
  // column is rejected before the output loop ever runs.
  const cell = (v: string | undefined): string => (v ?? '').trim().replace(/^[A-Za-z]{2,6}\s*:\s*/, '');
  const count = (rows: string[][], col: number): number =>
    rows.slice(1).filter((r) => looksLikeTicker(cell(r[col]))).length;

  // Pass 1 — a column whose HEADER names it. This is the reliable signal.
  let pick: { rows: string[][]; col: number } | null = null;
  let bestNamed = 0;
  for (const rows of grid) {
    const header = rows[0] ?? [];
    for (let col = 0; col < header.length; col++) {
      const h = (header[col] ?? '').trim();
      // Headers vary: "Symbol", "Ticker", "Stock symbol", "Ticker symbol", "Code".
      // Kept strict — a loose match picked the wrong column and broke FTSE/ASX.
      if (!/^(stock\s+)?(symbol|ticker(\s+symbol)?|code|epic|constituent)$/i.test(h)) continue;
      const n = count(rows, col);
      if (n > bestNamed) { bestNamed = n; pick = { rows, col }; }
    }
  }
  // Pass 2 — no named header anywhere: take the column with the most ticker-shaped cells.
  if (!pick || bestNamed < 5) {
    let best = 0;
    for (const rows of grid) {
      for (let col = 0; col < Math.min(4, (rows[0] ?? []).length); col++) {
        const n = count(rows, col);
        if (n > best) { best = n; pick = { rows, col }; }
      }
    }
    if (!pick || best < 10) return [];
  }

  const header = pick.rows[0] ?? [];
  const nameCol = header.findIndex((h) => /company|security|name|constituent/i.test(h));
  // Pick the sector column whose VALUES look like text, not a rank or weight.
  const sectorCandidates = header.map((h, i) => (/sector|industry|gics|sub-industry/i.test(h) ? i : -1)).filter((i) => i >= 0);
  const sectorCol = sectorCandidates.find((i) => {
    const vals = pick.rows.slice(1, 8).map((r) => (r[i] ?? '').trim()).filter(Boolean);
    return vals.length > 0 && vals.filter((v) => !/^[\d.,%\s-]+$/.test(v)).length >= vals.length / 2;
  }) ?? -1;
  const seen = new Set<string>();
  const out: Constituent[] = [];
  for (const r of pick.rows.slice(1)) {
    // Some tables prefix the exchange ("SEHK: 5"), others pad codes ("0005").
    const raw = cell(r[pick.col]);
    if (!looksLikeTicker(raw)) continue;
    let symbol = raw.toUpperCase();
    // Hong Kong codes are 4-digit in Yahoo terms.
    if (/^\d{1,4}$/.test(symbol)) symbol = symbol.padStart(4, '0');
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    out.push({
      symbol,
      name: (nameCol >= 0 && r[nameCol] ? r[nameCol]! : symbol).slice(0, 120),
      // A numeric "sector" is a weight or rank column, not a sector — reject it.
      sector: (() => {
        const v = sectorCol >= 0 && r[sectorCol] ? r[sectorCol]!.trim() : '';
        return !v || /^[\d.,%\s-]+$/.test(v) ? 'Unclassified' : v.slice(0, 80);
      })(),
    });
  }
  return out;
}

/** Market → Yahoo screener region code. */
export const REGIONS: Record<string, string> = {
  IN: 'in', US: 'us', GB: 'gb', JP: 'jp', DE: 'de', SG: 'sg', HK: 'hk', AU: 'au', CA: 'ca',
};

const cache = new Map<string, { at: number; list: Constituent[] }>();
const regionCache = new Map<string, { at: number; total: number; list: Constituent[] }>();

/**
 * The FULL listed equity universe for a market, via Yahoo's region screener.
 * This is the "every single stock" path: an index gives 50–500 names, this gives the
 * whole market (US ~19,900; India ~8,600 before de-duplication).
 */
export async function fetchRegionUniverse(
  market: string,
  opts: { limit?: number; pageSize?: number; client?: { screenRegion: (r: string, o: number, s: number) => Promise<{ total: number; symbols: Array<{ symbol: string; name: string; exchange: string }> }> } } = {},
): Promise<{ market: string; total: number; list: Constituent[]; error?: string }> {
  const code = market.toUpperCase();
  const region = REGIONS[code];
  if (!region) return { market: code, total: 0, list: [], error: `No region mapping for "${market}"` };
  const client = opts.client;
  if (!client) return { market: code, total: 0, list: [], error: 'no live client supplied' };
  const limit = Math.max(1, Math.min(opts.limit ?? 500, 5000));
  const pageSize = Math.min(opts.pageSize ?? 250, 250);
  const cached = regionCache.get(code);
  if (cached && Date.now() - cached.at < 1_800_000 && cached.list.length >= Math.min(limit, cached.total)) {
    return { market: code, total: cached.total, list: cached.list.slice(0, limit) };
  }
  const seen = new Map<string, Constituent>();
  let total = 0;
  for (let offset = 0; offset < limit; offset += pageSize) {
    const page = await client.screenRegion(region, offset, Math.min(pageSize, limit - offset));
    if (page.total) total = page.total;
    if (page.symbols.length === 0) break;
    for (const sym of page.symbols) {
      // India lists the same company on BSE and NSE — keep the NSE line only.
      if (code === 'IN' && sym.symbol.endsWith('.BO')) continue;
      if (!seen.has(sym.symbol)) seen.set(sym.symbol, { symbol: sym.symbol, name: sym.name, sector: 'Unclassified' });
    }
    if (page.symbols.length < pageSize) break;
  }
  const list = [...seen.values()];
  regionCache.set(code, { at: Date.now(), total, list });
  return { market: code, total, list };
}

/** Fetch a market's index constituents. Cached for an hour. */
export async function fetchConstituents(market: string, force = false): Promise<{ market: string; indexName: string; list: Constituent[]; source: string; error?: string }> {
  const src = INDEX_SOURCES[market.toUpperCase()];
  if (!src) return { market, indexName: 'unknown', list: [], source: '', error: `No index source for "${market}"` };
  const hit = cache.get(src.market);
  if (!force && hit && Date.now() - hit.at < 3_600_000) return { market: src.market, indexName: src.indexName, list: hit.list, source: src.page };
  try {
    // Wikipedia rejects a browser-spoofed User-Agent (403) and accepts an honest one.
    const res = await httpsGetText(src.page, { Accept: 'text/html', 'User-Agent': 'Atlas/1.0 (local research tool)' });
    if (res.status !== 200) return { market: src.market, indexName: src.indexName, list: [], source: src.page, error: `HTTP ${res.status}` };
    const list = parseConstituents(res.body, src.market);
    if (list.length === 0) return { market: src.market, indexName: src.indexName, list: [], source: src.page, error: 'Could not parse the constituent table' };
    cache.set(src.market, { at: Date.now(), list });
    return { market: src.market, indexName: src.indexName, list, source: src.page };
  } catch (e) {
    return { market: src.market, indexName: src.indexName, list: [], source: src.page, error: e instanceof Error ? e.message : 'fetch failed' };
  }
}

/** The Yahoo symbol for a constituent in a market (India needs .NS, the US needs none). */
export function yahooSymbol(def: MarketDef, constituent: string): string {
  if (!def.suffix) return constituent;
  // Japanese and HK codes are numeric; they still take the suffix.
  return `${constituent}${def.suffix}`;
}
