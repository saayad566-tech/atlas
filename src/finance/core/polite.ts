// A well-behaved HTTP client for public data sources.
//
// Atlas reads public data. It identifies itself, obeys robots.txt, honours rate limits,
// caches what it fetches, and backs off when a server is unhappy. That is both the
// correct behaviour and the only sustainable way to keep a pipeline running for years.
//
// What this deliberately does NOT do: disguise the client, rotate identities to avoid
// blocks, or defeat a site's controls. If a source does not want automated access, the
// answer is a different source, not a way around the refusal.

import fs from 'node:fs';
import path from 'node:path';

export interface FetchResult {
  ok: boolean;
  status: number;
  body: string;
  /** True when the server confirmed nothing changed (304). */
  notModified: boolean;
  cached: boolean;
  ms: number;
  error: string | null;
  /** Seconds the server asked us to wait, from Retry-After. */
  retryAfterSec: number | null;
}

export interface PoliteOptions {
  /** Identifies the app honestly, with a contact URL. */
  userAgent: string;
  /** Minimum gap between requests to the same host. */
  minIntervalMs: number;
  /** How long a cached body stays usable. */
  cacheTtlMs: number;
  cacheDir: string;
  timeoutMs: number;
}

const DEFAULTS: PoliteOptions = {
  userAgent: 'Atlas/3.1 (+https://github.com/saayad566-tech/atlas; personal research tool)',
  minIntervalMs: 1500,
  cacheTtlMs: 10 * 60_000,
  cacheDir: path.join(process.cwd(), 'data', 'cache'),
  timeoutMs: 12_000,
};

interface CacheEntry { at: number; etag: string | null; lastModified: string | null; body: string }

export class PoliteClient {
  private lastHit = new Map<string, number>();
  private robots = new Map<string, { allow: boolean; at: number }>();
  private opts: PoliteOptions;

  constructor(opts: Partial<PoliteOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    try { fs.mkdirSync(this.opts.cacheDir, { recursive: true }); } catch { /* read-only fs */ }
  }

  private cachePath(url: string): string {
    const safe = Buffer.from(url).toString('base64url').slice(0, 120);
    return path.join(this.opts.cacheDir, `${safe}.json`);
  }

  private readCache(url: string): CacheEntry | null {
    try {
      const raw = fs.readFileSync(this.cachePath(url), 'utf8');
      return JSON.parse(raw) as CacheEntry;
    } catch { return null; }
  }

  private writeCache(url: string, entry: CacheEntry): void {
    try { fs.writeFileSync(this.cachePath(url), JSON.stringify(entry)); } catch { /* not fatal */ }
  }

  /** Wait until the per-host interval has elapsed. */
  private async throttle(host: string): Promise<void> {
    const last = this.lastHit.get(host) ?? 0;
    const wait = this.opts.minIntervalMs - (Date.now() - last);
    // A real await, not a spin: blocking the event loop here would stall every other request.
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastHit.set(host, Date.now());
  }

  /**
   * Ask robots.txt whether this path may be fetched. Cached for an hour. A host that
   * publishes no robots.txt is treated as permissive; a host that refuses is respected.
   */
  private async allowedByRobots(origin: string, pathname: string): Promise<boolean> {
    const cached = this.robots.get(origin);
    if (cached && Date.now() - cached.at < 3_600_000) return cached.allow;
    let allow = true;
    try {
      const res = await fetch(`${origin}/robots.txt`, {
        headers: { 'User-Agent': this.opts.userAgent },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const text = await res.text();
        // Only Disallow rules are honoured here; a full parser is not needed for GET-only use.
        const lines = text.split('\n').map((l) => l.trim());
        let applies = false;
        for (const line of lines) {
          if (/^user-agent:\s*\*/i.test(line)) applies = true;
          else if (/^user-agent:/i.test(line)) applies = false;
          else if (applies && /^disallow:\s*(\S*)/i.test(line)) {
            const rule = line.replace(/^disallow:\s*/i, '').trim();
            if (rule && rule !== '/' && pathname.startsWith(rule)) allow = false;
            if (rule === '/') allow = false;
          }
        }
      }
    } catch { /* an unreachable robots.txt does not block a public read */ }
    this.robots.set(origin, { allow, at: Date.now() });
    return allow;
  }

  /**
   * Fetch a URL politely. Uses a conditional request when a cached copy exists, so an
   * unchanged page costs one 304 rather than a full transfer.
   */
  async get(url: string, opts: { bypassCache?: boolean } = {}): Promise<FetchResult> {
    const started = Date.now();
    let host = '';
    let origin = '';
    let pathname = '/';
    try {
      const u = new URL(url);
      host = u.host;
      origin = u.origin;
      pathname = u.pathname;
    } catch {
      return { ok: false, status: 0, body: '', notModified: false, cached: false, ms: 0, error: 'Invalid URL', retryAfterSec: null };
    }

    const allowed = await this.allowedByRobots(origin, pathname);
    if (!allowed) {
      return { ok: false, status: 0, body: '', notModified: false, cached: false, ms: Date.now() - started,
        error: 'robots.txt disallows this path — the source is not scraped, a different source is used', retryAfterSec: null };
    }

    const cached = this.readCache(url);
    if (!opts.bypassCache && cached && Date.now() - cached.at < this.opts.cacheTtlMs) {
      return { ok: true, status: 200, body: cached.body, notModified: false, cached: true, ms: Date.now() - started, error: null, retryAfterSec: null };
    }

    await this.throttle(host);

    const headers: Record<string, string> = { 'User-Agent': this.opts.userAgent, 'Accept': 'application/json, text/xml, application/xml, text/html;q=0.9' };
    if (cached?.etag) headers['If-None-Match'] = cached.etag;
    if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;

    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(this.opts.timeoutMs) });
      const retryAfter = res.headers.get('retry-after');
      const retryAfterSec = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : null;

      if (res.status === 304 && cached) {
        this.writeCache(url, { ...cached, at: Date.now() });
        return { ok: true, status: 304, body: cached.body, notModified: true, cached: true, ms: Date.now() - started, error: null, retryAfterSec };
      }

      const body = await res.text();
      const entry: CacheEntry = { at: Date.now(), etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'), body };
      if (res.ok) this.writeCache(url, entry);

      return {
        ok: res.ok, status: res.status, body, notModified: false, cached: false,
        ms: Date.now() - started,
        error: res.ok ? null : `HTTP ${res.status}${res.status === 429 ? ' — rate limited, backing off' : ''}`,
        retryAfterSec,
      };
    } catch (e) {
      // Offline or blocked: serve the cached copy if we have one, and say that is what happened.
      if (cached) {
        return { ok: true, status: 0, body: cached.body, notModified: false, cached: true, ms: Date.now() - started,
          error: 'network unavailable — serving the stored copy', retryAfterSec: null };
      }
      return { ok: false, status: 0, body: '', notModified: false, cached: false, ms: Date.now() - started,
        error: e instanceof Error ? e.message : String(e), retryAfterSec: null };
    }
  }
}

export const polite = new PoliteClient();
