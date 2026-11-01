import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openDatabase, type Db } from '../src/finance/core/db';
import { ingestFixture, normaliseEdgarFacts } from '../src/finance/core/ingest';
import { Store } from '../src/finance/core/store';
import { analyseCompany } from '../src/finance/core/analysis';

let db: Db;
let store: Store;

beforeAll(() => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sift-')), 'sift.db');
  db = openDatabase(file);
  ingestFixture(db.db, { companies: 120, seed: 7, years: 10, quarters: 8 });
  store = new Store(db.db);
});

describe('fixture ingestion', () => {
  it('loads companies and statements', () => {
    const s = store.stats();
    expect(s.companies).toBe(120);
    expect(s.annual).toBe(120 * 10);
    expect(s.quarterly).toBe(120 * 8);
    expect(s.sources['fixture']).toBe(120);
    expect(s.sectors).toBeGreaterThan(5);
  });

  it('produces a balance sheet that actually balances', () => {
    const rows = db.db.prepare(`SELECT total_assets, total_liabilities FROM statements WHERE period_type='annual'`).all() as Array<{ total_assets: number; total_liabilities: number }>;
    expect(rows.length).toBeGreaterThan(1000);
    for (const r of rows) expect(Math.abs(r.total_assets - r.total_liabilities)).toBeLessThan(1);
  });

  it('is deterministic for identical options and seed', () => {
    const opts = { companies: 10, seed: 7, years: 5, quarters: 2 };
    const one = openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sift-')), 'a.db'));
    const two = openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sift-')), 'b.db'));
    ingestFixture(one.db, opts); ingestFixture(two.db, opts);
    const q = `SELECT symbol, sales, net_profit FROM statements s JOIN companies c ON c.id=s.company_id ORDER BY symbol, period_type, period_end`;
    expect(one.db.prepare(q).all()).toEqual(two.db.prepare(q).all());
  });
});

describe('screener queries', () => {
  it('filters on a single metric', () => {
    const r = store.screener('ROE > 15', { limit: 200 });
    expect(r.rows.length).toBeGreaterThan(0);
    for (const row of r.rows) expect(row.roe).toBeGreaterThan(15);
  });

  it('combines conditions with AND', () => {
    const r = store.screener('Debt to Equity < 0.5 AND ROE > 15', { limit: 200 });
    for (const row of r.rows) { expect(row.debtToEquity).toBeLessThan(0.5); expect(row.roe).toBeGreaterThan(15); }
  });

  it('sorts and paginates', () => {
    const r = store.screener('Market Cap > 0', { sort: 'market_cap', order: 'desc', limit: 5 });
    expect(r.rows.length).toBe(5);
    for (let i = 1; i < r.rows.length; i++) expect(r.rows[i - 1]!.marketCap).toBeGreaterThanOrEqual(r.rows[i]!.marketCap);
    expect(r.total).toBeGreaterThan(5);
  });

  it('supports text filters and NOT', () => {
    const sectors = store.sectors();
    const target = sectors[0]!.sector;
    const r = store.screener(`Sector = "${target}"`, { limit: 200 });
    expect(r.rows.length).toBeGreaterThan(0);
    for (const row of r.rows) expect(row.sector).toBe(target);
    const not = store.screener(`NOT Sector = "${target}"`, { limit: 200 });
    for (const row of not.rows) expect(row.sector).not.toBe(target);
  });

  it('returns the compiled SQL and bound params (no user text in SQL)', () => {
    const r = store.screener('ROE > 12 AND Sector = "FMCG"');
    expect(r.sql).toContain('?');
    expect(r.sql).not.toContain('FMCG');
    expect(r.params).toEqual([12, 'FMCG']);
  });

  it('rejects an injection attempt at compile time', () => {
    expect(() => store.screener('ROE > 1; DROP TABLE companies')).toThrow();
    expect(store.stats().companies).toBe(120); // table still there
  });
});

