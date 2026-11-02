// Price-history backtesting.
//
// Deliberately honest about what it can and cannot do:
//  · It backtests rules that depend only on price history, because that is the only
//    point-in-time data stored per date. Fundamental screens cannot be backtested without
//    historical statements keyed to each rebalance date, so this does not pretend to.
//  · Every trade pays a cost, and the cost is stated.
//  · The benchmark is an equal-weighted buy-and-hold of the same universe, so a strategy
//    has to beat simply holding everything.
import type { Database as DB } from 'better-sqlite3';

const r2 = (v: number): number => Math.round(v * 100) / 100;

export interface PriceSeries { id: number; symbol: string; dates: string[]; closes: number[] }

export interface BacktestOptions {
  /** Days of price history used to rank a candidate at each rebalance. */
  lookbackDays?: number;
  /** How many names to hold. */
  topN?: number;
  /** Rebalance every N trading days. */
  rebalanceDays?: number;
  /** Round-trip cost in percent applied on each replacement. */
  costPct?: number;
}

export interface BacktestResult {
  ok: boolean;
  reason: string;
  universe: number;
  sessions: number;
  from: string;
  to: string;
  equity: Array<{ date: string; strategy: number; benchmark: number }>;
  stats: {
    totalReturnPct: number;
    benchmarkReturnPct: number;
    cagrPct: number | null;
    maxDrawdownPct: number;
    sharpe: number | null;
    rebalances: number;
    averageTurnoverPct: number;
    costPaidPct: number;
  };
  assumptions: string[];
}

/** Load every company's price series once, aligned by date. */
export function loadSeries(db: DB): PriceSeries[] {
  const rows = db.prepare(`
    SELECT c.id AS id, c.symbol AS symbol, p.date AS date, p.close AS close
    FROM price_history p JOIN companies c ON c.id = p.company_id
    WHERE p.close > 0 ORDER BY c.id, p.date ASC`).all() as Array<{ id: number; symbol: string; date: string; close: number }>;
  const byId = new Map<number, PriceSeries>();
  for (const r of rows) {
    let s = byId.get(r.id);
    if (!s) { s = { id: r.id, symbol: r.symbol, dates: [], closes: [] }; byId.set(r.id, s); }
    s.dates.push(r.date); s.closes.push(r.close);
  }
  return [...byId.values()];
}

/**
 * Rank-and-hold backtest: at each rebalance, buy the top-N names by trailing return over
 * `lookbackDays`, hold until the next rebalance, and charge `costPct` on each swap.
 */
