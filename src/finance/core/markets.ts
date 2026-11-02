// Markets — country-wise data bundles with hard isolation.
//
// The requirement is that switching market can never leak one country's data into
// another. The strongest guarantee is not a WHERE clause; it is a separate database
// file per market. Nothing in the India file can be read while the US file is open.
import * as fs from 'fs';
import { ASSETS, type AssetClass } from './assets';
import { storageKey } from './resolve';
import * as path from 'path';
import { openDatabase, type Db } from './db';

export interface MarketDef {
  code: string;
  name: string;
  currency: string;
  symbol: string;
  locale: string;
  timezone: string;
  /** Yahoo suffix used to resolve symbols, e.g. '.NS' for India. */
  suffix: string;
  /** Not a country: a global asset space (forex, crypto). Hidden from the country picker. */
  pseudo?: boolean;
  exchanges: string[];
  fiscalYearEnd: string;
  benchmark: string;
  flag: string;
  /** Rough size of the downloadable bundle, for the UI. */
  bundleNote: string;
}

export const MARKETS: MarketDef[] = [
  { code: 'IN', name: 'India', currency: 'INR', symbol: '₹', locale: 'en-IN', timezone: 'Asia/Kolkata', suffix: '.NS', exchanges: ['NSE', 'BSE'], fiscalYearEnd: '03-31', benchmark: '^NSEI', flag: '🇮🇳', bundleNote: 'NSE/BSE large & mid cap, ~2,000 symbols' },
  { code: 'US', name: 'United States', currency: 'USD', symbol: '$', locale: 'en-US', timezone: 'America/New_York', suffix: '', exchanges: ['NYSE', 'NASDAQ'], fiscalYearEnd: '12-31', benchmark: '^GSPC', flag: '🇺🇸', bundleNote: 'NYSE/NASDAQ, ~6,000 symbols' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', symbol: '£', locale: 'en-GB', timezone: 'Europe/London', suffix: '.L', exchanges: ['LSE'], fiscalYearEnd: '12-31', benchmark: '^FTSE', flag: '🇬🇧', bundleNote: 'LSE main market, ~1,500 symbols' },
  { code: 'JP', name: 'Japan', currency: 'JPY', symbol: '¥', locale: 'ja-JP', timezone: 'Asia/Tokyo', suffix: '.T', exchanges: ['TSE'], fiscalYearEnd: '03-31', benchmark: '^N225', flag: '🇯🇵', bundleNote: 'Tokyo prime, ~2,000 symbols' },
  { code: 'DE', name: 'Germany', currency: 'EUR', symbol: '€', locale: 'de-DE', timezone: 'Europe/Berlin', suffix: '.DE', exchanges: ['XETRA'], fiscalYearEnd: '12-31', benchmark: '^GDAXI', flag: '🇩🇪', bundleNote: 'XETRA prime, ~800 symbols' },
  { code: 'SG', name: 'Singapore', currency: 'SGD', symbol: 'S$', locale: 'en-SG', timezone: 'Asia/Singapore', suffix: '.SI', exchanges: ['SGX'], fiscalYearEnd: '12-31', benchmark: '^STI', flag: '🇸🇬', bundleNote: 'SGX mainboard, ~700 symbols' },
  { code: 'HK', name: 'Hong Kong', currency: 'HKD', symbol: 'HK$', locale: 'en-HK', timezone: 'Asia/Hong_Kong', suffix: '.HK', exchanges: ['HKEX'], fiscalYearEnd: '12-31', benchmark: '^HSI', flag: '🇭🇰', bundleNote: 'HKEX, ~2,500 symbols' },
  { code: 'AU', name: 'Australia', currency: 'AUD', symbol: 'A$', locale: 'en-AU', timezone: 'Australia/Sydney', suffix: '.AX', exchanges: ['ASX'], fiscalYearEnd: '06-30', benchmark: '^AXJO', flag: '🇦🇺', bundleNote: 'ASX 200 + extras, ~2,000 symbols' },
  { code: 'CA', name: 'Canada', currency: 'CAD', symbol: 'C$', locale: 'en-CA', timezone: 'America/Toronto', suffix: '.TO', exchanges: ['TSX'], fiscalYearEnd: '12-31', benchmark: '^GSPTSE', flag: '🇨🇦', bundleNote: 'TSX, ~1,500 symbols' },
  { code: 'FX', name: 'Forex', currency: 'USD', symbol: '$', locale: 'en-US', timezone: 'UTC', suffix: '', exchanges: ['FX'], fiscalYearEnd: '12-31', benchmark: '', flag: '💱', bundleNote: 'Currency pairs, 24 hours across overlapping sessions', pseudo: true },
  { code: 'GLOBAL', name: 'Crypto', currency: 'USD', symbol: '$', locale: 'en-US', timezone: 'UTC', suffix: '', exchanges: ['CRYPTO'], fiscalYearEnd: '12-31', benchmark: '', flag: '₿', bundleNote: 'Digital assets, trading continuously', pseudo: true },
];

export function marketDef(code: string): MarketDef | undefined {
  return MARKETS.find((m) => m.code.toUpperCase() === code.toUpperCase());
}

/**
 * Owns one SQLite file per market. Switching closes nothing — each handle stays open so
 * a switch is instant — but the active pointer decides which file every query touches.
 */
export class MarketManager {
  private handles = new Map<string, Db>();
  private current: string | null;
  private currentClass: AssetClass | null = null;
  private readonly metaFile: string;

  constructor(private dataDir: string, initial = 'IN') {
    fs.mkdirSync(path.join(dataDir, 'markets'), { recursive: true });
    this.metaFile = path.join(dataDir, 'active-market.json');
    // NO DEFAULT MARKET. Until setup completes there is no active market, and every
    // data route refuses to guess one.
    const saved = this.readActive();
    this.current = saved ?? (process.env['ATLAS_FORCE_MARKET'] && marketDef(process.env['ATLAS_FORCE_MARKET']) ? process.env['ATLAS_FORCE_MARKET'].toUpperCase() : null);
  }

  private readActive(): string | null {
    try {
      if (!fs.existsSync(this.metaFile)) return null;
      const j = JSON.parse(fs.readFileSync(this.metaFile, 'utf8')) as { active?: string };
      return j.active && marketDef(j.active) ? j.active.toUpperCase() : null;
    } catch { return null; }
  }

  private writeActive(code: string): void {
    try { fs.writeFileSync(this.metaFile, JSON.stringify({ active: code, at: new Date().toISOString() })); } catch { /* read-only fs */ }
  }

  /**
   * Path of a database. A market now holds one file per asset class, so India's stocks and
   * India's ETFs are physically separate. The pre-3.0 name (IN.db) is migrated on first use
   * and kept until the new file verifies, so no data is lost.
   */
  dbPath(code: string, assetClass: AssetClass = 'stock'): string {
    const key = storageKey(code, assetClass);
    const target = path.join(this.dataDir, 'markets', `${key}.db`);
    if (fs.existsSync(target)) return target;
    const legacy = path.join(this.dataDir, 'markets', `${code.toUpperCase()}.db`);
    if (assetClass === 'stock' && fs.existsSync(legacy)) {
      try {
        fs.copyFileSync(legacy, target);
        const size = fs.statSync(target).size;
        if (size > 0) return target;
        fs.rmSync(target, { force: true });
      } catch { /* fall through to a fresh file */ }
    }
    return target;
  }

  /** Which asset classes have a database on disk for this market. */
  installedClasses(code: string): AssetClass[] {
    const c = code.toUpperCase();
    return ASSETS.map((a) => a.id).filter((id) => fs.existsSync(path.join(this.dataDir, 'markets', `${c}-${id.toUpperCase()}.db`)));
  }

  open(code: string, assetClass: AssetClass = this.currentClass ?? 'stock'): Db {
    const c = code.toUpperCase();
    if (!marketDef(c)) throw new Error(`Unknown market "${code}"`);
    const key = `${c}:${assetClass}`;
    const existing = this.handles.get(key);
    if (existing) return existing;
    const db = openDatabase(this.dbPath(c, assetClass));
    this.handles.set(key, db);
    return db;
  }

  configured(): boolean { return this.current !== null; }

  active(): string | null { return this.current; }

  /** The active asset class. Stocks until the user focuses something else. */
  activeClass(): AssetClass { return this.currentClass ?? 'stock'; }

  /** Switch asset class within the current market. */
  switchClass(assetClass: AssetClass): AssetClass {
    this.currentClass = assetClass;
    if (this.current) this.writeActive(this.current);
    return assetClass;
  }

  /** Throws when no market is configured — callers must handle the setup state. */
  activeDb(): Db {
    if (!this.current) throw new Error('SETUP_REQUIRED');
    return this.open(this.current);
  }

  activeDef(): MarketDef {
    if (!this.current) throw new Error('SETUP_REQUIRED');
    return marketDef(this.current)!;
  }

  /** Per-feature readiness for one market, so a screen is never a dead end silently. */
  readiness(code: string): { code: string; configured: boolean; companies: number; features: Array<{ feature: string; ready: boolean; detail: string }> } {
    const def = marketDef(code);
    if (!def) throw new Error(`Unknown market "${code}"`);
    const db = this.open(def.code);
    const n = (sql: string): number => { try { return (db.db.prepare(sql).get() as { n: number }).n; } catch { return 0; } };
    const companies = n(`SELECT COUNT(*) AS n FROM companies`);
    const withHistory = n(`SELECT COUNT(DISTINCT company_id) AS n FROM statements WHERE period_type='annual'`);
    const withPrices = n(`SELECT COUNT(DISTINCT company_id) AS n FROM price_history`);
    const withAnalysts = n(`SELECT COUNT(DISTINCT company_id) AS n FROM analyst_targets`);
    const withDividends = n(`SELECT COUNT(DISTINCT company_id) AS n FROM dividends`);
    const withCalendar = n(`SELECT COUNT(DISTINCT company_id) AS n FROM calendar_events`);
    const withProfiles = n(`SELECT COUNT(DISTINCT company_id) AS n FROM company_profiles`);
    const pct = (v: number): number => (companies ? Math.round((v / companies) * 100) : 0);
    return {
      code: def.code, configured: this.current === def.code, companies,
      features: [
        { feature: 'Company search & screener', ready: companies > 0, detail: `${companies} companies` },
        { feature: 'Statements & ratios', ready: withHistory > 0, detail: `${pct(withHistory)}% have annual statements` },
        { feature: 'Scores & deep analysis', ready: withHistory > 0, detail: 'needs statements' },
        { feature: 'Valuation lab', ready: withPrices > 0, detail: `${pct(withPrices)}% have prices` },
        { feature: 'Price analytics & risk', ready: withPrices > 0, detail: `${pct(withPrices)}% have price history` },
        { feature: 'Dividends & total return', ready: withDividends > 0, detail: `${pct(withDividends)}% pay dividends` },
        { feature: 'Analysts & targets', ready: withAnalysts > 0, detail: `${pct(withAnalysts)}% covered` },
        { feature: 'Earnings calendar', ready: withCalendar > 0, detail: `${pct(withCalendar)}% scheduled` },
        { feature: 'Company intelligence', ready: withProfiles > 0, detail: `${pct(withProfiles)}% profiled` },
        { feature: 'Macro indicators', ready: true, detail: 'World Bank — country-level, always available' },
      ],
    };
  }

  switch(code: string): MarketDef {
    const c = code.toUpperCase();
    const def = marketDef(c);
    if (!def) throw new Error(`Unknown market "${code}"`);
    this.open(c);                 // make sure the file exists before pointing at it
    this.current = c;
    this.writeActive(c);
    return def;
  }

  /**
   * Per-market stats for the switcher, read from each file independently.
   * Countries only: pseudo-markets (FX, GLOBAL) are asset spaces, not places.
   */
  list(): Array<MarketDef & { active: boolean; companies: number; hasData: boolean; dbBytes: number }> {
    return countryMarkets().map((m) => {
      let companies = 0;
      let dbBytes = 0;
      try {
        const p = this.dbPath(m.code);
        if (fs.existsSync(p)) {
          dbBytes = fs.statSync(p).size;
          const db = this.open(m.code);
          companies = (db.db.prepare(`SELECT COUNT(*) AS n FROM companies`).get() as { n: number }).n;
        }
      } catch { /* market not yet created */ }
      return { ...m, active: m.code === this.current, companies, hasData: companies > 0, dbBytes };
    });
  }

  /** The downloadable bundle descriptor for a market. */
  bundle(code: string): { market: MarketDef; files: Array<{ name: string; kind: string; note: string }>; installed: boolean } {
    const def = marketDef(code);
    if (!def) throw new Error(`Unknown market "${code}"`);
    const installed = fs.existsSync(this.dbPath(code));
    return {
      market: def,
      installed,
      files: [
        { name: `${def.code}.db`, kind: 'database', note: 'Companies, statements, ratios, prices for this market only.' },
        { name: `companies-${def.code}.csv`, kind: 'universe', note: `Symbol list for ${def.name} (${def.exchanges.join(', ')}).` },
        { name: `model-q4_k_m.gguf`, kind: 'model', note: 'Optional on-device quantized model for local answers.' },
      ],
    };
  }

  closeAll(): void {
    for (const [, db] of this.handles) { try { db.db.close(); } catch { /* already closed */ } }
    this.handles.clear();
  }
}

/** Real countries only — the setup picker and market switcher use this. */
export function countryMarkets(): MarketDef[] {
  return MARKETS.filter((m) => !m.pseudo);
}
