// The decision journal.
//
// A screener tells you what to buy. It never asks why, and it never reminds you that you
// were wrong. This records the reasoning at the moment of the decision, then grades that
// reasoning against what actually happened — which is the only way anyone improves.
import type { Database as DB } from 'better-sqlite3';

export const JOURNAL_DDL = `
CREATE TABLE IF NOT EXISTS journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market TEXT NOT NULL,
  symbol TEXT NOT NULL,
  action TEXT NOT NULL,              -- buy | sell | watch | note
  thesis TEXT NOT NULL,              -- why, in your words
  expectation TEXT NOT NULL,         -- up | down | flat
  horizon_days INTEGER NOT NULL,
  price_at_entry REAL NOT NULL,
  confidence INTEGER NOT NULL,       -- 1..5, your own
  created_at TEXT NOT NULL,
  closed_at TEXT,
  closed_price REAL,
  closed_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_journal_market ON journal(market, created_at DESC);
`;

export interface JournalEntry {
  id: number; market: string; symbol: string; action: string;
  thesis: string; expectation: string; horizonDays: number;
  priceAtEntry: number; confidence: number; createdAt: string;
  closedAt: string | null; closedPrice: number | null; closedNote: string | null;
}

export interface GradedEntry extends JournalEntry {
  currentPrice: number | null;
  returnPct: number | null;
  daysHeld: number;
  /** Did reality match what the author expected? */
  verdict: 'right' | 'wrong' | 'early' | 'unresolved' | 'flat';
  note: string;
}

export function ensureJournal(db: DB): void { db.exec(JOURNAL_DDL); }

export function addEntry(db: DB, e: {
  market: string; symbol: string; action: string; thesis: string;
  expectation: string; horizonDays: number; priceAtEntry: number; confidence: number;
}): number {
  ensureJournal(db);
  const info = db.prepare(`
    INSERT INTO journal (market,symbol,action,thesis,expectation,horizon_days,price_at_entry,confidence,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    e.market, e.symbol, e.action, e.thesis, e.expectation,
    Math.max(1, Math.min(3650, Math.round(e.horizonDays))),
    e.priceAtEntry, Math.max(1, Math.min(5, Math.round(e.confidence))),
    new Date().toISOString(),
  );
  return Number(info.lastInsertRowid);
}

function priceNow(db: DB, symbol: string): number | null {
  try {
    const r = db.prepare(`SELECT price FROM v_latest WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { price: number } | undefined;
    return r && r.price > 0 ? r.price : null;
  } catch { return null; }
}

/**
 * Grade one entry against reality.
 *
 * The judgement is deliberately narrow: did the price move the way the author said it
 * would, and did it happen inside the horizon they gave themselves? Anything else is
 * hindsight, which teaches nothing.
 */
export function gradeEntry(e: JournalEntry, currentPrice: number | null, now = Date.now()): GradedEntry {
  const daysHeld = Math.max(0, Math.floor((now - new Date(e.createdAt).getTime()) / 86_400_000));
  const base: GradedEntry = { ...e, currentPrice, returnPct: null, daysHeld, verdict: 'unresolved', note: '' };
  if (currentPrice === null || !(e.priceAtEntry > 0)) {
    return { ...base, note: 'No current price to compare against.' };
  }
  const returnPct = Math.round(((currentPrice - e.priceAtEntry) / e.priceAtEntry) * 1000) / 10;
  const withinHorizon = daysHeld <= e.horizonDays;
  const moved = Math.abs(returnPct) < 2;

  let verdict: GradedEntry['verdict'];
  let note: string;
  if (e.closedAt) {
    const closedReturn = e.closedPrice && e.priceAtEntry > 0 ? Math.round(((e.closedPrice - e.priceAtEntry) / e.priceAtEntry) * 1000) / 10 : returnPct;
    verdict = (e.expectation === 'up' && closedReturn > 0) || (e.expectation === 'down' && closedReturn < 0) ? 'right' : 'wrong';
    note = `Closed at ${closedReturn > 0 ? '+' : ''}${closedReturn}%.`;
    return { ...base, returnPct: closedReturn, verdict, note };
  }
  if (moved) { verdict = 'flat'; note = `Barely moved (${returnPct > 0 ? '+' : ''}${returnPct}%) — no signal yet.`; }
  else if (e.expectation === 'up' && returnPct > 0) { verdict = 'right'; note = `Up ${returnPct}% — as expected.`; }
  else if (e.expectation === 'down' && returnPct < 0) { verdict = 'right'; note = `Down ${returnPct}% — as expected.`; }
  // A materially adverse move is a wrong call even with time left. Calling a 20% fall
  // "early" would flatter the author and teach nothing.
  else if (withinHorizon && Math.abs(returnPct) < 10) { verdict = 'early'; note = `${returnPct > 0 ? '+' : ''}${returnPct}% so far, ${e.horizonDays - daysHeld} day(s) left in your horizon.`; }
  else if (withinHorizon) { verdict = 'wrong'; note = `${returnPct > 0 ? '+' : ''}${returnPct}% against your call, with ${e.horizonDays - daysHeld} day(s) still to run.`; }
  else { verdict = 'wrong'; note = `${returnPct > 0 ? '+' : ''}${returnPct}% after ${daysHeld} days — the horizon you set has passed.`; }
  return { ...base, returnPct, verdict, note };
}

