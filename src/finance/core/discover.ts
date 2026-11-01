// Discovery: which sectors are actually moving, and which companies deserve a closer look.
//
// A recommendation that only lists reasons to buy is a sales pitch. Every candidate here
// carries what argues against it and what would prove the read wrong.
import type { Database as DB } from 'better-sqlite3';
import { stancesFor, findDissent, type Stance } from './briefing';

const r1 = (v: number): number => Math.round(v * 10) / 10;

/** One-year return computed from stored prices (v_latest has no return column). */
function returnsFor(db: DB, companyId: number): { y1: number | null; m1: number | null } {
  let rows: Array<{ close: number }> = [];
  try { rows = db.prepare(`SELECT close FROM price_history WHERE company_id=? AND close>0 ORDER BY date ASC`).all(companyId) as Array<{ close: number }>; } catch { return { y1: null, m1: null }; }
  if (rows.length < 2) return { y1: null, m1: null };
  const first = rows[0]!.close; const last = rows[rows.length - 1]!.close;
  const y1 = first > 0 ? r1(((last - first) / first) * 100) : null;
  const recent = rows.slice(-21)[0]!.close;
  const m1 = recent > 0 ? r1(((last - recent) / recent) * 100) : null;
  return { y1, m1 };
}

export type SectorPhase = 'leading' | 'improving' | 'weakening' | 'lagging' | 'quiet';

export interface SectorTrend {
  sector: string;
  companies: number;
  medianReturn1y: number | null;
  breadthPct: number;          // share of companies up over the year
  momentum1m: number | null;   // median last-month return
  phase: SectorPhase;
  evidence: string;
}

/**
 * Sector phase, read from two independent facts: the year's trend and the last month's.
 * Improving (bad year, good month) is the most useful signal and the least obvious.
 */
export function classifyPhase(medianY1: number | null, momentum1m: number | null, breadth: number): SectorPhase {
  if (medianY1 === null || momentum1m === null) return 'quiet';
  if (medianY1 > 10 && momentum1m > 0) return 'leading';
  if (medianY1 <= 10 && momentum1m > 3) return 'improving';
  if (medianY1 > 10 && momentum1m < -3) return 'weakening';
  if (medianY1 < -5 && momentum1m < 0) return 'lagging';
  return breadth >= 60 ? 'leading' : breadth <= 40 ? 'lagging' : 'quiet';
}

export function trendingSectors(db: DB): SectorTrend[] {
  const companies = db.prepare(`SELECT id, COALESCE(sector,'Unclassified') AS sector FROM companies`).all() as Array<{ id: number; sector: string }>;
  const bySector = new Map<string, Array<{ y1: number | null; m1: number | null }>>();
  for (const c of companies) {
    const r = returnsFor(db, c.id);
    const arr = bySector.get(c.sector) ?? [];
    arr.push(r);
    bySector.set(c.sector, arr);
  }
  const median = (xs: number[]): number | null => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m]! : r1((s[m - 1]! + s[m]!) / 2);
  };
  const out: SectorTrend[] = [];
  for (const [sector, rows] of bySector) {
    const y1s = rows.map((r) => r.y1).filter((v): v is number => v !== null);
    const m1s = rows.map((r) => r.m1).filter((v): v is number => v !== null);
    if (!y1s.length) { out.push({ sector, companies: rows.length, medianReturn1y: null, breadthPct: 0, momentum1m: null, phase: 'quiet', evidence: 'no price history yet' }); continue; }
    const medianY1 = median(y1s);
    const momentum = median(m1s);
    const breadth = Math.round((y1s.filter((v) => v > 0).length / y1s.length) * 100);
    const phase = classifyPhase(medianY1, momentum, breadth);
    // The sentence must describe the numbers that produced the phase. A template that
    // claims "trend and momentum agree" next to a negative month is a lie in prose.
    const mom = momentum === null ? 'no recent data' : `${momentum > 0 ? '+' : ''}${momentum}% in the last month`;
    const evidence =
      phase === 'improving' ? `Down ${Math.abs(medianY1!)}% over the year but ${mom} — the turn may be starting.`
      : phase === 'leading' ? (momentum !== null && momentum > 0
          ? `Up ${medianY1}% over the year with ${mom} — trend and momentum agree.`
          : `Up ${medianY1}% over the year but ${mom} — carried by breadth (${breadth}% of names up), not fresh momentum.`)
      : phase === 'weakening' ? `Up ${medianY1}% over the year but ${mom} — the trend is losing steam.`
      : phase === 'lagging' ? `Down ${Math.abs(medianY1!)}% over the year and ${mom} — no turn yet.`
      : `${breadth}% of names are up over the year; ${mom}.`;
    out.push({ sector, companies: rows.length, medianReturn1y: medianY1, breadthPct: breadth, momentum1m: momentum, phase, evidence });
  }
  const order: Record<SectorPhase, number> = { improving: 0, leading: 1, quiet: 2, weakening: 3, lagging: 4 };
  return out.sort((a, b) => order[a.phase] - order[b.phase] || (b.medianReturn1y ?? -999) - (a.medianReturn1y ?? -999));
}

