// In-process refresh scheduler. Prices go stale the moment they are fetched; this keeps
// the active market's companies current without the user pressing anything.
//
// Deliberately bounded: each tick refreshes at most `batch` companies, oldest first, so a
// large universe is worked through gradually instead of hammering the source.

export interface MaintenanceResult {
  ran: boolean;
  newSymbols: number;
  eventsRefreshed: number;
  enriched: number;
  market: string | null;
  ms: number;
  error: string | null;
}

export interface SchedulerStatus {
  running: boolean;
  autoStarted: boolean;
  maintenanceEvery: number;
  lastMaintenanceAt: number | null;
  lastMaintenance: MaintenanceResult | null;
  intervalMs: number;
  batch: number;
  lastRunAt: number | null;
  lastRunMs: number | null;
  lastUpdated: number;
  lastFailed: number;
  lastError: string | null;
  ticks: number;
  nextRunAt: number | null;
}

export interface SchedulerDeps {
  /** Refresh one symbol; resolve true when it succeeded. */
  refresh: (symbol: string) => Promise<boolean>;
  /** Symbols that most need refreshing, oldest first. */
  due: (limit: number) => string[];
  /** Slower cadence work: discover newly listed symbols, refresh upcoming events. */
  maintenance?: () => Promise<{ newSymbols: number; eventsRefreshed: number; enriched?: number; market?: string }>;
}

export class RefreshScheduler {
  private timer: NodeJS.Timeout | null = null;
  private status: SchedulerStatus;
  private ticking = false;

  constructor(private readonly deps: SchedulerDeps, intervalMs = 15 * 60 * 1000, batch = 5) {
    this.status = {
      running: false, autoStarted: false, maintenanceEvery: 8,
      lastMaintenanceAt: null, lastMaintenance: null,
      intervalMs, batch, lastRunAt: null, lastRunMs: null,
      lastUpdated: 0, lastFailed: 0, lastError: null, ticks: 0, nextRunAt: null,
    };
  }

  getStatus(): SchedulerStatus { return { ...this.status }; }

  configure(intervalMs: number, batch: number, maintenanceEvery?: number): void {
    this.status.intervalMs = Math.max(30_000, Math.min(intervalMs, 24 * 60 * 60 * 1000));
    this.status.batch = Math.max(1, Math.min(batch, 50));
    if (typeof maintenanceEvery === 'number') this.status.maintenanceEvery = Math.max(1, Math.min(maintenanceEvery, 100));
    if (this.status.running) { this.stop(); this.start(); }
  }

  /** Start on boot so the app keeps itself current without the user asking. */
  autoStart(): SchedulerStatus {
    const st = this.start();
    this.status.autoStarted = true;
    return st;
  }

  start(): SchedulerStatus {
    if (this.status.running) return this.getStatus();
    this.status.running = true;
    this.scheduleNext();
    return this.getStatus();
  }

  stop(): SchedulerStatus {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.status.running = false;
    this.status.nextRunAt = null;
    return this.getStatus();
  }

  private scheduleNext(): void {
    if (this.timer) clearTimeout(this.timer);
    this.status.nextRunAt = Date.now() + this.status.intervalMs;
    this.timer = setTimeout(() => { void this.tick().then(() => { if (this.status.running) this.scheduleNext(); }); }, this.status.intervalMs);
    // Do not hold the process open just for the scheduler.
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  /** One pass: refresh the stalest few companies. Safe to call manually. */
  async tick(): Promise<SchedulerStatus> {
    if (this.ticking) return this.getStatus();
    this.ticking = true;
    const t0 = Date.now();
    let updated = 0; let failed = 0; let error: string | null = null;
    try {
      const targets = this.deps.due(this.status.batch);
      for (const sym of targets) {
        try { if (await this.deps.refresh(sym)) updated++; else failed++; }
        catch (e) { failed++; error = e instanceof Error ? e.message : String(e); }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    this.status.lastRunAt = t0;
    this.status.lastRunMs = Date.now() - t0;
    this.status.lastUpdated = updated;
    this.status.lastFailed = failed;
    this.status.lastError = error;
    this.status.ticks++;

    // Every Nth pass, also look for newly listed symbols and refresh upcoming events.
    if (this.deps.maintenance && this.status.ticks % Math.max(1, this.status.maintenanceEvery) === 0) {
      const m0 = Date.now();
      try {
        const r = await this.deps.maintenance();
        this.status.lastMaintenance = { ran: true, newSymbols: r.newSymbols, eventsRefreshed: r.eventsRefreshed, enriched: r.enriched ?? 0, market: r.market ?? null, ms: Date.now() - m0, error: null };
      } catch (e) {
        this.status.lastMaintenance = { ran: true, newSymbols: 0, eventsRefreshed: 0, enriched: 0, market: null, ms: Date.now() - m0, error: e instanceof Error ? e.message : String(e) };
      }
      this.status.lastMaintenanceAt = m0;
    }

    this.ticking = false;
    return this.getStatus();
  }
}
