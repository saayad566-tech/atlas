// Corporate timeline and insider flows.
//
// Two views AnalyzerX offered, rebuilt natively: one chronological account of everything
// a company has disclosed, and one measure of whether the people closest to the business
// are buying or selling it.
import type { Database as DB } from 'better-sqlite3';

const r2 = (v: number): number => Math.round(v * 100) / 100;
const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export type TimelineKind = 'announcement' | 'action' | 'insider' | 'result';

export interface TimelineEvent {
  date: string;
  kind: TimelineKind;
  title: string;
  detail: string;
  /** Weight used to surface what matters; not a price prediction. */
  significance: 'high' | 'normal' | 'low';
}

export interface Timeline {
  symbol: string;
  events: TimelineEvent[];
  counts: Record<TimelineKind, number>;
  note: string;
}

const HIGH_SIGNAL = /board approves|merger|acquisition|demerger|rights|bonus|split|pledge|resign|appoint|auditor|default|downgrade|upgrade|stake|open offer|buyback/i;

/** Everything disclosed, in one chronological account. */
export function corporateTimeline(db: DB, symbol: string, limit = 60): Timeline | null {
  const c = db.prepare(`SELECT id, symbol FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number; symbol: string } | undefined;
  if (!c) return null;

  const events: TimelineEvent[] = [];
  const counts: Record<TimelineKind, number> = { announcement: 0, action: 0, insider: 0, result: 0 };

  try {
    const rows = db.prepare(`SELECT date, title, category, summary FROM announcements WHERE company_id=? ORDER BY date DESC`).all(c.id) as Array<{ date: string; title: string; category: string | null; summary: string | null }>;
    for (const a of rows) {
      const isResult = /result|earnings|financial/i.test(`${a.category ?? ''} ${a.title}`);
      const kind: TimelineKind = isResult ? 'result' : 'announcement';
      counts[kind]++;
      events.push({
        date: a.date, kind,
        title: a.title,
        detail: a.summary ?? a.category ?? '',
        significance: HIGH_SIGNAL.test(a.title) ? 'high' : 'normal',
      });
    }
  } catch { /* table absent */ }

  try {
    const rows = db.prepare(`SELECT date, kind, detail FROM corporate_actions WHERE company_id=? ORDER BY date DESC`).all(c.id) as Array<{ date: string; kind: string; detail: string | null }>;
    for (const a of rows) {
      counts.action++;
      events.push({ date: a.date, kind: 'action', title: a.kind, detail: a.detail ?? '', significance: 'high' });
    }
  } catch { /* table absent */ }

  try {
    const rows = db.prepare(`SELECT date, name, relation, txn, shares, value FROM insider_trades WHERE company_id=? ORDER BY date DESC LIMIT 40`).all(c.id) as Array<{ date: string; name: string; relation: string | null; txn: string; shares: number; value: number }>;
    for (const t of rows) {
      counts.insider++;
      events.push({
        date: t.date, kind: 'insider',
        title: `${t.relation ?? 'Insider'} ${/sale|sell/i.test(t.txn) ? 'sold' : 'bought'} shares`,
        detail: `${t.name} — ${t.shares.toLocaleString()} shares`,
        significance: Math.abs(n(t.value)) > 50_000_000 ? 'high' : 'normal',
      });
    }
  } catch { /* table absent */ }

  events.sort((a, b) => b.date.localeCompare(a.date));
  return {
    symbol: c.symbol, events: events.slice(0, limit), counts,
    note: 'Every item is a stored disclosure. Significance flags corporate actions and large insider trades; it is not a recommendation.',
  };
}

export interface FlowSummary {
  symbol: string;
  insider: {
    windowDays: number;
    buys: number; sells: number;
    boughtValue: number; soldValue: number;
    netValue: number;
    netDirection: 'net buying' | 'net selling' | 'balanced';
    byRole: Array<{ role: string; bought: number; sold: number; net: number }>;
    largest: { name: string; txn: string; value: number; date: string } | null;
  };
  ownership: {
    insidersPct: number | null;
    institutionsPct: number | null;
    institutionsCount: number | null;
    verdict: string;
  } | null;
  note: string;
}

/** Are the people closest to the business buying or selling it? */
export function insiderFlows(db: DB, symbol: string, windowDays = 365): FlowSummary | null {
  const c = db.prepare(`SELECT id, symbol FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number; symbol: string } | undefined;
  if (!c) return null;

  const cutoff = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);
  let trades: Array<{ date: string; name: string; relation: string | null; txn: string; shares: number; value: number }> = [];
  try {
    trades = db.prepare(`SELECT date, name, relation, txn, shares, value FROM insider_trades
      WHERE company_id=? AND date >= ? ORDER BY date DESC`).all(c.id, cutoff) as typeof trades;
  } catch { /* table absent */ }

  let buys = 0; let sells = 0; let boughtValue = 0; let soldValue = 0;
  const roles = new Map<string, { bought: number; sold: number }>();
  let largest: FlowSummary['insider']['largest'] = null;

  for (const t of trades) {
    const isSale = /sale|sell/i.test(t.txn);
    const value = Math.abs(n(t.value));
    if (isSale) { sells++; soldValue += value; } else { buys++; boughtValue += value; }
    const role = t.relation ?? 'Other';
    const entry = roles.get(role) ?? { bought: 0, sold: 0 };
    if (isSale) entry.sold += value; else entry.bought += value;
    roles.set(role, entry);
    if (!largest || value > Math.abs(largest.value)) largest = { name: t.name, txn: t.txn, value, date: t.date };
  }

  const netValue = boughtValue - soldValue;
  const scale = Math.max(boughtValue, soldValue, 1);
  const netDirection: FlowSummary['insider']['netDirection'] =
    Math.abs(netValue) / scale < 0.1 ? 'balanced' : netValue > 0 ? 'net buying' : 'net selling';

  let ownership: FlowSummary['ownership'] = null;
  try {
    const h = db.prepare(`SELECT insiders_pct, institutions_pct, institutions_count FROM holders WHERE company_id=? ORDER BY fetched_at DESC LIMIT 1`).get(c.id) as { insiders_pct: number | null; institutions_pct: number | null; institutions_count: number | null } | undefined;
    if (h) {
      const inst = h.institutions_pct;
      ownership = {
        insidersPct: h.insiders_pct === null ? null : r2(n(h.insiders_pct)),
        institutionsPct: inst === null ? null : r2(n(inst)),
        institutionsCount: h.institutions_count === null ? null : Math.round(n(h.institutions_count)),
        verdict: inst === null ? 'institutional holding unknown'
          : inst >= 50 ? 'institution-dominated — expect index-driven moves'
          : inst >= 20 ? 'meaningful institutional interest'
          : 'thin institutional ownership — wider price swings likely',
      };
    }
  } catch { /* table absent */ }

  return {
    symbol: c.symbol,
    insider: {
      windowDays, buys, sells,
      boughtValue: r2(boughtValue), soldValue: r2(soldValue), netValue: r2(netValue),
      netDirection,
      byRole: [...roles.entries()].map(([role, v]) => ({ role, bought: r2(v.bought), sold: r2(v.sold), net: r2(v.bought - v.sold) })).sort((a, b) => Math.abs(b.net) - Math.abs(a.net)),
      largest,
    },
    ownership,
    note: `Counts trades disclosed in the last ${windowDays} days. Insider selling is often diversification, not a verdict — the ratio matters more than the raw count.`,
  };
}
