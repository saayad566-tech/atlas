// User state: layout preferences, personal ratings, custom alert rules, peer
// overrides and a portfolio. Everything lives in the same local SQLite file.
import type { Database as DB } from 'better-sqlite3';
import { ulid } from './ids';

export const DEFAULT_COLUMNS = ['name', 'spark', 'market_cap', 'price', 'pe', 'roe', 'roce', 'debt_to_equity', 'sales', 'net_profit', 'opm', 'sales_growth_3y', 'promoter_holding', 'pledge'];
export const ALL_COLUMNS = ['name', 'spark', 'market_cap', 'price', 'pe', 'pb', 'roe', 'roce', 'debt_to_equity', 'sales', 'net_profit', 'opm', 'npm', 'eps', 'dividend_yield', 'sales_growth_3y', 'profit_growth_3y', 'promoter_holding', 'pledge', 'current_ratio', 'interest_coverage', 'asset_turnover'];

export interface Prefs {
  theme: 'light' | 'dark';
  density: 'comfortable' | 'compact';
  columns: string[];
  panels: Record<string, boolean>;
  limit: number;
  currency: string;
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'dark', density: 'comfortable', columns: [...DEFAULT_COLUMNS],
  panels: { scores: true, deep: true, factors: true, valuation: true, strength: true, intel: true },
  limit: 100, currency: 'INR',
};

export interface AlertRule { id: string; metric: string; op: '>' | '<' | '>=' | '<=' | '='; threshold: number; enabled: boolean; createdAt: number }

const ALERT_METRICS: Record<string, string> = {
  pe: 'pe', roe: 'roe', roce: 'roce', opm: 'opm', debt_to_equity: 'debt_to_equity',
  pledge: 'pledge', promoter_holding: 'promoter_holding', sales_growth_3y: 'sales_growth_3y',
  market_cap: 'market_cap', price: 'price', current_ratio: 'current_ratio',
};

export class Custom {
  constructor(private db: DB) {}

  // ---- preferences ----
  prefs(): Prefs {
    const row = this.db.prepare(`SELECT value FROM prefs WHERE key='ui'`).get() as { value: string } | undefined;
    if (!row) return { ...DEFAULT_PREFS };
    try {
      const parsed = JSON.parse(row.value) as Partial<Prefs>;
      return { ...DEFAULT_PREFS, ...parsed, columns: (parsed.columns ?? DEFAULT_COLUMNS).filter((c) => ALL_COLUMNS.includes(c)) };
    } catch { return { ...DEFAULT_PREFS }; }
  }

