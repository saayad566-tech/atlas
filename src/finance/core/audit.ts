// Feature-coverage audit.
//
// "Does every function work for THIS stock?" answered by running each one and
// reporting what it produced. Used by the UI (one click) and by the release check.
import type { Database as DB } from 'better-sqlite3';
import { analyseCompany } from './analysis';
import { scores } from './scores';
import { deepMetrics, peerMatrix } from './metrics';
import { factorsFor } from './factors';
import { valuationReport } from './valuation2';
import { strength } from './strength';
import { companyIntelligence } from './profile';
import { priceAnalytics } from './live';
import { coverage } from './fundamentals';
import { Store } from './store';
import { deep2 } from './deep2';

export interface AuditRow { feature: string; ok: boolean; detail: string; status: 'ok' | 'no-data' | 'error' }
export interface AuditResult { symbol: string; passed: number; total: number; rows: AuditRow[] }

export function auditCompany(db: DB, symbol: string): AuditResult | null {
  const exists = db.prepare(`SELECT id, source FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number; source: string } | undefined;
  if (!exists) return null;
  const rows: AuditRow[] = [];
  const run = (feature: string, fn: () => { ok: boolean; detail: string; status?: AuditRow['status'] }): void => {
    try {
      const r = fn();
      rows.push({ feature, ok: r.ok, detail: r.detail, status: r.status ?? (r.ok ? 'ok' : 'no-data') });
    } catch (e) {
      rows.push({ feature, ok: false, detail: e instanceof Error ? e.message : String(e), status: 'error' });
    }
  };

  run('Company record', () => ({ ok: true, detail: `source: ${exists.source}` }));
  run('Statement history', () => {
    const c = coverage(db, symbol);
    return { ok: c.annual > 0, detail: `${c.annual} annual · ${c.quarterly} quarterly · ${c.years}y` };
  });
  run('Ratios', () => {
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM ratios WHERE company_id=?`).get(exists.id) as { n: number }).n;
    return { ok: n > 0, detail: `${n} period(s)` };
  });
  run('Health / red flags', () => {
    const a = analyseCompany(db, symbol);
    return { ok: !!a, detail: a ? `score ${a.score}, ${a.flags.length} flag(s)` : 'no result' };
  });
  run('Piotroski F-Score', () => {
    const s = scores(db, symbol);
    return { ok: !!s?.piotroski, detail: s?.piotroski ? `${s.piotroski.score}/9` : 'needs 2 annual periods' };
  });
  run('Altman Z-Score', () => {
    const s = scores(db, symbol);
    return { ok: !!s?.altman, detail: s?.altman ? `Z ${s.altman.z} (${s.altman.zone})` : 'needs assets' };
  });
  run('Beneish M-Score', () => {
    const s = scores(db, symbol);
    return { ok: !!s?.beneish, detail: s?.beneish ? `M ${s.beneish.m}${s.beneish.flag ? ' (flagged)' : ''}` : 'needs 2 periods' };
  });
  run('Composite grade', () => {
    const s = scores(db, symbol);
    return { ok: !!s, detail: s ? `${s.composite.score}/100 (${s.composite.grade})` : 'no result' };
  });
  run('DuPont decomposition', () => {
    const m = deepMetrics(db, symbol);
    return { ok: !!m?.dupont, detail: m?.dupont ? `ROE ${m.dupont.roe}%` : 'no result' };
  });
  run('Cash conversion cycle', () => {
    const m = deepMetrics(db, symbol);
    return { ok: !!m?.ccc, detail: m?.ccc ? `${m.ccc.days} days` : 'no result' };
  });
  run('CAGR 3Y', () => {
    const m = deepMetrics(db, symbol);
    return { ok: m?.cagr.sales3 !== null && m?.cagr.sales3 !== undefined, detail: m?.cagr.sales3 === null ? 'needs 4 periods' : `${m?.cagr.sales3}%` };
  });
  run('Factor scores', () => {
    const f = factorsFor(db, symbol);
    return { ok: !!f, detail: f ? `composite ${f.composite}` : 'no result' };
  });
  run('Valuation lab', () => {
    const v = valuationReport(db, symbol);
    return { ok: !!v?.blended, detail: v?.blended ? `₹${v.blended} (${v.verdict})` : 'no model produced a value' };
  });
  run('Balance-sheet strength', () => {
    const st = strength(db, symbol);
    return { ok: !!st, detail: st ? `${st.verdict}, net debt/EBITDA ${st.netDebtToEbitda ?? '—'}` : 'no result' };
  });
  run('Company intelligence', () => {
    const i = companyIntelligence(db, symbol);
    const hasProfile = !!i?.profile;
    return { ok: hasProfile, detail: hasProfile ? `source ${String(i!.profile!['source'])}` : 'no profile' };
  });
  run('Price analytics', () => {
    const p = priceAnalytics(db, symbol);
    return { ok: !!p && p.points > 0, detail: p && p.points > 0 ? `${p.points} sessions, 1y ${p.returns.y1 ?? '—'}%` : 'no price history' };
  });
  run('Peer matrix', () => {
    const pm = peerMatrix(db, symbol);
    if (!pm) return { ok: false, detail: 'no result' };
    if (pm.peers.length > 1) return { ok: true, detail: `${pm.peers.length - 1} peer(s)` };
    // One company in the universe means there is nothing to compare against — that is a
    // data-coverage fact, not a defect in the company's data.
    const inSector = (db.prepare(`SELECT COUNT(*) AS n FROM companies WHERE sector = (SELECT sector FROM companies WHERE UPPER(symbol)=UPPER(?))`).get(symbol) as { n: number }).n;
    return inSector <= 1
      ? { ok: true, detail: `no peers yet — this market has ${inSector} company in the sector` }
      : { ok: false, detail: 'peers exist in the sector but none were matched' };
  });
  run('Screener query', () => {
    const store = new Store(db);
    const r = store.screener(`Symbol = "${symbol}"`);
    return { ok: r.rows.length === 1, detail: `${r.rows.length} row(s) in ${r.ms} ms` };
  });
  // ---- value sanity: a number that exists can still be wrong -----------------
  const lat = db.prepare(`SELECT price, market_cap AS marketCap, pe, pb, roe, roce, debt_to_equity AS de, opm, sales, net_profit AS netProfit FROM v_latest WHERE id=?`).get(exists.id) as Record<string, number> | undefined;
  run('Sanity: price & market cap', () => {
    const p2 = Number(lat?.['price'] ?? 0); const mc = Number(lat?.['marketCap'] ?? 0);
    const ok = p2 > 0 && p2 < 1e8 && mc > 0;
    return { ok, detail: ok ? `price ${p2}, mcap ${Math.round(mc)} Cr` : `price ${p2}, mcap ${mc} — implausible`, status: ok ? 'ok' : 'suspect' as never };
  });
  run('Sanity: ratios in range', () => {
    const roe = Number(lat?.['roe'] ?? 0); const de = Number(lat?.['de'] ?? 0); const pe = Number(lat?.['pe'] ?? 0);
    const problems: string[] = [];
    if (roe < -100 || roe > 300) problems.push(`ROE ${roe}`);
    if (de < 0) problems.push(`D/E ${de}`);
    if (pe < 0) problems.push(`P/E ${pe}`);
    return { ok: problems.length === 0, detail: problems.length ? problems.join(', ') : `ROE ${roe}%, D/E ${de}, P/E ${pe}`, status: problems.length ? 'suspect' as never : 'ok' };
  });
  run('Sanity: balance sheet balances', () => {
    const row = db.prepare(`SELECT total_assets AS a, total_liabilities AS l FROM statements WHERE company_id=? AND period_type='annual' ORDER BY period_end DESC LIMIT 1`).get(exists.id) as { a: number; l: number } | undefined;
    if (!row || !row.a) return { ok: false, detail: 'no balance sheet', status: 'no-data' as const };
    const gap = Math.abs(row.a - row.l) / row.a;
    return { ok: gap < 0.05, detail: `assets ${Math.round(row.a)} vs liabilities ${Math.round(row.l)} (${(gap * 100).toFixed(2)}% gap)`, status: gap < 0.05 ? 'ok' : 'suspect' as never };
  });
  run('Sanity: valuation vs price', () => {
    const v = valuationReport(db, symbol);
    if (!v || v.blended === null || !v.price) return { ok: false, detail: 'no blend', status: 'no-data' as const };
    const ratio = v.blended / v.price;
    const ok = ratio > 0.02 && ratio < 50;
    return { ok, detail: `blend ₹${v.blended} vs price ₹${v.price} (${ratio.toFixed(2)}×)`, status: ok ? 'ok' : 'suspect' as never };
  });
  run('Sanity: CAGR plausible', () => {
    const m = deepMetrics(db, symbol);
    const vals = [m?.cagr.sales3, m?.cagr.profit3].filter((x): x is number => x !== null && x !== undefined);
    if (vals.length === 0) return { ok: false, detail: 'not enough history', status: 'no-data' as const };
    const bad = vals.filter((x) => Math.abs(x) > 200);
    return { ok: bad.length === 0, detail: bad.length ? `implausible ${bad.join(', ')}%` : `${vals.map((x) => x.toFixed(1)).join(', ')}%`, status: bad.length ? 'suspect' as never : 'ok' };
  });

  run('Deep analysis v2', () => {
    const d = deep2(db, symbol);
    return { ok: !!d, detail: d ? `ROIC ${d.roic ?? '—'}%, ${d.anomalies.length} anomaly(ies), data quality ${d.dataQuality.score}` : 'no result' };
  });

  return { symbol: symbol.toUpperCase(), passed: rows.filter((r) => r.ok).length, total: rows.length, rows };
}
