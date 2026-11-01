// Company intelligence: what a business does, where it operates, what it has
// committed to, and what could go wrong.
//
// HONESTY: the bundled pack is SYNTHETIC, generated deterministically per company
// and labelled `source: 'generated'`. Real text can be pulled from Wikipedia (free,
// no key) or imported as JSON — both overwrite the generated row and set the source.
import type { Database as DB } from 'better-sqlite3';
import { loadSeries } from './metrics';
import { httpsGetJson } from './net';

export const PROFILE_DDL = `
CREATE TABLE IF NOT EXISTS company_profiles (
  company_id INTEGER PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  founded_year INTEGER, hq_city TEXT, hq_country TEXT, employees INTEGER, website TEXT,
  auditor TEXT, registrar TEXT, business_model TEXT, moat_score INTEGER, moat_notes TEXT,
  source TEXT NOT NULL DEFAULT 'generated', updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS segments (company_id INTEGER NOT NULL, name TEXT NOT NULL, revenue_pct REAL, margin_pct REAL, growth_pct REAL, PRIMARY KEY (company_id, name));
CREATE TABLE IF NOT EXISTS geographies (company_id INTEGER NOT NULL, region TEXT NOT NULL, revenue_pct REAL, PRIMARY KEY (company_id, region));
CREATE TABLE IF NOT EXISTS order_book (company_id INTEGER NOT NULL, as_of TEXT NOT NULL, order_book_cr REAL, book_to_bill REAL, executable_12m_pct REAL, notes TEXT, PRIMARY KEY (company_id, as_of));
CREATE TABLE IF NOT EXISTS guidance (company_id INTEGER NOT NULL, period TEXT NOT NULL, metric TEXT NOT NULL, guided_value REAL, unit TEXT, commentary TEXT, issued_at TEXT, PRIMARY KEY (company_id, period, metric));
CREATE TABLE IF NOT EXISTS facilities (company_id INTEGER NOT NULL, name TEXT NOT NULL, location TEXT, kind TEXT, capacity_note TEXT, PRIMARY KEY (company_id, name));
CREATE TABLE IF NOT EXISTS subsidiaries (company_id INTEGER NOT NULL, name TEXT NOT NULL, stake_pct REAL, country TEXT, PRIMARY KEY (company_id, name));
CREATE TABLE IF NOT EXISTS corporate_actions (company_id INTEGER NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT, PRIMARY KEY (company_id, date, kind));
CREATE TABLE IF NOT EXISTS announcements (company_id INTEGER NOT NULL, date TEXT NOT NULL, title TEXT NOT NULL, category TEXT, summary TEXT, PRIMARY KEY (company_id, date, title));
CREATE TABLE IF NOT EXISTS risks (company_id INTEGER NOT NULL, code TEXT NOT NULL, severity TEXT NOT NULL, description TEXT, PRIMARY KEY (company_id, code));
CREATE TABLE IF NOT EXISTS products (company_id INTEGER NOT NULL, name TEXT NOT NULL, category TEXT, description TEXT, PRIMARY KEY (company_id, name));
`;

interface SectorCopy {
  what: string;
  products: string[];
  segments: string[];
  regions: string[];
  facility: string;
  risk: Array<[string, 'high' | 'medium' | 'low', string]>;
  model: string;
  orderBook: boolean;
}

