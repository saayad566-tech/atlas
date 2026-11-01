// Yahoo Finance client — the live universe.
//
// There is no hard-coded company list: a search returns whatever Yahoo knows about,
// on any exchange, and a symbol can be fetched on demand. Endpoints used are the
// public ones the web app itself calls (search, chart, quoteSummary with a crumb).
//
// The crumb flow is: GET https://fc.yahoo.com (sets cookies) → GET /v1/test/getcrumb
// → pass `crumb` on quoteSummary. HttpSession carries the cookies.
import { HttpSession, type SimpleResponse } from './net';

export interface SearchHit { symbol: string; name: string; exchange: string; quoteType: string; currency?: string; score?: number }

export interface QuoteSummary {
  symbol: string; name: string; sector: string; industry: string; country: string; employees: number | null;
  website: string; description: string; currency: string; exchange: string;
  price: number; marketCap: number; pe: number; forwardPe: number; pb: number; eps: number;
  dividendYield: number; beta: number; week52High: number; week52Low: number;
  targetMeanPrice: number; targetLow: number; targetHigh: number; targetMedian: number; analystCount: number; recommendation: string;
  totalRevenue: number; revenueGrowth: number; grossMargins: number; operatingMargins: number; profitMargins: number;
  returnOnEquity: number; returnOnAssets: number; debtToEquity: number; currentRatio: number;
  totalCash: number; totalDebt: number; freeCashflow: number; operatingCashflow: number; earningsGrowth: number;
}

export interface PricePoint {
  date: string; close: number;
  // Yahoo returns these; discarding them cost us ATR, Stochastic, Williams %R, OBV,
  // candlesticks and volume bars. They are optional so an older cached payload still parses.
  open?: number; high?: number; low?: number; volume?: number;
}

const n = (v: unknown): number => {
  if (v && typeof v === 'object' && 'raw' in (v as Record<string, unknown>)) {
    const raw = (v as { raw?: unknown }).raw;
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  }
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
};
const s = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Parse Yahoo's /v1/finance/search response. */
export function parseSearch(json: unknown): SearchHit[] {
  const j = json as { quotes?: Array<Record<string, unknown>> } | undefined;
  const quotes = j?.quotes;
  if (!Array.isArray(quotes)) return [];
  return quotes
    .filter((q) => (q['quoteType'] === 'EQUITY' || q['quoteType'] === 'ETF') && typeof q['symbol'] === 'string')
    .map((q) => ({
      symbol: String(q['symbol']),
      name: s(q['longname']) || s(q['shortname']) || String(q['symbol']),
      exchange: s(q['exchDisp']) || s(q['exchange']),
      quoteType: s(q['quoteType']),
      currency: s(q['currency']) || undefined,
      score: typeof q['score'] === 'number' ? q['score'] : undefined,
    }));
}

/** Parse Yahoo's /v10/finance/quoteSummary response (price, summaryDetail, key stats, financialData, assetProfile). */
export function parseQuoteSummary(json: unknown): QuoteSummary | null {
  const j = json as { quoteSummary?: { result?: Array<Record<string, unknown>> } } | undefined;
  const r = j?.quoteSummary?.result?.[0];
  if (!r) return null;
  const price = (r['price'] ?? {}) as Record<string, unknown>;
  const detail = (r['summaryDetail'] ?? {}) as Record<string, unknown>;
  const stats = (r['defaultKeyStatistics'] ?? {}) as Record<string, unknown>;
  const fin = (r['financialData'] ?? {}) as Record<string, unknown>;
  const profile = (r['assetProfile'] ?? {}) as Record<string, unknown>;
  const symbol = s(price['symbol']);
  if (!symbol) return null;
  return {
    symbol,
    name: s(price['longName']) || s(price['shortName']) || symbol,
    sector: s(profile['sector']) || 'Unclassified',
    industry: s(profile['industry']) || 'Unclassified',
    country: s(profile['country']),
    employees: n(profile['fullTimeEmployees']) || null,
    website: s(profile['website']),
    description: s(profile['longBusinessSummary']),
    currency: s(price['currency']),
    exchange: s(price['exchangeName']),
    price: n(price['regularMarketPrice']),
    marketCap: n(price['marketCap']),
    pe: n(detail['trailingPE']),
    forwardPe: n(detail['forwardPE']),
    pb: n(stats['priceToBook']),
    eps: n(stats['trailingEps']),
    dividendYield: n(detail['dividendYield']),
    beta: n(detail['beta']),
    week52High: n(detail['fiftyTwoWeekHigh']),
    week52Low: n(detail['fiftyTwoWeekLow']),
    targetMeanPrice: n(fin['targetMeanPrice']),
    targetLow: n(fin['targetLowPrice']), targetHigh: n(fin['targetHighPrice']),
    targetMedian: n(fin['targetMedianPrice']), analystCount: n(fin['numberOfAnalystOpinions']),
    recommendation: s(fin['recommendationKey']),
    totalRevenue: n(fin['totalRevenue']),
    revenueGrowth: n(fin['revenueGrowth']),
    grossMargins: n(fin['grossMargins']),
    operatingMargins: n(fin['operatingMargins']),
    profitMargins: n(fin['profitMargins']),
    returnOnEquity: n(fin['returnOnEquity']),
    returnOnAssets: n(fin['returnOnAssets']),
    debtToEquity: n(fin['debtToEquity']),
    currentRatio: n(fin['currentRatio']),
    totalCash: n(fin['totalCash']),
    totalDebt: n(fin['totalDebt']),
    freeCashflow: n(fin['freeCashflow']),
    operatingCashflow: n(fin['operatingCashflow']),
    earningsGrowth: n(fin['earningsGrowth']),
  };
}

