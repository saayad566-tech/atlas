import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openDatabase, type Db } from '../src/finance/core/db';
import { parseSearch, parseQuoteSummary, parseChart } from '../src/finance/core/yahoo';
import { upsertLiveCompany, storePrices, priceAnalytics, marketBreadth, liveCompanies, ensureLiveTables } from '../src/finance/core/live';
import { Store } from '../src/finance/core/store';

let db: Db;
beforeAll(() => {
  db = openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-live-')), 'l.db'));
  ensureLiveTables(db.db);
});

const SEARCH_FIXTURE = {
  quotes: [
    { symbol: 'RELIANCE.NS', longname: 'Reliance Industries Limited', shortname: 'RELIANCE INDUSTRIES', exchange: 'NSI', exchDisp: 'NSE', quoteType: 'EQUITY', score: 21519 },
    { symbol: 'RS', longname: 'Reliance, Inc.', exchDisp: 'NYSE', quoteType: 'EQUITY', score: 120 },
    { symbol: '^NSEI', quoteType: 'INDEX', exchDisp: 'NSE' },
  ],
};

const SUMMARY_FIXTURE = {
  quoteSummary: { result: [{
    price: { symbol: 'AAPL', longName: 'Apple Inc.', currency: 'USD', exchangeName: 'NMS', regularMarketPrice: { raw: 255.4 }, marketCap: { raw: 5019084521472 } },
    summaryDetail: { trailingPE: { raw: 39.44 }, forwardPE: { raw: 32.1 }, dividendYield: { raw: 0.0041 }, beta: { raw: 1.09 }, fiftyTwoWeekHigh: { raw: 260 }, fiftyTwoWeekLow: { raw: 169 } },
    defaultKeyStatistics: { priceToBook: { raw: 54.2 }, trailingEps: { raw: 6.47 } },
    financialData: { returnOnEquity: { raw: 1.4875 }, returnOnAssets: { raw: 0.28 }, debtToEquity: { raw: 152.4 }, currentRatio: { raw: 0.92 },
      totalRevenue: { raw: 400000000000 }, revenueGrowth: { raw: 0.08 }, operatingMargins: { raw: 0.32 }, profitMargins: { raw: 0.26 },
      grossMargins: { raw: 0.47 }, targetMeanPrice: { raw: 329.25 }, recommendationKey: 'buy', freeCashflow: { raw: 100000000000 },
      totalCash: { raw: 30000000000 }, totalDebt: { raw: 100000000000 }, earningsGrowth: { raw: 0.11 } },
    assetProfile: { sector: 'Technology', industry: 'Consumer Electronics', country: 'United States', fullTimeEmployees: 164000, website: 'https://apple.com', longBusinessSummary: 'Apple Inc. designs and sells consumer devices.' },
  }] },
};

const CHART_FIXTURE = {
  chart: { result: [{
    meta: { currency: 'INR', fullExchangeName: 'NSE', regularMarketPrice: 1190 },
    timestamp: [1700000000, 1700086400, 1700172800, 1700259200],
    indicators: { quote: [{ close: [100, 102, null, 105] }] },
  }] },
};

describe('Yahoo parsers', () => {
  it('keeps equities and drops indices', () => {
    const hits = parseSearch(SEARCH_FIXTURE);
    expect(hits.length).toBe(2);
    expect(hits[0]!.symbol).toBe('RELIANCE.NS');
    expect(hits[0]!.exchange).toBe('NSE');
    expect(hits.some((h) => h.symbol === '^NSEI')).toBe(false);
  });

  it('maps quoteSummary fields', () => {
    const q = parseQuoteSummary(SUMMARY_FIXTURE)!;
    expect(q.symbol).toBe('AAPL');
    expect(q.sector).toBe('Technology');
    expect(q.pe).toBeCloseTo(39.44, 2);
    expect(q.marketCap).toBe(5019084521472);
    expect(q.employees).toBe(164000);
    expect(q.description).toMatch(/designs and sells/);
    expect(q.targetMeanPrice).toBeCloseTo(329.25, 2);
  });

  it('returns null for an empty quoteSummary', () => {
    expect(parseQuoteSummary({ quoteSummary: { result: [] } })).toBeNull();
  });

  it('parses chart closes and skips null points', () => {
    const c = parseChart(CHART_FIXTURE)!;
    expect(c.points.length).toBe(3);
    expect(c.points[0]!.close).toBe(100);
    expect(c.currency).toBe('INR');
  });
});

