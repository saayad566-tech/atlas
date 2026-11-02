// Instrument lifecycle: what is listed, what is new, what is coming, what has gone.
//
// Detection is a delta against a stored snapshot, not a scrape of a listing page. That makes
// it work offline, from the bundled universe, and it means "new" always means "appeared
// since we last looked" rather than "appeared on a page we happened to read".

import type { Database as DB } from 'better-sqlite3';
import { loadUniverse } from './universeBundle';

export type ListingState = 'active' | 'new' | 'upcoming' | 'delisted';

export interface ListingEvent {
  symbol: string;
  name: string;
  market: string;
  state: ListingState;
  firstSeenAt: number;
  lastSeenAt: number;
  note: string;
}

const DDL = `
CREATE TABLE IF NOT EXISTS listing_snapshots (
  market TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active',
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  gone_at INTEGER,
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (market, symbol)
);
CREATE INDEX IF NOT EXISTS idx_listing_state ON listing_snapshots(market, state);
CREATE INDEX IF NOT EXISTS idx_listing_gone ON listing_snapshots(market, gone_at);
`;

export function ensureListings(db: DB): void { db.exec(DDL); }

/**
 * Reconcile a market against the current universe.
 *
 * - present now, never seen        → new
 * - present now, seen before       → active
 * - seen before, absent now        → delisted (kept, not deleted: history matters)
 * - announced but not yet tradable → upcoming (supplied explicitly, see markUpcoming)
 */
export function reconcile(db: DB, market: string, now = Date.now()): {
  market: string; total: number; added: number; delisted: number; unchanged: number;
} {
  ensureListings(db);
  const code = market.toUpperCase();
  const rows = loadUniverse(code);
  if (!rows.length) return { market: code, total: 0, added: 0, delisted: 0, unchanged: 0 };

  const known = new Map<string, { state: string; gone: number | null }>();
  for (const r of db.prepare(`SELECT symbol, state, gone_at FROM listing_snapshots WHERE market=?`).all(code) as Array<{ symbol: string; state: string; gone_at: number | null }>) {
    known.set(r.symbol, { state: r.state, gone: r.gone_at });
  }

  const upKnown = db.prepare(`UPDATE listing_snapshots SET last_seen_at=?, state='active', gone_at=NULL, name=? WHERE market=? AND symbol=?`);
  const ins = db.prepare(`INSERT INTO listing_snapshots (market, symbol, name, state, first_seen_at, last_seen_at, note)
    VALUES (?,?,?,?,?,?,?)`);

  let added = 0; let unchanged = 0;
  const present = new Set<string>();
  const tx = db.transaction(() => {
    for (const r of rows) {
      present.add(r.symbol);
      const prev = known.get(r.symbol);
      if (!prev) {
        ins.run(code, r.symbol, r.name, 'new', now, now, 'appeared in the universe since the last check');
        added++;
      } else {
        upKnown.run(now, r.name, code, r.symbol);
        unchanged++;
      }
    }
    // Anything previously known and now absent is marked delisted, never removed.
    for (const [symbol, prev] of known) {
      if (present.has(symbol)) continue;
      if (prev.gone !== null) continue;
      db.prepare(`UPDATE listing_snapshots SET state='delisted', gone_at=?, note=? WHERE market=? AND symbol=?`)
        .run(now, 'no longer present in the universe', code, symbol);
    }
  });
  tx();

  const delisted = (db.prepare(`SELECT COUNT(*) n FROM listing_snapshots WHERE market=? AND state='delisted'`).get(code) as { n: number }).n;
  return { market: code, total: rows.length, added, delisted, unchanged };
}

/** Record an instrument that is announced but not yet tradable. */
export function markUpcoming(db: DB, market: string, symbol: string, name: string, note = 'announced, not yet trading', now = Date.now()): void {
  ensureListings(db);
  db.prepare(`INSERT INTO listing_snapshots (market, symbol, name, state, first_seen_at, last_seen_at, note)
    VALUES (?,?,?,'upcoming',?,?,?)
    ON CONFLICT(market, symbol) DO UPDATE SET state='upcoming', name=excluded.name, note=excluded.note, last_seen_at=excluded.last_seen_at`)
    .run(market.toUpperCase(), symbol, name, now, now, note);
}

export function listings(db: DB, market: string, state?: ListingState, limit = 100): ListingEvent[] {
  ensureListings(db);
  const sql = state
    ? `SELECT * FROM listing_snapshots WHERE market=? AND state=? ORDER BY last_seen_at DESC LIMIT ?`
    : `SELECT * FROM listing_snapshots WHERE market=? ORDER BY last_seen_at DESC LIMIT ?`;
  const args = state ? [market.toUpperCase(), state, limit] : [market.toUpperCase(), limit];
  return (db.prepare(sql).all(...args) as Array<Record<string, unknown>>).map((r) => ({
    symbol: String(r['symbol']), name: String(r['name']), market: String(r['market']),
    state: String(r['state']) as ListingState,
    firstSeenAt: Number(r['first_seen_at']), lastSeenAt: Number(r['last_seen_at']),
    note: String(r['note']),
  }));
}

/** Instruments first seen within the last N days — the useful form of "what is new". */
export function recentlyAdded(db: DB, market: string, days = 30, limit = 100): ListingEvent[] {
  ensureListings(db);
  const cut = Date.now() - days * 86_400_000;
  return (db.prepare(`SELECT * FROM listing_snapshots WHERE market=? AND first_seen_at>=? AND state<>'delisted'
    ORDER BY first_seen_at DESC LIMIT ?`).all(market.toUpperCase(), cut, limit) as Array<Record<string, unknown>>).map((r) => ({
    symbol: String(r['symbol']), name: String(r['name']), market: String(r['market']),
    state: String(r['state']) as ListingState,
    firstSeenAt: Number(r['first_seen_at']), lastSeenAt: Number(r['last_seen_at']),
    note: String(r['note']),
  }));
}

export function listingSummary(db: DB, market: string): Record<ListingState, number> {
  ensureListings(db);
  const out: Record<ListingState, number> = { active: 0, new: 0, upcoming: 0, delisted: 0 };
  for (const r of db.prepare(`SELECT state, COUNT(*) n FROM listing_snapshots WHERE market=? GROUP BY state`).all(market.toUpperCase()) as Array<{ state: string; n: number }>) {
    if (r.state in out) out[r.state as ListingState] = r.n;
  }
  return out;
}