const SECTOR_COPY: Record<string, SectorCopy> = {
  'Information Technology': {
    what: 'provides software engineering, cloud migration and managed-services work for enterprises',
    products: ['Application modernisation', 'Cloud platforms', 'Data & AI', 'Managed services', 'Testing'],
    segments: ['Digital', 'Cloud', 'Legacy services', 'Products'],
    regions: ['North America', 'Europe', 'India', 'Rest of world'],
    facility: 'Development centre', model: 'B2B services',
    orderBook: true,
    risk: [
      ['client-concentration', 'medium', 'A few large clients can swing revenue.'],
      ['visa-dependence', 'medium', 'Onsite delivery depends on work-visa availability.'],
      ['currency', 'low', 'Revenue is largely USD/EUR against an INR cost base.'],
    ],
  },
  Financials: {
    what: 'lends to retail and corporate borrowers and earns a spread on its book',
    products: ['Retail lending', 'Corporate banking', 'Treasury', 'Fee income'],
    segments: ['Retail', 'Corporate', 'Treasury', 'Other'],
    regions: ['India'],
    facility: 'Branch', model: 'B2C lending',
    orderBook: false,
    risk: [
      ['credit-quality', 'high', 'A rising NPA cycle would hit provisioning.'],
      ['rate-sensitivity', 'medium', 'Margins compress if funding costs outrun lending rates.'],
      ['regulatory', 'medium', 'Priority-sector and capital rules can change the growth path.'],
    ],
  },
  FMCG: {
    what: 'manufactures and distributes packaged consumer goods through a distributor network',
    products: ['Packaged foods', 'Personal care', 'Beverages', 'Home care'],
    segments: ['Foods', 'Personal care', 'Beverages', 'Exports'],
    regions: ['India', 'South Asia', 'Middle East', 'Africa'],
    facility: 'Plant', model: 'B2C branded',
    orderBook: false,
    risk: [
      ['input-cost', 'high', 'Palm oil and packaging costs move margins quickly.'],
      ['rural-demand', 'medium', 'Rural volume growth is sensitive to rainfall and wages.'],
      ['competition', 'medium', 'Regional brands compete on price in mass segments.'],
    ],
  },
  Automobile: {
    what: 'designs, manufactures and sells vehicles and automotive components',
    products: ['Passenger vehicles', 'Two-wheelers', 'Components', 'Aftermarket'],
    segments: ['Vehicles', 'Components', 'Spares', 'Exports'],
    regions: ['India', 'Africa', 'Latin America', 'Europe'],
    facility: 'Plant', model: 'B2C cyclical',
    orderBook: true,
    risk: [
      ['demand-cycle', 'high', 'Vehicle demand is cyclical and rate-sensitive.'],
      ['ev-transition', 'medium', 'Capital is needed to retool for electrification.'],
      ['commodity', 'medium', 'Steel and aluminium costs pass through with a lag.'],
    ],
  },
  Pharmaceuticals: {
    what: 'develops, manufactures and sells generic and branded medicines',
    products: ['Generics', 'APIs', 'Branded formulations', 'Contract manufacturing'],
    segments: ['Generics', 'API', 'Branded', 'CDMO'],
    regions: ['India', 'USA', 'Europe', 'Emerging markets'],
    facility: 'Formulation plant', model: 'B2B regulated',
    orderBook: true,
    risk: [
      ['regulatory', 'high', 'Plant inspections can stop shipments to regulated markets.'],
      ['price-erosion', 'high', 'Generic prices erode a few percent a year.'],
      ['litigation', 'medium', 'Patent challenges carry contingent liability.'],
    ],
  },
  Cement: {
    what: 'manufactures cement and building materials, sold regionally from plants',
    products: ['Cement', 'Ready-mix concrete', 'Aggregates'],
    segments: ['Cement', 'RMC', 'Other'],
    regions: ['North', 'West', 'South', 'East'],
    facility: 'Kiln', model: 'B2B commodity',
    orderBook: false,
    risk: [
      ['freight', 'high', 'Cement is freight-heavy; logistics costs decide the margin.'],
      ['fuel-cost', 'high', 'Coal and petcoke are the dominant variable cost.'],
      ['regional-price', 'medium', 'Price discipline breaks down when capacity is added.'],
    ],
  },
  'Steel & Metals': {
    what: 'produces steel and metal products for construction and industry',
    products: ['Flat products', 'Long products', 'Alloys', 'By-products'],
    segments: ['Steel', 'Alloys', 'Mining', 'Trading'],
    regions: ['India', 'Asia', 'Europe', 'Middle East'],
    facility: 'Integrated works', model: 'B2B cyclical',
    orderBook: true,
    risk: [
      ['commodity-cycle', 'high', 'Realisation swings with global steel prices.'],
      ['leverage', 'high', 'Capital intensity keeps debt high through downturns.'],
      ['imports', 'medium', 'Cheap imports pressure domestic pricing.'],
    ],
  },
  Energy: {
    what: 'refines, generates or distributes energy and related products',
    products: ['Refined fuels', 'Power', 'Gas', 'Petrochemicals'],
    segments: ['Refining', 'Marketing', 'Power', 'Other'],
    regions: ['India', 'Middle East', 'Africa'],
    facility: 'Refinery', model: 'B2B regulated',
    orderBook: false,
    risk: [
      ['crude-price', 'high', 'Crude price and subsidy policy drive realised margins.'],
      ['regulation', 'high', 'Tariffs and duties are set administratively.'],
      ['capex-execution', 'medium', 'Large projects carry schedule and cost risk.'],
    ],
  },
  Telecom: {
    what: 'operates a mobile and broadband network and sells connectivity and data services',
    products: ['Mobile', 'Broadband', 'Enterprise connectivity', 'Digital services'],
    segments: ['Mobile', 'Broadband', 'Enterprise', 'Other'],
    regions: ['India'],
    facility: 'Network hub', model: 'B2C subscription',
    orderBook: false,
    risk: [
      ['arpu-pressure', 'high', 'Price competition compresses revenue per user.'],
      ['spectrum', 'high', 'Spectrum renewals require large periodic outlays.'],
      ['capex', 'medium', 'Network rollout is capital intensive.'],
    ],
  },
  'Consumer Durables': {
    what: 'manufactures and sells appliances and consumer electronics',
    products: ['Appliances', 'Electronics', 'Kitchen', 'Fans & lighting'],
    segments: ['Appliances', 'Electronics', 'Others'],
    regions: ['India', 'Middle East', 'Africa', 'South Asia'],
    facility: 'Plant', model: 'B2C discretionary',
    orderBook: false,
    risk: [
      ['discretionary-demand', 'high', 'Purchases defer when incomes tighten.'],
      ['competition', 'medium', 'Global brands compete hard in premium segments.'],
      ['channel', 'low', 'Channel inventory can distort reported growth.'],
    ],
  },
};

