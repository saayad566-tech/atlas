// Read-side queries: search, company detail, screener runs, peers.
import type { Database as DB } from 'better-sqlite3';
import { compileExpression } from './expr';
import type { Company, ScreenerRow } from './types';

export interface ScreenerResult {
  rows: ScreenerRow[];
  total: number;
  sql: string;
  params: unknown[];
  ms: number;
}

const SORTABLE: Record<string, string> = {
  market_cap: 'market_cap', price: 'price', pe: 'pe', pb: 'pb', roe: 'roe', roce: 'roce',
  debt_to_equity: 'debt_to_equity', sales: 'sales', net_profit: 'net_profit', opm: 'opm', npm: 'npm',
  eps: 'eps', dividend_yield: 'dividend_yield', promoter_holding: 'promoter_holding', pledge: 'pledge',
  current_ratio: 'current_ratio', interest_coverage: 'interest_coverage',
  sales_growth_3y: 'sales_growth_3y', profit_growth_3y: 'profit_growth_3y', asset_turnover: 'asset_turnover',
};

const ROW_COLUMNS = `id, symbol, name, sector, industry, source, market_cap, price, pe, pb, roe, roce, debt_to_equity,
  sales, net_profit, opm, npm, eps, dividend_yield, promoter_holding, pledge, current_ratio,
  interest_coverage, sales_growth_3y, profit_growth_3y, asset_turnover, cfo, cash`;

function toRow(r: Record<string, unknown>): ScreenerRow {
  return {
    id: Number(r['id']), symbol: String(r['symbol']), name: String(r['name']),
    sector: String(r['sector']), industry: String(r['industry']),
    // The data's provenance travels with the row so the UI can mark synthetic data.
    source: String(r['source'] ?? ''),
    marketCap: Number(r['market_cap']), price: Number(r['price']), pe: Number(r['pe']), pb: Number(r['pb']),
    roe: Number(r['roe']), roce: Number(r['roce']), debtToEquity: Number(r['debt_to_equity']),
    sales: Number(r['sales']), netProfit: Number(r['net_profit']), opm: Number(r['opm']), npm: Number(r['npm']),
    eps: Number(r['eps']), dividendYield: Number(r['dividend_yield']), promoterHolding: Number(r['promoter_holding']),
    pledge: Number(r['pledge']), currentRatio: Number(r['current_ratio']), interestCoverage: Number(r['interest_coverage']),
    salesGrowth3y: Number(r['sales_growth_3y']), profitGrowth3y: Number(r['profit_growth_3y']),
    assetTurnover: Number(r['asset_turnover']),
    cfo: Number(r['cfo']), cash: Number(r['cash']),
  };
}

export class Store {
  constructor(private db: DB) {}

  /** Search by symbol or name (prefix first, then substring). */
  search(q: string, limit = 12): Array<{ id: number; symbol: string; name: string; sector: string }> {
    const term = (q ?? '').trim();
    if (!term) return [];
    const like = `${term}%`;
    const rows = this.db.prepare(`
      SELECT id, symbol, name, sector FROM companies
      WHERE symbol LIKE ? OR name LIKE ? OR name LIKE ?
      ORDER BY (symbol LIKE ?) DESC, name ASC
      LIMIT ?`).all(like, like, `%${term}%`, like, limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({ id: Number(r['id']), symbol: String(r['symbol']), name: String(r['name']), sector: String(r['sector']) }));
  }