describe('live universe upsert', () => {
  it('creates a company once and updates it on refetch', () => {
    const q = parseQuoteSummary(SUMMARY_FIXTURE)!;
    const first = upsertLiveCompany(db.db, q);
    expect(first.created).toBe(true);
    const second = upsertLiveCompany(db.db, { ...q, price: 260, pe: 41 });
    expect(second.created).toBe(false);
    expect(second.companyId).toBe(first.companyId);
    const count = (db.db.prepare(`SELECT COUNT(*) AS n FROM companies WHERE symbol='AAPL'`).get() as { n: number }).n;
    expect(count).toBe(1);
    const price = (db.db.prepare(`SELECT price FROM quotes WHERE company_id=?`).get(first.companyId) as { price: number }).price;
    expect(price).toBe(260);
  });

  it('makes the live company screenable', () => {
    const store = new Store(db.db);
    const r = store.screener('Symbol = "AAPL"');
    expect(r.rows.length).toBe(1);
    expect(r.rows[0]!.sector).toBe('Technology');
  });

  it('stores price history and exposes the company as live', () => {
    const n = storePrices(db.db, 'AAPL', parseChart(CHART_FIXTURE)!.points);
    expect(n).toBe(3);
    const live = liveCompanies(db.db);
    expect(live.some((c) => c.symbol === 'AAPL')).toBe(true);
  });
});

describe('price analytics', () => {
  it('computes returns, drawdown and 52-week position from a known series', () => {
    // 300 sessions: rise 100 → 200 then fall to 150.
    const points = [];
    for (let i = 0; i < 300; i++) {
      const close = i <= 150 ? 100 + i * (100 / 150) : 200 - (i - 150) * (50 / 149);
      points.push({ date: new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10), close: Math.round(close * 100) / 100 });
    }
    storePrices(db.db, 'AAPL', points);
    const a = priceAnalytics(db.db, 'AAPL')!;
    expect(a.points).toBe(300);
    expect(a.last).toBeCloseTo(150, 0);
    expect(a.maxDrawdownPct!).toBeLessThan(-20);       // 200 → 150 is -25%
    expect(a.week52.positionPct!).toBeGreaterThan(0);
    expect(a.week52.positionPct!).toBeLessThan(100);
    expect(a.returns.m1).not.toBeNull();
    expect(a.sparkline.length).toBeGreaterThan(5);
  });

  it('handles a company with no price history', () => {
    const q = parseQuoteSummary(SUMMARY_FIXTURE)!;
    const up = upsertLiveCompany(db.db, { ...q, symbol: 'NOPRICE', name: 'No Price Co' });
    expect(up.created).toBe(true);
    const a = priceAnalytics(db.db, 'NOPRICE')!;
    expect(a.points).toBe(0);
    expect(a.last).toBeNull();
  });

  it('reports market breadth across stored histories', () => {
    const b = marketBreadth(db.db);
    expect(b.companies).toBeGreaterThan(0);
    expect(b.withPrices).toBeGreaterThan(0);
    expect(b.above52wLowPct).toBeGreaterThanOrEqual(0);
    expect(b.above52wLowPct).toBeLessThanOrEqual(100);
  });

  it('returns null for an unknown symbol', () => {
    expect(priceAnalytics(db.db, 'NOPE')).toBeNull();
  });
});
