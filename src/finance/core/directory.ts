// Full-market symbol directory.
//
// Yahoo no longer answers a region-only screener query, so the whole universe is built by
// walking every sector and unioning the results. The directory lists every listed symbol;
// full company data is still fetched on demand, which keeps the app lightweight.
import type { Database as DB } from 'better-sqlite3';

// NOTE: Yahoo caps a single screener query at roughly 1,150 rows. Sectors larger than
// that (Consumer Cyclical, Industrials) stop at exactly 1,150 and are reported SHORT.
// Splitting a sector by market-cap bracket would retrieve the remainder.
export const SECTORS = [
  'Basic Materials', 'Communication Services', 'Consumer Cyclical', 'Consumer Defensive',
  'Energy', 'Financial Services', 'Healthcare', 'Industrials', 'Real Estate',
  'Technology', 'Utilities',
];

export const DIRECTORY_DDL = `
CREATE TABLE IF NOT EXISTS universe_symbols (
  market TEXT NOT NULL, symbol TEXT NOT NULL, name TEXT NOT NULL, sector TEXT NOT NULL,
  exchange TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'yahoo-screener',
  added_at INTEGER NOT NULL, PRIMARY KEY (market, symbol)
);
CREATE INDEX IF NOT EXISTS idx_universe_market ON universe_symbols(market);
CREATE INDEX IF NOT EXISTS idx_universe_sector ON universe_symbols(market, sector);
`;

export function ensureDirectory(db: DB): void { db.exec(DIRECTORY_DDL); }

/** Market-cap bands used to get past Yahoo's ~1,150-row cap on a single sector query. */
export const MCAP_BRACKETS: Array<[number, number]> = [
  [0, 5e9], [5e9, 2e10], [2e10, 1e11], [1e11, 1e13],
];

export interface DirectorySyncResult {
  market: string; sectors: number; symbols: number; inserted: number;
  perSector: Array<{ sector: string; found: number; pages: number; incomplete?: boolean }>;
  ms: number; error?: string;
}

