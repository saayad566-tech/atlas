// Fundamentals history pipeline.
//
// Yahoo's quoteSummary is a snapshot; its timeseries endpoint gives several years of
// annual and quarterly statements. This module maps that into the same `statements`
// table the demo pack uses, so EVERY analysis function (DuPont, CCC, Piotroski,
// Altman, Beneish, DCF, CAGR, factors) works identically for a live stock.
import type { Database as DB } from 'better-sqlite3';
import type { YahooClient } from './yahoo';

export const ANNUAL_TYPES = [
  'TotalRevenue', 'GrossProfit', 'EBITDA', 'OperatingIncome', 'PretaxIncome', 'TaxProvision',
  'NetIncome', 'DilutedEPS', 'InterestExpense', 'ReconciledDepreciation', 'OperatingCashFlow',
  'CapitalExpenditure', 'FreeCashFlow', 'TotalAssets', 'TotalLiabilitiesNetMinorityInterest',
  'StockholdersEquity', 'TotalDebt', 'LongTermDebt', 'CashAndCashEquivalents', 'CashCashEquivalentsAndShortTermInvestments',
  'Inventory', 'AccountsReceivable', 'AccountsPayable', 'CurrentAssets', 'CurrentLiabilities',
  'NetPPE', 'OtherShortTermInvestments',
];

export const QUARTERLY_TYPES = [
  'TotalRevenue', 'GrossProfit', 'EBITDA', 'OperatingIncome', 'PretaxIncome', 'NetIncome',
  'DilutedEPS', 'OperatingCashFlow', 'TotalAssets', 'StockholdersEquity', 'TotalDebt', 'CurrentAssets', 'CurrentLiabilities',
];

export interface Point { date: string; value: number }
export type Series = Record<string, Point[]>;

/** Parse the fundamentals-timeseries response into { type: [{date, value}] }. */
export function parseTimeseries(json: unknown): Series {
  const out: Series = {};
  const results = (json as { timeseries?: { result?: Array<Record<string, unknown>> } } | undefined)?.timeseries?.result;
  if (!Array.isArray(results)) return out;
  for (const r of results) {
    const meta = (r['meta'] ?? {}) as { type?: string[] };
    const rawType = meta.type?.[0] ?? Object.keys(r).find((k) => k !== 'meta' && k !== 'timestamp');
    if (!rawType) continue;
    // Yahoo returns "annualTotalRevenue" / "quarterlyTotalRevenue"; normalise to the bare type.
    const type = rawType.replace(/^(annual|quarterly)/, '');
    // Index the response with the ORIGINAL key, store under the normalised one.
    const rows = r[rawType];
    if (!Array.isArray(rows)) continue;
    const points: Point[] = [];
    for (const row of rows as Array<Record<string, unknown>>) {
      const date = typeof row['asOfDate'] === 'string' ? row['asOfDate'] : null;
      const rv = row['reportedValue'] as { raw?: number } | undefined;
      const value = typeof rv?.raw === 'number' ? rv.raw : null;
      if (date && value !== null) points.push({ date, value });
    }
    points.sort((a, b) => a.date.localeCompare(b.date));
    out[type] = points;
  }
  return out;
}

const at = (s: Series, type: string, date: string): number | null => {
  const p = s[type];
  if (!p) return null;
  const hit = p.find((x) => x.date === date);
  return hit ? hit.value : null;
};
const first = (s: Series, ...types: string[]): string | null => {
  for (const t of types) if (s[t] && s[t]!.length) return t;
  return null;
};

export interface BuiltStatement {
  periodType: 'annual' | 'quarterly';
  periodEnd: string;
  fiscalYear: number;
  quarter: number | null;
  sales: number; expenses: number; operatingProfit: number; opmPct: number; otherIncome: number;
  interest: number; depreciation: number; profitBeforeTax: number; taxPct: number; netProfit: number; eps: number;
  equityCapital: number; reserves: number; borrowings: number; otherLiabilities: number; totalLiabilities: number;
  fixedAssets: number; cwip: number; investments: number; otherAssets: number; totalAssets: number;
  cfo: number; cfi: number; cff: number; netCashFlow: number;
  receivables: number; inventory: number; payables: number; cash: number;
}

