// Cross-sectional analytics: correlation, risk-adjusted return, sector rotation,
// breadth, data freshness, coverage, investability, comparison and portfolio analysis.
//
// All of it reads the local database only — no network at query time.
import type { Database as DB } from 'better-sqlite3';
import { priceAnalytics } from './live';
import { deep2 } from './deep2';
import { scores } from './scores';
import { valuationReport } from './valuation2';
import { marketIntel, ensureMarketTables } from './marketdata';

const r2 = (n: number): number => Math.round(n * 100) / 100;

function closesFor(db: DB, symbol: string): Array<{ date: string; close: number }> {
  const c = db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
  if (!c) return [];
  return db.prepare(`SELECT date, close FROM price_history WHERE company_id=? ORDER BY date ASC`).all(c.id) as Array<{ date: string; close: number }>;
}

function dailyReturns(series: Array<{ date: string; close: number }>): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1]!.close; const b = series[i]!.close;
    if (a > 0) out.set(series[i]!.date, b / a - 1);
  }
  return out;
}

/** Pearson correlation of daily returns over the overlapping window. */
export function correlation(db: DB, a: string, b: string): number | null {
  const ra = dailyReturns(closesFor(db, a));
  const rb = dailyReturns(closesFor(db, b));
  const dates = [...ra.keys()].filter((d) => rb.has(d));
  if (dates.length < 20) return null;
  const x = dates.map((d) => ra.get(d)!);
  const y = dates.map((d) => rb.get(d)!);
  const mx = x.reduce((p, c) => p + c, 0) / x.length;
  const my = y.reduce((p, c) => p + c, 0) / y.length;
  let num = 0; let dx = 0; let dy = 0;
  for (let i = 0; i < x.length; i++) {
    num += (x[i]! - mx) * (y[i]! - my);
    dx += (x[i]! - mx) ** 2;
    dy += (y[i]! - my) ** 2;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? null : r2(num / den);
}

export function correlationMatrix(db: DB, symbols: string[]): { symbols: string[]; matrix: Array<Array<number | null>> } {
  const list = symbols.slice(0, 8);
  const matrix = list.map((a) => list.map((b) => (a === b ? 1 : correlation(db, a, b))));
  return { symbols: list, matrix };
}

/** Risk-adjusted return, recovery time and relative strength against the universe. */
// The universe median 1y return is the same for every company in a request burst, and
// recomputing it per call made /api/atlas-score 5x slower than it needed to be.
let medianCache: { at: number; value: number | null } | null = null;
function universeMedianY1(db: DB): number | null {
  if (medianCache && Date.now() - medianCache.at < 30_000) return medianCache.value;
  // One SQL pass instead of one priceAnalytics call per company: the loop made a cold
  // request take ~500 ms on a 120-company universe.
  let value: number | null = null;
  try {
    // Correlated index seeks instead of a window function over every price row:
    // 1.4 ms against 150 ms on a 120-company universe, same answer.
    const rows = db.prepare(`
      SELECT c.id AS id,
        (SELECT close FROM price_history p WHERE p.company_id=c.id AND close>0 ORDER BY p.date DESC LIMIT 1) AS last,
        (SELECT close FROM price_history p WHERE p.company_id=c.id AND close>0 ORDER BY p.date ASC  LIMIT 1) AS first
      FROM companies c`).all() as Array<{ id: number; last: number | null; first: number | null }>;
    const y1s = rows
      .filter((x) => x.last !== null && x.first !== null && x.first > 0)
      .map((x) => ((x.last! / x.first!) - 1) * 100)
      .sort((p, q) => p - q);
    if (y1s.length > 0) value = y1s[Math.floor(y1s.length / 2)]!;
  } catch {
    // Older SQLite without window functions: fall back to the loop.
    const y1s: number[] = [];
    for (const o of db.prepare(`SELECT symbol FROM companies`).all() as Array<{ symbol: string }>) {
      const a = priceAnalytics(db, o.symbol);
      if (a?.returns.y1 !== null && a?.returns.y1 !== undefined) y1s.push(a.returns.y1);
    }
    if (y1s.length > 0) { y1s.sort((p, q) => p - q); value = y1s[Math.floor(y1s.length / 2)]!; }
  }
  medianCache = { at: Date.now(), value };
  return value;
}

export function riskProfile(db: DB, symbol: string): { sharpe: number | null; annualReturnPct: number | null; annualVolPct: number | null; recoveryDays: number | null; relativeStrengthPct: number | null } | null {
  const series = closesFor(db, symbol);
  if (series.length < 30) return null;
  const rets = [...dailyReturns(series).values()];
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varr = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  const annualVol = Math.sqrt(varr) * Math.sqrt(252) * 100;
  const annualRet = (mean * 252) * 100;
  const sharpe = annualVol > 0 ? r2((annualRet - 7) / annualVol) : null;

  // Days from the deepest trough back to the prior peak.
  let peak = series[0]!.close; let peakIdx = 0; let worstDd = 0; let troughIdx = 0;
  for (let i = 0; i < series.length; i++) {
    if (series[i]!.close > peak) { peak = series[i]!.close; peakIdx = i; }
    const dd = (series[i]!.close / peak) - 1;
    if (dd < worstDd) { worstDd = dd; troughIdx = i; }
  }
  let recoveryDays: number | null = null;
  if (worstDd < 0) {
    const priorPeak = series[peakIdx]!.close;
    for (let i = troughIdx; i < series.length; i++) {
      if (series[i]!.close >= priorPeak) { recoveryDays = i - troughIdx; break; }
    }
  }

  // Relative strength = the company's 1y return minus the universe median 1y return.
  const own = priceAnalytics(db, symbol);
  const ownY1 = own?.returns.y1 ?? null;
  const medianY1 = universeMedianY1(db);

  return {
    sharpe, annualReturnPct: r2(annualRet), annualVolPct: r2(annualVol), recoveryDays,
    relativeStrengthPct: ownY1 !== null && medianY1 !== null ? r2(ownY1 - medianY1) : null,
  };
}

/** Total return including dividends, and the price reaction after each earnings date. */
export function totalReturn(db: DB, symbol: string): { priceReturnPct: number | null; dividendReturnPct: number | null; totalReturnPct: number | null; dividendsReceived: number } | null {
  const series = closesFor(db, symbol);
  if (series.length < 2) return null;
  const first = series[0]!.close; const last = series[series.length - 1]!.close;
  if (first <= 0) return null;
  const c = db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
  if (!c) return null;
  const divs = db.prepare(`SELECT date, amount FROM dividends WHERE company_id=? AND date >= ? ORDER BY date`).all(c.id, series[0]!.date) as Array<{ date: string; amount: number }>;
  const received = divs.reduce((a, d) => a + d.amount, 0);
  const priceReturn = ((last - first) / first) * 100;
  const divReturn = (received / first) * 100;
  return {
    priceReturnPct: r2(priceReturn), dividendReturnPct: r2(divReturn),
    totalReturnPct: r2(priceReturn + divReturn), dividendsReceived: r2(received),
  };
}

/** Price move around each stored earnings date (±1 session). */
export function earningsReaction(db: DB, symbol: string): Array<{ date: string; movePct: number | null }> {
  ensureMarketTables(db);
  const c = db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
  if (!c) return [];
  const ev = db.prepare(`SELECT earnings_date FROM calendar_events WHERE company_id=?`).get(c.id) as { earnings_date: string | null } | undefined;
  if (!ev?.earnings_date) return [];
  const series = closesFor(db, symbol);
  const idx = series.findIndex((p) => p.date >= ev.earnings_date!);
  if (idx <= 0 || idx >= series.length) return [{ date: ev.earnings_date, movePct: null }];
  const before = series[idx - 1]!.close; const after = series[idx]!.close;
  return [{ date: ev.earnings_date, movePct: before > 0 ? r2(((after - before) / before) * 100) : null }];
}

/** Median momentum per sector. */
export function sectorRotation(db: DB): Array<{ sector: string; companies: number; m1: number | null; m3: number | null; y1: number | null }> {
  const rows = db.prepare(`SELECT DISTINCT sector FROM companies ORDER BY sector`).all() as Array<{ sector: string }>;
  const median = (xs: number[]): number | null => {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, b) => a - b);
    return r2(s[Math.floor(s.length / 2)]!);
  };
  return rows.map(({ sector }) => {
    const syms = db.prepare(`SELECT symbol FROM companies WHERE sector=?`).all(sector) as Array<{ symbol: string }>;
    const m1: number[] = []; const m3: number[] = []; const y1: number[] = [];
    for (const s of syms) {
      const a = priceAnalytics(db, s.symbol);
      if (!a) continue;
      if (a.returns.m1 !== null) m1.push(a.returns.m1);
      if (a.returns.m3 !== null) m3.push(a.returns.m3);
      if (a.returns.y1 !== null) y1.push(a.returns.y1);
    }
    return { sector, companies: syms.length, m1: median(m1), m3: median(m3), y1: median(y1) };
  });
}

