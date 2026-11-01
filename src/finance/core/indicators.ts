// Technical indicators, computed from stored daily closes. Pure functions so the maths
// can be tested against known values rather than eyeballed on a chart.

export interface Bar { date: string; open: number; high: number; low: number; close: number; volume: number }

const r2 = (v: number): number => Math.round(v * 100) / 100;

/** Simple moving average. Positions before the window are null. */
export function sma(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    out.push(i >= period - 1 ? r2(sum / period) : null);
  }
  return out;
}

/** Exponential moving average, seeded with the first SMA. */
export function ema(values: number[], period: number): Array<number | null> {
  const k = 2 / (period + 1);
  const out: Array<number | null> = [];
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    if (prev === null) {
      const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
      prev = seed; out.push(r2(seed)); continue;
    }
    prev = values[i]! * k + prev * (1 - k);
    out.push(r2(prev));
  }
  return out;
}

/** Relative Strength Index (Wilder). A monotonically rising series gives 100. */
export function rsi(values: number[], period = 14): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0; let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i]! - values[i - 1]!;
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgGain = gain / period; let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : r2(100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i]! - values[i - 1]!;
    const g = d > 0 ? d : 0; const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : r2(100 - 100 / (1 + avgGain / avgLoss));
  }
  return out;
}

export interface MacdResult { macd: Array<number | null>; signal: Array<number | null>; histogram: Array<number | null> }

export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const f = ema(values, fast); const s = ema(values, slow);
  const line: Array<number | null> = values.map((_, i) => (f[i] !== null && s[i] !== null ? r2(f[i]! - s[i]!) : null));
  const defined = line.filter((v) => v !== null) as number[];
  const sig = ema(defined, signalPeriod);
  const signal: Array<number | null> = new Array(values.length).fill(null);
  let j = 0;
  for (let i = 0; i < line.length; i++) if (line[i] !== null) { signal[i] = sig[j] ?? null; j++; }
  const histogram = line.map((v, i) => (v !== null && signal[i] !== null ? r2(v - signal[i]!) : null));
  return { macd: line, signal, histogram };
}

export interface Bollinger { upper: Array<number | null>; middle: Array<number | null>; lower: Array<number | null> }

export function bollinger(values: number[], period = 20, mult = 2): Bollinger {
  const mid = sma(values, period);
  const upper: Array<number | null> = []; const lower: Array<number | null> = [];
  for (let i = 0; i < values.length; i++) {
    if (mid[i] === null) { upper.push(null); lower.push(null); continue; }
    const win = values.slice(i - period + 1, i + 1);
    const mean = win.reduce((a, b) => a + b, 0) / period;
    const sd = Math.sqrt(win.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    upper.push(r2(mean + mult * sd)); lower.push(r2(mean - mult * sd));
  }
  return { upper, middle: mid, lower };
}

/** Average True Range — needs high/low, so it takes bars. */
export function atr(bars: Bar[], period = 14): Array<number | null> {
  const out: Array<number | null> = [null];
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i]!; const p = bars[i - 1]!;
    trs.push(Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close)));
    if (trs.length < period) { out.push(null); continue; }
    const win = trs.slice(-period);
    out.push(r2(win.reduce((a, c) => a + c, 0) / period));
  }
  return out;
}

/** On-balance volume — cumulative signed volume. */
export function obv(bars: Bar[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < bars.length; i++) {
    if (i > 0) {
      const d = bars[i]!.close - bars[i - 1]!.close;
      acc += d > 0 ? bars[i]!.volume : d < 0 ? -bars[i]!.volume : 0;
    }
    out.push(acc);
  }
  return out;
}

/** Stochastic %K. */
export function stochastic(bars: Bar[], period = 14): Array<number | null> {
  return bars.map((b, i) => {
    if (i < period - 1) return null;
    const win = bars.slice(i - period + 1, i + 1);
    const hi = Math.max(...win.map((x) => x.high));
    const lo = Math.min(...win.map((x) => x.low));
    return hi === lo ? 50 : r2(((b.close - lo) / (hi - lo)) * 100);
  });
}

