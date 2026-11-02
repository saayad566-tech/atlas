// Data truth: what do we actually know about a company, and how much should you trust it.
//
// Every analysis in this app is only as good as the rows behind it. This reports, per
// company and per market, which data types exist, how old they are, and whether anything
// is synthetic — so a confident-looking number can be traced back to its evidence.
import type { Database as DB } from 'better-sqlite3';

const r1 = (v: number): number => Math.round(v * 10) / 10;

export type Coverage = 'present' | 'partial' | 'missing';

export interface DataTypeCheck {
  key: string;
  label: string;
  coverage: Coverage;
  rows: number;
  newest: string | null;
  ageDays: number | null;
  note: string;
}

export interface CompanyTruth {
  symbol: string;
  name: string;
  source: string;
  synthetic: boolean;
  types: DataTypeCheck[];
  completenessPct: number;
  freshnessDays: number | null;
  verdict: 'well supported' | 'usable with gaps' | 'thin';
  warnings: string[];
}

function countRows(db: DB, sql: string, ...params: unknown[]): { rows: number; newest: string | null } {
  try {
    const r = db.prepare(sql).get(...params) as { n: number; d: string | null } | undefined;
    return { rows: r ? Number(r.n) : 0, newest: r?.d ?? null };
  } catch { return { rows: 0, newest: null }; }
}

const daysSince = (date: string | null): number | null =>
  date ? Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000)) : null;

export function companyTruth(db: DB, symbol: string): CompanyTruth | null {
  const c = db.prepare(`SELECT id, symbol, name, source FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number; symbol: string; name: string; source: string } | undefined;
  if (!c) return null;

  const spec: Array<{ key: string; label: string; sql: string; min: number; note: string }> = [
    { key: 'prices', label: 'Price history', sql: `SELECT COUNT(*) n, MAX(date) d FROM price_history WHERE company_id=?`, min: 30, note: 'needed for every chart and risk measure' },
    { key: 'statements', label: 'Financial statements', sql: `SELECT COUNT(*) n, MAX(period_end) d FROM statements WHERE company_id=?`, min: 2, note: 'needed for every fundamental ratio' },
    { key: 'ratios', label: 'Computed ratios', sql: `SELECT COUNT(*) n, MAX(period_end) d FROM ratios WHERE company_id=?`, min: 1, note: 'derived from statements' },
    { key: 'dividends', label: 'Dividends', sql: `SELECT COUNT(*) n, MAX(date) d FROM dividends WHERE company_id=?`, min: 1, note: 'for income analysis' },
    { key: 'holders', label: 'Ownership', sql: `SELECT COUNT(*) n, MAX(fetched_at) d FROM holders WHERE company_id=?`, min: 1, note: 'institutional and insider split' },
    { key: 'insiders', label: 'Insider trades', sql: `SELECT COUNT(*) n, MAX(date) d FROM insider_trades WHERE company_id=?`, min: 1, note: 'for the flow view' },
    { key: 'announcements', label: 'Disclosures', sql: `SELECT COUNT(*) n, MAX(date) d FROM announcements WHERE company_id=?`, min: 1, note: 'the corporate timeline' },
    { key: 'profile', label: 'Company profile', sql: `SELECT COUNT(*) n, MAX(updated_at) d FROM company_profiles WHERE company_id=?`, min: 1, note: 'business description and sector detail' },
  ];

  const types: DataTypeCheck[] = spec.map((s) => {
    const { rows, newest } = countRows(db, s.sql, c.id);
    const age = daysSince(newest);
    const coverage: Coverage = rows === 0 ? 'missing' : rows >= s.min ? 'present' : 'partial';
    return { key: s.key, label: s.label, coverage, rows, newest, ageDays: age, note: s.note };
  });

  const present = types.filter((t) => t.coverage === 'present').length;
  const partial = types.filter((t) => t.coverage === 'partial').length;
  const completenessPct = r1(((present + partial * 0.5) / types.length) * 100);
  const priceType = types.find((t) => t.key === 'prices');
  const freshnessDays = priceType?.ageDays ?? null;

  const warnings: string[] = [];
  const synthetic = c.source === 'fixture';
  if (synthetic) warnings.push('Synthetic demo data — every figure is generated, not real.');
  if (freshnessDays !== null && freshnessDays > 7) warnings.push(`Prices are ${freshnessDays} days old.`);
  if (priceType?.coverage === 'missing') warnings.push('No price history — charts and risk measures cannot be computed.');
  const st = types.find((t) => t.key === 'statements');
  if (st?.coverage === 'missing') warnings.push('No statements — fundamental ratios cannot be computed.');
  if (st && st.rows > 0 && st.rows < 3) warnings.push(`Only ${st.rows} year(s) of statements — trend analysis is limited.`);

  const verdict: CompanyTruth['verdict'] = completenessPct >= 80 ? 'well supported' : completenessPct >= 50 ? 'usable with gaps' : 'thin';

  return { symbol: c.symbol, name: c.name, source: c.source, synthetic, types, completenessPct, freshnessDays, verdict, warnings };
}

export interface MarketTruth {
  market: string;
  companies: number;
  synthetic: number;
  real: number;
  averageCompletenessPct: number;
  stalePrices: number;
  missingStatements: number;
  byType: Array<{ key: string; label: string; withData: number; pct: number }>;
  note: string;
}

export function marketTruth(db: DB, market: string): MarketTruth {
  const rows = db.prepare(`SELECT id, symbol, source FROM companies`).all() as Array<{ id: number; symbol: string; source: string }>;
  const synthetic = rows.filter((r) => r.source === 'fixture').length;

  const byType = new Map<string, { label: string; withData: number }>();
  let completenessSum = 0;
  let stale = 0;
  let missingStatements = 0;

  for (const r of rows) {
    const t = companyTruth(db, r.symbol);
    if (!t) continue;
    completenessSum += t.completenessPct;
    if (t.freshnessDays !== null && t.freshnessDays > 7) stale++;
    if (t.types.find((x) => x.key === 'statements')?.coverage === 'missing') missingStatements++;
    for (const ty of t.types) {
      const e = byType.get(ty.key) ?? { label: ty.label, withData: 0 };
      if (ty.coverage !== 'missing') e.withData++;
      byType.set(ty.key, e);
    }
  }

  return {
    market,
    companies: rows.length,
    synthetic,
    real: rows.length - synthetic,
    averageCompletenessPct: rows.length ? r1(completenessSum / rows.length) : 0,
    stalePrices: stale,
    missingStatements,
    byType: [...byType.entries()].map(([key, v]) => ({ key, label: v.label, withData: v.withData, pct: rows.length ? r1((v.withData / rows.length) * 100) : 0 })),
    note: synthetic > 0
      ? `${synthetic} of ${rows.length} companies are synthetic demo data and are labelled DEMO wherever they appear.`
      : 'All companies in this market come from a live source.',
  };
}
