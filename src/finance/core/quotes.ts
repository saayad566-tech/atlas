// Live quotes, from Yahoo's public chart endpoint.
//
// One request per symbol, cached by the polite client, so a refresh loop cannot turn into a
// burst. A symbol that fails is reported as failed; it is never filled in from a neighbour
// or an average.
//
// The endpoint is public and needs no key. It is also the only per-symbol quote source
// reachable from this build, so when it refuses, the app says so and falls back to the last
// stored close rather than showing nothing.

import { polite } from './polite';

export interface Quote {
  symbol: string;
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePct: number | null;
  currency: string;
  exchange: string;
  /** The exchange's own timestamp for the last trade, as ISO. */
  asOf: string | null;
  /** The day's range, when the source supplies it. */
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  source: 'yahoo';
  fromCache: boolean;
  error: string | null;
}

export interface QuoteBatch {
  quotes: Quote[];
  requested: number;
  ok: number;
  failed: number;
  fetchedAt: string;
}

const ENDPOINT = 'https://query1.finance.yahoo.com/v8/finance/chart/';

const n = (v: unknown): number | null => {
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : null;
};

/** Parse one chart response. Exported so it can be tested without a network. */
export function parseQuote(symbol: string, body: string, fromCache = false): Quote {
  const empty: Quote = {
    symbol, price: null, previousClose: null, change: null, changePct: null,
    currency: '', exchange: '', asOf: null, dayHigh: null, dayLow: null, volume: null,
    source: 'yahoo', fromCache, error: null,
  };
  let json: unknown;
  try { json = JSON.parse(body); } catch { return { ...empty, error: 'the quote response was not JSON' }; }

  const chart = (json as { chart?: { result?: Array<Record<string, unknown>>; error?: { description?: string } } })?.chart;
  if (chart?.error?.description) return { ...empty, error: String(chart.error.description).slice(0, 120) };
  const result = chart?.result?.[0] as Record<string, unknown> | undefined;
  if (!result) return { ...empty, error: 'no quote data for that symbol' };

  const meta = (result['meta'] ?? {}) as Record<string, unknown>;
  const price = n(meta['regularMarketPrice']);
  const prev = n(meta['chartPreviousClose']) ?? n(meta['previousClose']);
  const change = price !== null && prev !== null ? Math.round((price - prev) * 100) / 100 : null;
  const changePct = change !== null && prev ? Math.round((change / prev) * 10000) / 100 : null;

  const indicators = (result['indicators'] ?? {}) as Record<string, Array<Record<string, unknown>>>;
  const q = indicators['quote']?.[0] ?? {};
  const highArr = (q['high'] as Array<number | null> | undefined) ?? [];
  const lowArr = (q['low'] as Array<number | null> | undefined) ?? [];
  const volArr = (q['volume'] as Array<number | null> | undefined) ?? [];
  const dayHigh = n(highArr.filter((x) => x !== null).at(-1));
  const dayLow = n(lowArr.filter((x) => x !== null).at(-1));
  const volume = n(volArr.filter((x) => x !== null).at(-1));

  const t = n(meta['regularMarketTime']);
  return {
    symbol: String(meta['symbol'] ?? symbol),
    price, previousClose: prev, change, changePct,
    currency: String(meta['currency'] ?? ''),
    exchange: String(meta['fullExchangeName'] ?? meta['exchangeName'] ?? ''),
    asOf: t ? new Date(t * 1000).toISOString() : null,
    dayHigh, dayLow, volume,
    source: 'yahoo', fromCache, error: null,
  };
}

/** Fetch one quote. */
export async function fetchQuote(symbol: string): Promise<Quote> {
  const url = `${ENDPOINT}${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  const res = await polite.get(url);
  if (!res.ok || !res.body) {
    return {
      symbol, price: null, previousClose: null, change: null, changePct: null,
      currency: '', exchange: '', asOf: null, dayHigh: null, dayLow: null, volume: null,
      source: 'yahoo', fromCache: res.cached,
      error: res.error ?? `the quote source returned HTTP ${res.status}`,
    };
  }
  return parseQuote(symbol, res.body, res.cached);
}

/**
 * Fetch several quotes.
 *
 * They run one after another rather than in parallel: the polite client enforces a per-host
 * gap, and a burst of parallel requests to one host is exactly what it exists to prevent.
 */
export async function fetchQuotes(symbols: string[], limit = 25): Promise<QuoteBatch> {
  const list = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, limit);
  const quotes: Quote[] = [];
  for (const s of list) quotes.push(await fetchQuote(s));
  return {
    quotes,
    requested: list.length,
    ok: quotes.filter((q) => !q.error).length,
    failed: quotes.filter((q) => !!q.error).length,
    fetchedAt: new Date().toISOString(),
  };
}
