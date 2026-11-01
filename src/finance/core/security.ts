// Production security: PIN authentication, session tokens, rate limiting and headers.
//
// The finance API shipped with no authentication at all. This adds a local PIN gate
// (PBKDF2-SHA256, constant-time compare, lockout) plus bearer sessions, so the app can
// be exposed beyond localhost without handing the database to anyone who finds the port.
import * as crypto from 'crypto';
import type { Database as DB } from 'better-sqlite3';

const ITERATIONS = 210_000;
const KEYLEN = 32;
const DIGEST = 'sha256';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;   // 12 hours
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export interface StoredPin { salt: string; hash: string; iterations: number; createdAt: number }

export function hashPin(pin: string, salt?: string): StoredPin {
  const s = salt ?? crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(pin, s, ITERATIONS, KEYLEN, DIGEST).toString('hex');
  return { salt: s, hash, iterations: ITERATIONS, createdAt: Date.now() };
}

/** Constant-time comparison — never early-return on a mismatch. */
export function verifyPin(pin: string, stored: StoredPin): boolean {
  const candidate = crypto.pbkdf2Sync(pin, stored.salt, stored.iterations, KEYLEN, DIGEST);
  const expected = Buffer.from(stored.hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

export class Security {
  private sessions = new Map<string, { expiresAt: number; createdAt: number }>();
  private failures = 0;
  private lockedUntil = 0;
  private buckets = new Map<string, { tokens: number; last: number }>();

  constructor(private db: DB, private opts: { rateLimitPerMin?: number } = {}) {}

  // ---- PIN ------------------------------------------------------------------

  private getSetting(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM prefs WHERE key=?`).get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  private setSetting(key: string, value: string): void {
    this.db.prepare(`INSERT INTO prefs (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
      .run(key, value, Date.now());
  }

  isConfigured(): boolean { return this.getSetting('auth.pin') !== null; }

  /** Set (or replace) the PIN. Requires the current PIN when one already exists. */
  setPin(pin: string, currentPin?: string): { ok: boolean; error?: string } {
    if (!/^\d{4,12}$/.test(pin)) return { ok: false, error: 'PIN must be 4–12 digits.' };
    if (this.isConfigured()) {
      if (!currentPin) return { ok: false, error: 'Current PIN required to change it.' };
      const check = this.unlock(currentPin);
      if (!check.ok) return { ok: false, error: check.error };
    }
    this.setSetting('auth.pin', JSON.stringify(hashPin(pin)));
    this.sessions.clear();     // changing the PIN invalidates every session
    return { ok: true };
  }

  removePin(pin: string): { ok: boolean; error?: string } {
    const check = this.unlock(pin);
    if (!check.ok) return { ok: false, error: check.error };
    this.db.prepare(`DELETE FROM prefs WHERE key='auth.pin'`).run();
    this.sessions.clear();
    return { ok: true };
  }

  /** Verify a PIN and mint a session token. Enforces lockout after repeated failures. */
  unlock(pin: string): { ok: boolean; token?: string; error?: string; lockedForMs?: number } {
    const now = Date.now();
    if (now < this.lockedUntil) return { ok: false, error: 'Locked after repeated failures.', lockedForMs: this.lockedUntil - now };
    const raw = this.getSetting('auth.pin');
    if (!raw) return { ok: false, error: 'No PIN configured.' };
    const stored = JSON.parse(raw) as StoredPin;
    if (!verifyPin(pin, stored)) {
      this.failures++;
      if (this.failures >= MAX_FAILURES) { this.lockedUntil = now + LOCKOUT_MS; this.failures = 0; return { ok: false, error: 'Too many attempts. Locked for 15 minutes.', lockedForMs: LOCKOUT_MS }; }
      return { ok: false, error: `Incorrect PIN (${MAX_FAILURES - this.failures} attempt(s) left).` };
    }
    this.failures = 0;
    const token = crypto.randomBytes(32).toString('hex');
    this.sessions.set(token, { expiresAt: now + SESSION_TTL_MS, createdAt: now });
    this.pruneSessions();
    return { ok: true, token };
  }

  /** Is this request authorised? No PIN configured ⇒ local open mode. */
  isAuthorised(header: string | undefined): boolean {
    if (!this.isConfigured()) return true;
    if (!header) return false;
    const token = header.replace(/^Bearer\s+/i, '').trim();
    const s = this.sessions.get(token);
    if (!s) return false;
    if (s.expiresAt < Date.now()) { this.sessions.delete(token); return false; }
    return true;
  }

  logout(header: string | undefined): void {
    if (!header) return;
    this.sessions.delete(header.replace(/^Bearer\s+/i, '').trim());
  }

  private pruneSessions(): void {
    const now = Date.now();
    for (const [k, v] of this.sessions) if (v.expiresAt < now) this.sessions.delete(k);
  }

  // ---- rate limiting ---------------------------------------------------------

  /** Token-bucket per client. Returns false when the caller should be throttled. */
  allow(clientKey: string): boolean {
    const perMin = this.opts.rateLimitPerMin ?? 240;
    const now = Date.now();
    const bucket = this.buckets.get(clientKey) ?? { tokens: perMin, last: now };
    const elapsed = (now - bucket.last) / 60000;
    bucket.tokens = Math.min(perMin, bucket.tokens + elapsed * perMin);
    bucket.last = now;
    if (bucket.tokens < 1) { this.buckets.set(clientKey, bucket); return false; }
    bucket.tokens -= 1;
    this.buckets.set(clientKey, bucket);
    return true;
  }

  // ---- headers ---------------------------------------------------------------

  /** Security headers for every response. CSP is strict because the console is local. */
  static headers(): Record<string, string> {
    return {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    };
  }
}

/** Consistent error envelope — never leaks a stack trace to the client. */
export function errorBody(e: unknown): { error: string; code: string } {
  const msg = e instanceof Error ? e.message : String(e);
  const code = /not found/i.test(msg) ? 'NOT_FOUND' : /required|invalid|must/i.test(msg) ? 'BAD_REQUEST' : 'INTERNAL';
  return { error: code === 'INTERNAL' ? 'Internal error' : msg, code };
}