/** Advancers vs decliners by one-month return. */
export function breadth2(db: DB): { advancers: number; decliners: number; unchanged: number; pctAdvancing: number; total: number } {
  const syms = db.prepare(`SELECT symbol FROM companies`).all() as Array<{ symbol: string }>;
  let adv = 0; let dec = 0; let flat = 0;
  for (const s of syms) {
    const a = priceAnalytics(db, s.symbol);
    if (!a || a.returns.m1 === null) continue;
    if (a.returns.m1 > 0.5) adv++; else if (a.returns.m1 < -0.5) dec++; else flat++;
  }
  const total = adv + dec + flat;
  return { advancers: adv, decliners: dec, unchanged: flat, pctAdvancing: total ? r2((adv / total) * 100) : 0, total };
}

/** How stale each company's data is. */
export function freshness(db: DB): Array<{ symbol: string; priceAgeDays: number | null; statementAgeDays: number | null; stale: boolean }> {
  const rows = db.prepare(`
    SELECT c.symbol,
      (SELECT MAX(date) FROM price_history p WHERE p.company_id=c.id) AS lastPrice,
      (SELECT MAX(period_end) FROM statements s WHERE s.company_id=c.id) AS lastStatement
    FROM companies c`).all() as Array<{ symbol: string; lastPrice: string | null; lastStatement: string | null }>;
  const now = Date.now();
  const days = (d: string | null): number | null => (d ? Math.round((now - Date.parse(d)) / 86400000) : null);
  return rows.map((r) => {
    const priceAgeDays = days(r.lastPrice);
    const statementAgeDays = days(r.lastStatement);
    return { symbol: r.symbol, priceAgeDays, statementAgeDays, stale: (priceAgeDays ?? 999) > 7 || (statementAgeDays ?? 999) > 400 };
  });
}