/** Parse Yahoo's /v8/finance/chart response into dated closes. */
export function parseChart(json: unknown): { currency: string; exchange: string; price: number; points: PricePoint[] } | null {
  const j = json as { chart?: { result?: Array<Record<string, unknown>> } } | undefined;
  const r = j?.chart?.result?.[0];
  if (!r) return null;
  const meta = (r['meta'] ?? {}) as Record<string, unknown>;
  const timestamps = (r['timestamp'] ?? []) as number[];
  const indicators = (r['indicators'] ?? {}) as {
    quote?: Array<{
      close?: Array<number | null>; open?: Array<number | null>;
      high?: Array<number | null>; low?: Array<number | null>; volume?: Array<number | null>;
    }>;
  };
  const q0 = indicators.quote?.[0] ?? {};
  const closes = q0.close ?? [];
  const opens = q0.open ?? [];
  const highs = q0.high ?? [];
  const lows = q0.low ?? [];
  const volumes = q0.volume ?? [];
  const num = (arr: Array<number | null>, i: number): number | undefined => {
    const v = arr[i];
    return typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : undefined;
  };
  const points: PricePoint[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    if (typeof c === 'number' && Number.isFinite(c)) {
      points.push({
        date: new Date(timestamps[i]! * 1000).toISOString().slice(0, 10),
        close: Math.round(c * 100) / 100,
        open: num(opens, i), high: num(highs, i), low: num(lows, i),
        volume: typeof volumes[i] === 'number' ? volumes[i]! : undefined,
      });
    }
  }
  return {
    currency: s(meta['currency']),
    exchange: s(meta['fullExchangeName']) || s(meta['exchangeName']),
    price: n(meta['regularMarketPrice']),
    points,
  };
}

/** Live client with the cookie + crumb handshake handled once per session. */
export class YahooClient {
  private session = new HttpSession();
  private crumb: string | null = null;
  private crumbAt = 0;
  constructor(private getter?: (url: string, headers?: Record<string, string>) => Promise<SimpleResponse>) {}

