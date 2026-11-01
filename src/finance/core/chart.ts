// Chart data + SVG rendering. No charting library: the app must stay lightweight and
// work offline, so the shapes are computed here and drawn as inline SVG.
import type { Database as DB } from 'better-sqlite3';

export interface Series {
  symbol: string; dates: string[]; closes: number[];
  ma50: Array<number | null>; ma200: Array<number | null>;
  min: number; max: number; first: number; last: number; changePct: number;
  high52: number; low52: number; drawdownPct: number;
}

function sma(values: number[], window: number): Array<number | null> {
  const out: Array<number | null> = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= window) sum -= values[i - window]!;
    out.push(i >= window - 1 ? Math.round((sum / window) * 100) / 100 : null);
  }
  return out;
}

/** Daily closes for one company, oldest first. */
export function priceSeries(db: DB, symbol: string, days = 365): Series | null {
  const c = db.prepare(`SELECT id, symbol FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number; symbol: string } | undefined;
  if (!c) return null;
  const rows = db.prepare(`
    SELECT date, close FROM price_history WHERE company_id=? AND close > 0
    ORDER BY date DESC LIMIT ?`).all(c.id, days) as Array<{ date: string; close: number }>;
  if (!rows.length) return null;
  rows.reverse();
  const dates = rows.map((r) => r.date);
  const closes = rows.map((r) => Math.round(r.close * 100) / 100);
  const first = closes[0]!;
  const last = closes[closes.length - 1]!;
  let peak = 0; let maxDrawdown = 0;
  for (const v of closes) { peak = Math.max(peak, v); if (peak > 0) maxDrawdown = Math.min(maxDrawdown, (v - peak) / peak); }
  const window52 = closes.slice(-252);
  return {
    symbol: c.symbol, dates, closes,
    ma50: sma(closes, 50), ma200: sma(closes, 200),
    min: Math.min(...closes), max: Math.max(...closes),
    first, last,
    changePct: first > 0 ? Math.round(((last - first) / first) * 1000) / 10 : 0,
    high52: window52.length ? Math.max(...window52) : last,
    low52: window52.length ? Math.min(...window52) : last,
    drawdownPct: Math.round(maxDrawdown * 1000) / 10,
  };
}

/** Compact sparkline data for a screen's rows: last N closes per symbol. */
export function sparklines(db: DB, symbols: string[], points = 30): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  const stmt = db.prepare(`SELECT close FROM price_history WHERE company_id=(SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)) AND close>0 ORDER BY date DESC LIMIT ?`);
  for (const s of symbols) {
    const rows = stmt.all(s, points) as Array<{ close: number }>;
    if (rows.length >= 2) out[s] = rows.map((r) => r.close).reverse();
  }
  return out;
}

/** SVG path for a series, normalised into a w×h box. */
export function svgPath(values: number[], w: number, h: number, min: number, max: number): string {
  if (!values.length) return '';
  const span = max - min || 1;
  const step = values.length > 1 ? w / (values.length - 1) : w;
  return values.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`).join(' ');
}

/** Sparkline markup — a tiny inline chart, safe to drop in a table cell. */
export function sparkSvg(values: number[], w = 72, h = 20): string {
  if (!values || values.length < 2) return '<span class="hint">—</span>';
  const min = Math.min(...values); const max = Math.max(...values);
  const up = values[values.length - 1]! >= values[0]!;
  const colour = up ? '#16a34a' : '#dc2626';
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${svgPath(values, w, h, min, max)}" fill="none" stroke="${colour}" stroke-width="1.5"/></svg>`;
}

export interface SectorBar { sector: string; up: number; down: number; pctUp: number }

/** Bars for a sector breadth chart. */
export function sectorBars(db: DB, days = 30): SectorBar[] {
  try {
    const rows = db.prepare(`
      WITH ranked AS (SELECT company_id, close, ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY date DESC) AS rn FROM price_history),
      pairs AS (SELECT a.company_id, ((a.close-b.close)/b.close)*100 AS chg FROM ranked a JOIN ranked b ON a.company_id=b.company_id AND b.rn=? WHERE a.rn=1 AND b.close>0)
      SELECT c.sector, SUM(CASE WHEN p.chg>0 THEN 1 ELSE 0 END) AS up, SUM(CASE WHEN p.chg<0 THEN 1 ELSE 0 END) AS down
      FROM pairs p JOIN companies c ON c.id=p.company_id GROUP BY c.sector ORDER BY (up+down) DESC LIMIT 12`).all(days + 1) as Array<{ sector: string; up: number; down: number }>;
    return rows.map((r) => ({ sector: r.sector, up: r.up, down: r.down, pctUp: r.up + r.down > 0 ? Math.round((r.up / (r.up + r.down)) * 1000) / 10 : 0 }));
  } catch { return []; }
}