/** What proportion of the universe has each kind of data. */
export function coverageReport(db: DB): { companies: number; withPrices: number; withHistory: number; withAnalysts: number; withDividends: number; withCalendar: number; pct: Record<string, number> } {
  ensureMarketTables(db);
  const n = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
  const companies = n(`SELECT COUNT(*) AS n FROM companies`);
  const withPrices = n(`SELECT COUNT(DISTINCT company_id) AS n FROM price_history`);
  const withHistory = n(`SELECT COUNT(DISTINCT company_id) AS n FROM statements WHERE period_type='annual'`);
  const withAnalysts = n(`SELECT COUNT(DISTINCT company_id) AS n FROM analyst_targets`);
  const withDividends = n(`SELECT COUNT(DISTINCT company_id) AS n FROM dividends`);
  const withCalendar = n(`SELECT COUNT(DISTINCT company_id) AS n FROM calendar_events`);
  const pct = (v: number): number => (companies ? r2((v / companies) * 100) : 0);
  return {
    companies, withPrices, withHistory, withAnalysts, withDividends, withCalendar,
    pct: { prices: pct(withPrices), history: pct(withHistory), analysts: pct(withAnalysts), dividends: pct(withDividends), calendar: pct(withCalendar) },
  };
}

/** Composite investability: quality + value + momentum + analyst view + data quality. */
export function investability(db: DB, symbol: string): { score: number; grade: 'A' | 'B' | 'C' | 'D'; parts: Record<string, number | null> } | null {
  const d = deep2(db, symbol);
  const v = valuationReport(db, symbol);
  const sc = scores(db, symbol);
  const mi = marketIntel(db, symbol);
  if (!d && !v) return null;
  const clamp = (x: number): number => Math.max(0, Math.min(100, x));
  const parts: Record<string, number | null> = {
    quality: d ? d.scorecard.score : null,
    value: v?.upsidePct !== null && v?.upsidePct !== undefined ? clamp(50 + v.upsidePct * 2) : null,
    momentum: d ? clamp(50 + (d as unknown as { momentum?: number }).momentum! * 0) : null,
    analysts: mi?.analysts.upsidePct !== null && mi?.analysts.upsidePct !== undefined ? clamp(50 + mi.analysts.upsidePct * 2) : null,
    fundamentals: sc ? sc.composite.score : null,
  };
  const own = priceAnalytics(db, symbol);
  parts['momentum'] = own?.returns.m3 !== null && own?.returns.m3 !== undefined ? clamp(50 + own.returns.m3 * 1.5) : null;
  const usable = Object.values(parts).filter((x): x is number => x !== null);
  if (usable.length === 0) return null;
  const score = Math.round(usable.reduce((a, b) => a + b, 0) / usable.length);
  const grade = score >= 75 ? 'A' : score >= 60 ? 'B' : score >= 45 ? 'C' : 'D';
  return { score, grade, parts };
}

