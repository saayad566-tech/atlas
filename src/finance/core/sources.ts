// Data sources: World Bank macro (live, free), Yahoo prices (live, free, unofficial),
// and CSV import so a user can bring their own filings.
//
// Each network call is optional and fails softly: Sift works with zero network.
import type { Database as DB } from 'better-sqlite3';
import { refreshLatest, refreshLatestFor } from './db';

// ---- World Bank ------------------------------------------------------------

export interface MacroPoint { indicator: string; country: string; year: number; value: number }

/** Parse the World Bank v2 response: [meta, [{date, value, indicator, country}]]. */
export function parseWorldBank(json: unknown): MacroPoint[] {
  if (!Array.isArray(json) || json.length < 2) return [];
  const rows = json[1];
  if (!Array.isArray(rows)) return [];
  const out: MacroPoint[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    // A missing observation must be skipped, never coerced to 0.
    if (r['value'] === null || r['value'] === undefined || r['value'] === '') continue;
    const value = Number(r['value']);
    const year = Number(r['date']);
    const ind = (r['indicator'] as { id?: string } | undefined)?.id ?? String(r['indicator'] ?? '');
    const country = (r['country'] as { id?: string } | undefined)?.id ?? String(r['country'] ?? '');
    if (Number.isFinite(value) && Number.isFinite(year) && ind) out.push({ indicator: ind, country, year, value });
  }
  return out;
}

const WB_INDICATORS: Record<string, string> = {
  'NY.GDP.MKTP.KD.ZG': 'GDP growth (%)',
  'FP.CPI.TOTL.ZG': 'Inflation, CPI (%)',
  'SL.UEM.TOTL.ZS': 'Unemployment (%)',
  'NE.GDI.TOTL.ZS': 'Gross capital formation (% GDP)',
  'BN.CAB.XOKA.GD.ZS': 'Current account balance (% GDP)',
};

export async function fetchWorldBank(
  db: DB, country = 'IN', fetchImpl: typeof fetch = fetch, indicators: string[] = Object.keys(WB_INDICATORS),
): Promise<{ inserted: number; indicators: Array<{ id: string; label: string; latest: MacroPoint | null }> }> {
  let inserted = 0;
  const results: Array<{ id: string; label: string; latest: MacroPoint | null }> = [];
  const ins = db.prepare(`INSERT INTO macro (indicator,country,year,value,fetched_at) VALUES (?,?,?,?,?)
    ON CONFLICT(indicator,country,year) DO UPDATE SET value=excluded.value, fetched_at=excluded.fetched_at`);
  for (const id of indicators) {
    try {
      const url = `https://api.worldbank.org/v2/country/${country}/indicator/${id}?format=json&per_page=20`;
      const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) { results.push({ id, label: WB_INDICATORS[id] ?? id, latest: null }); continue; }
      const points = parseWorldBank(await res.json()).filter((p) => p.year >= 2000);
      for (const p of points) { ins.run(p.indicator, p.country || country, p.year, p.value, Date.now()); inserted++; }
      const latest = points.sort((a, b) => b.year - a.year)[0] ?? null;
      results.push({ id, label: WB_INDICATORS[id] ?? id, latest });
    } catch { results.push({ id, label: WB_INDICATORS[id] ?? id, latest: null }); }
  }
  return { inserted, indicators: results };
}

export function macroSeries(db: DB, country: string): Array<{ indicator: string; label: string; points: Array<{ year: number; value: number }> }> {
  const rows = db.prepare(`SELECT indicator, year, value FROM macro WHERE country=? ORDER BY indicator, year`).all(country) as Array<{ indicator: string; year: number; value: number }>;
  const byInd = new Map<string, Array<{ year: number; value: number }>>();
  for (const r of rows) {
    if (!byInd.has(r.indicator)) byInd.set(r.indicator, []);
    byInd.get(r.indicator)!.push({ year: r.year, value: r.value });
  }
  return [...byInd.entries()].map(([indicator, points]) => ({ indicator, label: WB_INDICATORS[indicator] ?? indicator, points }));
}

// ---- Yahoo (prices) --------------------------------------------------------

/** Extract a last price from the Yahoo chart response. Pure, so it is testable. */
export function parseYahooChart(json: unknown): { price: number; currency: string } | null {
  const j = json as { chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; currency?: string } }> } } | undefined;
  const meta = j?.chart?.result?.[0]?.meta;
  if (!meta || typeof meta.regularMarketPrice !== 'number') return null;
  return { price: meta.regularMarketPrice, currency: meta.currency ?? '' };
}

