// Deterministic demo dataset.
//
// IMPORTANT: these are SYNTHETIC companies and numbers, generated from a fixed
// seed so the app, its tests and its screenshots are reproducible offline. Every
// row is stamped `source: 'fixture'` and the UI labels it "Demo data". They are
// modelled on realistic shapes (margins, growth, leverage, balance-sheet identity)
// but they are not real filings. Real data comes from the EDGAR adapter in
// ingest.ts when the network allows it.
import type { Company, Statement, Ratios, Shareholding, Quote, PeriodType } from './types';

export interface GenOptions {
  companies?: number;
  seed?: number;
  years?: number;
  quarters?: number;
  /** Fiscal year of the most recent annual period. */
  lastFiscalYear?: number;
}

interface SectorProfile {
  sector: string;
  industries: string[];
  /** Name suffixes that read naturally for this sector. */
  suffixes: string[];
  growth: number;
  margin: number;
  debtRatio: number;
  taxPct: number;
  peBase: number;
  divYield: number;
  promoter: number;
}

const SECTORS: SectorProfile[] = [
  { sector: 'Information Technology', suffixes: ['Systems', 'Software', 'Technologies', 'Labs', 'Digital'], industries: ['Software', 'IT Services', 'SaaS'], growth: 0.13, margin: 0.24, debtRatio: 0.05, taxPct: 0.25, peBase: 26, divYield: 1.8, promoter: 0.52 },
  { sector: 'Financials', suffixes: ['Bank', 'Capital', 'Finance', 'Finserv', 'Investments'], industries: ['Private Bank', 'NBFC', 'Insurance'], growth: 0.11, margin: 0.30, debtRatio: 0.55, taxPct: 0.25, peBase: 16, divYield: 0.8, promoter: 0.35 },
  { sector: 'FMCG', suffixes: ['Foods', 'Consumer', 'Products', 'Beverages', 'Care'], industries: ['Packaged Foods', 'Personal Care', 'Beverages'], growth: 0.08, margin: 0.19, debtRatio: 0.10, taxPct: 0.25, peBase: 42, divYield: 1.6, promoter: 0.60 },
  { sector: 'Automobile', suffixes: ['Motors', 'Auto', 'Wheels', 'Vehicles', 'Auto Parts'], industries: ['Passenger Vehicles', 'Two Wheelers', 'Auto Parts'], growth: 0.09, margin: 0.14, debtRatio: 0.22, taxPct: 0.25, peBase: 22, divYield: 1.1, promoter: 0.48 },
  { sector: 'Pharmaceuticals', suffixes: ['Pharma', 'Labs', 'Remedies', 'Healthcare', 'Biotech'], industries: ['Generics', 'API', 'Hospitals'], growth: 0.10, margin: 0.21, debtRatio: 0.15, taxPct: 0.25, peBase: 30, divYield: 0.7, promoter: 0.45 },
  { sector: 'Cement', suffixes: ['Cement', 'Infra', 'Buildmat', 'Concrete'], industries: ['Cement', 'Building Materials'], growth: 0.07, margin: 0.17, debtRatio: 0.30, taxPct: 0.25, peBase: 28, divYield: 0.9, promoter: 0.55 },
  { sector: 'Steel & Metals', suffixes: ['Steel', 'Metals', 'Alloys', 'Iron', 'Rolling'], industries: ['Steel', 'Aluminium', 'Copper'], growth: 0.06, margin: 0.12, debtRatio: 0.48, taxPct: 0.25, peBase: 12, divYield: 1.4, promoter: 0.50 },
  { sector: 'Energy', suffixes: ['Energy', 'Power', 'Petro', 'Gas', 'Refining'], industries: ['Refining', 'Power', 'Gas'], growth: 0.05, margin: 0.13, debtRatio: 0.40, taxPct: 0.25, peBase: 11, divYield: 2.4, promoter: 0.58 },
  { sector: 'Telecom', suffixes: ['Telecom', 'Communications', 'Networks', 'Infocomm'], industries: ['Telecom Services'], growth: 0.04, margin: 0.16, debtRatio: 0.62, taxPct: 0.25, peBase: 34, divYield: 0.5, promoter: 0.46 },
  { sector: 'Consumer Durables', suffixes: ['Appliances', 'Electronics', 'Durables', 'Home'], industries: ['Appliances', 'Electronics'], growth: 0.09, margin: 0.15, debtRatio: 0.18, taxPct: 0.25, peBase: 38, divYield: 1.0, promoter: 0.62 },
];

