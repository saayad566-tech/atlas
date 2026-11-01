// Lifecycle event log + outbound webhooks.
//
// Every state change worth telling a human about (a new filing appears, a price range is
// set, a ticker starts trading) is written to an immutable audit trail and, if the user
// configured a webhook, pushed to it. Dispatch never throws: a dead webhook must not stop
// the maintenance loop.
import type { Database as DB } from 'better-sqlite3';
import * as crypto from 'crypto';

export type EventType = 'PRE_LISTING_DISCOVERED' | 'PRICED_UPDATE' | 'TICKER_GRADUATED' | 'MAINTENANCE_SUMMARY' | 'DIRECTORY_GROWTH';

export interface AuditEvent {
  id: string;
  type: EventType;
  symbol: string;
  market: string;
  title: string;
  details: Record<string, unknown>;
  timestamp: string;
}

export const EVENTS_DDL = `
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, symbol TEXT NOT NULL, market TEXT NOT NULL,
  title TEXT NOT NULL, details TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_time ON audit_events(created_at DESC);
`;

export function ensureEvents(db: DB): void { db.exec(EVENTS_DDL); }

export function makeEvent(type: EventType, symbol: string, market: string, title: string, details: Record<string, unknown> = {}): AuditEvent {
  return { id: `ev_${crypto.randomBytes(8).toString('hex')}`, type, symbol, market, title, details, timestamp: new Date().toISOString() };
}

export function logEvent(db: DB, e: AuditEvent): void {
  try {
    ensureEvents(db);
    db.prepare(`INSERT OR IGNORE INTO audit_events (id,type,symbol,market,title,details,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(e.id, e.type, e.symbol, e.market, e.title, JSON.stringify(e.details), Date.parse(e.timestamp) || Date.now());
  } catch { /* logging must never break the caller */ }
}

export interface StoredEvent extends AuditEvent { createdAt: number }

export function listEvents(db: DB, limit = 50, type?: EventType): StoredEvent[] {
  try {
    ensureEvents(db);
    const rows = (type
      ? db.prepare(`SELECT * FROM audit_events WHERE type=? ORDER BY created_at DESC LIMIT ?`).all(type, limit)
      : db.prepare(`SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?`).all(limit)) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r['id']), type: String(r['type']) as EventType, symbol: String(r['symbol']),
      market: String(r['market']), title: String(r['title']),
      details: (() => { try { return JSON.parse(String(r['details'])) as Record<string, unknown>; } catch { return {}; } })(),
      timestamp: new Date(Number(r['created_at'])).toISOString(), createdAt: Number(r['created_at']),
    }));
  } catch { return []; }
}

/** Reject anything that is not a public https endpoint — a webhook must not become an SSRF. */
export function validateWebhookUrl(raw: string): { ok: boolean; reason?: string; url?: string } {
  if (!raw || !raw.trim()) return { ok: false, reason: 'no URL configured' };
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return { ok: false, reason: 'not a valid URL' }; }
  if (u.protocol !== 'https:') return { ok: false, reason: 'webhooks must use https' };
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')) return { ok: false, reason: 'local addresses are not allowed' };
  if (/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return { ok: false, reason: 'private addresses are not allowed' };
  return { ok: true, url: u.toString() };
}

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number }>;

export interface DispatchResult { ok: boolean; status: number; error: string | null }

/** POST the event. Never throws — a broken webhook must not stop the caller. */
export async function dispatchWebhook(url: string, event: AuditEvent, opts: { secret?: string; fetchImpl: FetchLike }): Promise<DispatchResult> {
  const v = validateWebhookUrl(url);
  if (!v.ok) return { ok: false, status: 0, error: v.reason ?? 'invalid URL' };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.secret) headers['X-Webhook-Secret'] = opts.secret;
  try {
    const res = await opts.fetchImpl(v.url!, {
      method: 'POST',
      headers,
      // `text` suits Slack/Discord; `event` carries the structured payload.
      body: JSON.stringify({ text: `*[${event.type}]* ${event.title}`, event }),
    });
    return { ok: res.ok, status: res.status, error: res.ok ? null : `webhook returned HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Log the event, then push it if a webhook is configured. */
export async function recordEvent(
  db: DB, event: AuditEvent,
  webhook: { url?: string | null; secret?: string | null; fetchImpl: FetchLike },
): Promise<{ logged: boolean; dispatched: DispatchResult | null }> {
  logEvent(db, event);
  if (!webhook.url) return { logged: true, dispatched: null };
  const r = await dispatchWebhook(webhook.url, event, { secret: webhook.secret ?? undefined, fetchImpl: webhook.fetchImpl });
  return { logged: true, dispatched: r };
}
