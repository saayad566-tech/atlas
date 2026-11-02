// Back data: browse any date range of stored prices.
//
// Everything the app shows today is a point in time. This exposes the record itself, so a
// user can check what actually happened rather than trusting a single summary number.
import type { Database as DB } from 'better-sqlite3';

const r2 = (v: number): number => Math.round(v * 100) / 100;

export type Interval = 'day' | 'week' | 'month';

export interface Bar { date: string; open: number; high: number; low: number; close: number; volume: number }

export interface PriceHistory {
  symbol: string;
  from: string; to: string;
  interval: Interval;
  bars: Bar[];
  coverage: { firstDate: string | null; lastDate: string | null; totalSessions: number };
  stats: {
    startClose: number | null; endClose: number | null;
    changePct: number | null;
    high: number | null; low: number | null;
    avgVolume: number | null;
    bestDayPct: number | null; worstDayPct: number | null;
    volatilityPct: number | null;
  };
  note: string;
}

/** Collapse daily bars into weekly or monthly ones (first open, max high, min low, last close). */
export function resample(bars: Bar[], interval: Interval): Bar[] {
  if (interval === 'day' || bars.length === 0) return bars;
  const key = (d: string): string => {
    const dt = new Date(d);
    if (interval === 'month') return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
    // ISO week: Thursday of the week determines the year.
    const t = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
    return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  };
  const out: Bar[] = [];
  let cur: Bar | null = null; let curKey = '';
  for (const b of bars) {
    const k = key(b.date);
    if (k !== curKey) {
      if (cur) out.push(cur);
      cur = { ...b }; curKey = k;
    } else if (cur) {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
      cur.date = b.date;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function priceHistory(db: DB, symbol: string, opts: { from?: string; to?: string; interval?: Interval } = {}): PriceHistory | null {
  const c = db.prepare(`SELECT id, symbol FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number; symbol: string } | undefined;
  if (!c) return null;

  const all = db.prepare(`SELECT date, COALESCE(open,close) AS open, COALESCE(high,close) AS high,
      COALESCE(low,close) AS low, close, COALESCE(volume,0) AS volume
    FROM price_history WHERE company_id=? AND close>0 ORDER BY date ASC`).all(c.id) as Bar[];

  const firstDate = all.length ? all[0]!.date : null;
  const lastDate = all.length ? all[all.length - 1]!.date : null;

  const from = opts.from ?? firstDate ?? '';
  const to = opts.to ?? lastDate ?? '';
  const window = all.filter((b) => b.date >= from && b.date <= to);
  const interval: Interval = opts.interval ?? 'day';
  const bars = resample(window, interval);

  let changePct: number | null = null;
  let high: number | null = null; let low: number | null = null;
  let avgVolume: number | null = null;
  let bestDayPct: number | null = null; let worstDayPct: number | null = null;
  let volatilityPct: number | null = null;

  if (window.length > 0) {
    const startClose = window[0]!.close; const endClose = window[window.length - 1]!.close;
    if (startClose > 0) changePct = r2(((endClose - startClose) / startClose) * 100);
    high = r2(Math.max(...window.map((b) => b.high)));
    low = r2(Math.min(...window.map((b) => b.low)));
    avgVolume = Math.round(window.reduce((a, b) => a + b.volume, 0) / window.length);

    const rets: number[] = [];
    for (let i = 1; i < window.length; i++) {
      const a = window[i - 1]!.close; const b = window[i]!.close;
      if (a > 0) rets.push((b - a) / a);
    }
    if (rets.length) {
      bestDayPct = r2(Math.max(...rets) * 100);
      worstDayPct = r2(Math.min(...rets) * 100);
      const mean = rets.reduce((x, y) => x + y, 0) / rets.length;
      const varr = rets.reduce((x, y) => x + (y - mean) ** 2, 0) / rets.length;
      volatilityPct = r2(Math.sqrt(varr) * Math.sqrt(252) * 100);
    }
  }

  return {
    symbol: c.symbol, from, to, interval, bars,
    coverage: { firstDate, lastDate, totalSessions: all.length },
    stats: {
      startClose: window.length ? r2(window[0]!.close) : null,
      endClose: window.length ? r2(window[window.length - 1]!.close) : null,
      changePct, high, low, avgVolume, bestDayPct, worstDayPct, volatilityPct,
    },
    note: `Showing ${bars.length} ${interval} bar(s) from ${window.length} stored sessions. The full record runs ${firstDate ?? 'n/a'} to ${lastDate ?? 'n/a'}.`,
  };
}

/** What date ranges this market can actually show, per company. */
export function dataCoverage(db: DB): { companies: number; earliest: string | null; latest: string | null; sessions: number; thin: number } {
  const r = db.prepare(`SELECT COUNT(*) n, MIN(date) a, MAX(date) b FROM price_history WHERE close>0`).get() as { n: number; a: string | null; b: string | null };
  const companies = (db.prepare(`SELECT COUNT(DISTINCT company_id) n FROM price_history`).get() as { n: number }).n;
  const thin = (db.prepare(`SELECT COUNT(*) n FROM (SELECT company_id FROM price_history GROUP BY company_id HAVING COUNT(*) < 30)`).get() as { n: number }).n;
  return { companies, earliest: r.a, latest: r.b, sessions: r.n, thin };
}