/** Walk every sector for a region and store each symbol once. */
export async function syncDirectory(
  db: DB,
  market: string,
  region: string,
  screen: (region: string, sector: string, offset: number, size: number) => Promise<{ total: number; symbols: Array<{ symbol: string; name: string; exchange: string }> }>,
  screenBracket?: (region: string, sector: string, lo: number, hi: number, offset: number, size: number) => Promise<{ total: number; symbols: Array<{ symbol: string; name: string; exchange: string }> }>,
  opts: { pageSize?: number; maxPagesPerSector?: number } = {},
): Promise<DirectorySyncResult> {
  ensureDirectory(db);
  const pageSize = opts.pageSize ?? 50;   // Yahoo returns an error body above 50
  const maxPages = opts.maxPagesPerSector ?? 20;
  const t0 = Date.now();
  const ins = db.prepare(`INSERT OR REPLACE INTO universe_symbols (market,symbol,name,sector,exchange,source,added_at) VALUES (?,?,?,?,?,?,?)`);
  const perSector: Array<{ sector: string; found: number; pages: number; incomplete?: boolean }> = [];
  let inserted = 0;
  for (const sector of SECTORS) {
    let found = 0; let pages = 0; let reported = 0; let holes = 0;
    for (let page = 0; page < maxPages; page++) {
      let res = { total: 0, symbols: [] as Array<{ symbol: string; name: string; exchange: string }> };
      // A page can come back empty transiently (offset 50 of one sector fails while 100
      // works), so retry before concluding the sector is exhausted.
      for (let attempt = 0; attempt < 3; attempt++) {
        try { res = await screen(region, sector, page * pageSize, pageSize); } catch { res = { total: 0, symbols: [] }; }
        if (res.symbols.length) break;
        await new Promise((r) => setTimeout(r, 500 + attempt * 500));
      }
      pages++;
      if (res.total > reported) reported = res.total;
      if (!res.symbols.length) {
        // Some offsets are dead (offset 50 of Technology never resolves). Skip one page
        // ahead rather than abandoning the remaining hundreds of symbols.
        if (page + 1 < maxPages && holes < 6) { holes++; continue; }
        break;
      }
      await new Promise((r) => setTimeout(r, 120));   // stay under the rate limiter
      const now = Date.now();
      for (const s of res.symbols) {
        ins.run(market, s.symbol, s.name || s.symbol, sector, s.exchange || '', 'yahoo-screener', now);
        found++; inserted++;
      }
      if (res.symbols.length < pageSize) break;
      if (res.total && (page + 1) * pageSize >= res.total) break;
    }
    // Incomplete when we stopped on an empty page despite having found rows, or when the
    // reported total exceeds what we collected. Yahoo sometimes reports total 0 with data.
    perSector.push({ sector, found, pages, incomplete: (found > 0 && found % pageSize === 0) || (reported > 0 && found < reported) });
  }
  // Second pass for sectors that came back empty — usually the rate limiter, not a
  // genuinely empty sector. Pause first so the limiter has cooled down.
  // Retry sectors that came back empty OR clearly short of their reported total.
  const empty = perSector.filter((p) => p.found === 0 || p.incomplete).map((p) => p.sector);
  if (empty.length) await new Promise((r) => setTimeout(r, 2500));
  for (const sector of empty) {
    let found = 0; let pages = 0; let reported2 = 0; let reported = 0; let holes = 0;
    for (let page = 0; page < maxPages; page++) {
      let res = { total: 0, symbols: [] as Array<{ symbol: string; name: string; exchange: string }> };
      for (let attempt = 0; attempt < 3; attempt++) {
        try { res = await screen(region, sector, page * pageSize, pageSize); } catch { res = { total: 0, symbols: [] }; }
        if (res.symbols.length) break;
        await new Promise((r) => setTimeout(r, 500 + attempt * 500));
      }
      pages++;
      if (res.total > reported2) reported2 = res.total;
      if (!res.symbols.length) {
        if (page + 1 < maxPages && holes < 6) { holes++; continue; }
        break;
      }
      const now = Date.now();
      for (const s of res.symbols) {
        ins.run(market, s.symbol, s.name || s.symbol, sector, s.exchange || '', 'yahoo-screener', now);
        found++; inserted++;
      }
      if (res.symbols.length < pageSize) break;
      if (res.total && (page + 1) * pageSize >= res.total) break;
      await new Promise((r) => setTimeout(r, 350));
    }
    const rec = perSector.find((p) => p.sector === sector);
    if (rec) {
      rec.found = Math.max(rec.found, found);   // a retry must never reduce the haul
      rec.pages += pages;
      rec.incomplete = found === 0 || (reported2 > 0 && found < reported2);
    }
  }
  // Third pass: sectors still short of their reported total are split into market-cap
  // bands, because a single query cannot return more than ~1,150 rows.
  const capped = perSector.filter((p) => p.incomplete).map((p) => p.sector);
  if (screenBracket && capped.length) {
    for (const sector of capped) {
      let found = 0;
      for (const [lo, hi] of MCAP_BRACKETS) {
        for (let page = 0; page < 24; page++) {
          let res = { total: 0, symbols: [] as Array<{ symbol: string; name: string; exchange: string }> };
          for (let attempt = 0; attempt < 2; attempt++) {
            try { res = await screenBracket(region, sector, lo, hi, page * pageSize, pageSize); } catch { res = { total: 0, symbols: [] }; }
            if (res.symbols.length) break;
            await new Promise((r) => setTimeout(r, 400));
          }
          if (!res.symbols.length) break;
          const now = Date.now();
          for (const x of res.symbols) {
            const r = ins.run(market, x.symbol, x.name || x.symbol, sector, x.exchange || '', 'yahoo-screener', now);
            if (r.changes > 0) { found++; inserted++; }
          }
          if (res.symbols.length < pageSize) break;
          await new Promise((r) => setTimeout(r, 120));
        }
      }
      const rec = perSector.find((p) => p.sector === sector);
      if (rec && found > 0) { rec.found += found; rec.incomplete = false; }
    }
  }
  return { market, sectors: SECTORS.length, symbols: countDirectory(db, market), inserted, perSector, ms: Date.now() - t0 };
}

export function countDirectory(db: DB, market: string): number {
  try { return (db.prepare(`SELECT COUNT(*) AS n FROM universe_symbols WHERE market=?`).get(market) as { n: number }).n; } catch { return 0; }
}

/** Search the directory — covers every listed symbol, not only ingested ones. */
export function searchDirectory(db: DB, market: string, q: string, limit = 20): Array<{ symbol: string; name: string; sector: string; ingested: boolean }> {
  try {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    return (db.prepare(`
      SELECT u.symbol, u.name, u.sector,
             EXISTS(SELECT 1 FROM companies c WHERE UPPER(c.symbol)=UPPER(u.symbol)) AS ingested
      FROM universe_symbols u
      WHERE u.market=? AND (u.symbol LIKE ? OR u.name LIKE ?)
      ORDER BY LENGTH(u.symbol), u.symbol LIMIT ?`).all(market, like, like, limit) as Array<Record<string, unknown>>)
      .map((r) => ({ symbol: String(r['symbol']), name: String(r['name']), sector: String(r['sector']), ingested: Number(r['ingested']) === 1 }));
  } catch { return []; }
}

/** How much of the directory has full data behind it. */
export function directoryCoverage(db: DB, market: string): { listed: number; ingested: number; pct: number; sectors: Array<{ sector: string; listed: number }> } {
  try {
    const listed = countDirectory(db, market);
    const ingested = (db.prepare(`SELECT COUNT(*) AS n FROM companies`).get() as { n: number }).n;
    const sectors = (db.prepare(`SELECT sector, COUNT(*) AS n FROM universe_symbols WHERE market=? GROUP BY sector ORDER BY n DESC`).all(market) as Array<{ sector: string; n: number }>)
      .map((r) => ({ sector: r.sector, listed: r.n }));
    return { listed, ingested, pct: listed ? Math.round((ingested / listed) * 1000) / 10 : 0, sectors };
  } catch { return { listed: 0, ingested: 0, pct: 0, sectors: [] }; }
}
