// Atlas Score — one number, and the reasons behind it.
//
// Every other module answers a narrow question. This composes them: quality, value,
// growth, momentum, analyst view, ownership, risk and data quality, each normalised to
// 0-100, then weighted. Every input is listed with its raw value so the score can be
// argued with rather than trusted blindly.
import type { Database as DB } from 'better-sqlite3';
import { deep2 } from './deep2';
import { scores } from './scores';
import { valuationReport } from './valuation2';
import { marketIntel } from './marketdata';
import { riskProfile, totalReturn } from './universe';
import { strength } from './strength';
import { deepMetrics } from './metrics';

export interface ScorePart { name: string; score: number | null; weight: number; raw: string; note: string }
export interface AtlasScore {
  symbol: string;
  score: number;
  grade: 'A+' | 'A' | 'B' | 'C' | 'D';
  verdict: string;
  parts: ScorePart[];
  coverage: number;          // % of the score that had real data
  strengths: string[];
  weaknesses: string[];
}

const clamp = (x: number): number => Math.round(Math.max(0, Math.min(100, x)) * 10) / 10;

export function atlasScore(db: DB, symbol: string): AtlasScore | null {
  const c = db.prepare(`SELECT id, name FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number; name: string } | undefined;
  if (!c) return null;

  const d = deep2(db, symbol);
  const sc = scores(db, symbol);
  const v = valuationReport(db, symbol);
  const mi = marketIntel(db, symbol);
  const rk = riskProfile(db, symbol);
  const tr = totalReturn(db, symbol);
  const st = strength(db, symbol);
  const dm = deepMetrics(db, symbol);

  const parts: ScorePart[] = [];

  // Quality — ROIC vs cost of capital plus the scorecard.
  const qualityRaw = d && d.roic !== null && d.wacc !== null
    ? clamp(50 + (d.roic - d.wacc) * 3)
    : (d ? d.scorecard.score : null);
  parts.push({
    name: 'Quality', score: qualityRaw, weight: 0.22,
    raw: d?.roic !== null && d?.roic !== undefined ? `ROIC ${d.roic}% vs WACC ${d?.wacc}%` : 'no ROIC',
    note: 'Returns above the cost of capital compound; below it, growth destroys value.',
  });

  // Value — upside from the blended fair value.
  const valueScore = v?.upsidePct !== null && v?.upsidePct !== undefined ? clamp(50 + v.upsidePct * 1.6) : null;
  parts.push({
    name: 'Value', score: valueScore, weight: 0.20,
    raw: v?.upsidePct !== null && v?.upsidePct !== undefined ? `${v.upsidePct > 0 ? '+' : ''}${v.upsidePct}% vs blend` : 'no valuation',
    note: 'Gap between the blended fair value and the price.',
  });

  // Growth — reinvestment-driven growth quality, else 3y sales CAGR.
  const growthScore = d?.growthQuality !== null && d?.growthQuality !== undefined ? clamp(d.growthQuality * 4)
    : (dm?.cagr.sales3 !== null && dm?.cagr.sales3 !== undefined ? clamp(50 + dm.cagr.sales3) : null);
  parts.push({
    name: 'Growth', score: growthScore, weight: 0.15,
    raw: d?.growthQuality !== null && d?.growthQuality !== undefined ? `growth quality ${d.growthQuality}%` : (dm?.cagr.sales3 !== null && dm?.cagr.sales3 !== undefined ? `sales CAGR ${dm.cagr.sales3}%` : 'no growth data'),
    note: 'Growth only counts when it is funded and earns a return.',
  });

  // Momentum — 6-month return plus the composite.
  const momentumScore = mi?.momentum.composite !== null && mi?.momentum.composite !== undefined ? clamp(50 + mi.momentum.composite * 1.5) : null;
  parts.push({
    name: 'Momentum', score: momentumScore, weight: 0.12,
    raw: mi?.momentum.composite !== null && mi?.momentum.composite !== undefined ? `composite ${mi.momentum.composite}%` : 'no price history',
    note: 'Trend persistence — weak evidence alone, useful as a tiebreaker.',
  });

  // Analyst view — consensus and target upside.
  const analystScore = mi?.analysts.upsidePct !== null && mi?.analysts.upsidePct !== undefined
    ? clamp(50 + mi.analysts.upsidePct * 1.4) : null;
  parts.push({
    name: 'Analysts', score: analystScore, weight: 0.11,
    raw: mi?.analysts.consensus ? `${mi.analysts.consensus}, ${mi.analysts.upsidePct}% upside` : 'no analyst data',
    note: 'Sell-side opinion — often late, but informative about expectations.',
  });

  // Risk — inverse of volatility, penalised for deep drawdowns.
  const riskScore = rk?.annualVolPct !== null && rk?.annualVolPct !== undefined ? clamp(100 - rk.annualVolPct * 1.6) : null;
  parts.push({
    name: 'Risk', score: riskScore, weight: 0.10,
    raw: rk?.annualVolPct !== null && rk?.annualVolPct !== undefined ? `vol ${rk.annualVolPct}%, Sharpe ${rk.sharpe}` : 'no volatility',
    note: 'Lower volatility scores higher; deep drawdowns reduce it further.',
  });

  // Balance sheet — the strength verdict.
  const strengthScore = st ? clamp(50 + (st.netDebtToEbitda === null || st.netDebtToEbitda === undefined ? 10 : (2 - st.netDebtToEbitda) * 20)) : null;
  parts.push({
    name: 'Balance sheet', score: strengthScore, weight: 0.10,
    raw: st ? `${st.verdict}, net debt/EBITDA ${st.netDebtToEbitda ?? '—'}` : 'no data',
    note: 'Leverage decides who survives a downturn.',
  });

  const usable = parts.filter((p) => p.score !== null);
  const totalWeight = usable.reduce((a, p) => a + p.weight, 0);
  const score = totalWeight > 0 ? Math.round(usable.reduce((a, p) => a + p.score! * p.weight, 0) / totalWeight) : 0;
  const coverage = Math.round((totalWeight / parts.reduce((a, p) => a + p.weight, 0)) * 100);
  const grade: AtlasScore['grade'] = score >= 85 ? 'A+' : score >= 72 ? 'A' : score >= 58 ? 'B' : score >= 42 ? 'C' : 'D';

  const sorted = [...usable].sort((a, b) => b.score! - a.score!);
  const strengths = sorted.slice(0, 2).filter((p) => p.score! >= 60).map((p) => `${p.name}: ${p.raw}`);
  const weaknesses = sorted.slice(-2).reverse().filter((p) => p.score! < 45).map((p) => `${p.name}: ${p.raw}`);

  const verdict = score >= 72
    ? `Strong across ${strengths.length} dimensions${weaknesses.length ? `, held back by ${weaknesses[0]!.split(':')[0]!.toLowerCase()}` : ''}.`
    : score >= 58
      ? `Solid but uneven — ${strengths[0]?.split(':')[0] ?? 'no standout'} leads, ${weaknesses[0]?.split(':')[0] ?? 'nothing critical'} lags.`
      : score >= 42
        ? `Mixed. ${weaknesses.length ? `${weaknesses[0]!.split(':')[0]} is the main concern.` : 'No single strength dominates.'}`
        : `Weak on most measures${weaknesses.length ? `; ${weaknesses[0]!.split(':')[0]!.toLowerCase()} is the biggest issue` : ''}.`;

  return { symbol: symbol.toUpperCase(), score, grade, verdict, parts, coverage, strengths, weaknesses };
}

/** Why does this company match a screen? Plain-English reasons, with the numbers. */
export function explainMatch(db: DB, symbol: string): { symbol: string; lines: Array<{ label: string; value: string; why: string }> } | null {
  const row = db.prepare(`SELECT * FROM v_latest WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as Record<string, number | string> | undefined;
  if (!row) return null;
  const d = deep2(db, symbol);
  const v = valuationReport(db, symbol);
  const mi = marketIntel(db, symbol);
  const n = (k: string): number => Number(row[k] ?? 0);

  const lines: Array<{ label: string; value: string; why: string }> = [
    { label: 'Market cap', value: `${Math.round(n('market_cap')).toLocaleString('en-IN')} Cr`, why: 'Size decides liquidity and how much research coverage a company attracts.' },
    { label: 'P/E', value: n('pe') ? n('pe').toFixed(1) : '—', why: 'Price per rupee of earnings — only meaningful against the company\'s own history and its sector.' },
    { label: 'ROE', value: `${n('roe').toFixed(1)}%`, why: 'Profit generated per rupee of shareholder capital. Above ~15% sustained is strong.' },
    { label: 'Debt / equity', value: n('debt_to_equity').toFixed(2), why: 'Leverage amplifies both returns and distress; below 1 is comfortable for most sectors.' },
    { label: 'Operating margin', value: `${n('opm').toFixed(1)}%`, why: 'Pricing power and cost control, before financing effects.' },
    { label: 'Sales growth 3Y', value: `${n('sales_growth_3y').toFixed(1)}%`, why: 'Sustained top-line growth is the raw material of every long-term return.' },
  ];
  if (d?.roic !== null && d?.roic !== undefined) lines.push({ label: 'ROIC', value: `${d.roic}%`, why: `Against a ${d.wacc}% cost of capital — ${d.roic > (d.wacc ?? 0) ? 'value-creating' : 'value-destroying'}.` });
  if (v?.upsidePct !== null && v?.upsidePct !== undefined) lines.push({ label: 'Valuation gap', value: `${v.upsidePct > 0 ? '+' : ''}${v.upsidePct}%`, why: 'Blended fair value against the current price; positive means the models see room.' });
  if (mi?.dividends.yieldPct !== null && mi?.dividends.yieldPct !== undefined) lines.push({ label: 'Dividend yield', value: `${mi.dividends.yieldPct}%`, why: 'Cash returned while you hold it — and evidence the profits are real.' });
  if (mi?.analysts.consensus) lines.push({ label: 'Analyst view', value: `${mi.analysts.consensus} (${mi.analysts.upsidePct ?? '—'}%)`, why: 'Consensus expectations; a crowded view is already in the price.' });
  return { symbol: symbol.toUpperCase(), lines };
}
