// Market data: analysts, ownership, dividends, volume and risk.
//
// Everything here comes from the live source and is stored locally, so the analysis
// works offline afterwards. Parsers are pure so they can be tested without a network.
import type { Database as DB } from 'better-sqlite3';

// ---- DDL --------------------------------------------------------------------

export const MARKET_DDL = `
CREATE TABLE IF NOT EXISTS dividends (
  company_id INTEGER NOT NULL, date TEXT NOT NULL, amount REAL NOT NULL,
  PRIMARY KEY (company_id, date)
);
CREATE TABLE IF NOT EXISTS price_volume (
  company_id INTEGER NOT NULL, date TEXT NOT NULL, volume REAL NOT NULL,
  PRIMARY KEY (company_id, date)
);
CREATE TABLE IF NOT EXISTS holders (
  company_id INTEGER PRIMARY KEY, insiders_pct REAL, institutions_pct REAL,
  institutions_float_pct REAL, institutions_count INTEGER, fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS insider_trades (
  company_id INTEGER NOT NULL, date TEXT NOT NULL, name TEXT NOT NULL, relation TEXT NOT NULL,
  txn TEXT NOT NULL, shares REAL NOT NULL, value REAL NOT NULL,
  PRIMARY KEY (company_id, date, name, txn)
);
CREATE TABLE IF NOT EXISTS recommendations (
  company_id INTEGER NOT NULL, period TEXT NOT NULL, strong_buy INTEGER, buy INTEGER,
  hold INTEGER, sell INTEGER, strong_sell INTEGER,
  PRIMARY KEY (company_id, period)
);
CREATE TABLE IF NOT EXISTS earnings_estimates (
  company_id INTEGER NOT NULL, period TEXT NOT NULL, end_date TEXT, eps_est REAL,
  eps_low REAL, eps_high REAL, revenue_est REAL, growth REAL, forward_pe REAL,
  PRIMARY KEY (company_id, period)
);
CREATE TABLE IF NOT EXISTS earnings_surprises (
  company_id INTEGER NOT NULL, quarter TEXT NOT NULL, actual REAL, estimate REAL, surprise_pct REAL,
  PRIMARY KEY (company_id, quarter)
);
CREATE TABLE IF NOT EXISTS calendar_events (
  company_id INTEGER PRIMARY KEY, earnings_date TEXT, eps_estimate REAL, revenue_estimate REAL,
  ex_dividend_date TEXT, dividend_date TEXT, fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS splits (
  company_id INTEGER NOT NULL, date TEXT NOT NULL, numerator REAL NOT NULL, denominator REAL NOT NULL,
  PRIMARY KEY (company_id, date)
);
CREATE TABLE IF NOT EXISTS analyst_targets (
  company_id INTEGER PRIMARY KEY, target_low REAL, target_mean REAL, target_high REAL,
  target_median REAL, recommendation TEXT, num_analysts INTEGER, fetched_at INTEGER NOT NULL
);
`;

export function ensureMarketTables(db: DB): void { db.exec(MARKET_DDL); }

// ---- helpers ----------------------------------------------------------------

const n = (v: unknown): number => {
  if (v && typeof v === 'object' && 'raw' in (v as Record<string, unknown>)) {
    const raw = (v as { raw?: unknown }).raw;
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  }
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
/** Yahoo sometimes returns {raw, fmt} for dates/labels — take fmt, else convert seconds. */
const label = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const o = v as { fmt?: unknown; raw?: unknown };
    if (typeof o.fmt === 'string') return o.fmt;
    if (typeof o.raw === 'number') return new Date(o.raw * 1000).toISOString().slice(0, 10);
  }
  return '';
};
const r2 = (x: number): number => Math.round(x * 100) / 100;

// ---- parsers ----------------------------------------------------------------

export interface Recommendation { period: string; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }
export function parseRecommendationTrend(json: unknown): Recommendation[] {
  const rows = (json as { quoteSummary?: { result?: Array<Record<string, unknown>> } })?.quoteSummary?.result?.[0]?.['recommendationTrend'] as { trend?: Array<Record<string, unknown>> } | undefined;
  if (!rows?.trend) return [];
  return rows.trend.map((t) => ({
    period: str(t['period']), strongBuy: n(t['strongBuy']), buy: n(t['buy']),
    hold: n(t['hold']), sell: n(t['sell']), strongSell: n(t['strongSell']),
  }));
}

