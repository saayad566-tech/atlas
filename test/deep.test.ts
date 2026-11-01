import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openDatabase, type Db } from '../src/finance/core/db';
import { ingestFixture } from '../src/finance/core/ingest';
import { Store } from '../src/finance/core/store';
import { deepMetrics, peerMatrix } from '../src/finance/core/metrics';
import { scores, piotroski, altman, beneish } from '../src/finance/core/scores';
import { PRESETS } from '../src/finance/core/presets';
import { Workflow } from '../src/finance/core/workflow';
import { parseWorldBank, parseYahooChart, parseStatementCsv, importStatementCsv } from '../src/finance/core/sources';
import { compileExpression } from '../src/finance/core/expr';

let db: Db; let store: Store; let flow: Workflow;
beforeAll(() => {
  db = openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sift-deep-')), 's.db'));
  ingestFixture(db.db, { companies: 80, seed: 5, years: 10, quarters: 4 });
  store = new Store(db.db);
  flow = new Workflow(db.db);
});
const anySymbol = (): string => (db.db.prepare(`SELECT symbol FROM companies ORDER BY id LIMIT 1`).get() as { symbol: string }).symbol;

describe('deep metrics', () => {
  it('computes DuPont, cash cycle, accruals and CAGRs', () => {
    const m = deepMetrics(db.db, anySymbol())!;
    expect(m).not.toBeNull();
    expect(m.dupont).not.toBeNull();
    expect(Number.isFinite(m.dupont!.roe)).toBe(true);
    expect(m.ccc!.days).toBeCloseTo(m.ccc!.dio + m.ccc!.dso - m.ccc!.dpo, 1);
    expect(Number.isFinite(m.accruals!)).toBe(true);
    expect(m.cagr.sales3 === null || Number.isFinite(m.cagr.sales3)).toBe(true);
    expect(m.years).toBe(10);
  });

  it('produces sector percentiles between 0 and 100', () => {
    const m = deepMetrics(db.db, anySymbol())!;
    const vals = Object.values(m.percentiles);
    expect(vals.length).toBeGreaterThan(3);
    for (const v of vals) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
  });

  it('returns null for an unknown symbol', () => {
    expect(deepMetrics(db.db, 'NOPE')).toBeNull();
  });

  it('builds a peer matrix that starts with the company itself', () => {
    const sym = anySymbol();
    const m = peerMatrix(db.db, sym)!;
    expect(m.self).toBe(sym);
    expect(m.peers[0]!.symbol).toBe(sym);
    expect(m.peers.length).toBeGreaterThan(1);
  });
});

describe('quant scores', () => {
  it('Piotroski returns 0..9 with nine named checks', () => {
    const s = scores(db.db, anySymbol())!;
    expect(s.piotroski).not.toBeNull();
    expect(s.piotroski!.checks.length).toBe(9);
    expect(s.piotroski!.score).toBeGreaterThanOrEqual(0);
    expect(s.piotroski!.score).toBeLessThanOrEqual(9);
    expect(s.piotroski!.score).toBe(s.piotroski!.checks.filter((c) => c.pass).length);
  });

  it('Altman returns a finite Z and a valid zone', () => {
    const s = scores(db.db, anySymbol())!;
    expect(s.altman).not.toBeNull();
    expect(Number.isFinite(s.altman!.z)).toBe(true);
    expect(['safe', 'grey', 'distress']).toContain(s.altman!.zone);
  });

  it('Beneish is flagged as simplified and states its approximations', () => {
    const s = scores(db.db, anySymbol())!;
    expect(s.beneish).not.toBeNull();
    expect(s.beneish!.simplified).toBe(true);
    expect(s.beneish!.notes.join(' ')).toMatch(/SGAI/);
    expect(typeof s.beneish!.flag).toBe('boolean');
  });

  it('composite score is bounded and graded', () => {
    const s = scores(db.db, anySymbol())!;
    expect(s.composite.score).toBeGreaterThanOrEqual(0);
    expect(s.composite.score).toBeLessThanOrEqual(100);
    expect(['A', 'B', 'C', 'D']).toContain(s.composite.grade);
    expect(Object.keys(s.composite.components).length).toBeGreaterThan(4);
  });

  it('returns null for an unknown symbol', () => {
    expect(scores(db.db, 'NOPE')).toBeNull();
  });
});