const CITIES = ['Mumbai', 'Pune', 'Bengaluru', 'Chennai', 'Hyderabad', 'Ahmedabad', 'Kolkata', 'Delhi', 'Jaipur', 'Surat'];
const AUDITORS = ['Deloitte Haskins', 'B S R & Co', 'Ernst & Young', 'Price Waterhouse', 'Walker Chandiok', 'S R Batliboi'];
const REGISTRARS = ['Link Intime', 'KFin Technologies', 'CAMS', 'Bigshare Services'];

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = <T>(r: () => number, arr: T[]): T => arr[Math.floor(r() * arr.length)]!;
const round = (n: number, dp = 1): number => Math.round(n * 10 ** dp) / 10 ** dp;

/** Moat score 0–100 from margin stability, returns on capital, scale and spread. */
export function moatScore(db: DB, companyId: number): { score: number; notes: string } {
  const s = loadSeries(db, companyId);
  if (s.length < 3) return { score: 40, notes: 'Too little history to judge durability.' };
  const latest = s[s.length - 1]!;
  const equity = latest.equityCapital + latest.reserves;
  const roce = equity + latest.borrowings > 0 ? (latest.operatingProfit / (equity + latest.borrowings)) * 100 : 0;
  const margins = s.slice(-5).map((x) => x.opmPct);
  const mean = margins.reduce((a, b) => a + b, 0) / margins.length;
  const sd = Math.sqrt(margins.reduce((a, b) => a + (b - mean) ** 2, 0) / margins.length);
  let score = 0;
  score += Math.min(35, Math.max(0, roce / 30 * 35));       // returns on capital
  score += Math.min(30, Math.max(0, mean / 25 * 30));        // absolute margin
  score += Math.min(20, Math.max(0, (5 - Math.min(5, sd)) / 5 * 20)); // margin stability
  score += Math.min(15, Math.max(0, latest.sales / 20000 * 15));      // scale
  const notes = [
    `ROCE ${round(roce)}% contributes ${Math.round(Math.min(35, Math.max(0, roce / 30 * 35)))}/35.`,
    `Operating margin ${round(mean)}% (σ ${round(sd)}) contributes ${Math.round(Math.min(30, Math.max(0, mean / 25 * 30)) + Math.min(20, Math.max(0, (5 - Math.min(5, sd)) / 5 * 20)))}/50.`,
    `Scale ₹${Math.round(latest.sales)} Cr contributes ${Math.round(Math.min(15, Math.max(0, latest.sales / 20000 * 15)))}/15.`,
  ];
  return { score: Math.round(score), notes: notes.join(' ') };
}

