// User-facing features: portfolio P&L, exports, freshness, sector drill-down,
// screen explanations, recent searches and alert quick-create.
import type { Database as DB } from 'better-sqlite3';
import { marketIntel } from './marketdata';

export interface Holding {
  symbol: string; name: string; quantity: number; avgCost: number;
  price: number; value: number; cost: number; pnl: number; pnlPct: number;
  weightPct: number; currency: string;
}

/** Portfolio with live-ish prices from the local quote table. */
export function portfolioPnl(db: DB): { holdings: Holding[]; totalValue: number; totalCost: number; totalPnl: number; totalPnlPct: number; best: Holding | null; worst: Holding | null } {
  const rows = db.prepare(`
    SELECT p.quantity, p.avg_cost AS avgCost, c.symbol, c.name, c.currency,
           COALESCE(q.price, 0) AS price
    FROM portfolio p JOIN companies c ON c.id = p.company_id
    LEFT JOIN quotes q ON q.company_id = c.id`).all() as Array<Record<string, unknown>>;
  const holdings: Holding[] = rows.map((r) => {
    const quantity = Number(r['quantity'] ?? 0);
    const avgCost = Number(r['avgCost'] ?? 0);
    const price = Number(r['price'] ?? 0);
    const value = quantity * price;
    const cost = quantity * avgCost;
    return {
      symbol: String(r['symbol']), name: String(r['name']), quantity, avgCost, price,
      value, cost, pnl: value - cost,
      pnlPct: cost > 0 ? Math.round(((value - cost) / cost) * 1000) / 10 : 0,
      weightPct: 0, currency: String(r['currency'] ?? ''),
    };
  });
  const totalValue = holdings.reduce((a, h) => a + h.value, 0);
  const totalCost = holdings.reduce((a, h) => a + h.cost, 0);
  for (const h of holdings) h.weightPct = totalValue > 0 ? Math.round((h.value / totalValue) * 1000) / 10 : 0;
  const sorted = [...holdings].sort((a, b) => b.pnlPct - a.pnlPct);
  return {
    holdings: holdings.sort((a, b) => b.value - a.value),
    totalValue, totalCost, totalPnl: totalValue - totalCost,
    totalPnlPct: totalCost > 0 ? Math.round(((totalValue - totalCost) / totalCost) * 1000) / 10 : 0,
    best: sorted[0] ?? null, worst: sorted[sorted.length - 1] ?? null,
  };
}