describe('presets', () => {
  it('ships 10 presets and every expression compiles', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(10);
    for (const p of PRESETS) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(() => compileExpression(p.expression)).not.toThrow();
    }
  });

  it('each preset runs against the data', () => {
    for (const p of PRESETS) {
      const r = store.screener(p.expression, { limit: 5 });
      expect(Array.isArray(r.rows)).toBe(true);
    }
  });
});

describe('workflow: saved screens, watchlist, notes, alerts', () => {
  it('saves, lists and deletes a screen', () => {
    const s = flow.saveScreen('Quality', 'ROE > 15');
    expect(flow.listScreens().some((x) => x.id === s.id)).toBe(true);
    expect(flow.deleteScreen(s.id)).toBe(true);
    expect(flow.listScreens().some((x) => x.id === s.id)).toBe(false);
  });

  it('adds and removes a watchlist entry', () => {
    const sym = anySymbol();
    flow.addWatch(sym);
    expect(flow.isWatched(sym)).toBe(true);
    expect(flow.watchlist().some((w) => w.symbol === sym)).toBe(true);
    flow.removeWatch(sym);
    expect(flow.isWatched(sym)).toBe(false);
  });

  it('rejects watching an unknown company', () => {
    expect(() => flow.addWatch('NOPE')).toThrow();
  });

  it('stores and reads a note', () => {
    const sym = anySymbol();
    flow.setNote(sym, 'watching margins');
    expect(flow.getNote(sym)!.body).toBe('watching margins');
  });

  it('raises alerts for a watchlisted high-pledge company', () => {
    const row = db.db.prepare(`SELECT c.symbol FROM companies c JOIN shareholding sh ON sh.company_id=c.id WHERE sh.pledge_pct >= 20 LIMIT 1`).get() as { symbol: string } | undefined;
    if (!row) return; // dataset may have none at this seed
    flow.addWatch(row.symbol);
    const alerts = flow.alerts();
    expect(alerts.some((a) => a.symbol === row.symbol && a.rule === 'promoter-pledge')).toBe(true);
    flow.removeWatch(row.symbol);
  });
});

describe('data sources', () => {
  it('parses a World Bank response', () => {
    const sample = [
      { page: 1 },
      [{ date: '2023', value: 7.8, indicator: { id: 'NY.GDP.MKTP.KD.ZG' }, country: { id: 'IN' } },
       { date: '2022', value: 9.1, indicator: { id: 'NY.GDP.MKTP.KD.ZG' }, country: { id: 'IN' } },
       { date: '2021', value: null, indicator: { id: 'NY.GDP.MKTP.KD.ZG' }, country: { id: 'IN' } }],
    ];
    const pts = parseWorldBank(sample);
    expect(pts.length).toBe(2);
    expect(pts[0]!.year).toBe(2023);
    expect(pts[0]!.value).toBe(7.8);
  });

  it('parses a Yahoo chart response and rejects a malformed one', () => {
    expect(parseYahooChart({ chart: { result: [{ meta: { regularMarketPrice: 123.45, currency: 'INR' } }] } })).toEqual({ price: 123.45, currency: 'INR' });
    expect(parseYahooChart({ chart: { result: [] } })).toBeNull();
  });

  it('validates CSV headers and reports missing columns', () => {
    const bad = parseStatementCsv('name,sales\nA,10');
    expect(bad.errors.join(' ')).toMatch(/symbol/);
    const good = parseStatementCsv('symbol,period_end,sales\nABC,2024-03-31,100');
    expect(good.errors).toEqual([]);
    expect(good.rows[0]!.symbol).toBe('ABC');
  });

  it('imports a CSV and makes the company screenable', () => {
    const csv = [
      'symbol,name,sector,period_end,sales,net_profit,equity_capital,reserves,borrowings,total_assets,total_liabilities,cfo,receivables,inventory,payables,cash,operating_profit,interest,price',
      'IMPTEST,Imported Test Co,Information Technology,2024-03-31,1000,120,100,500,50,1200,1200,150,80,40,60,90,160,10,300',
    ].join('\n');
    const r = importStatementCsv(db.db, csv);
    expect(r.statements).toBe(1);
    expect(r.companies).toBe(1);
    const found = store.screener('Symbol = "IMPTEST"');
    expect(found.rows.length).toBe(1);
    expect(found.rows[0]!.sales).toBe(1000);
    expect(found.rows[0]!.roe).toBeGreaterThan(0); // ratios recomputed on import
  });
});