export async function refreshQuote(db: DB, symbol: string, fetchImpl: typeof fetch = fetch): Promise<{ symbol: string; price: number; currency: string } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
    const res = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; Sift/1.0)' } });
    if (!res.ok) return null;
    const parsed = parseYahooChart(await res.json());
    if (!parsed) return null;
    const c = db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
    if (!c) return null;
    const row = db.prepare(`SELECT market_cap, pe, price FROM quotes WHERE company_id=?`).get(c.id) as { market_cap: number; pe: number; price: number } | undefined;
    const shares = row && row.price > 0 ? row.market_cap / row.price : 0;
    db.prepare(`INSERT INTO quotes (company_id,price,market_cap,pe,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(company_id) DO UPDATE SET price=excluded.price, market_cap=excluded.market_cap, updated_at=excluded.updated_at`)
      .run(c.id, parsed.price, shares > 0 ? parsed.price * shares : (row?.market_cap ?? 0), row?.pe ?? 0, Date.now());
    return { symbol, price: parsed.price, currency: parsed.currency };
  } catch { return null; }
}

// ---- CSV import ------------------------------------------------------------

const NUMERIC_FIELDS = ['sales', 'expenses', 'operating_profit', 'opm_pct', 'other_income', 'interest', 'depreciation',
  'profit_before_tax', 'tax_pct', 'net_profit', 'eps', 'equity_capital', 'reserves', 'borrowings', 'other_liabilities',
  'total_liabilities', 'fixed_assets', 'cwip', 'investments', 'other_assets', 'total_assets', 'cfo', 'cfi', 'cff',
  'net_cash_flow', 'receivables', 'inventory', 'payables', 'cash'];

function splitCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/** Parse a CSV of annual statements into rows keyed by header. Pure and testable. */
export function parseStatementCsv(text: string): { rows: Array<Record<string, string>>; errors: string[] } {
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], errors: ['CSV needs a header row and at least one data row.'] };
  const header = splitCsvLine(lines[0]!).map((h) => h.toLowerCase().replace(/\s+/g, '_'));
  if (!header.includes('symbol')) errors.push('Missing required column: symbol');
  // A row may describe only a company (symbol/name/sector) — a symbol universe is a
  // legitimate import. Statements are optional; if period_end is present, sales is too.
  const hasStatements = header.includes('period_end');
  if (hasStatements && !header.includes('sales')) errors.push('Missing required column: sales (required when period_end is present)');
  if (errors.length) return { rows: [], errors };
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!);
    const row: Record<string, string> = {};
    header.forEach((h, idx) => { row[h] = cells[idx] ?? ''; });
    if (!row['symbol']) { errors.push(`Row ${i + 1}: missing symbol`); continue; }
    rows.push(row);
  }
  return { rows, errors };
}