export interface Holders { insidersPct: number | null; institutionsPct: number | null; institutionsFloatPct: number | null; institutionsCount: number | null }
export function parseMajorHolders(json: unknown): Holders | null {
  const m = (json as { quoteSummary?: { result?: Array<Record<string, unknown>> } })?.quoteSummary?.result?.[0]?.['majorHoldersBreakdown'] as Record<string, unknown> | undefined;
  if (!m) return null;
  return {
    insidersPct: n(m['insidersPercentHeld']) ? n(m['insidersPercentHeld']) * 100 : null,
    institutionsPct: n(m['institutionsPercentHeld']) ? n(m['institutionsPercentHeld']) * 100 : null,
    institutionsFloatPct: n(m['institutionsFloatPercentHeld']) ? n(m['institutionsFloatPercentHeld']) * 100 : null,
    institutionsCount: n(m['institutionsCount']) || null,
  };
}

export interface InsiderTrade { date: string; name: string; relation: string; transaction: string; shares: number; value: number }
export function parseInsiderTransactions(json: unknown): InsiderTrade[] {
  const t = (json as { quoteSummary?: { result?: Array<Record<string, unknown>> } })?.quoteSummary?.result?.[0]?.['insiderTransactions'] as { transactions?: Array<Record<string, unknown>> } | undefined;
  if (!t?.transactions) return [];
  return t.transactions.map((x) => ({
    date: label(x['startDate']),
    name: str(x['filerName']), relation: str(x['filerRelation']), transaction: str(x['transactionText']),
    shares: n(x['shares']), value: n(x['value']),
  })).filter((x) => x.date && x.name);
}

export interface Estimate { period: string; endDate: string; epsEst: number | null; epsLow: number | null; epsHigh: number | null; revenueEst: number | null; growth: number | null; forwardPe: number | null }
export function parseEarningsTrend(json: unknown): Estimate[] {
  const t = (json as { quoteSummary?: { result?: Array<Record<string, unknown>> } })?.quoteSummary?.result?.[0]?.['earningsTrend'] as { trend?: Array<Record<string, unknown>> } | undefined;
  if (!t?.trend) return [];
  return t.trend.map((x) => ({
    period: str(x['period']), endDate: str(x['endDate']),
    epsEst: n(x['earningsEstimate'] && (x['earningsEstimate'] as Record<string, unknown>)['avg']) || null,
    epsLow: n(x['earningsEstimate'] && (x['earningsEstimate'] as Record<string, unknown>)['low']) || null,
    epsHigh: n(x['earningsEstimate'] && (x['earningsEstimate'] as Record<string, unknown>)['high']) || null,
    revenueEst: n(x['revenueEstimate'] && (x['revenueEstimate'] as Record<string, unknown>)['avg']) || null,
    growth: n(x['growth']) || null,
    forwardPe: n(x['forwardPE']) || null,
  }));
}

export interface Surprise { quarter: string; actual: number; estimate: number; surprisePct: number }
export function parseEarningsHistory(json: unknown): Surprise[] {
  const h = (json as { quoteSummary?: { result?: Array<Record<string, unknown>> } })?.quoteSummary?.result?.[0]?.['earningsHistory'] as { history?: Array<Record<string, unknown>> } | undefined;
  if (!h?.history) return [];
  return h.history.map((x) => {
    const actual = n(x['epsActual']); const estimate = n(x['epsEstimate']);
    return { quarter: label(x['quarter']), actual, estimate, surprisePct: estimate !== 0 ? r2(((actual - estimate) / Math.abs(estimate)) * 100) : 0 };
  }).filter((x) => x.quarter);
}