  company(symbol: string): {
    company: Company;
    annual: Array<Record<string, unknown>>;
    quarterly: Array<Record<string, unknown>>;
    ratios: Array<Record<string, unknown>>;
    shareholding: Array<Record<string, unknown>>;
    peers: Array<{ symbol: string; name: string; marketCap: number; pe: number; roe: number; rank: number }>;
    latest: ScreenerRow | null;
  } | null {
    const c = this.db.prepare(`SELECT * FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as Record<string, unknown> | undefined;
    if (!c) return null;
    const id = Number(c['id']);
    const annual = this.db.prepare(`SELECT * FROM statements WHERE company_id=? AND period_type='annual' ORDER BY period_end DESC`).all(id) as Array<Record<string, unknown>>;
    const quarterly = this.db.prepare(`SELECT * FROM statements WHERE company_id=? AND period_type='quarterly' ORDER BY period_end DESC`).all(id) as Array<Record<string, unknown>>;
    const ratios = this.db.prepare(`SELECT * FROM ratios WHERE company_id=? ORDER BY period_end DESC`).all(id) as Array<Record<string, unknown>>;
    const shareholding = this.db.prepare(`SELECT * FROM shareholding WHERE company_id=? ORDER BY period_end DESC`).all(id) as Array<Record<string, unknown>>;
    const peers = this.db.prepare(`
      SELECT c2.symbol, c2.name, COALESCE(q.market_cap,0) AS market_cap, COALESCE(q.pe,0) AS pe, COALESCE(r.roe,0) AS roe, p.rank
      FROM peers p JOIN companies c2 ON c2.id = p.peer_id
      LEFT JOIN quotes q ON q.company_id = c2.id
      LEFT JOIN ratios r ON r.company_id = c2.id AND r.period_type='annual'
        AND r.period_end = (SELECT MAX(period_end) FROM ratios WHERE company_id = c2.id AND period_type='annual')
      WHERE p.company_id = ? ORDER BY p.rank`).all(id) as Array<Record<string, unknown>>;
    const latestRow = this.db.prepare(`SELECT ${ROW_COLUMNS} FROM v_latest WHERE id=?`).get(id) as Record<string, unknown> | undefined;
    return {
      company: {
        id, symbol: String(c['symbol']), name: String(c['name']), sector: String(c['sector']),
        industry: String(c['industry']), currency: String(c['currency']), source: String(c['source']),
        listedOn: String(c['listed_on']), updatedAt: Number(c['updated_at']),
      },
      annual, quarterly, ratios, shareholding,
      peers: peers.map((p) => ({ symbol: String(p['symbol']), name: String(p['name']), marketCap: Number(p['market_cap']), pe: Number(p['pe']), roe: Number(p['roe']), rank: Number(p['rank']) })),
      latest: latestRow ? toRow(latestRow) : null,
    };
  }

  /** Run a screener expression (safe: compiled to SQL with bound parameters). */
  screener(expression: string, opts: { sort?: string; order?: 'asc' | 'desc'; limit?: number; offset?: number } = {}): ScreenerResult {
    const t0 = Date.now();
    const compiled = compileExpression(expression);
    const sortCol = SORTABLE[opts.sort ?? 'market_cap'] ?? 'market_cap';
    const dir = (opts.order ?? 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const limit = Math.max(1, Math.min(500, opts.limit ?? 100));
    const offset = Math.max(0, opts.offset ?? 0);
    const sql = `SELECT ${ROW_COLUMNS} FROM v_latest WHERE ${compiled.sql} ORDER BY ${sortCol} ${dir} LIMIT ? OFFSET ?`;
    const rows = this.db.prepare(sql).all(...compiled.params, limit, offset) as Array<Record<string, unknown>>;
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM v_latest WHERE ${compiled.sql}`).get(...compiled.params) as { n: number }).n;
    return { rows: rows.map(toRow), total, sql, params: compiled.params, ms: Date.now() - t0 };
  }

  sectors(): Array<{ sector: string; companies: number }> {
    return (this.db.prepare(`SELECT sector, COUNT(*) AS n FROM companies GROUP BY sector ORDER BY n DESC`).all() as Array<{ sector: string; n: number }>)
      .map((r) => ({ sector: r.sector, companies: r.n }));
  }

  stats(): { companies: number; statements: number; annual: number; quarterly: number; sources: Record<string, number>; sectors: number } {
    const one = (sql: string): number => Number((this.db.prepare(sql).get() as { n: number }).n);
    const src = this.db.prepare(`SELECT source, COUNT(*) AS n FROM companies GROUP BY source`).all() as Array<{ source: string; n: number }>;
    const sources: Record<string, number> = {};
    for (const s of src) sources[s.source] = s.n;
    return {
      companies: one(`SELECT COUNT(*) AS n FROM companies`),
      statements: one(`SELECT COUNT(*) AS n FROM statements`),
      annual: one(`SELECT COUNT(*) AS n FROM statements WHERE period_type='annual'`),
      quarterly: one(`SELECT COUNT(*) AS n FROM statements WHERE period_type='quarterly'`),
      sources,
      sectors: one(`SELECT COUNT(DISTINCT sector) AS n FROM companies`),
    };
  }
}
