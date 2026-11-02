// Analysis for a non-stock instrument.
//
// A stock is judged on fundamentals; an ETF on cost and composition; a currency pair on
// carry and session overlap; a crypto asset on supply and liquidity. This module computes
// what each class actually needs, and says plainly when the data is not there instead of
// showing a stock panel with empty fields.
import type { Database as DB } from 'better-sqlite3';
import { assetDef, volatilityVerdict, type AssetClass } from './assets';

const r2 = (v: number): number => Math.round(v * 100) / 100;

export interface Panel { title: string; rows: Array<{ label: string; value: string; note?: string }>; note?: string }

export interface InstrumentAnalysis {
  symbol: string;
  assetClass: AssetClass;
  name: string | null;
  currency: string | null;
  panels: Panel[];
  /** Panels the class supports but the data cannot fill. Stated, never faked. */
  unavailable: string[];
  note: string;
}

interface Bar { date: string; open: number; high: number; low: number; close: number; volume: number }

function bars(db: DB, symbol: string): Bar[] {
  try {
    const c = db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
    if (!c) return [];
    return db.prepare(`SELECT date, COALESCE(open,close) AS open, COALESCE(high,close) AS high,
        COALESCE(low,close) AS low, close, COALESCE(volume,0) AS volume
      FROM price_history WHERE company_id=? AND close>0 ORDER BY date ASC`).all(c.id) as Bar[];
  } catch { return []; }
}

function priceStats(series: Bar[]): { last: number | null; changePct: number | null; high: number | null; low: number | null; vol: number | null; maxDd: number | null } {
  if (!series.length) return { last: null, changePct: null, high: null, low: null, vol: null, maxDd: null };
  const closes = series.map((b) => b.close);
  const last = closes[closes.length - 1]!;
  const first = closes[0]!;
  const high = Math.max(...series.map((b) => b.high));
  const low = Math.min(...series.map((b) => b.low));
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) { const a = closes[i - 1]!; if (a > 0) rets.push((closes[i]! - a) / a); }
  let vol: number | null = null;
  if (rets.length > 2) {
    const m = rets.reduce((a, b) => a + b, 0) / rets.length;
    const v = rets.reduce((a, b) => a + (b - m) ** 2, 0) / rets.length;
    vol = r2(Math.sqrt(v) * Math.sqrt(252) * 100);
  }
  let peak = closes[0]!; let maxDd = 0;
  for (const c of closes) { if (c > peak) peak = c; if (peak > 0) maxDd = Math.min(maxDd, (c - peak) / peak); }
  return { last: r2(last), changePct: first > 0 ? r2(((last - first) / first) * 100) : null, high: r2(high), low: r2(low), vol, maxDd: r2(maxDd * 100) };
}

/** Pip size: 0.01 for JPY pairs, 0.0001 otherwise — the market convention. */
function pipSize(symbol: string): number {
  return /JPY/.test(symbol.toUpperCase()) ? 0.01 : 0.0001;
}

export function analyseInstrument(db: DB, symbol: string, assetClass: AssetClass): InstrumentAnalysis | null {
  const row = db.prepare(`SELECT name FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { name: string } | undefined;
  const series = bars(db, symbol);
  const s = priceStats(series);
  const def = assetDef(assetClass);
  const panels: Panel[] = [];
  const unavailable: string[] = [];

  const pricePanel: Panel = {
    title: 'Price',
    rows: [
      { label: 'Last', value: s.last === null ? '—' : String(s.last) },
      { label: 'Change over the record', value: s.changePct === null ? '—' : `${s.changePct}%` },
      { label: 'Range', value: s.low === null ? '—' : `${s.low} – ${s.high}` },
      { label: 'Volatility (annualised)', value: s.vol === null ? '—' : `${s.vol}%`, note: `${volatilityVerdict(assetClass, s.vol)} for ${def.name.toLowerCase()}` },
      { label: 'Maximum drawdown', value: s.maxDd === null ? '—' : `${s.maxDd}%` },
      { label: 'Bars stored', value: String(series.length) },
    ],
  };
  panels.push(pricePanel);

  if (assetClass === 'etf') {
    const holdings = (() => {
      try { return (db.prepare(`SELECT name, weight_pct FROM etf_holdings WHERE UPPER(symbol)=UPPER(?) ORDER BY weight_pct DESC LIMIT 10`).all(symbol) as Array<{ name: string; weight_pct: number }>); } catch { return []; }
    })();
    if (holdings.length) {
      panels.push({ title: 'Top holdings', rows: holdings.map((h) => ({ label: h.name, value: `${r2(h.weight_pct)}%` })) });
    } else unavailable.push('Holdings — no constituent data stored for this ETF yet.');
    unavailable.push('Expense ratio — the free source does not publish it; check the issuer page.');
    unavailable.push('Tracking error — needs the benchmark series, which is not stored.');
  }

  if (assetClass === 'forex') {
    const pip = pipSize(symbol);
    const rangePips = s.high !== null && s.low !== null ? r2((s.high - s.low) / pip) : null;
    panels.push({
      title: 'Pair',
      rows: [
        { label: 'Pip size', value: String(pip), note: /JPY/.test(symbol) ? 'JPY quote convention' : 'standard 4-decimal quote' },
        { label: 'Range in pips', value: rangePips === null ? '—' : String(rangePips) },
        { label: 'Daily volatility (pips)', value: s.vol === null || s.last === null ? '—' : String(r2((s.vol / 100 / Math.sqrt(252)) * s.last / pip)) },
      ],
      note: 'Sessions overlap: London and New York overlap 13:00–17:00 UTC, the busiest window for this pair.',
    });
    unavailable.push('Carry — needs the two central-bank policy rates; the macro source carries GDP and inflation, not policy rates.');
  }

  if (assetClass === 'crypto') {
    panels.push({
      title: 'Market',
      rows: [
        { label: 'Trading', value: '24 hours, every day', note: 'no session close' },
        { label: 'Volume (latest bar)', value: series.length ? series[series.length - 1]!.volume.toLocaleString() : '—' },
        { label: 'Average volume', value: series.length ? Math.round(series.reduce((a, b) => a + b.volume, 0) / series.length).toLocaleString() : '—' },
      ],
    });
    unavailable.push('Circulating supply — the free source does not publish it per ticker.');
    unavailable.push('Dominance — needs a total-market-cap series, which is not stored.');
  }

  if (assetClass === 'stock') {
    // Stocks have their own deeper panels elsewhere; this module only handles the rest.
    return null;
  }

  return {
    symbol: symbol.toUpperCase(), assetClass,
    name: row?.name ?? null, currency: null, panels, unavailable,
    note: `${def.note} ${unavailable.length ? `${unavailable.length} item(s) could not be filled from stored data — listed rather than approximated.` : ''}`.trim(),
  };
}