export function listJournal(db: DB, market: string, includeGraded = true): GradedEntry[] {
  ensureJournal(db);
  const rows = db.prepare(`SELECT * FROM journal WHERE market=? ORDER BY created_at DESC LIMIT 200`).all(market) as Array<Record<string, unknown>>;
  const entries: JournalEntry[] = rows.map((r) => ({
    id: Number(r['id']), market: String(r['market']), symbol: String(r['symbol']), action: String(r['action']),
    thesis: String(r['thesis']), expectation: String(r['expectation']), horizonDays: Number(r['horizon_days']),
    priceAtEntry: Number(r['price_at_entry']), confidence: Number(r['confidence']), createdAt: String(r['created_at']),
    closedAt: r['closed_at'] ? String(r['closed_at']) : null,
    closedPrice: r['closed_price'] === null || r['closed_price'] === undefined ? null : Number(r['closed_price']),
    closedNote: r['closed_note'] ? String(r['closed_note']) : null,
  }));
  if (!includeGraded) return entries.map((e) => ({ ...e, currentPrice: null, returnPct: null, daysHeld: 0, verdict: 'unresolved' as const, note: '' }));
  return entries.map((e) => gradeEntry(e, priceNow(db, e.symbol)));
}

export function closeEntry(db: DB, id: number, price: number, note = ''): boolean {
  ensureJournal(db);
  const r = db.prepare(`UPDATE journal SET closed_at=?, closed_price=?, closed_note=? WHERE id=? AND closed_at IS NULL`)
    .run(new Date().toISOString(), price, note, id);
  return r.changes > 0;
}

/** The honest scoreboard: how often was the reasoning right, and how often was it just lucky? */
export function journalScorecard(entries: GradedEntry[]): {
  total: number; graded: number; right: number; wrong: number; early: number; flat: number;
  accuracy: number | null; avgConfidenceWhenRight: number | null; avgConfidenceWhenWrong: number | null;
  insight: string;
} {
  const graded = entries.filter((e) => e.verdict === 'right' || e.verdict === 'wrong');
  const right = graded.filter((e) => e.verdict === 'right');
  const wrong = graded.filter((e) => e.verdict === 'wrong');
  const avg = (xs: GradedEntry[]): number | null => xs.length ? Math.round((xs.reduce((a, b) => a + b.confidence, 0) / xs.length) * 10) / 10 : null;
  const accuracy = graded.length ? Math.round((right.length / graded.length) * 100) : null;
  const cRight = avg(right); const cWrong = avg(wrong);
  let insight: string;
  if (!graded.length) insight = 'No resolved calls yet — the scoreboard stays empty until a horizon passes.';
  else if (accuracy !== null && accuracy >= 60) insight = `You were right ${right.length} of ${graded.length} times. Your reasoning is holding up.`;
  else if (accuracy !== null && accuracy <= 40) insight = `You were right ${right.length} of ${graded.length} times. Worth re-reading the theses that failed.`;
  else insight = `Roughly a coin flip: ${right.length} of ${graded.length}. The theses may not be adding edge yet.`;
  if (cRight !== null && cWrong !== null && cRight - cWrong >= 1) {
    insight += ' Your high-confidence calls do better than your low-confidence ones — trust the conviction.';
  } else if (cRight !== null && cWrong !== null && cWrong - cRight >= 1) {
    insight += ' Your low-confidence calls do better — the ones you were sure about are the ones to re-examine.';
  }
  return {
    total: entries.length, graded: graded.length, right: right.length, wrong: wrong.length,
    early: entries.filter((e) => e.verdict === 'early').length,
    flat: entries.filter((e) => e.verdict === 'flat').length,
    accuracy, avgConfidenceWhenRight: cRight, avgConfidenceWhenWrong: cWrong, insight,
  };
}