/** Rate of change over n periods, percent. */
export function roc(values: number[], period = 10): Array<number | null> {
  return values.map((v, i) => {
    if (i < period) return null;
    const prev = values[i - period]!;
    return prev === 0 ? null : r2(((v - prev) / prev) * 100);
  });
}

/** Williams %R. */
export function williamsR(bars: Bar[], period = 14): Array<number | null> {
  return bars.map((b, i) => {
    if (i < period - 1) return null;
    const win = bars.slice(i - period + 1, i + 1);
    const hi = Math.max(...win.map((x) => x.high));
    const lo = Math.min(...win.map((x) => x.low));
    return hi === lo ? -50 : r2(((hi - b.close) / (hi - lo)) * -100);
  });
}

/** Resample daily bars into weekly or monthly buckets (first open, max high, min low, last close). */
export function resample(bars: Bar[], tf: '1D' | '1W' | '1M'): Bar[] {
  if (tf === '1D') return bars;
  const keyOf = (d: string): string => {
    const dt = new Date(d);
    if (tf === '1M') return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
    const jan1 = Date.UTC(dt.getUTCFullYear(), 0, 1);
    const week = Math.floor((dt.getTime() - jan1) / (7 * 86400000));
    return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  };
  const out: Bar[] = [];
  let cur: Bar | null = null; let curKey = '';
  for (const b of bars) {
    const k = keyOf(b.date);
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

export type IndicatorId = 'sma20' | 'sma50' | 'sma200' | 'ema20' | 'rsi14' | 'macd' | 'bollinger' | 'atr14' | 'obv' | 'stoch14' | 'roc10' | 'williams14';

export const INDICATORS: Array<{ id: IndicatorId; label: string; kind: 'overlay' | 'panel'; hint: string }> = [
  { id: 'sma20', label: 'SMA 20', kind: 'overlay', hint: '20-period simple average' },
  { id: 'sma50', label: 'SMA 50', kind: 'overlay', hint: '50-period simple average' },
  { id: 'sma200', label: 'SMA 200', kind: 'overlay', hint: '200-period simple average' },
  { id: 'ema20', label: 'EMA 20', kind: 'overlay', hint: '20-period exponential average' },
  { id: 'bollinger', label: 'Bollinger 20,2', kind: 'overlay', hint: '20-period bands at ±2σ' },
  { id: 'rsi14', label: 'RSI 14', kind: 'panel', hint: 'above 70 overbought, below 30 oversold' },
  { id: 'macd', label: 'MACD 12,26,9', kind: 'panel', hint: 'momentum crossover' },
  { id: 'atr14', label: 'ATR 14', kind: 'panel', hint: 'average true range (volatility)' },
  { id: 'stoch14', label: 'Stochastic 14', kind: 'panel', hint: '%K oscillator' },
  { id: 'roc10', label: 'ROC 10', kind: 'panel', hint: '10-period rate of change' },
  { id: 'williams14', label: 'Williams %R 14', kind: 'panel', hint: 'inverted stochastic' },
  { id: 'obv', label: 'OBV', kind: 'panel', hint: 'on-balance volume' },
];

/** Compute the requested indicator set for a bar series. */
export function computeIndicators(bars: Bar[], wanted: IndicatorId[]): Record<string, unknown> {
  const closes = bars.map((b) => b.close);
  const out: Record<string, unknown> = {};
  for (const id of wanted) {
    switch (id) {
      case 'sma20': out['sma20'] = sma(closes, 20); break;
      case 'sma50': out['sma50'] = sma(closes, 50); break;
      case 'sma200': out['sma200'] = sma(closes, 200); break;
      case 'ema20': out['ema20'] = ema(closes, 20); break;
      case 'rsi14': out['rsi14'] = rsi(closes, 14); break;
      case 'macd': out['macd'] = macd(closes); break;
      case 'bollinger': out['bollinger'] = bollinger(closes, 20, 2); break;
      case 'atr14': out['atr14'] = atr(bars, 14); break;
      case 'obv': out['obv'] = obv(bars); break;
      case 'stoch14': out['stoch14'] = stochastic(bars, 14); break;
      case 'roc10': out['roc10'] = roc(closes, 10); break;
      case 'williams14': out['williams14'] = williamsR(bars, 14); break;
      default: break;
    }
  }
  return out;
}
