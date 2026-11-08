// The scraping pipeline.
//
// One fetch, one parse, one extraction rule, one record with its provenance. Everything the
// pipeline does is visible: which URL, which status, how long it took, whether the answer
// came from cache, and where each field was read from.
//
// What it will not do: disguise itself, rotate identities, or defeat a block. It identifies
// honestly, obeys robots.txt, waits between requests, honours Retry-After, and reports a
// refusal as a refusal. A source that says no is a source that says no.

import { polite } from './polite';
import { parseHtml, findAll, findOne, textOf, tableToRows, meta, readableText,
  contentStats, links, type HtmlNode } from './html';

export interface ScrapeRule {
  /** A human name for what is being read, e.g. "index level". */
  field: string;
  /** How to find it. Exactly one of these is used. */
  selector: { tag?: string; className?: string; id?: string };
  /** Read a table instead of a single value. */
  table?: boolean;
  /** Take this capture group from the text, when the value sits inside a sentence. */
  pattern?: string;
  /** Which column to take from a table row. */
  column?: number;
}

export interface ScrapedRecord {
  /** Where this came from, always. */
  sourceUrl: string;
  /** The page title, as published. */
  pageTitle: string;
  fetchedAt: string;
  fromCache: boolean;
  status: number;
  ms: number;
  /** One entry per rule, with the text that produced it. */
  fields: Record<string, string | string[][]>;
  /** The readable prose of the page, trimmed. */
  text: string;
  /** A count so an empty page can be told from a blocked one. */
  stats: { elements: number; chars: number };
  links: Array<{ href: string; text: string }>;
  error: string | null;
  /** True when the page yielded no usable content, whatever the status said. */
  empty: boolean;
}

export interface ScrapeResult {
  ok: boolean;
  record: ScrapedRecord | null;
  error: string | null;
  /** The number of attempts actually made. */
  attempts: number;
  /** True when every retry was exhausted on a server-side failure. */
  exhausted: boolean;
}

export interface ScrapeOptions {
  rules?: ScrapeRule[];
  /** How many times to retry a 5xx or a timeout. */
  maxAttempts?: number;
  /** Base delay for the backoff, doubled each attempt. */
  backoffMs?: number;
  /** Cap the readable text kept, so a huge page cannot exhaust memory. */
  maxTextChars?: number;
}

const DEFAULTS: Required<Pick<ScrapeOptions, 'maxAttempts' | 'backoffMs' | 'maxTextChars'>> = {
  maxAttempts: 3,
  backoffMs: 800,
  maxTextChars: 20_000,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Should this status be retried? A 4xx other than 429 is a refusal, not a transient fault. */
function retryable(status: number): boolean {
  return status === 429 || status === 408 || (status >= 500 && status < 600);
}

function applyRules(root: HtmlNode, rules: ScrapeRule[]): Record<string, string | string[][]> {
  const out: Record<string, string | string[][]> = {};
  for (const rule of rules) {
    const opts = { ...rule.selector };
    if (rule.table) {
      const table = findOne(root, opts);
      if (!table) { out[rule.field] = []; continue; }
      const { headers, rows } = tableToRows(table);
      // Keep the header row as the first row so a reader knows what the columns mean.
      out[rule.field] = headers.length ? [headers, ...rows] : rows;
      continue;
    }
    const el = findOne(root, opts);
    if (!el) { out[rule.field] = ''; continue; }
    let value = textOf(el);
    if (rule.column !== undefined) {
      const cells = findAll(el, { tag: 'td' });
      value = textOf(cells[rule.column] ?? null);
    }
    if (rule.pattern) {
      try {
        const m = new RegExp(rule.pattern).exec(value);
        value = m ? (m[1] ?? m[0]) : '';
      } catch { value = ''; }
    }
    out[rule.field] = value;
  }
  return out;
}

/**
 * Fetch and read one page.
 *
 * A 4xx is reported at once — retrying a refusal is both useless and impolite. A 5xx or a
 * timeout is retried with exponential backoff, up to the attempt limit.
 */
export async function scrape(url: string, opts: ScrapeOptions = {}): Promise<ScrapeResult> {
  const maxAttempts = opts.maxAttempts ?? DEFAULTS.maxAttempts;
  const backoffMs = opts.backoffMs ?? DEFAULTS.backoffMs;
  const maxTextChars = opts.maxTextChars ?? DEFAULTS.maxTextChars;
  let attempts = 0;
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts = attempt;
    let res;
    try {
      res = await polite.get(url);
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'request failed';
      if (attempt < maxAttempts) { await sleep(backoffMs * 2 ** (attempt - 1)); continue; }
      break;
    }

    // A refusal is final.
    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      return { ok: false, record: null, attempts, exhausted: false,
        error: `the source refused the request with HTTP ${res.status}` };
    }
    if (!res.ok && retryable(res.status)) {
      lastError = `the source returned HTTP ${res.status}`;
      if (res.retryAfterSec) {
        // Honour what the server asked for, capped so a long wait cannot hang the app.
        await sleep(Math.min(res.retryAfterSec * 1000, 15_000));
      } else if (attempt < maxAttempts) {
        await sleep(backoffMs * 2 ** (attempt - 1));
      }
      continue;
    }
    if (!res.ok) {
      return { ok: false, record: null, attempts, exhausted: false,
        error: res.error ?? `HTTP ${res.status}` };
    }

    const root = parseHtml(res.body);
    const stats = contentStats(root);
    const pageMeta = meta(root);
    const text = readableText(root).slice(0, maxTextChars);
    const fields = opts.rules?.length ? applyRules(root, opts.rules) : {};

    const record: ScrapedRecord = {
      sourceUrl: url,
      pageTitle: pageMeta.title,
      fetchedAt: new Date().toISOString(),
      fromCache: res.cached,
      status: res.status,
      ms: res.ms,
      fields,
      text,
      stats,
      links: links(root, url).slice(0, 100),
      error: null,
      empty: stats.chars < 80 && !Object.values(fields).some((v) => (Array.isArray(v) ? v.length : String(v).length)),
    };
    return { ok: true, record, error: null, attempts, exhausted: false };
  }

  return { ok: false, record: null, attempts, exhausted: attempts >= maxAttempts,
    error: lastError ?? 'the source could not be reached' };
}