/** Recompute ratios for a company from its latest annual statement. */
export function recomputeRatios(db: DB, companyId: number, price?: number): void {
  const s = db.prepare(`SELECT * FROM statements WHERE company_id=? AND period_type='annual' ORDER BY period_end DESC`).all(companyId) as Array<Record<string, unknown>>;
  if (!s.length) return;
  const cur = s[0]!;
  const equity = Number(cur['equity_capital'] ?? 0) + Number(cur['reserves'] ?? 0);
  const net = Number(cur['net_profit'] ?? 0);
  const sales = Number(cur['sales'] ?? 0);
  const op = Number(cur['operating_profit'] ?? 0);
  const borrow = Number(cur['borrowings'] ?? 0);
  const interest = Number(cur['interest'] ?? 0);
  const shares = equity > 0 ? equity / 10 : 0;
  const eps = shares > 0 ? net / shares : 0;
  const px = price ?? 0;
  const pe = eps > 0 && px > 0 ? px / eps : 0;
  const mc = shares > 0 && px > 0 ? shares * px : 0;
  const g3 = (series: number[]): number => {
    if (series.length < 4) return 0;
    const a = series[series.length - 4]!; const b = series[series.length - 1]!;
    return a > 0 && b > 0 ? ((b / a) ** (1 / 3) - 1) * 100 : 0;
  };
  const salesSeries = s.map((r) => Number(r['sales'] ?? 0)).reverse();
  const profitSeries = s.map((r) => Number(r['net_profit'] ?? 0)).reverse();
  db.prepare(`INSERT OR REPLACE INTO ratios (company_id,period_type,period_end,roe,roce,debt_to_equity,opm,npm,pe,pb,dividend_yield,market_cap,current_ratio,interest_coverage,asset_turnover,sales_growth_3y,profit_growth_3y)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    companyId, 'annual', String(cur['period_end']),
    equity > 0 ? (net / equity) * 100 : 0,
    equity + borrow > 0 ? (op / (equity + borrow)) * 100 : 0,
    equity > 0 ? borrow / equity : 0,
    sales > 0 ? (op / sales) * 100 : 0,
    sales > 0 ? (net / sales) * 100 : 0,
    pe, equity > 0 && mc > 0 ? mc / equity : 0, 0, mc,
    Number(cur['payables'] ?? 0) > 0 ? (Number(cur['receivables'] ?? 0) + Number(cur['inventory'] ?? 0) + Number(cur['cash'] ?? 0)) / Number(cur['payables']) : 0,
    interest > 0 ? op / interest : 0,
    Number(cur['total_assets'] ?? 0) > 0 ? sales / Number(cur['total_assets'] ?? 1) : 0,
    g3(salesSeries), g3(profitSeries),
  );  refreshLatestFor(db, companyId);
}

/** Import a statements CSV. Creates companies as needed, upserts statements, recomputes ratios. */
export function importStatementCsv(db: DB, text: string): { companies: number; statements: number; errors: string[] } {
  const { rows, errors } = parseStatementCsv(text);
  let companies = 0; let statements = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      const symbol = r['symbol']!.toUpperCase();
      let c = db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=?`).get(symbol) as { id: number } | undefined;
      if (!c) {
        const id = (db.prepare(`SELECT COALESCE(MAX(id),0)+1 AS n FROM companies`).get() as { n: number }).n;
        db.prepare(`INSERT INTO companies (id,symbol,name,sector,industry,currency,source,listed_on,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(id, symbol, r['name'] || symbol, r['sector'] || 'Unclassified', r['industry'] || 'Unclassified', r['currency'] || 'INR', 'import', r['listed_on'] || 'CSV', Date.now());
        c = { id }; companies++;
      }
      const periodEnd = r['period_end'];
      if (!periodEnd) { continue; }   // company-only row: added to the universe, no statement
      const fy = Number(r['fiscal_year'] || periodEnd.slice(0, 4));
      const vals: Record<string, number> = {};
      for (const f of NUMERIC_FIELDS) vals[f] = r[f] === undefined || r[f] === '' ? 0 : Number(r[f]);
      db.prepare(`INSERT OR REPLACE INTO statements (company_id,period_type,period_end,fiscal_year,quarter,${NUMERIC_FIELDS.join(',')})
        VALUES (?,?,?,?,?,${NUMERIC_FIELDS.map(() => '?').join(',')})`)
        .run(c.id, 'annual', periodEnd, fy, null, ...NUMERIC_FIELDS.map((f) => vals[f]!));
      statements++;
      const price = r['price'] ? Number(r['price']) : undefined;
      recomputeRatios(db, c.id, price);
    }
  });
  tx();
  refreshLatest(db);
  return { companies, statements, errors };
}

export const WORLD_BANK_CATALOGUE = WB_INDICATORS;

// ---- backup & restore ------------------------------------------------------

const TABLES = ['companies', 'statements', 'ratios', 'shareholding', 'peers', 'quotes', 'macro', 'saved_screens', 'watchlist', 'notes'] as const;

/** Export the whole local database as one JSON document. */
export function exportDatabase(db: DB): { version: number; exportedAt: number; tables: Record<string, unknown[]> } {
  const tables: Record<string, unknown[]> = {};
  for (const t of TABLES) tables[t] = db.prepare(`SELECT * FROM ${t}`).all() as unknown[];
  return { version: 2, exportedAt: Date.now(), tables };
}

/** Restore from an export. Replaces rows in the listed tables. */
export function importDatabase(db: DB, doc: { version?: number; tables?: Record<string, unknown[]> }): { restored: Record<string, number> } {
  const restored: Record<string, number> = {};
  const tables = doc.tables ?? {};
  const tx = db.transaction(() => {
    for (const t of TABLES) {
      const rows = tables[t];
      if (!Array.isArray(rows) || rows.length === 0) continue;
      db.prepare(`DELETE FROM ${t}`).run();
      const cols = Object.keys(rows[0] as Record<string, unknown>);
      const stmt = db.prepare(`INSERT OR REPLACE INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
      for (const r of rows) stmt.run(...cols.map((c) => (r as Record<string, unknown>)[c] ?? null));
      restored[t] = rows.length;
    }
  });
  tx();
  return { restored };
}
