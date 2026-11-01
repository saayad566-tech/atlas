// Universal bulk symbol manifests.
//
// Sector-rotation works but is slow and caps out. A bulk manifest is one fetch that
// returns every registered symbol — SEC publishes one for all US registrants.
//
// SEC blocks requests without a contact-bearing User-Agent, and the host is unreachable
// from some networks, so the fetcher is injected and the parsing/diff is tested directly.
import type { Database as DB } from 'better-sqlite3';
import { ensureDirectory } from './directory';

export interface MasterEntry { cik: string; ticker: string; name: string; exchange: string | null }

/**
 * SEC company_tickers.json shape:
 *   { "0": { "cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc." }, "1": {...} }
 * Newer exports use an array of the same objects; both are accepted.
 */
export function parseCompanyTickers(json: unknown): MasterEntry[] {
  const src = json as Record<string, unknown> | unknown[] | null;
  if (!src) return [];
  const values = Array.isArray(src) ? src : Object.values(src);
  const out: MasterEntry[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const ticker = String(r['ticker'] ?? '').trim().toUpperCase();
    if (!ticker) continue;
    if (seen.has(ticker)) continue;
    seen.add(ticker);
    const cikRaw = r['cik_str'] ?? r['cik'] ?? '';
    const cik = String(cikRaw).replace(/\D/g, '').padStart(10, '0');
    out.push({
      cik: cik === '0000000000' ? '' : cik,
      ticker,
      name: String(r['title'] ?? r['name'] ?? ticker).trim(),
      exchange: r['exchange'] ? String(r['exchange']) : null,
    });
  }
  return out;
}

export interface BulkSyncResult {
  market: string; scanned: number; added: number; existing: number; ms: number; error?: string;
}

/** Diff the manifest against the directory and insert only what is missing. */
export function syncBulkManifest(
  db: DB, market: string, entries: MasterEntry[], sectorLabel = 'Unclassified', manifestMarket?: string,
): BulkSyncResult {
  const t0 = Date.now();
  // The single most dangerous mistake here: writing one country's symbols into another
  // country's database. Refuse rather than trust the caller.
  if (manifestMarket && manifestMarket !== market) {
    return {
      market, scanned: entries.length, added: 0, existing: 0, ms: Date.now() - t0,
      error: `refused: this manifest describes ${manifestMarket}, not ${market}`,
    };
  }
  ensureDirectory(db);
  const ins = db.prepare(`INSERT OR IGNORE INTO universe_symbols (market,symbol,name,sector,exchange,source,added_at) VALUES (?,?,?,?,?,?,?)`);
  let added = 0; let existing = 0;
  const now = Date.now();
  const tx = db.transaction(() => {
    for (const e of entries) {
      const r = ins.run(market, e.ticker, e.name, sectorLabel, e.exchange ?? '', 'sec-bulk', now);
      if (r.changes > 0) added++; else existing++;
    }
  });
  try { tx(); } catch (err) {
    return { market, scanned: entries.length, added, existing, ms: Date.now() - t0, error: err instanceof Error ? err.message : String(err) };
  }
  return { market, scanned: entries.length, added, existing, ms: Date.now() - t0 };
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export interface BulkFetchOutcome {
  ok: boolean; entries: MasterEntry[]; status: number; error: string | null;
  /** Which market this manifest describes. SEC's file is US-only. */
  manifestMarket: string;
}

/** Fetch the SEC bulk manifest. Requires the contact-bearing User-Agent. */
export async function fetchSecBulkManifest(opts: { contact: string; fetchImpl: FetchLike; url?: string }): Promise<BulkFetchOutcome> {
  const url = opts.url ?? 'https://www.sec.gov/files/company_tickers.json';
  if (!opts.contact || !opts.contact.trim()) return { ok: false, entries: [], status: 0, error: 'SEC requires a contact address in the User-Agent', manifestMarket: 'US' };
  try {
    const res = await opts.fetchImpl(url, { headers: { 'User-Agent': `Atlas ${opts.contact.trim()}`, Accept: 'application/json' } });
    if (!res.ok) return { ok: false, entries: [], status: res.status, error: `bulk manifest returned HTTP ${res.status}${res.status === 403 ? ' — User-Agent rejected' : ''}`, manifestMarket: 'US' };
    const entries = parseCompanyTickers(JSON.parse(await res.text()) as unknown);
    if (!entries.length) return { ok: false, entries: [], status: res.status, error: 'manifest parsed to zero symbols', manifestMarket: 'US' };
    return { ok: true, entries, status: res.status, error: null, manifestMarket: 'US' };
  } catch (e) {
    return { ok: false, entries: [], status: 0, error: e instanceof Error ? e.message : String(e), manifestMarket: 'US' };
  }
}