describe('company detail & search', () => {
  it('finds a company by symbol prefix', () => {
    const first = db.db.prepare(`SELECT symbol FROM companies ORDER BY id LIMIT 1`).get() as { symbol: string };
    const hits = store.search(first.symbol.slice(0, 3));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.symbol === first.symbol)).toBe(true);
  });

  it('returns full detail with all statement sets and peers', () => {
    const sym = (db.db.prepare(`SELECT symbol FROM companies ORDER BY id LIMIT 1`).get() as { symbol: string }).symbol;
    const d = store.company(sym);
    expect(d).not.toBeNull();
    expect(d!.annual.length).toBe(10);
    expect(d!.quarterly.length).toBe(8);
    expect(d!.ratios.length).toBeGreaterThan(0);
    expect(d!.shareholding.length).toBe(4);
    expect(d!.peers.length).toBeGreaterThan(0);
    expect(d!.latest?.symbol).toBe(sym);
  });

  it('returns null for an unknown symbol', () => {
    expect(store.company('NOPE')).toBeNull();
  });
});

describe('red-flag analysis', () => {
  it('flags every company whose promoter pledge is high', () => {
    const pledged = db.db.prepare(`SELECT c.symbol, sh.pledge_pct FROM companies c JOIN shareholding sh ON sh.company_id=c.id
      WHERE sh.pledge_pct >= 20`).all() as Array<{ symbol: string; pledge_pct: number }>;
    expect(pledged.length).toBeGreaterThan(0);
    for (const p of pledged) {
      const rep = analyseCompany(db.db, p.symbol);
      expect(rep!.flags.some((f) => f.code === 'promoter-pledge')).toBe(true);
    }
  });

  it('produces a bounded score and a readable summary', () => {
    const sym = (db.db.prepare(`SELECT symbol FROM companies ORDER BY id LIMIT 1`).get() as { symbol: string }).symbol;
    const rep = analyseCompany(db.db, sym)!;
    expect(rep.score).toBeGreaterThanOrEqual(0);
    expect(rep.score).toBeLessThanOrEqual(100);
    expect(['strong', 'fair', 'weak']).toContain(rep.verdict);
    expect(rep.summary).toContain(sym);
  });

  it('returns null for an unknown symbol', () => {
    expect(analyseCompany(db.db, 'NOPE')).toBeNull();
  });
});

describe('EDGAR mapping (no network)', () => {
  it('maps companyfacts into annual statements', () => {
    const facts = {
      cik: 320193, entityName: 'Example Corp',
      facts: { 'us-gaap': {
        Revenues: { units: { USD: [{ end: '2023-09-30', val: 383285, fy: 2023, fp: 'FY', form: '10-K' }, { end: '2022-09-30', val: 394328, fy: 2022, fp: 'FY', form: '10-K' }] } },
        NetIncomeLoss: { units: { USD: [{ end: '2023-09-30', val: 96995, fy: 2023, fp: 'FY', form: '10-K' }] } },
        Assets: { units: { USD: [{ end: '2023-09-30', val: 352583, fy: 2023, fp: 'FY', form: '10-K' }] } },
      } },
    };
    const out = normaliseEdgarFacts(facts);
    expect(out.name).toBe('Example Corp');
    expect(out.annual.length).toBe(2);
    expect(out.annual[1]!.sales).toBe(383285);
    expect(out.annual[1]!.netProfit).toBe(96995);
    expect(out.annual[1]!.fiscalYear).toBe(2023);
  });

  it('ignores quarterly filings when building the annual series', () => {
    const facts = {
      cik: 1, entityName: 'Q',
      facts: { 'us-gaap': { Revenues: { units: { USD: [
        { end: '2023-03-31', val: 100, fy: 2023, fp: 'Q1', form: '10-Q' },
        { end: '2023-12-31', val: 400, fy: 2023, fp: 'FY', form: '10-K' },
      ] } } } },
    };
    const out = normaliseEdgarFacts(facts);
    expect(out.annual.length).toBe(1);
    expect(out.annual[0]!.sales).toBe(400);
  });
});
