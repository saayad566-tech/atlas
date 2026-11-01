import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openDatabase, type Db } from '../src/finance/core/db';
import { parseQuoteSummary } from '../src/finance/core/yahoo';
import { upsertLiveCompany, ensureLiveTables } from '../src/finance/core/live';
import { parseTimeseries, buildStatements, storeHistory, recomputeAllRatios, coverage } from '../src/finance/core/fundamentals';
import { scores } from '../src/finance/core/scores';
import { deepMetrics } from '../src/finance/core/metrics';
import { valuationReport } from '../src/finance/core/valuation2';

let db: Db;
beforeAll(() => {
  db = openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-fund-')), 'f.db'));
  ensureLiveTables(db.db);
});

const CR = 1e7; // the source reports currency units; the DB stores crore
const point = (date: string, raw: number): Record<string, unknown> => ({ asOfDate: date, periodType: '12M', reportedValue: { raw } });
const cr = (v: number): number => v * CR; // express a fixture value in crore

/** Yahoo returns prefixed type keys — the parser must normalise them. */
const TIMESERIES_FIXTURE = {
  timeseries: { result: [
    { meta: { type: ['annualTotalRevenue'] }, annualTotalRevenue: [point('2022-03-31', cr(1000)), point('2023-03-31', cr(1100)), point('2024-03-31', cr(1250)), point('2025-03-31', cr(1400))] },
    { meta: { type: ['annualNetIncome'] }, annualNetIncome: [point('2022-03-31', cr(100)), point('2023-03-31', cr(110)), point('2024-03-31', cr(130)), point('2025-03-31', cr(150))] },
    { meta: { type: ['annualEBITDA'] }, annualEBITDA: [point('2025-03-31', cr(300))] },
    { meta: { type: ['annualTotalAssets'] }, annualTotalAssets: [point('2025-03-31', cr(2000))] },
    { meta: { type: ['annualStockholdersEquity'] }, annualStockholdersEquity: [point('2025-03-31', cr(1000))] },
    { meta: { type: ['annualTotalDebt'] }, annualTotalDebt: [point('2025-03-31', cr(400))] },
    { meta: { type: ['annualOperatingCashFlow'] }, annualOperatingCashFlow: [point('2025-03-31', cr(200))] },
    { meta: { type: ['annualDilutedEPS'] }, annualDilutedEPS: [point('2025-03-31', 1.5)] },
  ] },
};

describe('fundamentals timeseries', () => {
  it('normalises the annual/quarterly prefix on type keys', () => {
    const s = parseTimeseries(TIMESERIES_FIXTURE);
    expect(Object.keys(s)).toContain('TotalRevenue');
    expect(Object.keys(s)).toContain('NetIncome');
    expect(Object.keys(s).some((k) => k.startsWith('annual'))).toBe(false);
  });

  it('builds one statement row per period and skips empty ones', () => {
    const rows = buildStatements(parseTimeseries(TIMESERIES_FIXTURE), 'annual');
    expect(rows.length).toBe(4);
    const latest = rows[rows.length - 1]!;
    expect(latest.periodEnd).toBe('2025-03-31');
    expect(latest.sales / CR).toBe(1400);
    expect(latest.netProfit / CR).toBe(150);
    expect(latest.operatingProfit / CR).toBe(300);
    expect(latest.reserves / CR).toBe(1000);
    expect(latest.borrowings / CR).toBe(400);
    expect(latest.eps).toBe(1.5);
    expect(latest.opmPct).toBeCloseTo((300 / 1400) * 100, 2);
  });

  it('returns no rows when revenue is absent', () => {
    expect(buildStatements({ NetIncome: [{ date: '2025-03-31', value: 10 }] }, 'annual').length).toBe(0);
  });
});

describe('pipeline: live company with history', () => {
  const q = parseQuoteSummary({
    quoteSummary: { result: [{
      price: { symbol: 'TESTCO', longName: 'Test Co', currency: 'INR', exchangeName: 'NSI', regularMarketPrice: { raw: 150 }, marketCap: { raw: 15000 } },
      summaryDetail: { trailingPE: { raw: 10 } },
      financialData: { returnOnEquity: { raw: 0.15 } },
      assetProfile: { sector: 'Industrials', industry: 'Machinery' },
    }] },
  })!;

  it('stores history and recomputes a ratio row for every annual period', () => {
    upsertLiveCompany(db.db, q);
    const rows = buildStatements(parseTimeseries(TIMESERIES_FIXTURE), 'annual');
    const r = storeHistory(db.db, 'TESTCO', rows, 150);
    expect(r.stored).toBe(4);
    expect(r.periods).toBe(4);
    const ratios = db.db.prepare(`SELECT period_end, roe, debt_to_equity, market_cap FROM ratios WHERE company_id=(SELECT id FROM companies WHERE symbol='TESTCO') ORDER BY period_end`).all() as Array<{ period_end: string; roe: number; debt_to_equity: number; market_cap: number }>;
    expect(ratios.length).toBe(4);
    expect(ratios[3]!.roe).toBeCloseTo(15, 1);          // 150 / 1000
    expect(ratios[3]!.debt_to_equity).toBeCloseTo(0.4, 2);
    // Shares = market cap ÷ price = 15000 / 150 = 100 → market cap 150 × 100 = 15000.
    expect(ratios[3]!.market_cap).toBeCloseTo(15000, 0);
  });

  it('makes every deep-analysis function produce a number', () => {
    const s = scores(db.db, 'TESTCO')!;
    expect(s.piotroski).not.toBeNull();
    expect(s.piotroski!.checks.length).toBe(9);
    expect(s.altman).not.toBeNull();
    expect(Number.isFinite(s.altman!.z)).toBe(true);
    const m = deepMetrics(db.db, 'TESTCO')!;
    expect(m.dupont).not.toBeNull();
    expect(m.ccc).not.toBeNull();
    expect(m.cagr.sales3).not.toBeNull();               // 4 annual periods → a 3y CAGR
    const v = valuationReport(db.db, 'TESTCO')!;
    expect(v.blended).not.toBeNull();
    expect(v.models.some((x) => x.value !== null)).toBe(true);
  });

  it('reports coverage so the UI knows when history is missing', () => {
    const c = coverage(db.db, 'TESTCO');
    expect(c.annual).toBe(4);
    expect(c.years).toBe(4);
    expect(c.ready).toBe(true);
    expect(coverage(db.db, 'NOPE').ready).toBe(false);
  });

  it('recompute is idempotent', () => {
    const id = (db.db.prepare(`SELECT id FROM companies WHERE symbol='TESTCO'`).get() as { id: number }).id;
    const a = recomputeAllRatios(db.db, id, 150);
    const b = recomputeAllRatios(db.db, id, 150);
    expect(a).toBe(b);
    const n = (db.db.prepare(`SELECT COUNT(*) AS n FROM ratios WHERE company_id=?`).get(id) as { n: number }).n;
    expect(n).toBe(4);
  });
});