  /** GET with one polite retry on 429/5xx — Yahoo throttles bursts. */
  private async fetchText(url: string, headers: Record<string, string> = {}): Promise<SimpleResponse> {
    const once = async (): Promise<SimpleResponse> => (this.getter ? this.getter(url, headers) : this.session.get(url, headers));
    let res = await once();
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 900));
      res = await once();
    }
    return res;
  }

  /** Fetch (and cache for 30 minutes) the crumb required by quoteSummary. */
  async ensureCrumb(): Promise<string | null> {
    if (this.crumb && Date.now() - this.crumbAt < 30 * 60 * 1000) return this.crumb;
    try {
      await this.fetchText('https://fc.yahoo.com', { Accept: 'text/html' });
      // The crumb endpoint answers 406 if asked for application/json.
      const res = await this.fetchText('https://query1.finance.yahoo.com/v1/test/getcrumb', { Accept: '*/*' });
      const crumb = (res.body || '').trim();
      if (res.status === 200 && crumb && crumb.length < 40) { this.crumb = crumb; this.crumbAt = Date.now(); return crumb; }
    } catch { /* leave null */ }
    return null;
  }

  async search(query: string, count = 12): Promise<SearchHit[]> {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=${count}&newsCount=0`;
    const res = await this.fetchText(url);
    if (res.status !== 200) return [];
    try { return parseSearch(JSON.parse(res.body)); } catch { return []; }
  }

  async summary(symbol: string): Promise<QuoteSummary | null> {
    const crumb = await this.ensureCrumb();
    if (!crumb) return null;
    const modules = 'price,summaryDetail,defaultKeyStatistics,financialData,assetProfile';
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&crumb=${encodeURIComponent(crumb)}`;
    const res = await this.fetchText(url);
    if (res.status !== 200) return null;
    try { return parseQuoteSummary(JSON.parse(res.body)); } catch { return null; }
  }

  /**
   * The whole equity universe for a region, via Yahoo's custom screener.
   * This is the only free source found that lists every listed company per country
   * (Japan 3,814 / Singapore 539 / Hong Kong 9,177 at the time of writing), rather than
   * one index's constituents.
   */
  /** Companies in a sector within a region — the peer universe for one company. */
  async screenSector(region: string, sector: string, offsetOrSize = 10, maybeSize?: number): Promise<{ total: number; symbols: Array<{ symbol: string; name: string; exchange: string }> }> {
    // Backwards compatible: (region, sector, size) or (region, sector, offset, size).
    const offset = maybeSize === undefined ? 0 : offsetOrSize;
    const size = maybeSize === undefined ? offsetOrSize : maybeSize;
    const crumb = await this.ensureCrumb();
    if (!crumb) return { total: 0, symbols: [] };
    const body = JSON.stringify({
      size, offset, sortField: 'intradaymarketcap', sortType: 'DESC', quoteType: 'EQUITY',
      query: {
        operator: 'AND',
        operands: [
          { operator: 'eq', operands: ['region', region] },
          { operator: 'eq', operands: ['sector', sector] },
        ],
      },
      userId: '', userIdType: 'guid',
    });
    const url = `https://query1.finance.yahoo.com/v1/finance/screener?crumb=${encodeURIComponent(crumb)}`;
    const res = await this.session.post(url, body);
    if (res.status !== 200) return { total: 0, symbols: [] };
    try {
      const j = JSON.parse(res.body) as { finance?: { result?: Array<{ total?: number; quotes?: Array<Record<string, unknown>> }> } };
      const r = j.finance?.result?.[0];
      const quotes = r?.quotes ?? [];
      return {
        total: r?.total ?? quotes.length,
        symbols: quotes.map((q) => ({ symbol: String(q['symbol'] ?? ''), name: String(q['longName'] ?? q['shortName'] ?? ''), exchange: String(q['exchange'] ?? '') })).filter((x) => x.symbol),
      };
    } catch { return { total: 0, symbols: [] }; }
  }

  /**
   * Sector sweep narrowed to a market-cap band. Yahoo caps a single query at ~1,150 rows,
   * so a large sector is split into bands to retrieve everything.
   */
  async screenSectorBracket(region: string, sector: string, lo: number, hi: number, offset = 0, size = 50): Promise<{ total: number; symbols: Array<{ symbol: string; name: string; exchange: string }> }> {
    const crumb = await this.ensureCrumb();
    if (!crumb) return { total: 0, symbols: [] };
    const body = JSON.stringify({
      size, offset, sortField: 'intradaymarketcap', sortType: 'DESC', quoteType: 'EQUITY',
      query: { operator: 'AND', operands: [
        { operator: 'eq', operands: ['region', region] },
        { operator: 'eq', operands: ['sector', sector] },
        { operator: 'gt', operands: ['intradaymarketcap', lo] },
        { operator: 'lt', operands: ['intradaymarketcap', hi] },
      ] },
      userId: '', userIdType: 'guid',
    });
    const url = `https://query1.finance.yahoo.com/v1/finance/screener?crumb=${encodeURIComponent(crumb)}`;
    const res = await this.session.post(url, body);
    if (res.status !== 200) return { total: 0, symbols: [] };
    try {
      const j = JSON.parse(res.body) as { finance?: { result?: Array<{ total?: number; quotes?: Array<Record<string, unknown>> }> } };
      const r = j.finance?.result?.[0];
      const quotes = r?.quotes ?? [];
      return {
        total: r?.total ?? quotes.length,
        symbols: quotes.map((q) => ({ symbol: String(q['symbol'] ?? ''), name: String(q['longName'] ?? q['shortName'] ?? ''), exchange: String(q['exchange'] ?? '') })).filter((x) => x.symbol),
      };
    } catch { return { total: 0, symbols: [] }; }
  }

  /**
   * Sweep by exchange instead of sector. Needed because Yahoo's US screener returns an
   * empty result for several sectors (Healthcare, Energy, …) while exchange queries work.
   */
  async screenExchange(region: string, exchange: string, offset = 0, size = 50): Promise<{ total: number; symbols: Array<{ symbol: string; name: string; exchange: string }> }> {
    const crumb = await this.ensureCrumb();
    if (!crumb) return { total: 0, symbols: [] };
    const body = JSON.stringify({
      size, offset, sortField: 'intradaymarketcap', sortType: 'DESC', quoteType: 'EQUITY',
      query: { operator: 'AND', operands: [
        { operator: 'eq', operands: ['region', region] },
        { operator: 'eq', operands: ['exchange', exchange] },
      ] },
      userId: '', userIdType: 'guid',
    });
    const url = `https://query1.finance.yahoo.com/v1/finance/screener?crumb=${encodeURIComponent(crumb)}`;
    const res = await this.session.post(url, body);
    if (res.status !== 200) return { total: 0, symbols: [] };
    try {
      const j = JSON.parse(res.body) as { finance?: { result?: Array<{ total?: number; quotes?: Array<Record<string, unknown>> }> } };
      const r = j.finance?.result?.[0];
      const quotes = r?.quotes ?? [];
      return {
        total: r?.total ?? quotes.length,
        symbols: quotes.map((q) => ({ symbol: String(q['symbol'] ?? ''), name: String(q['longName'] ?? q['shortName'] ?? ''), exchange: String(q['exchange'] ?? exchange) })).filter((x) => x.symbol),
      };
    } catch { return { total: 0, symbols: [] }; }
  }

  async screenRegion(region: string, offset = 0, size = 250): Promise<{ total: number; symbols: Array<{ symbol: string; name: string; exchange: string }> }> {
    const crumb = await this.ensureCrumb();
    if (!crumb) return { total: 0, symbols: [] };
    const body = JSON.stringify({
      size, offset, sortField: 'intradaymarketcap', sortType: 'DESC', quoteType: 'EQUITY',
      query: { operator: 'AND', operands: [{ operator: 'eq', operands: ['region', region] }] },
      userId: '', userIdType: 'guid',
    });
    const url = `https://query1.finance.yahoo.com/v1/finance/screener?crumb=${encodeURIComponent(crumb)}`;
    const res = await this.session.post(url, body);
    if (res.status !== 200) return { total: 0, symbols: [] };
    try {
      const j = JSON.parse(res.body) as { finance?: { result?: Array<{ total?: number; quotes?: Array<Record<string, unknown>> }> } };
      const r = j.finance?.result?.[0];
      const quotes = r?.quotes ?? [];
      return {
        total: r?.total ?? quotes.length,
        symbols: quotes.map((q) => ({
          symbol: String(q['symbol'] ?? ''),
          name: String((q['longName'] ?? q['shortName'] ?? q['symbol']) ?? ''),
          exchange: String(q['exchange'] ?? ''),
        })).filter((x) => x.symbol),
      };
    } catch { return { total: 0, symbols: [] }; }
  }

  /** Fetch an arbitrary set of quoteSummary modules (analysts, holders, calendar…). */
  async summaryModules(symbol: string, modules: string): Promise<unknown | null> {
    const crumb = await this.ensureCrumb();
    if (!crumb) return null;
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&crumb=${encodeURIComponent(crumb)}`;
    const res = await this.fetchText(url);
    if (res.status !== 200) return null;
    try { return JSON.parse(res.body); } catch { return null; }
  }

  /** Chart with dividend/split events and volume. */
  async chartExtras(symbol: string, range = '5y'): Promise<unknown | null> {
    return this.raw(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&events=div%2Csplit`);
  }

  /** Raw GET for endpoints that return their own shape (fundamentals timeseries). */
  async raw(url: string): Promise<unknown | null> {
    const res = await this.fetchText(url);
    if (res.status !== 200) return null;
    try { return JSON.parse(res.body); } catch { return null; }
  }

  async chart(symbol: string, range = '1y', interval = '1d'): Promise<{ currency: string; exchange: string; price: number; points: PricePoint[] } | null> {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
    const res = await this.fetchText(url);
    if (res.status !== 200) return null;
    try { return parseChart(JSON.parse(res.body)); } catch { return null; }
  }
}