/** How old each data source is for a company — so users know what they are reading. */
export function dataFreshness(db: DB, symbol: string): { symbol: string; sources: Array<{ source: string; asOf: string | null; ageDays: number | null; stale: boolean }> } | null {
  const c = db.prepare(`SELECT id, symbol, source, updated_at FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number; symbol: string; source: string; updated_at: number } | undefined;
  if (!c) return null;
  const day = 86_400_000;
  const age = (ts: number | null | undefined): { asOf: string | null; ageDays: number | null } => {
    if (!ts) return { asOf: null, ageDays: null };
    return { asOf: new Date(Number(ts)).toISOString().slice(0, 10), ageDays: Math.floor((Date.now() - Number(ts)) / day) };
  };
  const out: Array<{ source: string; asOf: string | null; ageDays: number | null; stale: boolean }> = [];
  const push = (name: string, ts: number | null | undefined, staleAfter: number): void => {
    const a = age(ts);
    out.push({ source: name, ...a, stale: a.ageDays === null ? true : a.ageDays > staleAfter });
  };
  push('company record', c.updated_at, 30);
  push('statements', (db.prepare(`SELECT MAX(period_end) AS d FROM statements WHERE company_id=?`).get(c.id) as { d: string | null })?.d ? Date.parse((db.prepare(`SELECT MAX(period_end) AS d FROM statements WHERE company_id=?`).get(c.id) as { d: string }).d) : null, 400);
  push('prices', (db.prepare(`SELECT MAX(date) AS d FROM price_history WHERE company_id=?`).get(c.id) as { d: string | null })?.d ? Date.parse((db.prepare(`SELECT MAX(date) AS d FROM price_history WHERE company_id=?`).get(c.id) as { d: string }).d) : null, 7);
  push('dividends', (db.prepare(`SELECT MAX(date) AS d FROM dividends WHERE company_id=?`).get(c.id) as { d: string | null })?.d ? Date.parse((db.prepare(`SELECT MAX(date) AS d FROM dividends WHERE company_id=?`).get(c.id) as { d: string })!.d) : null, 200);
  push('analysts', (db.prepare(`SELECT MAX(fetched_at) AS d FROM analyst_targets WHERE company_id=?`).get(c.id) as { d: number | null })?.d ?? null, 30);
  return { symbol: c.symbol, sources: out };
}

/** Sector drill-down: companies in a sector, ranked by market cap. */
export function sectorCompanies(db: DB, sector: string, limit = 100): Array<{ symbol: string; name: string; marketCap: number; pe: number; roe: number }> {
  return (db.prepare(`SELECT symbol, name, market_cap AS marketCap, pe, roe FROM v_latest WHERE sector = ? ORDER BY market_cap DESC LIMIT ?`).all(sector, limit) as Array<Record<string, unknown>>)
    .map((r) => ({ symbol: String(r['symbol']), name: String(r['name']), marketCap: Number(r['marketCap'] ?? 0), pe: Number(r['pe'] ?? 0), roe: Number(r['roe'] ?? 0) }));
}

/** Explain why each row of a screen matched — the conditions it satisfied. */
export function explainScreen(db: DB, expression: string, symbols: string[]): Array<{ symbol: string; matched: string[] }> {
  const conditions = expression.split(/\s+(?:AND|OR)\s+/i).map((p) => p.replace(/^\(|\)$/g, '').trim()).filter(Boolean);
  const out: Array<{ symbol: string; matched: string[] }> = [];
  for (const symbol of symbols) {
    const row = db.prepare(`SELECT * FROM v_latest WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as Record<string, unknown> | undefined;
    if (!row) continue;
    const matched: string[] = [];
    for (const cond of conditions) {
      const m = /^(.+?)\s*(>=|<=|!=|=|>|<)\s*(.+)$/.exec(cond);
      if (!m) continue;
      const field = m[1]!.trim();
      const op = m[2]!;
      const raw = m[3]!.trim();
      const value = /^".*"$/.test(raw) ? raw.slice(1, -1) : Number(raw);
      // map a label to a v_latest column by trying the obvious candidates
      const key = Object.keys(row).find((k) => k.toLowerCase().replace(/_/g, ' ') === field.toLowerCase());
      if (!key) { matched.push(`${field} ${op} ${raw} (not a stored column)`); continue; }
      const actual = row[key];
      const ok = typeof value === 'number'
        ? (op === '>' ? Number(actual) > value : op === '>=' ? Number(actual) >= value : op === '<' ? Number(actual) < value : op === '<=' ? Number(actual) <= value : op === '=' ? Number(actual) === value : Number(actual) !== value)
        : String(actual) === String(value);
      matched.push(`${field} ${op} ${raw} → ${String(actual)}${ok ? '' : ' (fails)'}`);
    }
    out.push({ symbol, matched });
  }
  return out;
}

/** CSV helpers for the exports users actually ask for. */
export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]!);
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

/** One-click: add every symbol in a screen to the watchlist. */
export function bulkWatchlist(db: DB, symbols: string[]): { added: number; already: number } {
  let added = 0; let already = 0;
  const ins = db.prepare(`INSERT OR IGNORE INTO watchlist (company_id, added_at, note) VALUES (?,?,'')`);
  for (const s of symbols) {
    const row = db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(s) as { id: number } | undefined;
    if (!row) continue;
    const r = ins.run(row.id, Date.now());
    if (r.changes > 0) added++; else already++;
  }
  return { added, already };
}

/** Latest headline count per company, for the "what's new" badge. */
export function newsCount(db: DB, symbol: string): number {
  try {
    const c = db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
    if (!c) return 0;
    return Number((db.prepare(`SELECT COUNT(*) AS n FROM news WHERE company_id=?`).get(c.id) as { n: number }).n);
  } catch { return 0; }
}

export { marketIntel };


/** Biggest movers over a window, from stored prices. */
export function topMovers(db: DB, days = 30, limit = 10): { gainers: Array<{ symbol: string; name: string; changePct: number; price: number }>; losers: Array<{ symbol: string; name: string; changePct: number; price: number }> } {
  const rows = db.prepare(`
    WITH ranked AS (
      SELECT company_id, close, date, ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY date DESC) AS rn
      FROM price_history
    ), pairs AS (
      SELECT a.company_id, a.close AS last, b.close AS prior, a.date AS lastDate
      FROM ranked a JOIN ranked b ON a.company_id = b.company_id AND b.rn = ?
      WHERE a.rn = 1 AND b.close > 0
    )
    SELECT c.symbol, c.name, p.last, p.prior, ROUND(((p.last - p.prior) / p.prior) * 1000) / 10.0 AS changePct
    FROM pairs p JOIN companies c ON c.id = p.company_id
    ORDER BY changePct DESC`).all(days + 1) as Array<Record<string, unknown>>;
  const mapped = rows.map((r) => ({ symbol: String(r['symbol']), name: String(r['name']), changePct: Number(r['changePct'] ?? 0), price: Number(r['last'] ?? 0) }));
  return { gainers: mapped.slice(0, limit), losers: mapped.slice(-limit).reverse() };
}

