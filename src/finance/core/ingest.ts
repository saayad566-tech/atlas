// Data ingestion: the bundled fixture pack, and a live EDGAR adapter.
import type { Database as DB } from 'better-sqlite3';
import { refreshLatest } from './db';
import { generateDataset, type GenOptions } from './dataset';
import { ensureLiveTables } from './live';
import { ensureProfiles } from './profile';
import { generateDemoMarketData } from './demoMarket';
import { ensureMarketTables } from './marketdata';
import type { Statement } from './types';

/** Load the deterministic demo dataset, replacing any existing fixture rows. */
export function ingestFixture(db: DB, opts: GenOptions = {}): { companies: number; statements: number; ms: number } {
  const t0 = Date.now();
  const data = generateDataset(opts);
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM companies WHERE source = 'fixture'`).run();
    const insC = db.prepare(`INSERT OR REPLACE INTO companies (id,symbol,name,sector,industry,currency,source,listed_on,updated_at)
      VALUES (@id,@symbol,@name,@sector,@industry,@currency,@source,@listedOn,@updatedAt)`);
    for (const c of data.companies) insC.run(c);
    const insS = db.prepare(`INSERT OR REPLACE INTO statements
      (company_id,period_type,period_end,fiscal_year,quarter,sales,expenses,operating_profit,opm_pct,other_income,interest,
       depreciation,profit_before_tax,tax_pct,net_profit,eps,equity_capital,reserves,borrowings,other_liabilities,total_liabilities,
       fixed_assets,cwip,investments,other_assets,total_assets,cfo,cfi,cff,net_cash_flow,receivables,inventory,payables,cash)
      VALUES (@companyId,@periodType,@periodEnd,@fiscalYear,@quarter,@sales,@expenses,@operatingProfit,@opmPct,@otherIncome,@interest,
       @depreciation,@profitBeforeTax,@taxPct,@netProfit,@eps,@equityCapital,@reserves,@borrowings,@otherLiabilities,@totalLiabilities,
       @fixedAssets,@cwip,@investments,@otherAssets,@totalAssets,@cfo,@cfi,@cff,@netCashFlow,@receivables,@inventory,@payables,@cash)`);
    for (const s of data.statements) insS.run(s);
    const insR = db.prepare(`INSERT OR REPLACE INTO ratios
      (company_id,period_type,period_end,roe,roce,debt_to_equity,opm,npm,pe,pb,dividend_yield,market_cap,current_ratio,
       interest_coverage,asset_turnover,sales_growth_3y,profit_growth_3y)
      VALUES (@companyId,@periodType,@periodEnd,@roe,@roce,@debtToEquity,@opm,@npm,@pe,@pb,@dividendYield,@marketCap,@currentRatio,
       @interestCoverage,@assetTurnover,@salesGrowth3y,@profitGrowth3y)`);
    for (const r of data.ratios) insR.run(r);
    const insH = db.prepare(`INSERT OR REPLACE INTO shareholding (company_id,period_end,promoter,fii,dii,public,pledge_pct)
      VALUES (@companyId,@periodEnd,@promoter,@fii,@dii,@public,@pledgePct)`);
    for (const h of data.shareholding) insH.run(h);
    const insQ = db.prepare(`INSERT OR REPLACE INTO quotes (company_id,price,market_cap,pe,updated_at) VALUES (@companyId,@price,@marketCap,@pe,@updatedAt)`);
    for (const q of data.quotes) insQ.run(q);
    // Peers: top 5 by market cap within the same sector.
    db.prepare(`DELETE FROM peers`).run();
    const insP = db.prepare(`INSERT OR REPLACE INTO peers (company_id,peer_id,rank) VALUES (?,?,?)`);
    for (const c of data.companies) {
      const same = data.quotes
        .map((q) => ({ id: q.companyId, mc: q.marketCap }))
        .filter((x) => x.id !== c.id && data.companies.find((cc) => cc.id === x.id)?.sector === c.sector)
        .sort((a, b) => b.mc - a.mc)
        .slice(0, 5);
      same.forEach((x, i) => insP.run(c.id, x.id, i + 1));
    }
  });
  tx();
  // A deterministic daily price series per company, so price analytics is available for
  // the demo pack too (otherwise those panels are empty for every demo stock).
  ensureLiveTables(db);
  ensureMarketTables(db);   // price_volume lives here
  const priceTx = db.transaction(() => {
    const ins = db.prepare(`INSERT OR REPLACE INTO price_history (company_id,date,close,open,high,low,volume) VALUES (?,?,?,?,?,?,?)`);
    const insVol = db.prepare(`INSERT OR REPLACE INTO price_volume (company_id,date,volume) VALUES (?,?,?)`);
    const today = Date.now();
    for (const q of data.quotes) {
      let px = q.price > 0 ? q.price : 100;
      let seed = (q.companyId * 2654435761) >>> 0;
      const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const series: Array<{ date: string; close: number; open: number; high: number; low: number }> = [];
      for (let i = 399; i >= 0; i--) {   // > 1 year so 1y returns resolve
        const drift = (rnd() - 0.5) * 0.03;
        const prev = px;
        px = Math.max(1, px * (1 + drift));
        // Synthetic OHLC around the close, so candle/ATR views have honest inputs in demo.
        const open = Math.round(prev * 100) / 100;
        const close = Math.round(px * 100) / 100;
        const spread = Math.abs(close - open) + Math.max(0.5, close * 0.006);
        const high = Math.round((Math.max(open, close) + spread * 0.5) * 100) / 100;
        const low = Math.round(Math.max(0.01, Math.min(open, close) - spread * 0.5) * 100) / 100;
        series.push({ date: new Date(today - i * 86400000).toISOString().slice(0, 10), close, open, high, low });
      }
      // Deterministic volume, scaled by size: bigger companies trade more.
      const baseVol = Math.max(5000, Math.round((q.marketCap > 0 ? q.marketCap : 1000) * 1200));
      let vseed = (q.companyId * 40503 + 7) >>> 0;
      const vrand = (): number => { vseed = (vseed * 1664525 + 1013904223) >>> 0; return vseed / 4294967296; };
      for (const row of series) {
        const vol = Math.round(baseVol * (0.6 + vrand() * 0.9));
        ins.run(q.companyId, row.date, row.close, row.open, row.high, row.low, vol);
        insVol.run(q.companyId, row.date, vol);
      }
    }
  });
  priceTx();
  // Every company needs an intelligence profile, otherwise the tabs are empty.
  ensureProfiles(db);
  // Analysts, dividends, calendar, estimates, ownership — so every panel has data.
  refreshLatest(db);
  const market = generateDemoMarketData(db);
  void market;
  return { companies: data.companies.length, statements: data.statements.length, ms: Date.now() - t0 };
}

// ---- EDGAR (live, free, official) ------------------------------------------

export interface EdgarFacts {
  cik: number;
  entityName: string;
  facts: Record<string, Record<string, { units: Record<string, Array<{ end: string; val: number; fy?: number; fp?: string; form?: string; filed?: string }>> }>>;
}

const EDGAR_TAGS: Record<string, string> = {
  Revenues: 'sales',
  RevenueFromContractWithCustomerExcludingAssessedTax: 'sales',
  NetIncomeLoss: 'netProfit',
  OperatingIncomeLoss: 'operatingProfit',
  InterestExpense: 'interest',
  DepreciationDepletionAndAmortization: 'depreciation',
  Assets: 'totalAssets',
  Liabilities: 'totalLiabilities',
  StockholdersEquity: 'equity',
  CashAndCashEquivalentsAtCarryingValue: 'cash',
  NetCashProvidedByUsedInOperatingActivities: 'cfo',
};

/** Pure mapping of EDGAR companyfacts → annual statements. Tested without network. */
export function normaliseEdgarFacts(json: EdgarFacts): { symbol: string; name: string; annual: Partial<Statement>[] } {
  const usGaap = json.facts['us-gaap'] ?? {};
  const pick = (tag: string): Map<string, number> => {
    const out = new Map<string, number>();
    const fact = usGaap[tag];
    if (!fact) return out;
    const units = fact['units']?.['USD'] ?? [];
    for (const row of units) {
      if (row.form && row.form !== '10-K') continue;
      if (row.fp && row.fp !== 'FY') continue;
      if (!row.end) continue;
      // Keep the latest filing value for each period end.
      out.set(row.end, row.val);
    }
    return out;
  };
  const series = new Map<string, Partial<Statement>>();
  for (const [tag, field] of Object.entries(EDGAR_TAGS)) {
    const m = pick(tag);
    for (const [end, val] of m) {
      const row = series.get(end) ?? { periodEnd: end, periodType: 'annual', quarter: null };
      (row as Record<string, unknown>)[field] = val;
      series.set(end, row);
    }
  }
  const annual = [...series.values()]
    .filter((r) => r.periodEnd && (r.sales !== undefined || r.netProfit !== undefined))
    .sort((a, b) => String(a.periodEnd).localeCompare(String(b.periodEnd)))
    .map((r) => ({
      ...r,
      fiscalYear: Number(String(r.periodEnd).slice(0, 4)),
      expenses: (r.sales ?? 0) - (r.operatingProfit ?? 0),
      operatingProfit: r.operatingProfit ?? (r.sales ?? 0) - (r.expenses ?? 0),
      totalAssets: r.totalAssets ?? 0,
      totalLiabilities: r.totalLiabilities ?? 0,
    }));
  return { symbol: `CIK${String(json.cik).padStart(10, '0')}`, name: json.entityName, annual };
}

/** Fetch one company from SEC EDGAR (free, official, no key). Network-dependent. */
export async function ingestEdgar(db: DB, cik: number, fetchImpl: typeof fetch = fetch): Promise<{ symbol: string; periods: number }> {
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`;
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'Sift/1.0 (local research; contact@example.com)', Accept: 'application/json' } });
  if (!res.ok) throw new Error(`EDGAR returned ${res.status} for CIK ${cik}`);
  const json = (await res.json()) as EdgarFacts;
  const norm = normaliseEdgarFacts(json);
  if (norm.annual.length === 0) throw new Error(`EDGAR returned no annual 10-K facts for CIK ${cik}`);

  const existing = db.prepare(`SELECT id FROM companies WHERE symbol=?`).get(norm.symbol) as { id: number } | undefined;
  const id = existing?.id ?? ((db.prepare(`SELECT COALESCE(MAX(id),0)+1 AS n FROM companies`).get() as { n: number }).n);
  db.prepare(`INSERT OR REPLACE INTO companies (id,symbol,name,sector,industry,currency,source,listed_on,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(id, norm.symbol, norm.name, 'Unclassified', 'US Listed', 'USD', 'edgar', 'SEC', Date.now());
  const ins = db.prepare(`INSERT OR REPLACE INTO statements (company_id,period_type,period_end,fiscal_year,quarter,sales,expenses,operating_profit,net_profit,cfo,cash,total_assets,total_liabilities)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const a of norm.annual) {
    ins.run(id, 'annual', a.periodEnd, a.fiscalYear ?? 0, null, a.sales ?? 0, a.expenses ?? 0, a.operatingProfit ?? 0, a.netProfit ?? 0, a.cfo ?? 0, a.cash ?? 0, a.totalAssets ?? 0, a.totalLiabilities ?? 0);
  }
  return { symbol: norm.symbol, periods: norm.annual.length };
}