/** Side-by-side metrics for 2–5 companies. */
export function compare(db: DB, symbols: string[]): Array<Record<string, unknown>> {
  return symbols.slice(0, 5).map((sym) => {
    const row = db.prepare(`SELECT * FROM v_latest WHERE UPPER(symbol)=UPPER(?)`).get(sym) as Record<string, number | string> | undefined;
    if (!row) return { symbol: sym.toUpperCase(), missing: true };
    const mi = marketIntel(db, sym);
    const inv = investability(db, sym);
    return {
      symbol: String(row['symbol']), name: String(row['name']), sector: String(row['sector']),
      marketCap: Number(row['market_cap'] ?? 0), pe: Number(row['pe'] ?? 0), roe: Number(row['roe'] ?? 0),
      debtToEquity: Number(row['debt_to_equity'] ?? 0), opm: Number(row['opm'] ?? 0),
      salesGrowth3y: Number(row['sales_growth_3y'] ?? 0),
      dividendYield: mi?.dividends.yieldPct ?? null, analystUpside: mi?.analysts.upsidePct ?? null,
      consensus: mi?.analysts.consensus ?? null, investability: inv?.score ?? null, grade: inv?.grade ?? null,
    };
  });
}

/** Portfolio-level analytics: allocation, concentration, weighted risk. */
export function portfolioAnalytics(db: DB, holdings: Array<{ symbol: string; value: number; sector: string }>): {
  totalValue: number; sectors: Array<{ sector: string; value: number; pct: number }>; hhi: number; concentration: string; weightedVolPct: number | null; holdings: number;
} {
  const total = holdings.reduce((a, h) => a + h.value, 0);
  const bySector = new Map<string, number>();
  for (const h of holdings) bySector.set(h.sector, (bySector.get(h.sector) ?? 0) + h.value);
  const sectors = [...bySector.entries()].map(([sector, value]) => ({ sector, value: r2(value), pct: total > 0 ? r2((value / total) * 100) : 0 })).sort((a, b) => b.value - a.value);
  const hhi = total > 0 ? r2([...bySector.values()].reduce((a, v) => a + (v / total) ** 2, 0)) : 0;
  const concentration = hhi > 0.4 ? 'high' : hhi > 0.2 ? 'moderate' : 'diversified';
  const vols: number[] = [];
  for (const h of holdings) {
    const a = priceAnalytics(db, h.symbol);
    if (a?.volatilityPct !== null && a?.volatilityPct !== undefined && total > 0) vols.push((a.volatilityPct * h.value) / total);
  }
  return {
    totalValue: r2(total), sectors, hhi, concentration, holdings: holdings.length,
    weightedVolPct: vols.length ? r2(vols.reduce((a, b) => a + b, 0)) : null,
  };
}

/** Upcoming events and alerts for the watchlist. */
export function watchlistDigest(db: DB, symbols: string[]): Array<{ symbol: string; name: string; earningsDate: string | null; exDividendDate: string | null; investability: number | null; grade: string | null; stale: boolean }> {
  ensureMarketTables(db);
  const fresh = new Map(freshness(db).map((f) => [f.symbol.toUpperCase(), f.stale]));
  return symbols.map((sym) => {
    const c = db.prepare(`SELECT id, symbol, name FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(sym) as { id: number; symbol: string; name: string } | undefined;
    if (!c) return { symbol: sym.toUpperCase(), name: sym, earningsDate: null, exDividendDate: null, investability: null, grade: null, stale: true };
    const ev = db.prepare(`SELECT earnings_date, ex_dividend_date FROM calendar_events WHERE company_id=?`).get(c.id) as { earnings_date: string | null; ex_dividend_date: string | null } | undefined;
    const inv = investability(db, c.symbol);
    return {
      symbol: c.symbol, name: c.name,
      earningsDate: ev?.earnings_date ?? null, exDividendDate: ev?.ex_dividend_date ?? null,
      investability: inv?.score ?? null, grade: inv?.grade ?? null, stale: fresh.get(c.symbol.toUpperCase()) ?? false,
    };
  });
}