/** Breadth by sector: how many up vs down over the window. */
export function sectorBreadth(db: DB, days = 30): Array<{ sector: string; up: number; down: number; pctUp: number; medianChangePct: number }> {
  const rows = db.prepare(`
    WITH ranked AS (
      SELECT company_id, close, ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY date DESC) AS rn FROM price_history
    ), pairs AS (
      SELECT a.company_id, ((a.close - b.close) / b.close) * 100 AS chg
      FROM ranked a JOIN ranked b ON a.company_id=b.company_id AND b.rn=? WHERE a.rn=1 AND b.close>0
    )
    SELECT c.sector, COUNT(*) AS n,
           SUM(CASE WHEN p.chg > 0 THEN 1 ELSE 0 END) AS up,
           SUM(CASE WHEN p.chg < 0 THEN 1 ELSE 0 END) AS down,
           ROUND(AVG(p.chg),2) AS avgChg
    FROM pairs p JOIN companies c ON c.id=p.company_id
    GROUP BY c.sector ORDER BY n DESC`).all(days + 1) as Array<Record<string, unknown>>;
  return rows.map((r) => {
    const up = Number(r['up'] ?? 0); const down = Number(r['down'] ?? 0);
    return { sector: String(r['sector']), up, down, pctUp: up + down > 0 ? Math.round((up / (up + down)) * 1000) / 10 : 0, medianChangePct: Number(r['avgChg'] ?? 0) };
  });
}

/** One company's event timeline: dividends, earnings, insider trades. */
export function companyTimeline(db: DB, symbol: string, limit = 40): Array<{ date: string; kind: string; detail: string }> | null {
  const c = db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
  if (!c) return null;
  const out: Array<{ date: string; kind: string; detail: string }> = [];
  const safe = (sql: string, map: (r: Record<string, unknown>) => { date: string; kind: string; detail: string }): void => {
    try { for (const r of db.prepare(sql).all(c.id, limit) as Array<Record<string, unknown>>) out.push(map(r)); } catch { /* table may not exist */ }
  };
  safe(`SELECT date, amount FROM dividends WHERE company_id=? ORDER BY date DESC LIMIT ?`, (r) => ({ date: String(r['date']), kind: 'dividend', detail: `Dividend ${r['amount']} per share` }));
  safe(`SELECT date, num, den FROM splits WHERE company_id=? ORDER BY date DESC LIMIT ?`, (r) => ({ date: String(r['date']), kind: 'split', detail: `Split ${r['num']}:${r['den']}` }));
  safe(`SELECT date, name, txn, shares FROM insider_trades WHERE company_id=? ORDER BY date DESC LIMIT ?`, (r) => ({ date: String(r['date']), kind: 'insider', detail: `${r['name']} — ${r['txn']} ${r['shares']} shares` }));
  safe(`SELECT quarter AS date, actual, estimate FROM earnings_surprises WHERE company_id=? ORDER BY quarter DESC LIMIT ?`, (r) => ({ date: String(r['date']), kind: 'earnings', detail: `EPS ${r['actual']} vs ${r['estimate']} est.` }));
  return out.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, limit);
}

/** Upcoming events across the watchlist: earnings and ex-dividend dates. */
export function watchlistCalendar(db: DB): { earnings: Array<{ symbol: string; date: string }>; exDividend: Array<{ symbol: string; date: string }> } {
  const rows = db.prepare(`
    SELECT c.symbol, ce.earnings_date AS ed, ce.ex_dividend_date AS xd
    FROM calendar_events ce JOIN companies c ON c.id = ce.company_id
    JOIN watchlist w ON w.company_id = c.id`).all() as Array<Record<string, unknown>>;
  const today = new Date().toISOString().slice(0, 10);
  const earnings: Array<{ symbol: string; date: string }> = [];
  const exDividend: Array<{ symbol: string; date: string }> = [];
  for (const r of rows) {
    const ed = r['ed'] ? String(r['ed']) : ''; const xd = r['xd'] ? String(r['xd']) : '';
    if (ed && ed >= today) earnings.push({ symbol: String(r['symbol']), date: ed });
    if (xd && xd >= today) exDividend.push({ symbol: String(r['symbol']), date: xd });
  }
  return { earnings: earnings.sort((a, b) => a.date.localeCompare(b.date)), exDividend: exDividend.sort((a, b) => a.date.localeCompare(b.date)) };
}
