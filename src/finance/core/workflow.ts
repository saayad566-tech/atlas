// Saved screens, watchlist and notes — the small amount of user state Sift keeps.
// All local, all in the same SQLite file.
import type { Database as DB } from 'better-sqlite3';
import { ulid } from './ids';

export interface SavedScreen { id: string; name: string; expression: string; createdAt: number; lastRunAt: number | null; lastCount: number | null }

export class Workflow {
  constructor(private db: DB) {}

  // ---- saved screens ----
  saveScreen(name: string, expression: string): SavedScreen {
    const existing = this.db.prepare(`SELECT id FROM saved_screens WHERE expression=?`).get(expression) as { id: string } | undefined;
    if (existing) {
      this.db.prepare(`UPDATE saved_screens SET name=?, created_at=? WHERE id=?`).run(name, Date.now(), existing.id);
      return this.listScreens().find((s) => s.id === existing.id)!;
    }
    const id = ulid('scr_');
    this.db.prepare(`INSERT INTO saved_screens (id,name,expression,created_at) VALUES (?,?,?,?)`).run(id, name, expression, Date.now());
    return this.listScreens().find((s) => s.id === id)!;
  }

  listScreens(): SavedScreen[] {
    return (this.db.prepare(`SELECT * FROM saved_screens ORDER BY created_at DESC`).all() as Array<Record<string, unknown>>).map((r) => ({
      id: String(r['id']), name: String(r['name']), expression: String(r['expression']),
      createdAt: Number(r['created_at']), lastRunAt: r['last_run_at'] === null ? null : Number(r['last_run_at']),
      lastCount: r['last_count'] === null ? null : Number(r['last_count']),
    }));
  }

  deleteScreen(id: string): boolean { return this.db.prepare(`DELETE FROM saved_screens WHERE id=?`).run(id).changes > 0; }

  markScreenRun(id: string, count: number): void {
    this.db.prepare(`UPDATE saved_screens SET last_run_at=?, last_count=? WHERE id=?`).run(Date.now(), count, id);
  }

  // ---- watchlist ----
  addWatch(symbol: string): boolean {
    const c = this.db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
    if (!c) throw new Error(`No company "${symbol}".`);
    this.db.prepare(`INSERT OR IGNORE INTO watchlist (company_id, added_at) VALUES (?,?)`).run(c.id, Date.now());
    return true;
  }

  removeWatch(symbol: string): boolean {
    const c = this.db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
    if (!c) return false;
    return this.db.prepare(`DELETE FROM watchlist WHERE company_id=?`).run(c.id).changes > 0;
  }

  watchlist(): Array<{ symbol: string; name: string; sector: string; marketCap: number; pe: number; roe: number; debtToEquity: number; addedAt: number; note: string }> {
    return (this.db.prepare(`
      SELECT c.symbol, c.name, c.sector, v.market_cap AS marketCap, v.pe, v.roe, v.debt_to_equity AS debtToEquity, w.added_at AS addedAt, w.note
      FROM watchlist w JOIN companies c ON c.id = w.company_id JOIN v_latest v ON v.id = c.id
      ORDER BY w.added_at DESC`).all() as Array<Record<string, unknown>>).map((r) => ({
        symbol: String(r['symbol']), name: String(r['name']), sector: String(r['sector']),
        marketCap: Number(r['marketCap']), pe: Number(r['pe']), roe: Number(r['roe']),
        debtToEquity: Number(r['debtToEquity']), addedAt: Number(r['addedAt']), note: String(r['note']),
      }));
  }

  isWatched(symbol: string): boolean {
    const r = this.db.prepare(`SELECT 1 AS x FROM watchlist w JOIN companies c ON c.id=w.company_id WHERE UPPER(c.symbol)=UPPER(?)`).get(symbol);
    return !!r;
  }

  // ---- notes ----
  getNote(symbol: string): { body: string; updatedAt: number } | null {
    const r = this.db.prepare(`SELECT n.body, n.updated_at AS updatedAt FROM notes n JOIN companies c ON c.id=n.company_id WHERE UPPER(c.symbol)=UPPER(?)`).get(symbol) as { body: string; updatedAt: number } | undefined;
    return r ?? null;
  }

  setNote(symbol: string, body: string): { body: string; updatedAt: number } {
    const c = this.db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
    if (!c) throw new Error(`No company "${symbol}".`);
    const now = Date.now();
    this.db.prepare(`INSERT INTO notes (company_id,body,updated_at) VALUES (?,?,?)
      ON CONFLICT(company_id) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at`).run(c.id, body, now);
    return { body, updatedAt: now };
  }

  // ---- alerts (rule-based, evaluated on demand) ----
  alerts(): Array<{ symbol: string; name: string; rule: string; detail: string; severity: 'high' | 'medium' }> {
    const rows = this.db.prepare(`
      SELECT c.symbol, c.name, v.pe, v.roe, v.debt_to_equity AS de, v.promoter_holding AS promoter, v.pledge, v.sales_growth_3y AS sg
      FROM watchlist w JOIN companies c ON c.id=w.company_id JOIN v_latest v ON v.id=c.id`).all() as Array<Record<string, unknown>>;
    const out: Array<{ symbol: string; name: string; rule: string; detail: string; severity: 'high' | 'medium' }> = [];
    for (const r of rows) {
      const symbol = String(r['symbol']); const name = String(r['name']);
      if (Number(r['pledge']) >= 20) out.push({ symbol, name, rule: 'promoter-pledge', detail: `${Number(r['pledge']).toFixed(1)}% pledged`, severity: 'high' });
      if (Number(r['de']) > 2) out.push({ symbol, name, rule: 'high-leverage', detail: `D/E ${Number(r['de']).toFixed(2)}`, severity: 'high' });
      if (Number(r['roe']) < 8) out.push({ symbol, name, rule: 'weak-roe', detail: `ROE ${Number(r['roe']).toFixed(1)}%`, severity: 'medium' });
      if (Number(r['sg']) < 0) out.push({ symbol, name, rule: 'shrinking', detail: `sales 3Y ${Number(r['sg']).toFixed(1)}%`, severity: 'medium' });
      if (Number(r['promoter']) < 25) out.push({ symbol, name, rule: 'low-promoter', detail: `${Number(r['promoter']).toFixed(1)}% held`, severity: 'medium' });
    }
    return out;
  }
}
