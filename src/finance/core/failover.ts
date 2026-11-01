// Multi-source failover.
//
// Rules learned the hard way:
//  · a source that just failed is not retried immediately — it cools down
//  · retries back off exponentially with jitter, so a rate limit is not hammered
//  · every attempt is recorded, so the UI can say which source actually answered
//  · an exhausted list returns the reasons, never a silent null
import { sourcesFor, type DataKind, type SourceDef } from './sourceRegistry';

export interface SourceHealth {
  id: string;
  attempts: number;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  lastError: string | null;
  lastLatencyMs: number | null;
  cooldownUntil: number;
}

export interface Attempt {
  sourceId: string;
  ok: boolean;
  ms: number;
  error: string | null;
}

export interface FailoverResult<T> {
  ok: boolean;
  value: T | null;
  sourceId: string | null;
  attempts: Attempt[];
  /** Every source was tried and none worked. */
  exhausted: boolean;
  reason: string;
}

export interface FailoverOptions {
  market?: string;
  /** Attempts per source before moving on. */
  retries?: number;
  /** Base backoff in ms; doubled each retry. */
  baseDelayMs?: number;
  /** How long a source is skipped after it fails. */
  cooldownMs?: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class SourcePool {
  private health = new Map<string, SourceHealth>();

  private entry(id: string): SourceHealth {
    let h = this.health.get(id);
    if (!h) {
      h = { id, attempts: 0, successes: 0, failures: 0, consecutiveFailures: 0, lastError: null, lastLatencyMs: null, cooldownUntil: 0 };
      this.health.set(id, h);
    }
    return h;
  }

  record(id: string, ok: boolean, ms: number, error: string | null, cooldownMs: number, now: number): void {
    const h = this.entry(id);
    h.attempts++;
    h.lastLatencyMs = ms;
    if (ok) {
      h.successes++;
      h.consecutiveFailures = 0;
      h.lastError = null;
      h.cooldownUntil = 0;
    } else {
      h.failures++;
      h.consecutiveFailures++;
      h.lastError = error;
      // Cool down longer the more it keeps failing, capped so it always returns.
      const factor = Math.min(8, 2 ** (h.consecutiveFailures - 1));
      h.cooldownUntil = now + cooldownMs * factor;
    }
  }

  status(): SourceHealth[] { return [...this.health.values()].sort((a, b) => b.attempts - a.attempts); }
  reset(): void { this.health.clear(); }
  isCoolingDown(id: string, now: number): boolean { return (this.health.get(id)?.cooldownUntil ?? 0) > now; }
}

/** Try each source in priority order until one returns a usable value. */
export async function runWithFailover<T>(
  kind: DataKind,
  attempt: (source: SourceDef) => Promise<T | null>,
  pool: SourcePool,
  opts: FailoverOptions = {},
): Promise<FailoverResult<T>> {
  const retries = Math.max(1, opts.retries ?? 2);
  const base = Math.max(0, opts.baseDelayMs ?? 300);
  const cooldown = Math.max(1000, opts.cooldownMs ?? 60_000);
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? (() => Date.now());

  const candidates = sourcesFor(kind, opts.market);
  const attempts: Attempt[] = [];

  for (const source of candidates) {
    if (pool.isCoolingDown(source.id, now())) {
      attempts.push({ sourceId: source.id, ok: false, ms: 0, error: 'skipped — cooling down after a recent failure' });
      continue;
    }
    for (let i = 0; i < retries; i++) {
      const started = now();
      try {
        const value = await attempt(source);
        const ms = now() - started;
        if (value !== null && value !== undefined) {
          pool.record(source.id, true, ms, null, cooldown, now());
          attempts.push({ sourceId: source.id, ok: true, ms, error: null });
          return { ok: true, value, sourceId: source.id, attempts, exhausted: false, reason: `answered by ${source.name}` };
        }
        pool.record(source.id, false, ms, 'returned nothing', cooldown, now());
        attempts.push({ sourceId: source.id, ok: false, ms, error: 'returned nothing' });
      } catch (e) {
        const ms = now() - started;
        const msg = e instanceof Error ? e.message : String(e);
        pool.record(source.id, false, ms, msg, cooldown, now());
        attempts.push({ sourceId: source.id, ok: false, ms, error: msg });
      }
      if (i < retries - 1) {
        // Exponential backoff with jitter: wait 300, 600, 1200… plus up to 25% noise.
        const wait = base * 2 ** i + Math.random() * base * 0.25;
        await sleep(Math.round(wait));
      }
    }
  }

  return {
    ok: false, value: null, sourceId: null, attempts, exhausted: true,
    reason: candidates.length === 0
      ? `No source is registered for "${kind}".`
      : `All ${candidates.length} source(s) for "${kind}" failed or are cooling down.`,
  };
}
