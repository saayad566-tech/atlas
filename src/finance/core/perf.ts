// Runtime performance metrics: request latency, data throughput, and threshold alerts.
//
// Distinct from metrics.ts, which computes financial metrics. This measures the app itself.
// Samples live in a bounded ring so memory stays flat on a device left running for weeks.

export interface Sample { at: number; path: string; ms: number; bytes: number; status: number }

const RING_SIZE = 500;

export interface Thresholds {
  latencyWarnMs: number;
  latencyAlertMs: number;
  errorRatePct: number;
  minSamples: number;
}

const DEFAULT_THRESHOLDS: Thresholds = {
  latencyWarnMs: 400, latencyAlertMs: 1200, errorRatePct: 5, minSamples: 20,
};

export interface Alert { id: string; severity: 'warn' | 'alert'; message: string; at: string; metric: string; value: number; threshold: number }

export class Perf {
  private ring: Sample[] = [];
  private next = 0;
  private alerts: Alert[] = [];
  private thresholds: Thresholds = { ...DEFAULT_THRESHOLDS };
  private started = Date.now();

  record(path: string, ms: number, bytes: number, status: number): void {
    const s: Sample = { at: Date.now(), path, ms: Math.round(ms * 100) / 100, bytes, status };
    if (this.ring.length < RING_SIZE) this.ring.push(s);
    else { this.ring[this.next] = s; this.next = (this.next + 1) % RING_SIZE; }
    this.evaluate(s);
  }

  private evaluate(s: Sample): void {
    if (s.ms >= this.thresholds.latencyAlertMs) {
      this.push({ id: `lat-${s.path}`, severity: 'alert', metric: 'latency', value: s.ms,
        threshold: this.thresholds.latencyAlertMs, at: new Date().toISOString(),
        message: `${s.path} took ${s.ms}ms, over the ${this.thresholds.latencyAlertMs}ms alert threshold` });
    } else if (s.ms >= this.thresholds.latencyWarnMs) {
      this.push({ id: `lat-warn-${s.path}`, severity: 'warn', metric: 'latency', value: s.ms,
        threshold: this.thresholds.latencyWarnMs, at: new Date().toISOString(),
        message: `${s.path} took ${s.ms}ms, over the ${this.thresholds.latencyWarnMs}ms warning threshold` });
    }
    if (s.status >= 500) {
      this.push({ id: `err-${s.path}`, severity: 'alert', metric: 'error', value: s.status,
        threshold: 500, at: new Date().toISOString(), message: `${s.path} returned ${s.status}` });
    }
    const rate = this.errorRate();
    if (rate !== null && rate > this.thresholds.errorRatePct) {
      this.push({ id: 'error-rate', severity: 'alert', metric: 'errorRate', value: Math.round(rate * 10) / 10,
        threshold: this.thresholds.errorRatePct, at: new Date().toISOString(),
        message: `Error rate is ${rate.toFixed(1)}%, over the ${this.thresholds.errorRatePct}% threshold` });
    }
  }

  /** Deduplicated by id and capped, so one slow endpoint cannot flood the list. */
  private push(a: Alert): void {
    this.alerts = [a, ...this.alerts.filter((x) => x.id !== a.id)].slice(0, 50);
  }

  errorRate(): number | null {
    if (this.ring.length < this.thresholds.minSamples) return null;
    return (this.ring.filter((s) => s.status >= 400).length / this.ring.length) * 100;
  }

  percentile(p: number): number | null {
    if (!this.ring.length) return null;
    const sorted = this.ring.map((s) => s.ms).sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
    return sorted[idx]!;
  }

  throughputBytesPerSec(windowMs = 60_000): number {
    const cut = Date.now() - windowMs;
    const recent = this.ring.filter((s) => s.at >= cut);
    if (!recent.length) return 0;
    const span = Math.max(1000, Date.now() - Math.min(...recent.map((s) => s.at)));
    return Math.round((recent.reduce((a, b) => a + b.bytes, 0) / span) * 1000);
  }

  /** Recent latency in time order, for a chart. */
  series(limit = 60): Array<{ at: number; ms: number }> {
    return this.ring.slice(-limit).map((s) => ({ at: s.at, ms: s.ms }));
  }

  snapshot() {
    const byPath = new Map<string, { count: number; totalMs: number; maxMs: number; bytes: number }>();
    for (const s of this.ring) {
      const e = byPath.get(s.path) ?? { count: 0, totalMs: 0, maxMs: 0, bytes: 0 };
      e.count++; e.totalMs += s.ms; e.maxMs = Math.max(e.maxMs, s.ms); e.bytes += s.bytes;
      byPath.set(s.path, e);
    }
    return {
      uptimeMs: Date.now() - this.started,
      samples: this.ring.length,
      capacity: RING_SIZE,
      latency: {
        p50: this.percentile(50), p95: this.percentile(95), p99: this.percentile(99),
        max: this.ring.length ? Math.max(...this.ring.map((s) => s.ms)) : null,
      },
      throughput: { bytesPerSec: this.throughputBytesPerSec(), totalBytes: this.ring.reduce((a, b) => a + b.bytes, 0) },
      errorRatePct: this.errorRate() === null ? null : Math.round(this.errorRate()! * 10) / 10,
      thresholds: this.thresholds,
      alerts: this.alerts,
      slowest: [...byPath.entries()]
        .map(([path, e]) => ({ path, count: e.count, avgMs: Math.round((e.totalMs / e.count) * 100) / 100, maxMs: e.maxMs, bytes: e.bytes }))
        .sort((a, b) => b.maxMs - a.maxMs).slice(0, 12),
      series: this.series(60),
    };
  }

  setThresholds(t: Partial<Thresholds>): Thresholds {
    this.thresholds = { ...this.thresholds, ...t };
    return this.thresholds;
  }

  clearAlerts(): void { this.alerts = []; }
}

export const perf = new Perf();