/** Map the parsed series onto statement rows. Pure, so it is testable offline. */
export function buildStatements(s: Series, periodType: 'annual' | 'quarterly'): BuiltStatement[] {
  const revenueType = first(s, 'TotalRevenue');
  if (!revenueType) return [];
  const dates = [...new Set(s[revenueType]!.map((p) => p.date))].sort();
  const rows: BuiltStatement[] = [];
  for (const date of dates) {
    const sales = at(s, 'TotalRevenue', date) ?? 0;
    if (sales <= 0) continue;
    const ebitda = at(s, 'EBITDA', date) ?? at(s, 'OperatingIncome', date) ?? at(s, 'GrossProfit', date) ?? 0;
    const netProfit = at(s, 'NetIncome', date) ?? 0;
    const pretax = at(s, 'PretaxIncome', date) ?? 0;
    const tax = at(s, 'TaxProvision', date) ?? 0;
    const equity = at(s, 'StockholdersEquity', date) ?? 0;
    const debt = at(s, 'TotalDebt', date) ?? at(s, 'LongTermDebt', date) ?? 0;
    const assets = at(s, 'TotalAssets', date) ?? 0;
    const liabilities = at(s, 'TotalLiabilitiesNetMinorityInterest', date) ?? Math.max(0, assets - equity);
    const cash = at(s, 'CashAndCashEquivalents', date) ?? at(s, 'CashCashEquivalentsAndShortTermInvestments', date) ?? 0;
    const ppe = at(s, 'NetPPE', date) ?? 0;
    const cfo = at(s, 'OperatingCashFlow', date) ?? 0;
    const capex = at(s, 'CapitalExpenditure', date) ?? 0;
    const eps = at(s, 'DilutedEPS', date) ?? (netProfit && equity ? 0 : 0);
    const fiscalYear = Number(date.slice(0, 4));
    const month = Number(date.slice(5, 7));
    const quarter = periodType === 'quarterly' ? Math.max(1, Math.min(4, Math.ceil(month / 3))) : null;
    const interest = Math.abs(at(s, 'InterestExpense', date) ?? 0);
    const depreciation = Math.abs(at(s, 'ReconciledDepreciation', date) ?? 0);

    rows.push({
      periodType, periodEnd: date, fiscalYear, quarter,
      sales, expenses: Math.max(0, sales - ebitda), operatingProfit: ebitda,
      opmPct: sales > 0 ? (ebitda / sales) * 100 : 0,
      otherIncome: 0, interest, depreciation,
      profitBeforeTax: pretax || (ebitda - interest - depreciation),
      taxPct: pretax > 0 ? (tax / pretax) * 100 : 0,
      netProfit, eps,
      // Equity capital and reserves are not separated in the source; keep it in reserves
      // and derive the share count from EPS where possible (see recomputeAllRatios).
      equityCapital: 0, reserves: equity, borrowings: debt,
      // Yahoo's "total liabilities net minority interest" excludes equity, while our
      // schema's total_liabilities is the whole funding side (assets = liabilities).
      otherLiabilities: Math.max(0, liabilities - debt),
      totalLiabilities: assets || (equity + debt + Math.max(0, liabilities - debt)),
      fixedAssets: ppe, cwip: 0, investments: 0,
      otherAssets: Math.max(0, (assets || equity + debt) - ppe),
      totalAssets: assets || (equity + debt),
      cfo, cfi: capex, cff: 0, netCashFlow: cfo + capex,
      receivables: at(s, 'AccountsReceivable', date) ?? 0,
      inventory: at(s, 'Inventory', date) ?? 0,
      payables: at(s, 'AccountsPayable', date) ?? 0,
      cash,
    });
  }
  return rows;
}

/** Write built statements, then recompute ratios for every period. */
/** The database stores crore-equivalents (1 crore = 1e7 units of the currency). */
const CRORE = 1e7;
const MONETARY: Array<keyof BuiltStatement> = ['sales', 'expenses', 'operatingProfit', 'otherIncome', 'interest', 'depreciation',
  'profitBeforeTax', 'netProfit', 'equityCapital', 'reserves', 'borrowings', 'otherLiabilities', 'totalLiabilities',
  'fixedAssets', 'cwip', 'investments', 'otherAssets', 'totalAssets', 'cfo', 'cfi', 'cff', 'netCashFlow',
  'receivables', 'inventory', 'payables', 'cash'];