  setPrefs(patch: Partial<Prefs>): Prefs {
    const merged = { ...this.prefs(), ...patch };
    // Guard rails: unknown columns are dropped, at least one column must remain.
    merged.columns = (merged.columns ?? DEFAULT_COLUMNS).filter((c) => ALL_COLUMNS.includes(c));
    if (merged.columns.length === 0) merged.columns = [...DEFAULT_COLUMNS];
    merged.limit = Math.max(10, Math.min(500, Number(merged.limit) || 100));
    this.db.prepare(`INSERT INTO prefs (key,value,updated_at) VALUES ('ui',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
      .run(JSON.stringify(merged), Date.now());
    return merged;
  }

  resetPrefs(): Prefs {
    this.db.prepare(`DELETE FROM prefs WHERE key='ui'`).run();
    return { ...DEFAULT_PREFS };
  }

  // ---- personal rating ----
  rating(symbol: string): { rating: number; thesis: string; updatedAt: number } | null {
    const r = this.db.prepare(`SELECT r.rating, r.thesis, r.updated_at AS updatedAt FROM my_ratings r JOIN companies c ON c.id=r.company_id WHERE UPPER(c.symbol)=UPPER(?)`).get(symbol) as { rating: number; thesis: string; updatedAt: number } | undefined;
    return r ?? null;
  }

  setRating(symbol: string, rating: number, thesis = ''): { rating: number; thesis: string; updatedAt: number } {
    const c = this.db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
    if (!c) throw new Error(`No company "${symbol}".`);
    const clamped = Math.max(1, Math.min(5, Math.round(rating)));
    const now = Date.now();
    this.db.prepare(`INSERT INTO my_ratings (company_id,rating,thesis,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(company_id) DO UPDATE SET rating=excluded.rating, thesis=excluded.thesis, updated_at=excluded.updated_at`)
      .run(c.id, clamped, thesis, now);
    return { rating: clamped, thesis, updatedAt: now };
  }

  // ---- alert rules ----
  listRules(): AlertRule[] {
    return (this.db.prepare(`SELECT * FROM alert_rules ORDER BY created_at DESC`).all() as Array<Record<string, unknown>>).map((r) => ({
      id: String(r['id']), metric: String(r['metric']), op: String(r['op']) as AlertRule['op'],
      threshold: Number(r['threshold']), enabled: Number(r['enabled']) === 1, createdAt: Number(r['created_at']),
    }));
  }

  addRule(metricInput: string, op: AlertRule['op'], threshold: number): AlertRule {
    // Accept "ROE", "roe", "Debt to Equity" — normalise instead of rejecting a caller
    // for not knowing our internal casing.
    const metric = metricInput.trim().toLowerCase().replace(/[\s\/-]+/g, '_');
    const col = ALERT_METRICS[metric];
    if (!col) throw new Error(`Unknown metric "${metricInput}". Try: ${Object.keys(ALERT_METRICS).join(', ')}`);
    if (!['>', '<', '>=', '<=', '='].includes(op)) throw new Error(`Unknown operator "${op}".`);
    const rule: AlertRule = { id: ulid('rule_'), metric, op, threshold, enabled: true, createdAt: Date.now() };
    this.db.prepare(`INSERT INTO alert_rules (id,metric,op,threshold,enabled,created_at) VALUES (?,?,?,?,?,?)`)
      .run(rule.id, rule.metric, rule.op, rule.threshold, 1, rule.createdAt);
    return rule;
  }

  deleteRule(id: string): boolean { return this.db.prepare(`DELETE FROM alert_rules WHERE id=?`).run(id).changes > 0; }

  toggleRule(id: string, enabled: boolean): boolean {
    return this.db.prepare(`UPDATE alert_rules SET enabled=? WHERE id=?`).run(enabled ? 1 : 0, id).changes > 0;
  }

  /** Evaluate the user's rules across the watchlist (falls back to all companies). */
  evaluateRules(scope: 'watchlist' | 'all' = 'watchlist'): Array<{ ruleId: string; symbol: string; name: string; metric: string; op: string; threshold: number; actual: number }> {
    const rules = this.listRules().filter((r) => r.enabled);
    if (rules.length === 0) return [];
    const where = scope === 'watchlist' ? `JOIN watchlist w ON w.company_id = v.id` : '';
    const rows = this.db.prepare(`SELECT v.id, v.symbol, v.name, ${Object.keys(ALERT_METRICS).map((k) => `v.${k}`).join(', ')} FROM v_latest v ${where}`).all() as Array<Record<string, unknown>>;
    const out: Array<{ ruleId: string; symbol: string; name: string; metric: string; op: string; threshold: number; actual: number }> = [];
    for (const r of rows) {
      for (const rule of rules) {
        const actual = Number(r[rule.metric] ?? 0);
        const hit = rule.op === '>' ? actual > rule.threshold : rule.op === '<' ? actual < rule.threshold
          : rule.op === '>=' ? actual >= rule.threshold : rule.op === '<=' ? actual <= rule.threshold : actual === rule.threshold;
        if (hit) out.push({ ruleId: rule.id, symbol: String(r['symbol']), name: String(r['name']), metric: rule.metric, op: rule.op, threshold: rule.threshold, actual });
      }
    }
    return out;
  }

  // ---- peer overrides ----
  setPeers(symbol: string, peerSymbols: string[]): { ok: boolean; peers: string[] } {
    const c = this.db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
    if (!c) throw new Error(`No company "${symbol}".`);
    const ids = peerSymbols.slice(0, 8).map((s) => this.db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(s) as { id: number } | undefined)
      .filter((x): x is { id: number } => !!x && x.id !== c.id);
    this.db.prepare(`DELETE FROM peer_overrides WHERE company_id=?`).run(c.id);
    ids.forEach((p, i) => this.db.prepare(`INSERT OR REPLACE INTO peer_overrides (company_id,peer_id,rank) VALUES (?,?,?)`).run(c.id, p.id, i + 1));
    return { ok: true, peers: ids.map((p) => (this.db.prepare(`SELECT symbol FROM companies WHERE id=?`).get(p.id) as { symbol: string }).symbol) };
  }

  peersFor(symbol: string): string[] {
    const c = this.db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
    if (!c) return [];
    const rows = this.db.prepare(`SELECT c2.symbol FROM peer_overrides p JOIN companies c2 ON c2.id=p.peer_id WHERE p.company_id=? ORDER BY p.rank`).all(c.id) as Array<{ symbol: string }>;
    if (rows.length) return rows.map((r) => r.symbol);
    const auto = this.db.prepare(`SELECT c2.symbol FROM peers p JOIN companies c2 ON c2.id=p.peer_id WHERE p.company_id=? ORDER BY p.rank`).all(c.id) as Array<{ symbol: string }>;
    if (auto.length) return auto.map((r) => r.symbol);
    // Live-fetched companies have no stored peer links, so derive them from the sector —
    // otherwise the endpoint returns nothing for exactly the companies users add themselves.
    const derived = this.db.prepare(`
      SELECT c2.symbol FROM companies c2
      WHERE c2.id <> ? AND c2.sector = (SELECT sector FROM companies WHERE id = ?)
        AND c2.sector <> ''
      ORDER BY COALESCE((SELECT market_cap FROM v_latest WHERE id = c2.id), 0) DESC
      LIMIT 8`).all(c.id, c.id) as Array<{ symbol: string }>;
    return derived.map((r) => r.symbol);
  }

  // ---- portfolio ----
  addHolding(symbol: string, quantity: number, avgCost: number, note = ''): { ok: boolean } {
    const c = this.db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
    if (!c) throw new Error(`No company "${symbol}".`);
    if (!(quantity > 0)) throw new Error('Quantity must be greater than zero.');
    if (!(avgCost > 0)) throw new Error('Average cost must be greater than zero.');
    this.db.prepare(`INSERT INTO portfolio (company_id,quantity,avg_cost,bought_at,note) VALUES (?,?,?,?,?)
      ON CONFLICT(company_id) DO UPDATE SET quantity=excluded.quantity, avg_cost=excluded.avg_cost, note=excluded.note`)
      .run(c.id, quantity, avgCost, Date.now(), note);
    return { ok: true };
  }

  removeHolding(symbol: string): boolean {
    const c = this.db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
    if (!c) return false;
    return this.db.prepare(`DELETE FROM portfolio WHERE company_id=?`).run(c.id).changes > 0;
  }

  portfolio(): {
    holdings: Array<{ symbol: string; name: string; sector: string; quantity: number; avgCost: number; price: number; value: number; cost: number; pnl: number; pnlPct: number; weightPct: number; note: string }>;
    summary: { holdings: number; value: number; cost: number; pnl: number; pnlPct: number; best: string | null; worst: string | null };
  } {
    const rows = this.db.prepare(`SELECT p.quantity, p.avg_cost, p.note, c.symbol, c.name, c.sector, v.price
      FROM portfolio p JOIN companies c ON c.id=p.company_id JOIN v_latest v ON v.id=c.id`).all() as Array<Record<string, unknown>>;
    const totalValue = rows.reduce((a, r) => a + Number(r['quantity']) * Number(r['price']), 0);
    const holdings = rows.map((r) => {
      const qty = Number(r['quantity']); const avg = Number(r['avg_cost']); const price = Number(r['price']);
      const value = Math.round(qty * price * 100) / 100; const cost = Math.round(qty * avg * 100) / 100;
      const pnl = Math.round((value - cost) * 100) / 100;
      return {
        symbol: String(r['symbol']), name: String(r['name']), sector: String(r['sector']),
        quantity: qty, avgCost: avg, price, value, cost, pnl,
        pnlPct: cost > 0 ? Math.round((pnl / cost) * 10000) / 100 : 0,
        weightPct: totalValue > 0 ? Math.round((value / totalValue) * 10000) / 100 : 0,
        note: String(r['note'] ?? ''),
      };
    }).sort((a, b) => b.value - a.value);
    const cost = holdings.reduce((a, h) => a + h.cost, 0);
    const pnl = Math.round((totalValue - cost) * 100) / 100;
    const best = holdings.length ? [...holdings].sort((a, b) => b.pnlPct - a.pnlPct)[0]!.symbol : null;
    const worst = holdings.length ? [...holdings].sort((a, b) => a.pnlPct - b.pnlPct)[0]!.symbol : null;
    return {
      holdings,
      summary: { holdings: holdings.length, value: Math.round(totalValue * 100) / 100, cost, pnl, pnlPct: cost > 0 ? Math.round((pnl / cost) * 10000) / 100 : 0, best, worst },
    };
  }
}
