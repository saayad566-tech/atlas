import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openDatabase, type Db } from '../src/finance/core/db';
import { ingestFixture } from '../src/finance/core/ingest';
import { valuationReport, saveAssumptions, loadAssumptions, resetAssumptions, applyScenario, waccLite, DEFAULT_ASSUMPTIONS } from '../src/finance/core/valuation2';
import { Custom, DEFAULT_PREFS, ALL_COLUMNS } from '../src/finance/core/custom';

let db: Db; let custom: Custom;
beforeAll(() => {
  db = openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-cv-')), 'c.db'));
  ingestFixture(db.db, { companies: 60, seed: 12, years: 10, quarters: 4 });
  custom = new Custom(db.db);
});
const sym = (): string => (db.db.prepare(`SELECT symbol FROM companies ORDER BY id LIMIT 1`).get() as { symbol: string }).symbol;

describe('multi-model valuation', () => {
  it('returns five models, a blend and a band ordered bear ≤ base ≤ bull', () => {
    const v = valuationReport(db.db, sym())!;
    expect(v).not.toBeNull();
    expect(v.models.length).toBe(5);
    expect(v.blended).not.toBeNull();
    const { bear, base, bull } = v.band;
    expect(bear!).toBeLessThanOrEqual(base! + 0.01);
    expect(base!).toBeLessThanOrEqual(bull! + 0.01);
  });

  it('reports EV, EV/EBITDA and the P/E band', () => {
    const v = valuationReport(db.db, sym())!;
    expect(v.ev.ev).toBeGreaterThan(0);
    expect(v.peBand.median).toBeGreaterThan(0);
    expect(['undervalued', 'fair', 'overvalued']).toContain(v.verdict);
  });

  it('scenario presets move the assumption set in the right direction', () => {
    const base = { ...DEFAULT_ASSUMPTIONS };
    expect(applyScenario(base, 'conservative').growthPct).toBeLessThan(base.growthPct);
    expect(applyScenario(base, 'conservative').discountPct).toBeGreaterThan(base.discountPct);
    expect(applyScenario(base, 'optimistic').growthPct).toBeGreaterThan(base.growthPct);
    expect(applyScenario(base, 'base')).toEqual(base);
  });

  it('WACC-lite is higher for smaller companies (size premium)', () => {
    expect(waccLite(1000)).toBeGreaterThan(waccLite(50000));
    expect(Number.isFinite(waccLite(10000))).toBe(true);
  });

  it('saves, loads and resets user assumptions', () => {
    const s = sym();
    saveAssumptions(db.db, s, { growthPct: 18, discountPct: 14, targetPe: 25 }, 'optimistic');
    const id = (db.db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(s) as { id: number }).id;
    const loaded = loadAssumptions(db.db, id);
    expect(loaded.a.growthPct).toBe(18);
    expect(loaded.a.discountPct).toBe(14);
    expect(loaded.scenario).toBe('optimistic');
    // The report applies the saved scenario to the stored base (18 × 1.4 for optimistic),
    // while loadAssumptions returns the raw saved values.
    const withHigh = valuationReport(db.db, s)!;
    expect(withHigh.scenario).toBe('optimistic');
    expect(withHigh.assumptions.growthPct).toBeCloseTo(18 * 1.4, 1);
    resetAssumptions(db.db, s);
    expect(loadAssumptions(db.db, id).a.growthPct).toBe(DEFAULT_ASSUMPTIONS.growthPct);
  });

  it('a scenario override does not overwrite the saved base', () => {
    const s = sym();
    const conservative = valuationReport(db.db, s, 'conservative')!;
    expect(conservative.scenario).toBe('conservative');
    expect(conservative.assumptions.growthPct).toBeLessThan(DEFAULT_ASSUMPTIONS.growthPct);
  });

  it('returns null for an unknown symbol', () => {
    expect(valuationReport(db.db, 'NOPE')).toBeNull();
  });
});

describe('preferences (choose & arrange)', () => {
  it('returns defaults with a usable column set', () => {
    const p = custom.prefs();
    expect(p.theme).toBe('light');
    expect(p.columns.length).toBeGreaterThan(5);
    expect(p.columns.every((c) => ALL_COLUMNS.includes(c))).toBe(true);
  });

  it('saves columns in the order given, dropping unknown keys', () => {
    const p = custom.setPrefs({ columns: ['roe', 'name', 'pe', 'not_a_column'] });
    expect(p.columns).toEqual(['roe', 'name', 'pe']);
  });

  it('refuses to leave the table with no columns', () => {
    const p = custom.setPrefs({ columns: [] });
    expect(p.columns.length).toBeGreaterThan(0);
  });

  it('clamps the row limit and persists the theme', () => {
    const p = custom.setPrefs({ limit: 9999, theme: 'dark' });
    expect(p.limit).toBe(500);
    expect(custom.prefs().theme).toBe('dark');
  });

  it('resets to defaults', () => {
    custom.resetPrefs();
    expect(custom.prefs()).toEqual({ ...DEFAULT_PREFS });
  });
});

describe('personal ratings, rules, peers, portfolio', () => {
  it('stores a rating clamped to 1..5', () => {
    const s = sym();
    expect(custom.setRating(s, 9, 'conviction').rating).toBe(5);
    expect(custom.rating(s)!.rating).toBe(5);
    expect(custom.rating(s)!.thesis).toBe('conviction');
  });

  it('adds, toggles and deletes an alert rule, and evaluates it', () => {
    const rule = custom.addRule('roe', '>', -100);
    expect(custom.listRules().some((r) => r.id === rule.id)).toBe(true);
    const findings = custom.evaluateRules('all');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.ruleId).toBe(rule.id);
    custom.toggleRule(rule.id, false);
    expect(custom.evaluateRules('all').length).toBe(0);
    expect(custom.deleteRule(rule.id)).toBe(true);
  });

  it('rejects an unknown rule metric', () => {
    expect(() => custom.addRule('nonsense', '>', 1)).toThrow(/Unknown metric/);
  });

  it('sets a custom peer set and reads it back', () => {
    const s = sym();
    const others = (db.db.prepare(`SELECT symbol FROM companies WHERE UPPER(symbol)<>UPPER(?) LIMIT 3`).all(s) as Array<{ symbol: string }>).map((r) => r.symbol);
    custom.setPeers(s, others);
    expect(custom.peersFor(s).sort()).toEqual(others.sort());
  });

  it('values a portfolio and computes P&L', () => {
    const s = sym();
    custom.addHolding(s, 10, 100);
    const p = custom.portfolio();
    const h = p.holdings.find((x) => x.symbol === s)!;
    expect(h.value).toBeCloseTo(h.price * 10, 1);
    expect(h.cost).toBeCloseTo(1000, 1);
    expect(h.pnl).toBeCloseTo(h.value - 1000, 1);
    expect(p.summary.holdings).toBeGreaterThan(0);
    expect(p.summary.value).toBeGreaterThan(0);
    expect(custom.removeHolding(s)).toBe(true);
  });

  it('rejects a holding with zero quantity or cost', () => {
    const s = sym();
    expect(() => custom.addHolding(s, 0, 100)).toThrow(/Quantity/);
    expect(() => custom.addHolding(s, 5, 0)).toThrow(/cost/);
  });
});