export function toCrore(rows: BuiltStatement[]): BuiltStatement[] {
  return rows.map((r) => {
    const out = { ...r };
    // No rounding here: 2 dp would turn a small crore figure (0.0001) into 0.
    for (const k of MONETARY) (out as unknown as Record<string, number>)[k] = (r[k] as number) / CRORE;
    return out; // eps stays per-share
  });
}

export function storeHistory(db: DB, symbol: string, rowsIn: BuiltStatement[], price: number): { stored: number; periods: number } {
  const rows = toCrore(rowsIn);
  const c = db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
  if (!c) return { stored: 0, periods: 0 };
  const cols = ['company_id', 'period_type', 'period_end', 'fiscal_year', 'quarter', 'sales', 'expenses', 'operating_profit', 'opm_pct',
    'other_income', 'interest', 'depreciation', 'profit_before_tax', 'tax_pct', 'net_profit', 'eps', 'equity_capital', 'reserves',
    'borrowings', 'other_liabilities', 'total_liabilities', 'fixed_assets', 'cwip', 'investments', 'other_assets', 'total_assets',
    'cfo', 'cfi', 'cff', 'net_cash_flow', 'receivables', 'inventory', 'payables', 'cash'];
  const stmt = db.prepare(`INSERT OR REPLACE INTO statements (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
  const tx = db.transaction(() => {
    for (const r of rows) {
      stmt.run(c.id, r.periodType, r.periodEnd, r.fiscalYear, r.quarter, r.sales, r.expenses, r.operatingProfit, r.opmPct,
        r.otherIncome, r.interest, r.depreciation, r.profitBeforeTax, r.taxPct, r.netProfit, r.eps, r.equityCapital, r.reserves,
        r.borrowings, r.otherLiabilities, r.totalLiabilities, r.fixedAssets, r.cwip, r.investments, r.otherAssets, r.totalAssets,
        r.cfo, r.cfi, r.cff, r.netCashFlow, r.receivables, r.inventory, r.payables, r.cash);
    }
  });
  tx();
  recomputeAllRatios(db, c.id, price);
  // The live snapshot row (dated today) is only a placeholder for companies with no
  // statements. Once real fiscal periods exist it would distort P/E bands, so drop it.
  const annualDates = rows.filter((r) => r.periodType === 'annual').map((r) => r.periodEnd);
  if (annualDates.length > 0) {
    const placeholders = db.prepare(`SELECT period_end FROM ratios WHERE company_id=? AND period_type='annual'`).all(c.id) as Array<{ period_end: string }>;
    for (const p2 of placeholders) {
      if (!annualDates.includes(p2.period_end)) db.prepare(`DELETE FROM ratios WHERE company_id=? AND period_type='annual' AND period_end=?`).run(c.id, p2.period_end);
    }
  }
  const periods = (db.prepare(`SELECT COUNT(*) AS n FROM statements WHERE company_id=? AND period_type='annual'`).get(c.id) as { n: number }).n;
  return { stored: rows.length, periods };
}

/** Recompute the ratios table for every stored annual period of a company. */
export function recomputeAllRatios(db: DB, companyId: number, price: number): number {
  const rows = db.prepare(`SELECT * FROM statements WHERE company_id=? AND period_type='annual' ORDER BY period_end ASC`).all(companyId) as Array<Record<string, number | string>>;
  if (rows.length === 0) return 0;
  const salesSeries = rows.map((r) => Number(r['sales'] ?? 0));
  const profitSeries = rows.map((r) => Number(r['net_profit'] ?? 0));
  const g3 = (series: number[]): number => {
    if (series.length < 4) return 0;
    const a = series[series.length - 4]!; const b = series[series.length - 1]!;
    return a > 0 && b > 0 ? ((b / a) ** (1 / 3) - 1) * 100 : 0;
  };
  const ins = db.prepare(`INSERT OR REPLACE INTO ratios
    (company_id,period_type,period_end,roe,roce,debt_to_equity,opm,npm,pe,pb,dividend_yield,market_cap,current_ratio,interest_coverage,asset_turnover,sales_growth_3y,profit_growth_3y)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  let n = 0;
  for (const r of rows) {
    const sales = Number(r['sales'] ?? 0);
    const net = Number(r['net_profit'] ?? 0);
    const op = Number(r['operating_profit'] ?? 0);
    const equity = Number(r['equity_capital'] ?? 0) + Number(r['reserves'] ?? 0);
    const debt = Number(r['borrowings'] ?? 0);
    const interest = Number(r['interest'] ?? 0);
    const eps = Number(r['eps'] ?? 0);
    // Share count from EPS when the source gives one (more reliable than a face value).
    const shares = eps > 0 && net > 0 ? net / eps : equity > 0 ? equity / 10 : 0;
    const pe = eps > 0 && price > 0 ? price / eps : 0;
    const mc = shares > 0 && price > 0 ? shares * price : 0;
    const currentAssets = Number(r['receivables'] ?? 0) + Number(r['inventory'] ?? 0) + Number(r['cash'] ?? 0);
    const currentLiabilities = Number(r['payables'] ?? 0);
    ins.run(companyId, 'annual', String(r['period_end']),
      equity > 0 ? (net / equity) * 100 : 0,
      equity + debt > 0 ? (op / (equity + debt)) * 100 : 0,
      equity > 0 ? debt / equity : 0,
      sales > 0 ? (op / sales) * 100 : 0,
      sales > 0 ? (net / sales) * 100 : 0,
      pe, equity > 0 && mc > 0 ? mc / equity : 0, 0, mc,
      currentLiabilities > 0 ? currentAssets / currentLiabilities : 0,
      interest > 0 ? op / interest : 0,
      Number(r['total_assets'] ?? 0) > 0 ? sales / Number(r['total_assets'] ?? 1) : 0,
      g3(salesSeries), g3(profitSeries));
    n++;
  }
  return n;
}

/** Fetch annual + quarterly history for a symbol and store it. */
export async function fetchAndStoreHistory(db: DB, client: YahooClient, symbol: string, price: number, years = 6): Promise<{ annual: number; quarterly: number; periods: number }> {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - Math.floor(years * 365.25 * 86400);
  const url = (prefix: string, types: string[]): string =>
    `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}` +
    `?symbol=${encodeURIComponent(symbol)}&type=${types.map((t) => prefix + t).join(',')}&period1=${p1}&period2=${p2}`;

  const annual = await client.raw(url('annual', ANNUAL_TYPES));
  const annualRows = annual ? buildStatements(parseTimeseries(annual), 'annual') : [];
  const quarterly = await client.raw(url('quarterly', QUARTERLY_TYPES));
  const quarterlyRows = quarterly ? buildStatements(parseTimeseries(quarterly), 'quarterly') : [];

  const a = storeHistory(db, symbol, annualRows, price);
  storeHistory(db, symbol, quarterlyRows, price);
  return { annual: annualRows.length, quarterly: quarterlyRows.length, periods: a.periods };
}

/** How much history a company has — drives the "needs data" state in the UI. */
export function coverage(db: DB, symbol: string): { annual: number; quarterly: number; years: number; ready: boolean } {
  const c = db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
  if (!c) return { annual: 0, quarterly: 0, years: 0, ready: false };
  const annual = (db.prepare(`SELECT COUNT(*) AS n FROM statements WHERE company_id=? AND period_type='annual'`).get(c.id) as { n: number }).n;
  const quarterly = (db.prepare(`SELECT COUNT(*) AS n FROM statements WHERE company_id=? AND period_type='quarterly'`).get(c.id) as { n: number }).n;
  const span = db.prepare(`SELECT MIN(period_end) AS a, MAX(period_end) AS b FROM statements WHERE company_id=? AND period_type='annual'`).get(c.id) as { a: string | null; b: string | null };
  const years = span.a && span.b ? Math.max(0, Number(span.b.slice(0, 4)) - Number(span.a.slice(0, 4)) + 1) : 0;
  // Piotroski needs 2 annual periods; trends need 3.
  return { annual, quarterly, years, ready: annual >= 2 };
}