/** Generate and store a deterministic intelligence pack for every company. */
export function ensureProfiles(db: DB, opts: { force?: boolean } = {}): { profiles: number; generated: number } {
  db.exec(PROFILE_DDL);
  const companies = db.prepare(`SELECT c.id, c.symbol, c.name, c.sector, c.industry, c.source FROM companies c`).all() as Array<{ id: number; symbol: string; name: string; sector: string; industry: string; source: string }>;
  const existing = new Set((db.prepare(`SELECT company_id FROM company_profiles`).all() as Array<{ company_id: number }>).map((r) => r.company_id));
  let generated = 0;
  for (const c of companies) {
    if (existing.has(c.id) && !opts.force) continue;
    // A live company gets its description from the real source; generating segments,
    // order books and guidance for it would be fiction presented as fact.
    if (c.source !== 'fixture' && !opts.force) continue;
    generateFor(db, c);
    generated++;
  }
  return { profiles: companies.length, generated };
}

function generateFor(db: DB, c: { id: number; symbol: string; name: string; sector: string; industry: string }): void {
  const copy = SECTOR_COPY[c.sector] ?? SECTOR_COPY['Information Technology']!;
  const r = rng(c.id * 7919 + 13);
  const s = loadSeries(db, c.id);
  const latest = s[s.length - 1];
  const sales = latest?.sales ?? 1000;
  const city = pick(r, CITIES);
  const founded = 1955 + Math.floor(r() * 55);
  const employees = Math.round((sales * 10000000) / (2000000 + r() * 3000000));
  const moat = moatScore(db, c.id);

  db.prepare(`INSERT OR REPLACE INTO company_profiles
    (company_id, description, founded_year, hq_city, hq_country, employees, website, auditor, registrar, business_model, moat_score, moat_notes, source, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    c.id,
    `${c.name} ${copy.what}. It operates in ${c.industry.toLowerCase()} within the ${c.sector.toLowerCase()} sector, with reported revenue of about ₹${Math.round(sales)} crore in the latest year.`,
    founded, city, 'India', employees, `https://www.${c.symbol.toLowerCase()}.example`,
    pick(r, AUDITORS), pick(r, REGISTRARS), copy.model, moat.score, moat.notes, 'generated', Date.now(),
  );

  // Segments with a revenue split that sums to ~100%.
  db.prepare(`DELETE FROM segments WHERE company_id=?`).run(c.id);
  const n = copy.segments.length;
  let remaining = 100;
  copy.segments.forEach((name, i) => {
    const pct = i === n - 1 ? remaining : Math.max(5, Math.round((remaining / (n - i)) * (0.7 + r() * 0.6)));
    remaining -= pct;
    db.prepare(`INSERT OR REPLACE INTO segments (company_id,name,revenue_pct,margin_pct,growth_pct) VALUES (?,?,?,?,?)`)
      .run(c.id, name, pct, round(8 + r() * 22), round(-4 + r() * 26));
  });

  db.prepare(`DELETE FROM geographies WHERE company_id=?`).run(c.id);
  const regions = copy.regions;
  let remG = 100;
  regions.forEach((region, i) => {
    const pct = i === regions.length - 1 ? remG : Math.max(3, Math.round((remG / (regions.length - i)) * (0.6 + r() * 0.8)));
    remG -= pct;
    db.prepare(`INSERT OR REPLACE INTO geographies (company_id,region,revenue_pct) VALUES (?,?,?)`).run(c.id, region, pct);
  });

  db.prepare(`DELETE FROM products WHERE company_id=?`).run(c.id);
  for (const p of copy.products) {
    db.prepare(`INSERT OR REPLACE INTO products (company_id,name,category,description) VALUES (?,?,?,?)`)
      .run(c.id, p, c.industry, `${p} offered to ${copy.model.startsWith('B2C') ? 'consumers' : 'business customers'}.`);
  }

  // Order book (only for businesses that actually carry one).
  db.prepare(`DELETE FROM order_book WHERE company_id=?`).run(c.id);
  if (copy.orderBook) {
    const ob = sales * (0.4 + r() * 1.4);
    for (let k = 0; k < 3; k++) {
      const fy = 2025 - k;
      const value = ob * (0.75 + r() * 0.5) * (1 - k * 0.12);
      db.prepare(`INSERT OR REPLACE INTO order_book (company_id,as_of,order_book_cr,book_to_bill,executable_12m_pct,notes) VALUES (?,?,?,?,?,?)`)
        .run(c.id, `${fy}-03-31`, round(value), round(0.7 + r() * 1.1, 2), round(45 + r() * 40), `Order inflow in FY${fy} was ${round(value * (0.8 + r() * 0.5))} Cr.`);
    }
  }

  // Guidance: revenue and margin guidance for the current year.
  db.prepare(`DELETE FROM guidance WHERE company_id=?`).run(c.id);
  if (latest) {
    db.prepare(`INSERT OR REPLACE INTO guidance (company_id,period,metric,guided_value,unit,commentary,issued_at) VALUES (?,?,?,?,?,?,?)`)
      .run(c.id, 'FY26', 'Revenue growth', round(4 + r() * 18), '%', 'Management expects volume-led growth with stable realisations.', '2025-05-20');
    db.prepare(`INSERT OR REPLACE INTO guidance (company_id,period,metric,guided_value,unit,commentary,issued_at) VALUES (?,?,?,?,?,?,?)`)
      .run(c.id, 'FY26', 'Operating margin', round(latest.opmPct * (0.9 + r() * 0.2)), '%', 'Margin guidance assumes input costs stay in the current band.', '2025-05-20');
    db.prepare(`INSERT OR REPLACE INTO guidance (company_id,period,metric,guided_value,unit,commentary,issued_at) VALUES (?,?,?,?,?,?,?)`)
      .run(c.id, 'FY26', 'Capex', round(sales * (0.03 + r() * 0.08)), '₹ Cr', 'Planned capacity and maintenance capital expenditure.', '2025-05-20');
  }

  // Facilities
  db.prepare(`DELETE FROM facilities WHERE company_id=?`).run(c.id);
  const facCount = 2 + Math.floor(r() * 4);
  for (let k = 0; k < facCount; k++) {
    const loc = pick(r, CITIES);
    db.prepare(`INSERT OR REPLACE INTO facilities (company_id,name,location,kind,capacity_note) VALUES (?,?,?,?,?)`)
      .run(c.id, `${copy.facility} ${k + 1}`, `${loc}, India`, copy.facility, `${Math.round(20 + r() * 80)}% utilisation`);
  }

  // Subsidiaries
  db.prepare(`DELETE FROM subsidiaries WHERE company_id=?`).run(c.id);
  for (const region of regions.slice(1, 3)) {
    db.prepare(`INSERT OR REPLACE INTO subsidiaries (company_id,name,stake_pct,country) VALUES (?,?,?,?)`)
      .run(c.id, `${c.name} ${region} Ltd`, round(51 + r() * 49), region === 'Europe' ? 'Netherlands' : region === 'USA' || region === 'North America' ? 'United States' : 'India');
  }

  // Corporate actions
  db.prepare(`DELETE FROM corporate_actions WHERE company_id=?`).run(c.id);
  for (let k = 0; k < 3; k++) {
    const yr = 2025 - k;
    const kind = pick(r, ['Dividend', 'Buyback', 'Bonus', 'Split']);
    db.prepare(`INSERT OR REPLACE INTO corporate_actions (company_id,date,kind,detail) VALUES (?,?,?,?)`)
      .run(c.id, `${yr}-06-15`, kind, kind === 'Dividend' ? `₹${round(1 + r() * 20)} per share` : kind === 'Split' ? 'Face value split 10 → 2' : kind === 'Bonus' ? '1:1 bonus issue' : `₹${Math.round(50 + r() * 400)} Cr buyback`);
  }

  // Announcements
  db.prepare(`DELETE FROM announcements WHERE company_id=?`).run(c.id);
  const news: Array<[string, string, string]> = [
    ['Board approves capacity expansion', 'Capex', `The board approved ₹${Math.round(sales * (0.05 + r() * 0.1))} Cr for additional capacity, commissioning over 18–24 months.`],
    ['Quarterly results announced', 'Results', `Revenue grew ${round(2 + r() * 14)}% year on year with an operating margin of ${round((latest?.opmPct ?? 15))}%.`],
    ['New order wins', 'Orders', `The company reported order intake of ₹${Math.round(sales * (0.2 + r() * 0.5))} Cr across ${pick(r, regions)}.`],
    ['Credit rating reaffirmed', 'Rating', 'The rating agency reaffirmed the long-term rating with a stable outlook.'],
  ];
  news.forEach(([title, category, summary], k) => {
    db.prepare(`INSERT OR REPLACE INTO announcements (company_id,date,title,category,summary) VALUES (?,?,?,?,?)`)
      .run(c.id, `2025-0${8 - k}-12`, title, category, summary);
  });

  // Risks
  db.prepare(`DELETE FROM risks WHERE company_id=?`).run(c.id);
  for (const [code, severity, description] of copy.risk) {
    db.prepare(`INSERT OR REPLACE INTO risks (company_id,code,severity,description) VALUES (?,?,?,?)`).run(c.id, code, severity, description);
  }
}