export interface CalendarEvents { earningsDate: string | null; epsEstimate: number | null; revenueEstimate: number | null; exDividendDate: string | null; dividendDate: string | null }
export function parseCalendarEvents(json: unknown): CalendarEvents | null {
  const c = (json as { quoteSummary?: { result?: Array<Record<string, unknown>> } })?.quoteSummary?.result?.[0]?.['calendarEvents'] as Record<string, unknown> | undefined;
  if (!c) return null;
  const dates = (c['earnings'] as Record<string, unknown> | undefined)?.['earningsDate'];
  const first = Array.isArray(dates) && dates.length ? n(dates[0]) : 0;
  return {
    earningsDate: first ? new Date(first * 1000).toISOString().slice(0, 10) : null,
    epsEstimate: n((c['earnings'] as Record<string, unknown> | undefined)?.['earningsAverage']) || null,
    revenueEstimate: n((c['earnings'] as Record<string, unknown> | undefined)?.['revenueAverage']) || null,
    exDividendDate: n(c['exDividendDate']) ? new Date(n(c['exDividendDate']) * 1000).toISOString().slice(0, 10) : null,
    dividendDate: n(c['dividendDate']) ? new Date(n(c['dividendDate']) * 1000).toISOString().slice(0, 10) : null,
  };
}