/** A named source with the rules that read it. */
export interface ScrapeSource {
  id: string;
  name: string;
  url: string;
  /** What this page provides, in plain words. */
  provides: string;
  market: string;
  rules: ScrapeRule[];
}

/**
 * The sources the pipeline is configured to read.
 *
 * Each is a public page, fetched once per refresh, under the polite client's rate limit.
 * Where a page renders its content in the browser, the record comes back empty and says so
 * rather than returning an invented value.
 */
export const SCRAPE_SOURCES: ScrapeSource[] = [
  {
    id: 'rbi-rates',
    name: 'Reserve Bank of India — policy rates',
    url: 'https://www.rbi.org.in/',
    provides: 'the repo rate, CRR, SLR and the rupee exchange rates',
    market: 'IN',
    rules: [
      { field: 'repoRate', selector: { tag: 'table' }, table: true },
      { field: 'reserveRatios', selector: { tag: 'table' }, table: true },
      { field: 'exchangeRates', selector: { tag: 'table' }, table: true },
    ],
  },
  {
    id: 'nse-indices',
    name: 'NSE — index board',
    url: 'https://www.nseindia.com/market-data/live-market-indices',
    provides: 'index levels and breadth',
    market: 'IN',
    rules: [
      { field: 'title', selector: { tag: 'h1' } },
      { field: 'indices', selector: { tag: 'table' }, table: true },
    ],
  },
  {
    id: 'nse-home',
    name: 'NSE — market snapshot',
    url: 'https://www.nseindia.com/',
    provides: 'headline index levels',
    market: 'IN',
    rules: [
      { field: 'title', selector: { tag: 'title' } },
      { field: 'headline', selector: { tag: 'h2' } },
    ],
  },
  {
    id: 'bse-home',
    name: 'BSE — market snapshot',
    url: 'https://www.bseindia.com/',
    provides: 'Sensex level and market state',
    market: 'IN',
    rules: [
      { field: 'title', selector: { tag: 'title' } },
      { field: 'headline', selector: { tag: 'h1' } },
    ],
  },
];

export function sourceById(id: string): ScrapeSource | null {
  return SCRAPE_SOURCES.find((s) => s.id === id) ?? null;
}

/** Read one configured source end to end. */
export async function scrapeSource(id: string, opts: ScrapeOptions = {}): Promise<ScrapeResult & { source: ScrapeSource | null }> {
  const source = sourceById(id);
  if (!source) return { ok: false, record: null, error: `no source called "${id}"`, attempts: 0, exhausted: false, source: null };
  const r = await scrape(source.url, { ...opts, rules: source.rules });
  return { ...r, source };
}

/**
 * Read the policy repo rate out of the RBI page text.
 *
 * The page prints it as "Policy Repo Rate : 5.50%". This returns the number, or null when
 * the sentence is not there — a layout change must produce null, never a stale guess.
 */
export function parseRepoRate(text: string): number | null {
  const m = /Policy\s+Repo\s+Rate\s*:?\s*([0-9]+(?:\.[0-9]+)?)\s*%/i.exec(text);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) && v >= 0 && v <= 25 ? v : null;
}

/** Read the rupee's exchange rates out of the page text, keyed by currency. */
export function parseExchangeRates(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  const re = /INR\s*\/\s*(1|100)\s*([A-Z]{3})\s*:?\s*([0-9]+(?:\.[0-9]+)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const per = Number(m[1]);
    const code = m[2]!.toUpperCase();
    const value = Number(m[3]);
    if (!Number.isFinite(value) || value <= 0) continue;
    // Normalise to rupees per one unit of the currency.
    out[code] = per === 100 ? Math.round((value / 100) * 10000) / 10000 : value;
  }
  return out;
}