export interface CompanyIntelligence {
  symbol: string;
  profile: Record<string, unknown> | null;
  segments: Array<{ name: string; revenue_pct: number; margin_pct: number; growth_pct: number }>;
  geographies: Array<{ region: string; revenue_pct: number }>;
  orderBook: Array<{ as_of: string; order_book_cr: number; book_to_bill: number; executable_12m_pct: number; notes: string }>;
  guidance: Array<{ period: string; metric: string; guided_value: number; unit: string; commentary: string; issued_at: string }>;
  facilities: Array<{ name: string; location: string; kind: string; capacity_note: string }>;
  subsidiaries: Array<{ name: string; stake_pct: number; country: string }>;
  corporateActions: Array<{ date: string; kind: string; detail: string }>;
  announcements: Array<{ date: string; title: string; category: string; summary: string }>;
  risks: Array<{ code: string; severity: string; description: string }>;
  products: Array<{ name: string; category: string; description: string }>;
  guidanceVsActual: Array<{ metric: string; guided: number; actual: number | null; variancePct: number | null }>;
}

/** Read the full intelligence pack for one company. */
export function companyIntelligence(db: DB, symbol: string): CompanyIntelligence | null {
  const c = db.prepare(`SELECT id, symbol FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number; symbol: string } | undefined;
  if (!c) return null;
  db.exec(PROFILE_DDL);
  const id = c.id;
  const profile = db.prepare(`SELECT * FROM company_profiles WHERE company_id=?`).get(id) as Record<string, unknown> | undefined;
  const segments = db.prepare(`SELECT name, revenue_pct, margin_pct, growth_pct FROM segments WHERE company_id=? ORDER BY revenue_pct DESC`).all(id) as CompanyIntelligence['segments'];
  const geographies = db.prepare(`SELECT region, revenue_pct FROM geographies WHERE company_id=? ORDER BY revenue_pct DESC`).all(id) as CompanyIntelligence['geographies'];
  const orderBook = db.prepare(`SELECT as_of, order_book_cr, book_to_bill, executable_12m_pct, notes FROM order_book WHERE company_id=? ORDER BY as_of DESC`).all(id) as CompanyIntelligence['orderBook'];
  const guidance = db.prepare(`SELECT period, metric, guided_value, unit, commentary, issued_at FROM guidance WHERE company_id=? ORDER BY metric`).all(id) as CompanyIntelligence['guidance'];
  const facilities = db.prepare(`SELECT name, location, kind, capacity_note FROM facilities WHERE company_id=? ORDER BY name`).all(id) as CompanyIntelligence['facilities'];
  const subsidiaries = db.prepare(`SELECT name, stake_pct, country FROM subsidiaries WHERE company_id=? ORDER BY stake_pct DESC`).all(id) as CompanyIntelligence['subsidiaries'];
  const corporateActions = db.prepare(`SELECT date, kind, detail FROM corporate_actions WHERE company_id=? ORDER BY date DESC`).all(id) as CompanyIntelligence['corporateActions'];
  const announcements = db.prepare(`SELECT date, title, category, summary FROM announcements WHERE company_id=? ORDER BY date DESC`).all(id) as CompanyIntelligence['announcements'];
  const risks = db.prepare(`SELECT code, severity, description FROM risks WHERE company_id=? ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`).all(id) as CompanyIntelligence['risks'];
  const products = db.prepare(`SELECT name, category, description FROM products WHERE company_id=?`).all(id) as CompanyIntelligence['products'];

  // Guidance vs actual: compare revenue-growth and margin guidance to reported figures.
  const latest = db.prepare(`SELECT opm_pct AS opm, sales FROM statements WHERE company_id=? AND period_type='annual' ORDER BY period_end DESC LIMIT 1`).get(id) as { opm: number; sales: number } | undefined;
  const prev = db.prepare(`SELECT sales FROM statements WHERE company_id=? AND period_type='annual' ORDER BY period_end DESC LIMIT 1 OFFSET 1`).get(id) as { sales: number } | undefined;
  const guidanceVsActual = guidance.map((g) => {
    if (!latest) return { metric: g.metric, guided: g.guided_value, actual: null, variancePct: null };
    if (g.metric === 'Operating margin') return { metric: g.metric, guided: g.guided_value, actual: round(latest.opm), variancePct: round(latest.opm - g.guided_value) };
    if (g.metric === 'Revenue growth' && prev) {
      const actual = prev.sales > 0 ? ((latest.sales / prev.sales) - 1) * 100 : null;
      return { metric: g.metric, guided: g.guided_value, actual: actual === null ? null : round(actual), variancePct: actual === null ? null : round(actual - g.guided_value) };
    }
    return { metric: g.metric, guided: g.guided_value, actual: null, variancePct: null };
  });

  return { symbol: c.symbol, profile: profile ?? null, segments, geographies, orderBook, guidance, facilities, subsidiaries, corporateActions, announcements, risks, products, guidanceVsActual };
}

/** Import a JSON intelligence pack (real data), replacing generated rows. */
export function importIntelligence(db: DB, symbol: string, pack: Partial<CompanyIntelligence> & { profile?: Record<string, unknown> }): { ok: boolean; fields: string[] } {
  const c = db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number } | undefined;
  if (!c) throw new Error(`No company "${symbol}".`);
  db.exec(PROFILE_DDL);
  const id = c.id;
  const done: string[] = [];
  const tx = db.transaction(() => {
    if (pack.profile) {
      const p = pack.profile as Record<string, unknown>;
      db.prepare(`INSERT INTO company_profiles (company_id, description, founded_year, hq_city, hq_country, employees, website, auditor, registrar, business_model, moat_score, moat_notes, source, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(company_id) DO UPDATE SET description=excluded.description, founded_year=excluded.founded_year, hq_city=excluded.hq_city,
          hq_country=excluded.hq_country, employees=excluded.employees, website=excluded.website, auditor=excluded.auditor,
          registrar=excluded.registrar, business_model=excluded.business_model, source=excluded.source, updated_at=excluded.updated_at`)
        .run(id, String(p['description'] ?? ''), Number(p['founded_year'] ?? 0) || null, String(p['hq_city'] ?? ''), String(p['hq_country'] ?? ''),
          Number(p['employees'] ?? 0) || null, String(p['website'] ?? ''), String(p['auditor'] ?? ''), String(p['registrar'] ?? ''),
          String(p['business_model'] ?? ''), Number(p['moat_score'] ?? 0) || null, String(p['moat_notes'] ?? ''), String(p['source'] ?? 'import'), Date.now());
      done.push('profile');
    }
    const replace = <T>(table: string, rows: T[] | undefined, cols: string[], map: (r: T) => unknown[]): void => {
      if (!Array.isArray(rows)) return;
      db.prepare(`DELETE FROM ${table} WHERE company_id=?`).run(id);
      const stmt = db.prepare(`INSERT OR REPLACE INTO ${table} (company_id,${cols.join(',')}) VALUES (?,${cols.map(() => '?').join(',')})`);
      for (const r of rows) stmt.run(id, ...map(r));
      done.push(table);
    };
    replace('segments', pack.segments, ['name', 'revenue_pct', 'margin_pct', 'growth_pct'], (r) => [r.name, r.revenue_pct, r.margin_pct, r.growth_pct]);
    replace('geographies', pack.geographies, ['region', 'revenue_pct'], (r) => [r.region, r.revenue_pct]);
    replace('order_book', pack.orderBook, ['as_of', 'order_book_cr', 'book_to_bill', 'executable_12m_pct', 'notes'], (r) => [r.as_of, r.order_book_cr, r.book_to_bill, r.executable_12m_pct, r.notes]);
    replace('guidance', pack.guidance, ['period', 'metric', 'guided_value', 'unit', 'commentary', 'issued_at'], (r) => [r.period, r.metric, r.guided_value, r.unit, r.commentary, r.issued_at]);
    replace('facilities', pack.facilities, ['name', 'location', 'kind', 'capacity_note'], (r) => [r.name, r.location, r.kind, r.capacity_note]);
    replace('subsidiaries', pack.subsidiaries, ['name', 'stake_pct', 'country'], (r) => [r.name, r.stake_pct, r.country]);
    replace('corporate_actions', pack.corporateActions, ['date', 'kind', 'detail'], (r) => [r.date, r.kind, r.detail]);
    replace('announcements', pack.announcements, ['date', 'title', 'category', 'summary'], (r) => [r.date, r.title, r.category, r.summary]);
    replace('risks', pack.risks, ['code', 'severity', 'description'], (r) => [r.code, r.severity, r.description]);
    replace('products', pack.products, ['name', 'category', 'description'], (r) => [r.name, r.category, r.description]);
  });
  tx();
  return { ok: true, fields: done };
}

/** Fetch a company summary from Wikipedia (free, no key) and store the description. */
export async function fetchWikipediaProfile(
  db: DB, symbol: string,
  getter: (url: string, headers: Record<string, string>) => Promise<{ status: number; json: unknown }> = (u, h) => httpsGetJson<unknown>(u, h),
): Promise<{ ok: boolean; title?: string; description?: string; error?: string }> {
  const c = db.prepare(`SELECT c.id, c.name FROM companies c WHERE UPPER(c.symbol)=UPPER(?)`).get(symbol) as { id: number; name: string } | undefined;
  if (!c) return { ok: false, error: `No company "${symbol}".` };
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(c.name.replace(/ /g, '_'))}`;
    const res = await getter(url, { 'User-Agent': 'Atlas/1.0 (local research)', Accept: 'application/json' });
    if (res.status !== 200) return { ok: false, error: `Wikipedia returned ${res.status}` };
    const j = (res.json ?? {}) as { title?: string; extract?: string; type?: string };
    if (!j.extract || j.type === 'disambiguation') return { ok: false, error: 'No usable summary for that title.' };
    db.exec(PROFILE_DDL);
    db.prepare(`INSERT INTO company_profiles (company_id, description, source, updated_at) VALUES (?,?,?,?)
      ON CONFLICT(company_id) DO UPDATE SET description=excluded.description, source='wikipedia', updated_at=excluded.updated_at`)
      .run(c.id, j.extract, 'wikipedia', Date.now());
    return { ok: true, title: j.title, description: j.extract };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