/** Chart response with events → dividends, splits and volume. */
export function parseChartExtras(json: unknown): { dividends: Array<{ date: string; amount: number }>; splits: Array<{ date: string; numerator: number; denominator: number }>; volumes: Array<{ date: string; volume: number }> } {
  const r = (json as { chart?: { result?: Array<Record<string, unknown>> } })?.chart?.result?.[0];
  if (!r) return { dividends: [], splits: [], volumes: [] };
  const events = (r['events'] ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
  const ts = (r['timestamp'] ?? []) as number[];
  const quote = (r['indicators'] as { quote?: Array<{ volume?: Array<number | null> }> })?.quote?.[0];
  const dividends = Object.values(events['dividends'] ?? {}).map((d) => ({
    date: new Date(Number(d['date']) * 1000).toISOString().slice(0, 10), amount: n(d['amount']),
  })).sort((a, b) => a.date.localeCompare(b.date));
  const splits = Object.values(events['splits'] ?? {}).map((s) => ({
    date: new Date(Number(s['date']) * 1000).toISOString().slice(0, 10), numerator: n(s['numerator']), denominator: n(s['denominator']),
  })).sort((a, b) => a.date.localeCompare(b.date));
  const volumes: Array<{ date: string; volume: number }> = [];
  for (let i = 0; i < ts.length; i++) {
    const v = quote?.volume?.[i];
    if (typeof v === 'number' && Number.isFinite(v)) volumes.push({ date: new Date(ts[i]! * 1000).toISOString().slice(0, 10), volume: v });
  }
  return { dividends, splits, volumes };
}

// ---- storage ----------------------------------------------------------------

export function storeMarketData(db: DB, symbol: string, payload: {
  recommendations?: Recommendation[]; holders?: Holders | null; insiders?: InsiderTrade[];
  estimates?: Estimate[]; surprises?: Surprise[]; targets?: { low: number; mean: number; high: number; median: number; recommendation: string; analysts: number } | null;
  dividends?: Array<{ date: string; amount: number }>; volumes?: Array<{ date: string; volume: number }>;
  splits?: Array<{ date: string; numerator: number; denominator: number }>; upcoming?: CalendarEvents | null;
}): { rows: number } {
  ensureMarketTables(db);
  const c = db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
  if (!c) return { rows: 0 };
  let rows = 0;
  const tx = db.transaction(() => {
    if (payload.recommendations) for (const x of payload.recommendations) {
      db.prepare(`INSERT OR REPLACE INTO recommendations (company_id,period,strong_buy,buy,hold,sell,strong_sell) VALUES (?,?,?,?,?,?,?)`)
        .run(c.id, x.period, x.strongBuy, x.buy, x.hold, x.sell, x.strongSell); rows++;
    }
    if (payload.holders) {
      db.prepare(`INSERT OR REPLACE INTO holders (company_id,insiders_pct,institutions_pct,institutions_float_pct,institutions_count,fetched_at) VALUES (?,?,?,?,?,?)`)
        .run(c.id, payload.holders.insidersPct, payload.holders.institutionsPct, payload.holders.institutionsFloatPct, payload.holders.institutionsCount, Date.now()); rows++;
    }
    if (payload.insiders) for (const x of payload.insiders) {
      db.prepare(`INSERT OR REPLACE INTO insider_trades (company_id,date,name,relation,txn,shares,value) VALUES (?,?,?,?,?,?,?)`)
        .run(c.id, x.date, x.name, x.relation, x.transaction, x.shares, x.value); rows++;
    }
    if (payload.estimates) for (const x of payload.estimates) {
      db.prepare(`INSERT OR REPLACE INTO earnings_estimates (company_id,period,end_date,eps_est,eps_low,eps_high,revenue_est,growth,forward_pe) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(c.id, x.period, x.endDate, x.epsEst, x.epsLow, x.epsHigh, x.revenueEst, x.growth, x.forwardPe); rows++;
    }
    if (payload.surprises) for (const x of payload.surprises) {
      db.prepare(`INSERT OR REPLACE INTO earnings_surprises (company_id,quarter,actual,estimate,surprise_pct) VALUES (?,?,?,?,?)`)
        .run(c.id, x.quarter, x.actual, x.estimate, x.surprisePct); rows++;
    }
    if (payload.targets) {
      db.prepare(`INSERT OR REPLACE INTO analyst_targets (company_id,target_low,target_mean,target_high,target_median,recommendation,num_analysts,fetched_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run(c.id, payload.targets.low, payload.targets.mean, payload.targets.high, payload.targets.median, payload.targets.recommendation, payload.targets.analysts, Date.now()); rows++;
    }
    if (payload.dividends) for (const x of payload.dividends) {
      db.prepare(`INSERT OR REPLACE INTO dividends (company_id,date,amount) VALUES (?,?,?)`).run(c.id, x.date, x.amount); rows++;
    }
    if (payload.splits) for (const x of payload.splits) {
      db.prepare(`INSERT OR REPLACE INTO splits (company_id,date,numerator,denominator) VALUES (?,?,?,?)`)
        .run(c.id, x.date, x.numerator, x.denominator); rows++;
    }
    if (payload.upcoming) {
      db.prepare(`INSERT OR REPLACE INTO calendar_events (company_id,earnings_date,eps_estimate,revenue_estimate,ex_dividend_date,dividend_date,fetched_at) VALUES (?,?,?,?,?,?,?)`)
        .run(c.id, payload.upcoming.earningsDate, payload.upcoming.epsEstimate, payload.upcoming.revenueEstimate, payload.upcoming.exDividendDate, payload.upcoming.dividendDate, Date.now()); rows++;
    }
    if (payload.volumes) for (const x of payload.volumes) {
      db.prepare(`INSERT OR REPLACE INTO price_volume (company_id,date,volume) VALUES (?,?,?)`).run(c.id, x.date, x.volume); rows++;
    }
  });
  tx();
  return { rows };
}

// ---- analytics --------------------------------------------------------------

export interface MarketIntel {
  symbol: string;
  dividends: { count: number; lastAmount: number | null; ttmAmount: number | null; yieldPct: number | null; growthPct: number | null; streakYears: number; yieldOnCostPct: number | null };
  volume: { avg20: number | null; avg60: number | null; trendPct: number | null; turnoverCr: number | null; liquidity: 'high' | 'medium' | 'low' | null };
  momentum: { m1: number | null; m3: number | null; m6: number | null; y1: number | null; composite: number | null };
  risk: { vol20: number | null; vol250: number | null; regime: 'calm' | 'normal' | 'elevated' | null; var95Pct: number | null };
  analysts: { consensus: string | null; score: number | null; targetMean: number | null; targetHigh: number | null; targetLow: number | null; upsidePct: number | null; analysts: number | null };
  estimates: Estimate[];
  surprises: Surprise[];
  avgSurprisePct: number | null;
  ownership: { insidersPct: number | null; institutionsPct: number | null; institutionsCount: number | null; netInsiderValue: number | null; insiderTrades: number };
  upcoming: CalendarEvents | null;
}

export function marketIntel(db: DB, symbol: string): MarketIntel | null {
  ensureMarketTables(db);
  const c = db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
  if (!c) return null;
  const price = (db.prepare(`SELECT price FROM v_latest WHERE id=?`).get(c.id) as { price: number } | undefined)?.price ?? 0;

  // dividends
  const divs = db.prepare(`SELECT date, amount FROM dividends WHERE company_id=? ORDER BY date ASC`).all(c.id) as Array<{ date: string; amount: number }>;
  const byYear = new Map<string, number>();
  for (const d of divs) byYear.set(d.date.slice(0, 4), (byYear.get(d.date.slice(0, 4)) ?? 0) + d.amount);
  const years = [...byYear.keys()].sort();
  const lastYear = years[years.length - 1];
  const ttm = lastYear ? byYear.get(lastYear)! : null;
  let streak = 0;
  for (let i = years.length - 1; i >= 0; i--) { if ((byYear.get(years[i]!) ?? 0) > 0) streak++; else break; }
  const firstYear = years[0]; const firstAmt = firstYear ? byYear.get(firstYear)! : 0;
  const growth = firstAmt > 0 && ttm !== null && years.length > 1 ? r2((((ttm / firstAmt) ** (1 / (years.length - 1))) - 1) * 100) : null;

  // volume
  const vols = db.prepare(`SELECT volume FROM price_volume WHERE company_id=? ORDER BY date DESC LIMIT 60`).all(c.id) as Array<{ volume: number }>;
  const avg = (arr: number[]): number | null => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const v20 = avg(vols.slice(0, 20).map((v) => v.volume));
  const v60 = avg(vols.map((v) => v.volume));
  const turnover = v20 !== null && price > 0 ? r2((v20 * price) / 1e7) : null;
  const liquidity = turnover === null ? null : turnover > 50 ? 'high' : turnover > 5 ? 'medium' : 'low';

  // momentum & risk from stored closes
  const closes = (db.prepare(`SELECT date, close FROM price_history WHERE company_id=? ORDER BY date ASC`).all(c.id) as Array<{ date: string; close: number }>).map((x) => x.close);
  const ret = (days: number): number | null => (closes.length > days && closes[closes.length - 1 - days]! > 0 ? r2(((closes[closes.length - 1]! / closes[closes.length - 1 - days]!) - 1) * 100) : null);
  const volOf = (window: number): number | null => {
    const slice = closes.slice(-window - 1);
    if (slice.length < 10) return null;
    const rets: number[] = [];
    for (let i = 1; i < slice.length; i++) if (slice[i - 1]! > 0) rets.push(slice[i]! / slice[i - 1]! - 1);
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const varr = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
    return r2(Math.sqrt(varr) * Math.sqrt(252) * 100);
  };
  const vol20 = volOf(20); const vol250 = volOf(250);
  const regime = vol20 === null || vol250 === null ? null : vol20 > vol250 * 1.3 ? 'elevated' : vol20 < vol250 * 0.7 ? 'calm' : 'normal';
  const var95 = vol20 === null ? null : r2(-1.645 * (vol20 / 100) / Math.sqrt(252) * 100);

  const m1 = ret(21); const m3 = ret(63); const m6 = ret(126); const y1 = ret(252);
  const parts = [m1, m3, m6, y1].filter((x): x is number => x !== null);
  const composite = parts.length ? r2(parts.reduce((a, b) => a + b, 0) / parts.length) : null;

  // analysts
  const recs = db.prepare(`SELECT * FROM recommendations WHERE company_id=?`).all(c.id) as Array<Record<string, number | string>>;
  const latest = recs.find((x) => x['period'] === '0m') ?? recs[0];
  let consensus: string | null = null; let score: number | null = null;
  if (latest) {
    const sb = Number(latest['strong_buy'] ?? 0), b = Number(latest['buy'] ?? 0), h = Number(latest['hold'] ?? 0);
    const s = Number(latest['sell'] ?? 0), ss = Number(latest['strong_sell'] ?? 0);
    const total = sb + b + h + s + ss;
    if (total > 0) {
      score = r2((sb * 5 + b * 4 + h * 3 + s * 2 + ss * 1) / total);
      consensus = score >= 4.5 ? 'strong buy' : score >= 3.5 ? 'buy' : score >= 2.5 ? 'hold' : score >= 1.5 ? 'sell' : 'strong sell';
    }
  }
  const t = db.prepare(`SELECT * FROM analyst_targets WHERE company_id=?`).get(c.id) as Record<string, unknown> | undefined;
  const targetMean = t ? Number(t['target_mean'] ?? 0) || null : null;

  const estimates = (db.prepare(`SELECT * FROM earnings_estimates WHERE company_id=?`).all(c.id) as Array<Record<string, unknown>>).map((x) => ({
    period: String(x['period']), endDate: String(x['end_date'] ?? ''), epsEst: x['eps_est'] === null ? null : Number(x['eps_est']),
    epsLow: x['eps_low'] === null ? null : Number(x['eps_low']), epsHigh: x['eps_high'] === null ? null : Number(x['eps_high']),
    revenueEst: x['revenue_est'] === null ? null : Number(x['revenue_est']), growth: x['growth'] === null ? null : Number(x['growth']),
    forwardPe: x['forward_pe'] === null ? null : Number(x['forward_pe']),
  }));
  const surprises = (db.prepare(`SELECT * FROM earnings_surprises WHERE company_id=?`).all(c.id) as Array<Record<string, unknown>>).map((x) => ({
    quarter: String(x['quarter']), actual: Number(x['actual']), estimate: Number(x['estimate']), surprisePct: Number(x['surprise_pct']),
  }));
  const avgSurprise = surprises.length ? r2(surprises.reduce((a, b) => a + b.surprisePct, 0) / surprises.length) : null;

  const h = db.prepare(`SELECT * FROM holders WHERE company_id=?`).get(c.id) as Record<string, unknown> | undefined;
  const insiders = db.prepare(`SELECT SUM(value) AS v, COUNT(*) AS c FROM insider_trades WHERE company_id=?`).get(c.id) as { v: number | null; c: number };

  return {
    symbol: symbol.toUpperCase(),
    dividends: {
      count: divs.length, lastAmount: divs.length ? r2(divs[divs.length - 1]!.amount) : null, ttmAmount: ttm === null ? null : r2(ttm),
      yieldPct: ttm !== null && price > 0 ? r2((ttm / price) * 100) : null, growthPct: growth, streakYears: streak,
      yieldOnCostPct: ttm !== null && firstAmt > 0 ? r2((ttm / firstAmt) * 100) : null,
    },
    volume: { avg20: v20 === null ? null : Math.round(v20), avg60: v60 === null ? null : Math.round(v60), trendPct: v20 !== null && v60 !== null && v60 > 0 ? r2(((v20 / v60) - 1) * 100) : null, turnoverCr: turnover, liquidity },
    momentum: { m1, m3, m6, y1, composite },
    risk: { vol20, vol250, regime, var95Pct: var95 },
    analysts: {
      consensus, score, targetMean, targetHigh: t ? Number(t['target_high'] ?? 0) || null : null, targetLow: t ? Number(t['target_low'] ?? 0) || null : null,
      upsidePct: targetMean !== null && price > 0 ? r2(((targetMean - price) / price) * 100) : null,
      analysts: t ? Number(t['num_analysts'] ?? 0) || null : null,
    },
    estimates, surprises, avgSurprisePct: avgSurprise,
    ownership: {
      insidersPct: h ? (h['insiders_pct'] === null ? null : Number(h['insiders_pct'])) : null,
      institutionsPct: h ? (h['institutions_pct'] === null ? null : Number(h['institutions_pct'])) : null,
      institutionsCount: h ? (h['institutions_count'] === null ? null : Number(h['institutions_count'])) : null,
      netInsiderValue: insiders.v === null ? null : r2(insiders.v), insiderTrades: insiders.c,
    },
    upcoming: (() => {
      const ev = db.prepare(`SELECT * FROM calendar_events WHERE company_id=?`).get(c.id) as Record<string, unknown> | undefined;
      if (!ev) return null;
      return {
        earningsDate: ev['earnings_date'] === null ? null : String(ev['earnings_date']),
        epsEstimate: ev['eps_estimate'] === null ? null : Number(ev['eps_estimate']),
        revenueEstimate: ev['revenue_estimate'] === null ? null : Number(ev['revenue_estimate']),
        exDividendDate: ev['ex_dividend_date'] === null ? null : String(ev['ex_dividend_date']),
        dividendDate: ev['dividend_date'] === null ? null : String(ev['dividend_date']),
      };
    })(),
  };
}