export interface Candidate {
  symbol: string; name: string; sector: string;
  composite: number;
  stances: Stance[];
  forIt: string[];
  againstIt: string[];
  falsifier: string;
  confidence: 'high' | 'moderate' | 'low';
}

/**
 * Rank companies by how well several independent dimensions agree, then subtract for
 * contradiction. Disagreement is a reason for caution, not a footnote.
 */
export function rankCandidates(db: DB, limit = 8): Candidate[] {
  const rows = db.prepare(`SELECT * FROM v_latest WHERE market_cap > 0`).all() as Array<Record<string, unknown>>;
  const scored: Candidate[] = [];
  for (const row of rows) {
    const symbol = String(row['symbol']);
    const cid = (db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined)?.id;
    if (!cid) continue;
    const { y1 } = returnsFor(db, cid);
    const stances = stancesFor(row as Record<string, number>, y1);
    const dissent = findDissent(stances);
    const positives = stances.filter((s) => s.score >= 60).sort((a, b) => b.score - a.score);
    const negatives = stances.filter((s) => s.score <= 40).sort((a, b) => a.score - b.score);
    // Agreement is rewarded; contradiction is penalised harder than a single weakness.
    const mean = stances.reduce((a, s) => a + s.score, 0) / stances.length;
    const spread = Math.max(...stances.map((s) => s.score)) - Math.min(...stances.map((s) => s.score));
    const composite = Math.max(0, Math.min(100, r1(mean - spread * 0.15 - dissent.filter((d) => d.severity === 'flag').length * 8)));
    const confidence: Candidate['confidence'] = dissent.some((d) => d.severity === 'flag') ? 'low' : positives.length >= 3 ? 'high' : positives.length >= 2 ? 'moderate' : 'low';
    scored.push({
      symbol, name: String(row['name'] ?? symbol), sector: String(row['sector'] ?? 'Unclassified'),
      composite, stances,
      forIt: positives.slice(0, 2).map((s) => `${s.verdict} (${s.basis})`),
      againstIt: (() => {
        const items = [...dissent.map((d) => d.message), ...negatives.slice(0, 1).map((s) => `${s.verdict} (${s.basis})`)];
        if (!items.length) {
          // Nothing is outright weak — say which dimension is merely the least strong,
          // rather than pretending there is no counter-argument.
          const weakest = [...stances].sort((a, b) => a.score - b.score)[0];
          if (weakest) items.push(`Least strong: ${weakest.dimension} at ${weakest.score}/100 (${weakest.basis})`);
        }
        return items.slice(0, 2);
      })(),
      falsifier: positives.length ? `This read fails if ${positives[0]!.dimension} stops holding: ${positives[0]!.basis} would have to reverse.` : 'No dimension is strong enough to state a falsifier.',
      confidence,
    });
  }
  return scored.sort((a, b) => b.composite - a.composite).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Peer percentile ranking.
//
// A raw ratio says nothing without context: ROE of 18% is excellent in utilities and
// ordinary in software. Ranking a company against its own sector turns every metric into
// a position, which is what an analyst actually reasons about.
// ---------------------------------------------------------------------------
export interface MetricRank {
  metric: string;
  label: string;
  value: number | null;
  percentile: number | null;
  sectorMedian: number | null;
  verdict: string;
}

const RANK_METRICS: Array<{ key: string; label: string; higherIsBetter: boolean }> = [
  { key: 'roe', label: 'Return on equity', higherIsBetter: true },
  { key: 'roce', label: 'Return on capital employed', higherIsBetter: true },
  { key: 'opm', label: 'Operating margin', higherIsBetter: true },
  { key: 'npm', label: 'Net margin', higherIsBetter: true },
  { key: 'pe', label: 'Price to earnings', higherIsBetter: false },
  { key: 'pb', label: 'Price to book', higherIsBetter: false },
  { key: 'debt_to_equity', label: 'Debt to equity', higherIsBetter: false },
  { key: 'interest_coverage', label: 'Interest coverage', higherIsBetter: true },
  { key: 'current_ratio', label: 'Current ratio', higherIsBetter: true },
  { key: 'sales_growth_3y', label: 'Sales growth (3y)', higherIsBetter: true },
  { key: 'profit_growth_3y', label: 'Profit growth (3y)', higherIsBetter: true },
  { key: 'dividend_yield', label: 'Dividend yield', higherIsBetter: true },
];

function percentileOf(value: number, sorted: number[], higherIsBetter: boolean): number {
  if (!sorted.length) return 50;
  let below = 0;
  for (const v of sorted) {
    if (higherIsBetter ? v < value : v > value) below++;
  }
  return Math.round((below / sorted.length) * 100);
}

/** Rank one company's metrics against every other company in its sector. */
export function peerPercentiles(db: DB, symbol: string): { sector: string; peers: number; ranks: MetricRank[] } | null {
  const target = db.prepare(`SELECT id, COALESCE(sector,'Unclassified') AS sector FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number; sector: string } | undefined;
  if (!target) return null;
  const row = db.prepare(`SELECT * FROM v_latest WHERE id=?`).get(target.id) as Record<string, number> | undefined;
  if (!row) return null;

  const peers = db.prepare(`SELECT * FROM v_latest WHERE sector=? AND id<>?`).all(target.sector, target.id) as Array<Record<string, number>>;

  const ranks: MetricRank[] = RANK_METRICS.map((m) => {
    const raw = row[m.key];
    const value = typeof raw === 'number' && Number.isFinite(raw) && raw !== 0 ? raw : null;
    const peerValues = peers.map((p) => p[m.key]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v !== 0).sort((a, b) => a - b);
    if (value === null || peerValues.length < 3) {
      return { metric: m.key, label: m.label, value, percentile: null, sectorMedian: null, verdict: peerValues.length < 3 ? 'too few peers to rank' : 'no value' };
    }
    const pct = percentileOf(value, peerValues, m.higherIsBetter);
    const median = peerValues[Math.floor(peerValues.length / 2)]!;
    const verdict = pct >= 80 ? 'top quintile of its sector'
      : pct >= 60 ? 'above the sector median'
      : pct >= 40 ? 'around the sector median'
      : pct >= 20 ? 'below the sector median'
      : 'bottom quintile of its sector';
    return { metric: m.key, label: m.label, value: Math.round(value * 100) / 100, percentile: pct, sectorMedian: Math.round(median * 100) / 100, verdict };
  });

  return { sector: target.sector, peers: peers.length, ranks };
}