const NAME_A = ['Apex', 'Bharat', 'Crest', 'Deccan', 'Elite', 'Fortis', 'Galaxy', 'Horizon', 'Indus', 'Jupiter', 'Kaveri', 'Lumina', 'Meridian', 'Nova', 'Orion', 'Pinnacle', 'Quantum', 'Radiant', 'Summit', 'Titan', 'Umbra', 'Vertex', 'Westwind', 'Xenon', 'Yamuna', 'Zenith'];

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (n: number, dp = 2): number => Math.round(n * 10 ** dp) / 10 ** dp;

function pad(n: number, w = 2): string { return String(n).padStart(w, '0'); }

export function generateDataset(opts: GenOptions = {}): {
  companies: Company[]; statements: Statement[]; ratios: Ratios[];
  shareholding: Shareholding[]; quotes: Quote[];
} {
  const n = Math.max(1, Math.min(5000, opts.companies ?? 200));
  const seed = opts.seed ?? 42;
  const years = Math.max(3, Math.min(15, opts.years ?? 10));
  const quarters = Math.max(0, Math.min(20, opts.quarters ?? 8));
  // The most recent COMPLETED fiscal year (Indian FY ends in March).
  const nowD = new Date();
  const lastFY = nowD.getMonth() >= 3 ? nowD.getFullYear() : nowD.getFullYear() - 1;
  const rand = rng(seed);

  const companies: Company[] = [];
  const statements: Statement[] = [];
  const ratios: Ratios[] = [];
  const shareholding: Shareholding[] = [];
  const quotes: Quote[] = [];

  const used = new Set<string>();
  for (let i = 0; i < n; i++) {
    const p = SECTORS[i % SECTORS.length]!;
    const a = NAME_A[Math.floor(rand() * NAME_A.length)]!;
    const b = p.suffixes[Math.floor(rand() * p.suffixes.length)]!;
    let symbol = `${a.slice(0, 3).toUpperCase()}${b.slice(0, 3).toUpperCase()}${pad(i + 1, 3)}`;
    while (used.has(symbol)) symbol = `${symbol}X`;
    used.add(symbol);

    const id = i + 1;
    const name = `${a} ${b}`;
    const industry = p.industries[Math.floor(rand() * p.industries.length)]!;
    companies.push({ id, symbol, name, sector: p.sector, industry, currency: 'INR', source: 'fixture', listedOn: 'NSE', updatedAt: Date.now() });

    // Company-specific character.
    const growth = p.growth * (0.6 + rand() * 0.9);
    const margin = p.margin * (0.75 + rand() * 0.5);
    const debtRatio = Math.max(0, p.debtRatio * (0.5 + rand() * 1.1));
    const baseSales = 300 + rand() * 40000;              // ₹ crore
    const shares = (baseSales / (30 + rand() * 120)) * 10; // crore shares (face ₹10)
    const equityCapital = shares * 10;
    let reserves = baseSales * (0.35 + rand() * 0.9);
    let prevSales = 0;
    let salesHistory: number[] = [];
    let profitHistory: number[] = [];

    // ---- annual series (oldest → newest) ----
    for (let y = 0; y < years; y++) {
      const fy = lastFY - (years - 1) + y;
      const periodEnd = `${fy}-03-31`;
      const drift = (rand() - 0.45) * 0.18;                    // some years are bad
      const sales = Math.max(20, baseSales * (1 + growth + drift) ** y * (0.95 + rand() * 0.1));
      const opmPct = Math.max(0.01, margin + (rand() - 0.5) * 0.05);
      const operatingProfit = sales * opmPct;
      const otherIncome = sales * (0.005 + rand() * 0.01);
      const borrowings = Math.max(0, sales * debtRatio * (0.8 + rand() * 0.4));
      const interest = borrowings * (0.075 + rand() * 0.03);
      const fixedAssets = sales * (0.35 + rand() * 0.25);
      const depreciation = fixedAssets * (0.07 + rand() * 0.02);
      const pbt = operatingProfit + otherIncome - interest - depreciation;
      const taxPct = p.taxPct;
      const netProfit = Math.max(-sales * 0.2, pbt * (1 - taxPct));
      const eps = netProfit / shares;
      const cwip = fixedAssets * (0.02 + rand() * 0.06);
      const investments = sales * (0.05 + rand() * 0.15);
      reserves = Math.max(0, reserves + netProfit * (0.6 + rand() * 0.2));
      const otherLiabilities = sales * (0.12 + rand() * 0.10);
      const totalLiabilities = equityCapital + reserves + borrowings + otherLiabilities;
      // Balance sheet must balance: other assets is the plug.
      const otherAssets = Math.max(0, totalLiabilities - fixedAssets - cwip - investments);
      const receivables = sales * (0.08 + rand() * 0.10);
      const inventory = sales * (0.06 + rand() * 0.12);
      const payables = sales * (0.07 + rand() * 0.09);
      const cash = Math.max(0, totalLiabilities * (0.03 + rand() * 0.06));
      const cfo = netProfit * (0.8 + rand() * 0.6) + depreciation;
      const cfi = -(fixedAssets * (0.08 + rand() * 0.10));
      const cff = borrowings * (rand() - 0.45) * 0.2 - netProfit * p.divYield * 0.1;
      const netCashFlow = cfo + cfi + cff;

      statements.push({
        companyId: id, periodType: 'annual', periodEnd, fiscalYear: fy, quarter: null,
        sales: round(sales), expenses: round(sales - operatingProfit), operatingProfit: round(operatingProfit),
        opmPct: round(opmPct * 100), otherIncome: round(otherIncome), interest: round(interest),
        depreciation: round(depreciation), profitBeforeTax: round(pbt), taxPct: round(taxPct * 100),
        netProfit: round(netProfit), eps: round(eps, 2), equityCapital: round(equityCapital), reserves: round(reserves),
        borrowings: round(borrowings), otherLiabilities: round(otherLiabilities), totalLiabilities: round(totalLiabilities),
        fixedAssets: round(fixedAssets), cwip: round(cwip), investments: round(investments), otherAssets: round(otherAssets),
        totalAssets: round(totalLiabilities), cfo: round(cfo), cfi: round(cfi), cff: round(cff), netCashFlow: round(netCashFlow),
        receivables: round(receivables), inventory: round(inventory), payables: round(payables), cash: round(cash),
      });

      // Price: a P/E that drifts a little each year.
      const pe = Math.max(4, p.peBase * (0.7 + rand() * 0.8));
      const price = Math.max(1, eps * pe);
      const marketCap = price * shares;
      const equity = equityCapital + reserves;
      ratios.push({
        companyId: id, periodType: 'annual', periodEnd,
        roe: round((netProfit / Math.max(1, equity)) * 100),
        roce: round((operatingProfit / Math.max(1, equity + borrowings)) * 100),
        debtToEquity: round(borrowings / Math.max(1, equity)),
        opm: round(opmPct * 100), npm: round((netProfit / Math.max(1, sales)) * 100),
        pe: round(pe), pb: round(marketCap / Math.max(1, equity)),
        dividendYield: round(p.divYield * (0.6 + rand() * 0.8)),
        marketCap: round(marketCap), currentRatio: round(1 + rand() * 1.6),
        interestCoverage: round(operatingProfit / Math.max(0.01, interest)),
        assetTurnover: round(sales / Math.max(1, totalLiabilities)),
        salesGrowth3y: 0, profitGrowth3y: 0,
      });

      salesHistory.push(sales); profitHistory.push(netProfit);
      prevSales = sales;
    }
    void prevSales;

    // 3-year CAGR on the newest annual rows.
    const cagr = (series: number[]): number => {
      if (series.length < 4) return 0;
      const end = series[series.length - 1]!;
      const start = series[series.length - 4]!;
      if (start <= 0 || end <= 0) return 0;
      return round(((end / start) ** (1 / 3) - 1) * 100);
    };
    const sG = cagr(salesHistory); const pG = cagr(profitHistory);
    for (const r of ratios) if (r.companyId === id) { r.salesGrowth3y = sG; r.profitGrowth3y = pG; }

    // ---- quarterly series (newest `quarters`) ----
    const lastAnnual = statements.filter((s) => s.companyId === id && s.periodType === 'annual').at(-1)!;
    for (let q = 0; q < quarters; q++) {
      const monthsBack = (quarters - q) * 3;
      const d = new Date(Date.UTC(lastFY, 2, 31));
      d.setUTCMonth(d.getUTCMonth() - monthsBack);
      const periodEnd = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate())}`;
      const fq = Math.floor((d.getUTCMonth() + 1) / 3) || 4;
      const qSales = (lastAnnual.sales / 4) * (0.85 + rand() * 0.3);
      const qOpm = Math.max(0.01, margin * 0.95 + (rand() - 0.5) * 0.05);
      const qOp = qSales * qOpm;
      const qInterest = lastAnnual.interest / 4;
      const qDep = lastAnnual.depreciation / 4;
      const qPbt = qOp + lastAnnual.otherIncome / 4 - qInterest - qDep;
      const qNet = qPbt * (1 - p.taxPct);
      statements.push({
        ...lastAnnual, periodType: 'quarterly' as PeriodType, periodEnd, quarter: fq,
        sales: round(qSales), expenses: round(qSales - qOp), operatingProfit: round(qOp), opmPct: round(qOpm * 100),
        interest: round(qInterest), depreciation: round(qDep), profitBeforeTax: round(qPbt), netProfit: round(qNet),
        eps: round(qNet / shares, 2), cfo: round(qNet * 0.9), cfi: round(-qDep * 0.8), cff: round(0), netCashFlow: round(qNet * 0.9 - qDep * 0.8),
      });
    }

    // ---- shareholding (4 half-yearly points) ----
    const promoter = Math.min(0.89, Math.max(0.12, p.promoter * (0.85 + rand() * 0.3)));
    const pledge = rand() < 0.18 ? round(rand() * 35, 1) : 0; // a minority pledge their stake
    for (let k = 0; k < 4; k++) {
      const fy = lastFY - k;
      const fii = Math.min(0.4, 0.03 + rand() * 0.22);
      const dii = Math.min(0.35, 0.02 + rand() * 0.18);
      shareholding.push({
        companyId: id, periodEnd: `${fy}-03-31`,
        promoter: round(promoter * 100, 1), fii: round(fii * 100, 1), dii: round(dii * 100, 1),
        public: round(Math.max(0, 100 - promoter * 100 - fii * 100 - dii * 100), 1),
        pledgePct: k === 0 ? pledge : 0,
      });
    }

    const latest = ratios.filter((r) => r.companyId === id).at(-1)!;
    quotes.push({ companyId: id, price: round(latest.marketCap / shares, 2), marketCap: latest.marketCap, pe: latest.pe, updatedAt: Date.now() });
  }

  return { companies, statements, ratios, shareholding, quotes };
}
