import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openDatabase, type Db } from '../src/finance/core/db';
import { ingestFixture } from '../src/finance/core/ingest';
import { Store } from '../src/finance/core/store';
import { factorsFor, rankUniverse, percentileOf, zScore } from '../src/finance/core/factors';
import { valuation, dcfPerShare, DEFAULT_DCF } from '../src/finance/core/valuation';
import { strength } from '../src/finance/core/strength';
import { screenStats, sectorBenchmarks, metricSeries, SERIES_METRIC_NAMES } from '../src/finance/core/analytics';
import { exportDatabase, importDatabase } from '../src/finance/core/sources';

let db: Db; let store: Store;
beforeAll(() => {
  db = openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sift-f-')), 'f.db'));
  ingestFixture(db.db, { companies: 90, seed: 3, years: 10, quarters: 4 });
  store = new Store(db.db);
});
const sym = (): string => (db.db.prepare(`SELECT symbol FROM companies ORDER BY id LIMIT 1`).get() as { symbol: string }).symbol;

describe('factor model', () => {
  it('returns six factors plus a composite, all 0..100', () => {
    const f = factorsFor(db.db, sym())!;
    expect(f).not.toBeNull();
    for (const k of ['value', 'quality', 'growth', 'momentum', 'lowVol', 'size', 'composite'] as const) {
      expect(f[k]).toBeGreaterThanOrEqual(0);
      expect(f[k]).toBeLessThanOrEqual(100);
    }
    expect(Object.keys(f.zScores).length).toBeGreaterThan(4);
  });

  it('percentiles stay in range and z-scores are finite', () => {
    const id = (db.db.prepare(`SELECT id FROM companies ORDER BY id LIMIT 1`).get() as { id: number }).id;
    const p = percentileOf(db.db, id, 'roe');
    expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThanOrEqual(100);
    const z = zScore(db.db, id, 'roe');
    expect(Number.isFinite(z)).toBe(true);
  });

  it('percentiles actually vary across the universe (regression)', () => {
    // A PERCENT_RANK computed with a WHERE filter in the same SELECT sees one row
    // and always returns 0 — this guards against that.
    const rows = db.db.prepare(`SELECT id, roe FROM v_latest ORDER BY roe DESC`).all() as Array<{ id: number; roe: number }>;
    const top = percentileOf(db.db, rows[0]!.id, 'roe');
    const bottom = percentileOf(db.db, rows[rows.length - 1]!.id, 'roe');
    expect(top).toBe(100);
    expect(bottom).toBe(0);
    const mid = percentileOf(db.db, rows[Math.floor(rows.length / 2)]!.id, 'roe');
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(100);
  });

  it('factor scores are not constant across companies', () => {
    const rows = db.db.prepare(`SELECT symbol FROM companies ORDER BY id LIMIT 5`).all() as Array<{ symbol: string }>;
    const composites = rows.map((r) => factorsFor(db.db, r.symbol)!.composite);
    expect(new Set(composites).size).toBeGreaterThan(1);
  });

  it('ranks the universe descending by composite', () => {
    const ranked = rankUniverse(db.db, { limit: 20 });
    expect(ranked.length).toBe(20);
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1]!.composite).toBeGreaterThanOrEqual(ranked[i]!.composite);
  });

  it('returns null for an unknown symbol', () => {
    expect(factorsFor(db.db, 'NOPE')).toBeNull();
  });
});

describe('valuation', () => {
  it('computes Graham number and margin of safety', () => {
    const v = valuation(db.db, sym())!;
    expect(v).not.toBeNull();
    if (v.eps > 0 && v.bookValuePerShare > 0) {
      expect(v.grahamNumber).toBeGreaterThan(0);
      expect(v.marginOfSafetyPct).not.toBeNull();
    }
    expect(v.pePercentile).toBeGreaterThanOrEqual(0);
  });

  it('DCF is positive for positive FCF and null when the discount rate is too low', () => {
    expect(dcfPerShare(10, DEFAULT_DCF)).toBeGreaterThan(0);
    expect(dcfPerShare(-5, DEFAULT_DCF)).toBeNull();
    expect(dcfPerShare(10, { ...DEFAULT_DCF, discountPct: 3, terminalGrowthPct: 4 })).toBeNull();
  });

  it('computes margin sensitivity both ways', () => {
    const v = valuation(db.db, sym())!;
    if (v.sensitivity) {
      expect(v.sensitivity.marginDrop200bps.eps).toBeLessThan(v.sensitivity.marginRise200bps.eps);
    }
  });

  it('returns null for an unknown symbol', () => {
    expect(valuation(db.db, 'NOPE')).toBeNull();
  });
});

describe('balance-sheet strength', () => {
  it('produces leverage, cover and a verdict', () => {
    const st = strength(db.db, sym())!;
    expect(st).not.toBeNull();
    expect(['fortress', 'solid', 'stretched', 'fragile']).toContain(st.verdict);
    expect(Number.isFinite(st.netDebt)).toBe(true);
    expect(st.notes.join(' ')).toMatch(/EBITDA/);
  });

  it('returns null for an unknown symbol', () => {
    expect(strength(db.db, 'NOPE')).toBeNull();
  });
});

describe('analytics', () => {
  it('computes distribution stats ordered min ≤ p25 ≤ median ≤ p75 ≤ max', () => {
    const rows = store.screener('Market Cap > 0', { limit: 50 }).rows;
    const stats = screenStats(rows);
    for (const k of Object.keys(stats)) {
      const s = stats[k]!;
      expect(s.min).toBeLessThanOrEqual(s.p25);
      expect(s.p25).toBeLessThanOrEqual(s.median);
      expect(s.median).toBeLessThanOrEqual(s.p75);
      expect(s.p75).toBeLessThanOrEqual(s.max);
    }
  });

  it('builds sector benchmarks that cover every sector', () => {
    const sectors = sectorBenchmarks(db.db);
    const count = (db.db.prepare(`SELECT COUNT(DISTINCT sector) AS n FROM companies`).get() as { n: number }).n;
    expect(sectors.length).toBe(count);
    for (const s of sectors) expect(s.companies).toBeGreaterThan(0);
  });

  it('returns a full annual series and rejects an unknown metric', () => {
    const series = metricSeries(db.db, sym(), 'sales');
    expect(series.length).toBe(10);
    for (let i = 1; i < series.length; i++) expect(series[i - 1]!.periodEnd < series[i]!.periodEnd).toBe(true);
    expect(() => metricSeries(db.db, sym(), 'nonsense')).toThrow(/Unknown metric/);
    expect(SERIES_METRIC_NAMES).toContain('cfo');
  });
});

describe('backup & restore', () => {
  it('round-trips the database', () => {
    const doc = exportDatabase(db.db);
    expect(doc.tables['companies']!.length).toBeGreaterThan(50);
    const before = (db.db.prepare(`SELECT COUNT(*) AS n FROM companies`).get() as { n: number }).n;
    const r = importDatabase(db.db, doc);
    expect(r.restored['companies']).toBe(before);
    expect((db.db.prepare(`SELECT COUNT(*) AS n FROM companies`).get() as { n: number }).n).toBe(before);
  });
});
