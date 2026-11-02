// Domain types for Sift.

export type PeriodType = 'annual' | 'quarterly';

export interface Company {
  id: number;
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  currency: string;
  /** Where the row came from: 'fixture' (bundled demo) or 'edgar' (live). */
  source: string;
  listedOn: string;
  updatedAt: number;
}

export interface Statement {
  companyId: number;
  periodType: PeriodType;
  periodEnd: string;
  fiscalYear: number;
  quarter: number | null;
  sales: number;
  expenses: number;
  operatingProfit: number;
  opmPct: number;
  otherIncome: number;
  interest: number;
  depreciation: number;
  profitBeforeTax: number;
  taxPct: number;
  netProfit: number;
  eps: number;
  equityCapital: number;
  reserves: number;
  borrowings: number;
  otherLiabilities: number;
  totalLiabilities: number;
  fixedAssets: number;
  cwip: number;
  investments: number;
  otherAssets: number;
  totalAssets: number;
  cfo: number;
  cfi: number;
  cff: number;
  netCashFlow: number;
  receivables: number;
  inventory: number;
  payables: number;
  cash: number;
}

export interface Ratios {
  companyId: number;
  periodType: PeriodType;
  periodEnd: string;
  roe: number;
  roce: number;
  debtToEquity: number;
  opm: number;
  npm: number;
  pe: number;
  pb: number;
  dividendYield: number;
  marketCap: number;
  currentRatio: number;
  interestCoverage: number;
  assetTurnover: number;
  salesGrowth3y: number;
  profitGrowth3y: number;
}

export interface Shareholding {
  companyId: number;
  periodEnd: string;
  promoter: number;
  fii: number;
  dii: number;
  public: number;
  pledgePct: number;
}

export interface Quote {
  companyId: number;
  price: number;
  marketCap: number;
  pe: number;
  updatedAt: number;
}

/** A row of the screener's flat "latest snapshot" view. */
export interface ScreenerRow {
  /**
   * Every ratio is nullable because it genuinely can be missing: a company with no earnings
   * has no P/E, and an impossible value is rejected at the sanity boundary. Declaring these
   * as `number` would force a lie somewhere — either 0 (which reads as a real reading) or a
   * cast. Null says "unknown" and the UI can show a dash.
   */
  cfo?: number | null;
  cash?: number | null;
  /** Provenance: 'fixture' means synthetic demo data; anything else is a real source. */
  source?: string;
  id: number;
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  marketCap: number | null;
  price: number | null;
  pe: number | null;
  pb: number | null;
  roe: number | null;
  roce: number | null;
  debtToEquity: number | null;
  sales: number | null;
  netProfit: number | null;
  opm: number | null;
  npm: number | null;
  eps: number | null;
  dividendYield: number | null;
  promoterHolding: number | null;
  pledge: number | null;
  currentRatio: number | null;
  interestCoverage: number | null;
  salesGrowth3y: number | null;
  profitGrowth3y: number | null;
  assetTurnover: number | null;
}


export interface RedFlag {
  code: string;
  severity: 'high' | 'medium' | 'low';
  label: string;
  detail: string;
}

export interface HealthReport {
  symbol: string;
  score: number;
  verdict: 'strong' | 'fair' | 'weak';
  flags: RedFlag[];
  summary: string;
}
