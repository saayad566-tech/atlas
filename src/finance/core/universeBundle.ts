// The bundled symbol universe.
//
// Sourced from FinanceDatabase (MIT), reduced to the fields this app uses. It gives a
// complete, offline list of listed companies per market — so a fresh install can show the
// real universe before any network call, and screening has something to screen.
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

export interface UniverseCompany {
  symbol: string;
  name: string;
  sector: string | null;
  industry: string | null;
  country: string | null;
  currency: string | null;
  marketCap: number | null;
  website: string | null;
  isin: string | null;
}

interface BundleFile { market: string; count: number; companies: Array<{ s: string; n: string; sec: string | null; ind: string | null; c: string | null; cur: string | null; cap: number | null; w: string | null; isin: string | null }> }

const CACHE = new Map<string, UniverseCompany[]>();

function dataDir(): string {
  // Works from both dist/ and src/ because the JSON is copied alongside.
  const here = __dirname;
  const candidates = [
    path.join(here, '..', 'data', 'universe'),
    path.join(process.cwd(), 'src', 'finance', 'data', 'universe'),
    path.join(process.cwd(), 'dist', 'finance', 'data', 'universe'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[1]!;
}

/**
 * Read a bundle file, gzipped or plain.
 *
 * The larger bundles ship compressed so they fit within a repository file limit; the reader
 * accepts either form so an uncompressed bundle still works.
 */
function readBundle(file: string): BundleFile {
  const raw = fs.readFileSync(file);
  const text = file.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  return JSON.parse(text) as BundleFile;
}

/** Bundle files, with .gz and .json treated alike. */
function bundleFiles(dir: string): string[] {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json') || f.endsWith('.json.gz'));
}

export function bundledMarkets(): Array<{ market: string; count: number }> {
  try {
    const dir = dataDir();
    return bundleFiles(dir).map((f) => {
      const j = readBundle(path.join(dir, f));
      return { market: j.market, count: j.count };
    }).sort((a, b) => a.market.localeCompare(b.market));
  } catch { return []; }
}

export function loadUniverse(market: string): UniverseCompany[] {
  const code = market.toUpperCase();
  const cached = CACHE.get(code);
  if (cached) return cached;
  try {
    // Accept a compressed bundle when one ships, and fall back to the plain file.
    const dir = dataDir();
    const plain = path.join(dir, `${code}.json`);
    const gz = `${plain}.gz`;
    const file = fs.existsSync(gz) ? gz : plain;
    const j = readBundle(file);
    const out = j.companies.map((c) => ({
      symbol: c.s, name: c.n, sector: c.sec, industry: c.ind,
      country: c.c, currency: c.cur, marketCap: c.cap, website: c.w, isin: c.isin,
    }));
    CACHE.set(code, out);
    return out;
  } catch { return []; }
}

/** Search the bundled universe: symbol prefix first, then name substring. */
export function searchUniverse(market: string, query: string, limit = 25): UniverseCompany[] {
  const all = loadUniverse(market);
  const q = query.trim().toUpperCase();
  if (!q) return all.slice(0, limit);
  const starts: UniverseCompany[] = [];
  const contains: UniverseCompany[] = [];
  for (const c of all) {
    if (c.symbol.toUpperCase().startsWith(q)) starts.push(c);
    else if (c.name.toUpperCase().includes(q)) contains.push(c);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

export function universeStats(market: string): {
  market: string; total: number; withSector: number; sectors: number;
  withMarketCap: number; sampleBySector: Array<{ sector: string; example: string }>;
  note: string;
} {
  const all = loadUniverse(market);
  const sectors = new Set(all.map((c) => c.sector).filter((s): s is string => !!s));
  const withSector = all.filter((c) => !!c.sector).length;
  const withMarketCap = all.filter((c) => c.marketCap !== null).length;

  // One representative name per sector, so the shape of the market is visible without
  // pretending we hold capitalisation data the source does not carry.
  const sampleBySector: Array<{ sector: string; example: string }> = [];
  for (const sector of sectors) {
    const first = all.find((c) => c.sector === sector);
    if (first) sampleBySector.push({ sector, example: `${first.symbol} — ${first.name}` });
  }
  sampleBySector.sort((a, b) => a.sector.localeCompare(b.sector));

  return {
    market: market.toUpperCase(), total: all.length, withSector, sectors: sectors.size,
    withMarketCap, sampleBySector,
    note: withMarketCap === 0
      ? 'This bundle carries names and classifications, not market caps. Capitalisation comes from the live price source.'
      : `${withMarketCap} of ${all.length} companies carry a market cap in the bundle.`,
  };
}

/**
 * Write the bundled universe into the active market database as company rows.
 * Deliberately symbols-and-metadata only: prices, statements and ratios stay empty until
 * they are fetched, so the screener never shows a company with invented numbers.
 */
export function importInto(db: import('better-sqlite3').Database, market: string): { market: string; listed: number; updated: number; skipped: number } {
  const rows = loadUniverse(market);
  const code = market.toUpperCase();
  if (!rows.length) return { market: code, listed: 0, updated: 0, skipped: 0 };

  // Match the real schema: id, symbol, name, sector, industry, currency, source, listed_on, updated_at.
  const find = db.prepare(`SELECT id FROM companies WHERE symbol=?`);
  const ins = db.prepare(`INSERT INTO companies (symbol,name,sector,industry,currency,source,listed_on,updated_at)
    VALUES (?,?,?,?,?,'financedatabase',?,?)`);
  const upd = db.prepare(`UPDATE companies SET name=?, sector=?, industry=?, updated_at=? WHERE id=?`);
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  let listed = 0; let updated = 0; let skipped = 0;

  // The directory search reads universe_symbols, so keep both tables in step.
  const dirIns = db.prepare(`INSERT OR REPLACE INTO universe_symbols
    (market, symbol, name, sector, exchange, source, added_at) VALUES (?,?,?,?,?,?,?)`);
  const addedAt = Date.now();

  const tx = db.transaction(() => {
    for (const r of rows) {
      try { dirIns.run(code, r.symbol, r.name, r.sector ?? 'Unclassified', '', 'financedatabase', addedAt); } catch { /* ignore */ }
      try {
        const found = find.get(r.symbol) as { id: number } | undefined;
        if (found) { upd.run(r.name, r.sector ?? 'Unclassified', r.industry ?? '', now, found.id); updated++; continue; }
        ins.run(r.symbol, r.name, r.sector ?? 'Unclassified', r.industry ?? '', r.currency ?? 'INR', today, now);
        listed++;
      } catch { skipped++; }
    }
  });
  tx();
  return { market: code, listed, updated, skipped };
}
