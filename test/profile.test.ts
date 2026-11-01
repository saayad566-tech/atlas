import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openDatabase, type Db } from '../src/finance/core/db';
import { ingestFixture } from '../src/finance/core/ingest';
import { ensureProfiles, companyIntelligence, importIntelligence, moatScore, fetchWikipediaProfile } from '../src/finance/core/profile';

let db: Db;
beforeAll(() => {
  db = openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-p-')), 'p.db'));
  ingestFixture(db.db, { companies: 40, seed: 9, years: 10, quarters: 4 });
  ensureProfiles(db.db);
});
const sym = (): string => (db.db.prepare(`SELECT symbol FROM companies ORDER BY id LIMIT 1`).get() as { symbol: string }).symbol;

describe('company intelligence pack', () => {
  it('generates a profile for every company', () => {
    const n = (db.db.prepare(`SELECT COUNT(*) AS n FROM company_profiles`).get() as { n: number }).n;
    expect(n).toBe(40);
  });

  it('answers what the company does, where, and how big', () => {
    const d = companyIntelligence(db.db, sym())!;
    expect(d.profile).not.toBeNull();
    const p = d.profile as Record<string, unknown>;
    expect(String(p['description']).length).toBeGreaterThan(40);
    expect(String(p['hq_city']).length).toBeGreaterThan(2);
    expect(Number(p['founded_year'])).toBeGreaterThan(1900);
    expect(Number(p['employees'])).toBeGreaterThan(0);
    expect(String(p['business_model']).length).toBeGreaterThan(3);
  });

  it('segment revenue splits sum to about 100%', () => {
    const d = companyIntelligence(db.db, sym())!;
    const total = d.segments.reduce((a, s) => a + s.revenue_pct, 0);
    expect(total).toBeGreaterThan(95);
    expect(total).toBeLessThan(105);
  });

  it('geography splits sum to about 100%', () => {
    const d = companyIntelligence(db.db, sym())!;
    const total = d.geographies.reduce((a, g) => a + g.revenue_pct, 0);
    expect(total).toBeGreaterThan(95);
    expect(total).toBeLessThan(105);
  });

  it('carries guidance and compares it with actuals', () => {
    const d = companyIntelligence(db.db, sym())!;
    expect(d.guidance.length).toBeGreaterThan(0);
    expect(d.guidanceVsActual.length).toBe(d.guidance.length);
    const margin = d.guidanceVsActual.find((g) => g.metric === 'Operating margin');
    expect(margin).toBeDefined();
    expect(margin!.actual).not.toBeNull();
    expect(margin!.variancePct).not.toBeNull();
  });

  it('has facilities, subsidiaries, corporate actions, announcements and risks', () => {
    const d = companyIntelligence(db.db, sym())!;
    expect(d.facilities.length).toBeGreaterThan(0);
    expect(d.subsidiaries.length).toBeGreaterThan(0);
    expect(d.corporateActions.length).toBeGreaterThan(0);
    expect(d.announcements.length).toBeGreaterThan(0);
    expect(d.risks.length).toBeGreaterThan(0);
    expect(['high', 'medium', 'low']).toContain(d.risks[0]!.severity);
  });

  it('moat score is bounded 0..100 with an explanation', () => {
    const id = (db.db.prepare(`SELECT id FROM companies ORDER BY id LIMIT 1`).get() as { id: number }).id;
    const m = moatScore(db.db, id);
    expect(m.score).toBeGreaterThanOrEqual(0);
    expect(m.score).toBeLessThanOrEqual(100);
    expect(m.notes.length).toBeGreaterThan(20);
  });

  it('is deterministic for the same company', () => {
    const a = companyIntelligence(db.db, sym())!;
    ensureProfiles(db.db, { force: true });
    const b = companyIntelligence(db.db, sym())!;
    expect((a.profile as Record<string, unknown>)['description']).toBe((b.profile as Record<string, unknown>)['description']);
  });

  it('imports a real pack and marks its source', () => {
    const s = sym();
    const r = importIntelligence(db.db, s, {
      profile: { description: 'A real imported description of the business.', hq_city: 'Pune', source: 'import' },
      segments: [{ name: 'Core', revenue_pct: 100, margin_pct: 20, growth_pct: 10 }],
      risks: [{ code: 'imported-risk', severity: 'high', description: 'Imported risk.' }],
    });
    expect(r.ok).toBe(true);
    const d = companyIntelligence(db.db, s)!;
    expect(String((d.profile as Record<string, unknown>)['description'])).toMatch(/real imported/);
    expect((d.profile as Record<string, unknown>)['source']).toBe('import');
    expect(d.segments.length).toBe(1);
    expect(d.risks[0]!.code).toBe('imported-risk');
  });

  it('stores a Wikipedia description when the source is reachable', async () => {
    const s = sym();
    const stub = async () => ({ status: 200, json: { title: 'Demo Ltd', extract: 'Demo Ltd is a company that makes things.', type: 'standard' } });
    const r = await fetchWikipediaProfile(db.db, s, stub as never);
    expect(r.ok).toBe(true);
    const d = companyIntelligence(db.db, s)!;
    expect((d.profile as Record<string, unknown>)['source']).toBe('wikipedia');
    expect(String((d.profile as Record<string, unknown>)['description'])).toMatch(/makes things/);
  });

  it('reports a failure instead of throwing when the source is unreachable', async () => {
    const s = sym();
    const stub = async () => ({ status: 0, json: null });
    const r = await fetchWikipediaProfile(db.db, s, stub as never);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('rejects an import for an unknown company', () => {
    expect(() => importIntelligence(db.db, 'NOPE', {})).toThrow(/No company/);
  });

  it('returns null for an unknown company', () => {
    expect(companyIntelligence(db.db, 'NOPE')).toBeNull();
  });
});