export function backtest(series: PriceSeries[], opts: BacktestOptions = {}): BacktestResult {
  const lookback = Math.max(5, opts.lookbackDays ?? 120);
  const topN = Math.max(1, opts.topN ?? 10);
  const every = Math.max(1, opts.rebalanceDays ?? 21);
  const costPct = Math.max(0, opts.costPct ?? 0.25);
  const assumptions = [
    `Ranked by trailing ${lookback}-trading-day return, holding the top ${topN}.`,
    `Rebalanced every ${every} trading days.`,
    `Round-trip cost of ${costPct}% charged on each name swapped.`,
    'Uses price history only — fundamental screens cannot be backtested without point-in-time statements.',
    'Benchmark is equal-weighted buy-and-hold of the same universe.',
  ];
  const empty: BacktestResult = {
    ok: false, reason: '', universe: series.length, sessions: 0, from: '', to: '',
    equity: [], stats: { totalReturnPct: 0, benchmarkReturnPct: 0, cagrPct: null, maxDrawdownPct: 0, sharpe: null, rebalances: 0, averageTurnoverPct: 0, costPaidPct: 0 },
    assumptions,
  };
  if (series.length === 0) return { ...empty, reason: 'No price history stored.' };

  // Use the dates of the series with the longest history as the master calendar.
  const master = series.reduce((a, b) => (b.dates.length > a.dates.length ? b : a));
  const calendar = master.dates;
  if (calendar.length < lookback + every * 2) {
    return { ...empty, sessions: calendar.length, reason: `Need at least ${lookback + every * 2} sessions of history; only ${calendar.length} are stored.` };
  }

  const index = new Map<number, Map<string, number>>();
  for (const s of series) {
    const m = new Map<string, number>();
    s.dates.forEach((d, i) => m.set(d, s.closes[i]!));
    index.set(s.id, m);
  }

  let holdings: number[] = [];
  let equityValue = 100;
  let benchmarkValue = 100;
  let rebalances = 0; let turnoverSum = 0; let costPaid = 0;
  const equity: BacktestResult['equity'] = [];
  let prevDate = calendar[lookback]!;

  const priceOn = (id: number, date: string): number | null => index.get(id)?.get(date) ?? null;

  for (let i = lookback; i < calendar.length; i++) {
    const date = calendar[i]!;
    // Mark to market the current holdings since the previous session.
    if (holdings.length) {
      let sum = 0; let counted = 0;
      for (const id of holdings) {
        const now = priceOn(id, date); const before = priceOn(id, prevDate);
        if (now !== null && before !== null && before > 0) { sum += now / before; counted++; }
      }
      if (counted > 0) equityValue *= sum / counted;
    }
    // Benchmark: equal-weighted hold of everything that has a price both days.
    {
      let sum = 0; let counted = 0;
      for (const s of series) {
        const now = priceOn(s.id, date); const before = priceOn(s.id, prevDate);
        if (now !== null && before !== null && before > 0) { sum += now / before; counted++; }
      }
      if (counted > 0) benchmarkValue *= sum / counted;
    }
    prevDate = date;

    if ((i - lookback) % every === 0) {
      // Rank by trailing return.
      const ranked = series
        .map((s) => {
          const now = priceOn(s.id, date);
          const past = priceOn(s.id, calendar[i - lookback]!);
          if (now === null || past === null || past <= 0) return null;
          return { id: s.id, ret: now / past - 1 };
        })
        .filter((x): x is { id: number; ret: number } => x !== null)
        .sort((a, b) => b.ret - a.ret);
      const next = ranked.slice(0, topN).map((x) => x.id);
      if (holdings.length) {
        const swapped = next.filter((id) => !holdings.includes(id)).length;
        const turnover = holdings.length ? swapped / holdings.length : 0;
        turnoverSum += turnover;
        const cost = (turnover * equityValue * costPct) / 100;
        equityValue -= cost; costPaid += cost;
      }
      holdings = next;
      rebalances++;
    }
    equity.push({ date, strategy: r2(equityValue), benchmark: r2(benchmarkValue) });
  }

  const totalReturnPct = r2(equityValue - 100);
  const benchmarkReturnPct = r2(benchmarkValue - 100);
  const sessions = equity.length;
  const years = sessions / 252;
  const cagrPct = years > 0.1 && equityValue > 0 ? r2((Math.pow(equityValue / 100, 1 / years) - 1) * 100) : null;

  let peak = equity[0]?.strategy ?? 100; let maxDd = 0;
  for (const p of equity) { if (p.strategy > peak) peak = p.strategy; if (peak > 0) maxDd = Math.min(maxDd, (p.strategy - peak) / peak); }

  const rets: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    const a = equity[i - 1]!.strategy; const b = equity[i]!.strategy;
    if (a > 0) rets.push(b / a - 1);
  }
  let sharpe: number | null = null;
  if (rets.length > 20) {
    const mean = rets.reduce((x, y) => x + y, 0) / rets.length;
    const varr = rets.reduce((x, y) => x + (y - mean) ** 2, 0) / rets.length;
    const sd = Math.sqrt(varr);
    if (sd > 0) sharpe = r2((mean / sd) * Math.sqrt(252));
  }

  return {
    ok: true, reason: '', universe: series.length, sessions,
    from: equity[0]!.date, to: equity[equity.length - 1]!.date,
    equity,
    stats: {
      totalReturnPct, benchmarkReturnPct, cagrPct,
      maxDrawdownPct: r2(maxDd * 100),
      sharpe,
      rebalances,
      averageTurnoverPct: rebalances ? r2((turnoverSum / rebalances) * 100) : 0,
      costPaidPct: r2(costPaid),
    },
    assumptions,
  };
}
