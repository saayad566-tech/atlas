// Network adapters for pre-listing discovery.
//
// SEC requires a descriptive User-Agent or it answers 403 — that is the single most common
// reason an EDGAR integration silently returns nothing. The fetch function is injected so
// this can be exercised against mocked responses without touching the network.
import { parseEdgarSubmissions, parseIpoCalendar, type PreListingCompany } from './prelisting';

/** SEC's stated requirement: "Sample Company Name AdminContact@domain.com". */
export function secUserAgent(contact: string, app = 'Atlas'): string {
  const c = contact.trim();
  if (!c) throw new Error('SEC requires a contact address in the User-Agent');
  return `${app} ${c}`;
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export interface FetchOutcome {
  ok: boolean;
  items: PreListingCompany[];
  status: number;
  error: string | null;
}

/** Fetch and parse a company's SEC submissions feed (JSON). */
export async function fetchEdgarSubmissions(cik: string, opts: { contact: string; fetchImpl: FetchLike }): Promise<FetchOutcome> {
  const padded = cik.replace(/\D/g, '').padStart(10, '0');
  const url = `https://data.sec.gov/submissions/CIK${padded}.json`;
  let ua: string;
  try { ua = secUserAgent(opts.contact); } catch (e) { return { ok: false, items: [], status: 0, error: (e as Error).message }; }
  try {
    const res = await opts.fetchImpl(url, { headers: { 'User-Agent': ua, Accept: 'application/json' } });
    if (!res.ok) return { ok: false, items: [], status: res.status, error: `SEC returned HTTP ${res.status}${res.status === 403 ? ' — User-Agent rejected' : ''}` };
    const json = JSON.parse(await res.text()) as unknown;
    return { ok: true, items: parseEdgarSubmissions(json), status: res.status, error: null };
  } catch (e) {
    return { ok: false, items: [], status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Fetch and parse an IPO calendar (FMP / API Ninjas shape). */
export async function fetchIpoCalendar(url: string, opts: { apiKey?: string; fetchImpl: FetchLike; keyHeader?: string }): Promise<FetchOutcome> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.apiKey) headers[opts.keyHeader ?? 'X-Api-Key'] = opts.apiKey;
  try {
    const res = await opts.fetchImpl(url, { headers });
    if (!res.ok) return { ok: false, items: [], status: res.status, error: `calendar returned HTTP ${res.status}` };
    const json = JSON.parse(await res.text()) as unknown;
    return { ok: true, items: parseIpoCalendar(json), status: res.status, error: null };
  } catch (e) {
    return { ok: false, items: [], status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
