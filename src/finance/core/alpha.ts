// Alpha factors: the statistical features a quant model is built from.
//
// The shapes follow the K-bar and rolling-statistic conventions used by Qlib's Alpha158,
// reimplemented over the OHLCV this app stores. A factor is only included when it can be
// computed from real data — anything needing VWAP or tick data is left out rather than
// approximated.

export interface Bar { date: string; open: number; high: number; low: number; close: number; volume: number }

const r4 = (v: number): number => Math.round(v * 10000) / 10000;
const safeDiv = (a: number, b: number): number => (b === 0 || !Number.isFinite(b) ? 0 : a / b);

/** Mean and standard deviation over the last n values. */
function stats(xs: number[]): { mean: number; std: number } {
  if (!xs.length) return { mean: 0, std: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const varr = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return { mean, std: Math.sqrt(varr) };
}

const tail = (xs: number[], n: number): number[] => (n >= xs.length ? xs : xs.slice(xs.length - n));

export interface Factor { name: string; value: number | null; group: string; note: string }

/**
 * Compute the factor set for one company's price history.
 * Returns null-valued factors when history is too short, so a caller never sees a
 * fabricated number where the window is missing.
 */
export function alphaFactors(bars: Bar[]): { factors: Factor[]; barsUsed: number; note: string } {
  const n = bars.length;
  // K-bar shape needs one candle; everything else needs a window, which returns null below.
  if (n < 1) return { factors: [], barsUsed: n, note: 'No price history stored.' };

  const close = bars.map((b) => b.close);
  const open = bars.map((b) => b.open);
  const high = bars.map((b) => b.high);
  const low = bars.map((b) => b.low);
  const vol = bars.map((b) => b.volume);
  const last = n - 1;

  const need = (w: number): boolean => n >= w;
  const f = (name: string, group: string, note: string, value: number | null): Factor => ({ name, group, note, value: value === null ? null : r4(value) });

  const out: Factor[] = [];

  // ---- K-bar shape: what happened inside the candle ----
  const c = close[last]!, o = open[last]!, h = high[last]!, l = low[last]!;
  out.push(f('KMID', 'kbar', '(close-open)/open — where the bar finished inside its range', safeDiv(c - o, o)));
  out.push(f('KLEN', 'kbar', '(high-low)/open — how wide the bar was', safeDiv(h - l, o)));
  out.push(f('KMID2', 'kbar', '(close-open)/(high-low) — position within the range', safeDiv(c - o, h - l)));
  out.push(f('KUP', 'kbar', '(high-max(open,close))/open — upper shadow', safeDiv(h - Math.max(o, c), o)));
  out.push(f('KUP2', 'kbar', 'upper shadow as a share of the range', safeDiv(h - Math.max(o, c), h - l)));
  out.push(f('KLOW', 'kbar', '(min(open,close)-low)/open — lower shadow', safeDiv(Math.min(o, c) - l, o)));
  out.push(f('KLOW2', 'kbar', 'lower shadow as a share of the range', safeDiv(Math.min(o, c) - l, h - l)));
  out.push(f('KSFT', 'kbar', '(2*close-high-low)/open — how far the close sits from the middle', safeDiv(2 * c - h - l, o)));
  out.push(f('KSFT2', 'kbar', 'same, scaled by the range', safeDiv(2 * c - h - l, h - l)));

  // ---- price relative to recent extremes ----
  for (const w of [5, 10, 20, 60]) {
    if (!need(w)) { out.push(f(`MAX${w}`, 'price', `close vs the highest close of ${w} bars`, null)); continue; }
    const hi = Math.max(...tail(close, w));
    out.push(f(`MAX${w}`, 'price', `close vs the highest close of ${w} bars`, safeDiv(c, hi)));
  }
  for (const w of [5, 10, 20, 60]) {
    if (!need(w)) { out.push(f(`MIN${w}`, 'price', `close vs the lowest close of ${w} bars`, null)); continue; }
    const lo = Math.min(...tail(close, w));
    out.push(f(`MIN${w}`, 'price', `close vs the lowest close of ${w} bars`, safeDiv(c, lo)));
  }

  // ---- returns over windows ----
  for (const w of [1, 5, 10, 20, 60]) {
    if (!need(w + 1)) { out.push(f(`ROC${w}`, 'return', `${w}-bar rate of change`, null)); continue; }
    const prev = close[last - w]!;
    out.push(f(`ROC${w}`, 'return', `${w}-bar rate of change`, safeDiv(c - prev, prev)));
  }

  // ---- moving averages and dispersion ----
  for (const w of [5, 10, 20, 60]) {
    if (!need(w)) {
      out.push(f(`MA${w}`, 'trend', `close over its ${w}-bar mean`, null));
      out.push(f(`STD${w}`, 'risk', `dispersion of close over ${w} bars`, null));
      continue;
    }
    const s = stats(tail(close, w));
    out.push(f(`MA${w}`, 'trend', `close over its ${w}-bar mean`, safeDiv(c, s.mean)));
    out.push(f(`STD${w}`, 'risk', `dispersion of close over ${w} bars`, safeDiv(s.std, s.mean)));
  }

  // ---- stochastic position (RSV) and rank ----
  for (const w of [10, 20]) {
    if (!need(w)) { out.push(f(`RSV${w}`, 'momentum', `where close sits in the ${w}-bar range`, null)); continue; }
    const hi = Math.max(...tail(high, w)); const lo = Math.min(...tail(low, w));
    out.push(f(`RSV${w}`, 'momentum', `where close sits in the ${w}-bar range`, safeDiv(c - lo, hi - lo)));
  }

  if (need(20)) {
    const win = tail(close, 20);
    const rank = win.filter((x) => x <= c).length / win.length;
    out.push(f('RANK20', 'momentum', 'share of the last 20 closes below today', rank));
  } else out.push(f('RANK20', 'momentum', 'share of the last 20 closes below today', null));

  // ---- correlation of price and volume with time (trend strength) ----
  if (need(10)) {
    const w = 10;
    const ys = tail(close, w); const xs = Array.from({ length: w }, (_, i) => i);
    const mx = (w - 1) / 2; const my = ys.reduce((a, b) => a + b, 0) / w;
    let num = 0; let dx = 0; let dy = 0;
    for (let i = 0; i < w; i++) { const a = xs[i]! - mx; const b = ys[i]! - my; num += a * b; dx += a * a; dy += b * b; }
    const corr = dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
    out.push(f('CORD10', 'trend', 'correlation of close with time over 10 bars', corr));
    // regression slope normalised by price — how fast it is moving
    const slope = dx > 0 ? num / dx : 0;
    out.push(f('RESI10', 'trend', 'average per-bar drift over 10 bars, as a share of price', safeDiv(slope * 10, my)));
  } else {
    out.push(f('CORD10', 'trend', 'correlation of close with time over 10 bars', null));
    out.push(f('RESI10', 'trend', 'average per-bar drift over 10 bars, as a share of price', null));
  }

  // ---- volume behaviour ----
  if (need(20)) {
    const v = tail(vol, 20); const vs = stats(v);
    out.push(f('VMA20', 'volume', 'volume over its 20-bar mean', safeDiv(v[v.length - 1]!, vs.mean)));
    out.push(f('VSTD20', 'volume', 'dispersion of volume over 20 bars', safeDiv(vs.std, vs.mean)));
    const upVol = bars.slice(-20).filter((b) => b.close > b.open).map((b) => b.volume);
    const dnVol = bars.slice(-20).filter((b) => b.close <= b.open).map((b) => b.volume);
    out.push(f('VSUMP20', 'volume', 'average volume on up bars over 20 bars', upVol.length ? upVol.reduce((a, b) => a + b, 0) / upVol.length : null));
    out.push(f('VSUMN20', 'volume', 'average volume on down bars over 20 bars', dnVol.length ? dnVol.reduce((a, b) => a + b, 0) / dnVol.length : null));
  } else {
    for (const k of ['VMA20', 'VSTD20', 'VSUMP20', 'VSUMN20']) out.push(f(k, 'volume', 'volume statistic over 20 bars', null));
  }

  // ---- count of up vs down bars ----
  for (const w of [10, 20]) {
    if (!need(w + 1)) { out.push(f(`CNTP${w}`, 'breadth', `share of up bars in the last ${w}`, null)); continue; }
    const seg = bars.slice(-w);
    const ups = seg.filter((b, i) => i > 0 && b.close > seg[i - 1]!.close).length;
    out.push(f(`CNTP${w}`, 'breadth', `share of up bars in the last ${w}`, ups / w));
  }

  return {
    factors: out,
    barsUsed: n,
    note: `Computed from ${n} stored bars. Factors needing VWAP or intraday data are omitted rather than approximated.`,
  };
}

export interface FactorSummary {
  symbol: string;
  factors: Factor[];
  byGroup: Record<string, number>;
  strongest: Factor[];
  note: string;
}

/** The factors with the largest absolute reading, to surface what is unusual. */
export function summarise(symbol: string, bars: Bar[], topN = 8): FactorSummary {
  const { factors, note } = alphaFactors(bars);
  const byGroup: Record<string, number> = {};
  for (const f of factors) byGroup[f.group] = (byGroup[f.group] ?? 0) + 1;
  const strongest = factors
    .filter((f) => f.value !== null && f.group !== 'price' && f.group !== 'trend')
    .sort((a, b) => Math.abs(b.value ?? 0) - Math.abs(a.value ?? 0))
    .slice(0, topN);
  return { symbol, factors, byGroup, strongest, note };
}
