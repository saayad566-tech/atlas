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
  { code: 'CN', name: 'China', currency: 'CNY', symbol: '¥', locale: 'zh-CN', timezone: 'Asia/Shanghai', suffix: '.SS', exchanges: ['SSE', 'SZSE'], fiscalYearEnd: '12-31', benchmark: '000001.SS', flag: '🇨🇳', bundleNote: 'Shanghai and Shenzhen listings' },
  { code: 'KR', name: 'South Korea', currency: 'KRW', symbol: '₩', locale: 'ko-KR', timezone: 'Asia/Seoul', suffix: '.KS', exchanges: ['KRX'], fiscalYearEnd: '12-31', benchmark: '^KS11', flag: '🇰🇷', bundleNote: 'KOSPI and KOSDAQ listings' },
  { code: 'TW', name: 'Taiwan', currency: 'TWD', symbol: 'NT$', locale: 'zh-TW', timezone: 'Asia/Taipei', suffix: '.TW', exchanges: ['TWSE'], fiscalYearEnd: '12-31', benchmark: '^TWII', flag: '🇹🇼', bundleNote: 'Taiwan Stock Exchange listings' },
  { code: 'FR', name: 'France', currency: 'EUR', symbol: '€', locale: 'fr-FR', timezone: 'Europe/Paris', suffix: '.PA', exchanges: ['Euronext Paris'], fiscalYearEnd: '12-31', benchmark: '^FCHI', flag: '🇫🇷', bundleNote: 'Euronext Paris listings' },
  { code: 'CH', name: 'Switzerland', currency: 'CHF', symbol: 'CHF', locale: 'de-CH', timezone: 'Europe/Zurich', suffix: '.SW', exchanges: ['SIX'], fiscalYearEnd: '12-31', benchmark: '^SSMI', flag: '🇨🇭', bundleNote: 'SIX Swiss Exchange listings' },
  { code: 'NL', name: 'Netherlands', currency: 'EUR', symbol: '€', locale: 'nl-NL', timezone: 'Europe/Amsterdam', suffix: '.AS', exchanges: ['Euronext Amsterdam'], fiscalYearEnd: '12-31', benchmark: '^AEX', flag: '🇳🇱', bundleNote: 'Euronext Amsterdam listings' },
  { code: 'SE', name: 'Sweden', currency: 'SEK', symbol: 'kr', locale: 'sv-SE', timezone: 'Europe/Stockholm', suffix: '.ST', exchanges: ['Nasdaq Stockholm'], fiscalYearEnd: '12-31', benchmark: '^OMX', flag: '🇸🇪', bundleNote: 'Stockholm listings' },
  { code: 'BR', name: 'Brazil', currency: 'BRL', symbol: 'R$', locale: 'pt-BR', timezone: 'America/Sao_Paulo', suffix: '.SA', exchanges: ['B3'], fiscalYearEnd: '12-31', benchmark: '^BVSP', flag: '🇧🇷', bundleNote: 'B3 listings' },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR', symbol: 'R', locale: 'en-ZA', timezone: 'Africa/Johannesburg', suffix: '.JO', exchanges: ['JSE'], fiscalYearEnd: '12-31', benchmark: '^JN0U.JO', flag: '🇿🇦', bundleNote: 'Johannesburg listings' },
  { code: 'ES', name: 'Spain', currency: 'EUR', symbol: '€', locale: 'es-ES', timezone: 'Europe/Madrid', suffix: '.MC', exchanges: ['BME'], fiscalYearEnd: '12-31', benchmark: '^IBEX', flag: '🇪🇸', bundleNote: 'Madrid listings' },
  { code: 'IT', name: 'Italy', currency: 'EUR', symbol: '€', locale: 'it-IT', timezone: 'Europe/Rome', suffix: '.MI', exchanges: ['Borsa Italiana'], fiscalYearEnd: '12-31', benchmark: 'FTSEMIB.MI', flag: '🇮🇹', bundleNote: 'Milan listings' },
  { code: 'NO', name: 'Norway', currency: 'NOK', symbol: 'kr', locale: 'nb-NO', timezone: 'Europe/Oslo', suffix: '.OL', exchanges: ['Oslo Børs'], fiscalYearEnd: '12-31', benchmark: '^OSEAX', flag: '🇳🇴', bundleNote: 'Oslo listings' },
  { code: 'DK', name: 'Denmark', currency: 'DKK', symbol: 'kr', locale: 'da-DK', timezone: 'Europe/Copenhagen', suffix: '.CO', exchanges: ['Nasdaq Copenhagen'], fiscalYearEnd: '12-31', benchmark: '^OMXC25', flag: '🇩🇰', bundleNote: 'Copenhagen listings' },
  { code: 'FI', name: 'Finland', currency: 'EUR', symbol: '€', locale: 'fi-FI', timezone: 'Europe/Helsinki', suffix: '.HE', exchanges: ['Nasdaq Helsinki'], fiscalYearEnd: '12-31', benchmark: '^OMXH25', flag: '🇫🇮', bundleNote: 'Helsinki listings' },
  { code: 'BE', name: 'Belgium', currency: 'EUR', symbol: '€', locale: 'nl-BE', timezone: 'Europe/Brussels', suffix: '.BR', exchanges: ['Euronext Brussels'], fiscalYearEnd: '12-31', benchmark: '^BFX', flag: '🇧🇪', bundleNote: 'Brussels listings' },
  { code: 'IE', name: 'Ireland', currency: 'EUR', symbol: '€', locale: 'en-IE', timezone: 'Europe/Dublin', suffix: '.IR', exchanges: ['Euronext Dublin'], fiscalYearEnd: '12-31', benchmark: '^ISEQ', flag: '🇮🇪', bundleNote: 'Dublin listings' },
  { code: 'IL', name: 'Israel', currency: 'ILS', symbol: '₪', locale: 'he-IL', timezone: 'Asia/Jerusalem', suffix: '.TA', exchanges: ['TASE'], fiscalYearEnd: '12-31', benchmark: '^TA125.TA', flag: '🇮🇱', bundleNote: 'Tel Aviv listings' },
  { code: 'PL', name: 'Poland', currency: 'PLN', symbol: 'zł', locale: 'pl-PL', timezone: 'Europe/Warsaw', suffix: '.WA', exchanges: ['GPW'], fiscalYearEnd: '12-31', benchmark: '^WIG20', flag: '🇵🇱', bundleNote: 'Warsaw listings' },
  { code: 'TR', name: 'Turkey', currency: 'TRY', symbol: '₺', locale: 'tr-TR', timezone: 'Europe/Istanbul', suffix: '.IS', exchanges: ['Borsa Istanbul'], fiscalYearEnd: '12-31', benchmark: 'XU100.IS', flag: '🇹🇷', bundleNote: 'Istanbul listings' },
  { code: 'ID', name: 'Indonesia', currency: 'IDR', symbol: 'Rp', locale: 'id-ID', timezone: 'Asia/Jakarta', suffix: '.JK', exchanges: ['IDX'], fiscalYearEnd: '12-31', benchmark: '^JKSE', flag: '🇮🇩', bundleNote: 'Indonesia Stock Exchange listings' },
  { code: 'MY', name: 'Malaysia', currency: 'MYR', symbol: 'RM', locale: 'ms-MY', timezone: 'Asia/Kuala_Lumpur', suffix: '.KL', exchanges: ['Bursa Malaysia'], fiscalYearEnd: '12-31', benchmark: '^KLSE', flag: '🇲🇾', bundleNote: 'Bursa Malaysia listings' },
  { code: 'TH', name: 'Thailand', currency: 'THB', symbol: '฿', locale: 'th-TH', timezone: 'Asia/Bangkok', suffix: '.BK', exchanges: ['SET'], fiscalYearEnd: '12-31', benchmark: '^SET.BK', flag: '🇹🇭', bundleNote: 'SET listings' },
  { code: 'PH', name: 'Philippines', currency: 'PHP', symbol: '₱', locale: 'en-PH', timezone: 'Asia/Manila', suffix: '.PS', exchanges: ['PSE'], fiscalYearEnd: '12-31', benchmark: 'PSEI.PS', flag: '🇵🇭', bundleNote: 'Philippine Stock Exchange listings' },
  { code: 'NZ', name: 'New Zealand', currency: 'NZD', symbol: 'NZ$', locale: 'en-NZ', timezone: 'Pacific/Auckland', suffix: '.NZ', exchanges: ['NZX'], fiscalYearEnd: '03-31', benchmark: '^NZ50', flag: '🇳🇿', bundleNote: 'NZX listings' },
  { code: 'MX', name: 'Mexico', currency: 'MXN', symbol: 'MX$', locale: 'es-MX', timezone: 'America/Mexico_City', suffix: '.MX', exchanges: ['BMV'], fiscalYearEnd: '12-31', benchmark: '^MXX', flag: '🇲🇽', bundleNote: 'Bolsa Mexicana listings' },
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR', symbol: '﷼', locale: 'ar-SA', timezone: 'Asia/Riyadh', suffix: '.SR', exchanges: ['Tadawul'], fiscalYearEnd: '12-31', benchmark: '^TASI.SR', flag: '🇸🇦', bundleNote: 'Tadawul listings' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', symbol: 'AED', locale: 'en-AE', timezone: 'Asia/Dubai', suffix: '.AE', exchanges: ['ADX', 'DFM'], fiscalYearEnd: '12-31', benchmark: '', flag: '🇦🇪', bundleNote: 'Abu Dhabi and Dubai listings' },
  { code: 'AT', name: 'Austria', currency: 'EUR', symbol: '€', locale: 'de-AT', timezone: 'Europe/Vienna', suffix: '.VI', exchanges: ['Wiener Börse'], fiscalYearEnd: '12-31', benchmark: '^ATX', flag: '🇦🇹', bundleNote: 'Vienna listings' },
  { code: 'PT', name: 'Portugal', currency: 'EUR', symbol: '€', locale: 'pt-PT', timezone: 'Europe/Lisbon', suffix: '.LS', exchanges: ['Euronext Lisbon'], fiscalYearEnd: '12-31', benchmark: '^PSI20', flag: '🇵🇹', bundleNote: 'Lisbon listings' },
  { code: 'GR', name: 'Greece', currency: 'EUR', symbol: '€', locale: 'el-GR', timezone: 'Europe/Athens', suffix: '.AT', exchanges: ['Athens Exchange'], fiscalYearEnd: '12-31', benchmark: '^ATG', flag: '🇬🇷', bundleNote: 'Athens listings' },
  { code: 'AR', name: 'Argentina', currency: 'ARS', symbol: 'AR$', locale: 'es-AR', timezone: 'America/Argentina/Buenos_Aires', suffix: '.BA', exchanges: ['BCBA'], fiscalYearEnd: '12-31', benchmark: '^MERV', flag: '🇦🇷', bundleNote: 'Buenos Aires listings' },
  { code: 'BD', name: 'Bangladesh', currency: 'BDT', symbol: '৳', locale: 'bn-BD', timezone: 'Asia/Dhaka', suffix: '.BD', exchanges: ['DSE'], fiscalYearEnd: '06-30', benchmark: '', flag: '🇧🇩', bundleNote: 'Dhaka listings' },
  { code: 'CL', name: 'Chile', currency: 'CLP', symbol: 'CL$', locale: 'es-CL', timezone: 'America/Santiago', suffix: '.SN', exchanges: ['BCS'], fiscalYearEnd: '12-31', benchmark: '^IPSA', flag: '🇨🇱', bundleNote: 'Santiago listings' },
  { code: 'CO', name: 'Colombia', currency: 'COP', symbol: 'CO$', locale: 'es-CO', timezone: 'America/Bogota', suffix: '.CL', exchanges: ['BVC'], fiscalYearEnd: '12-31', benchmark: '^COLCAP', flag: '🇨🇴', bundleNote: 'Bogota listings' },
  { code: 'EG', name: 'Egypt', currency: 'EGP', symbol: 'E£', locale: 'ar-EG', timezone: 'Africa/Cairo', suffix: '.CA', exchanges: ['EGX'], fiscalYearEnd: '06-30', benchmark: '^CASE30', flag: '🇪🇬', bundleNote: 'Egyptian Exchange listings' },
  { code: 'HU', name: 'Hungary', currency: 'HUF', symbol: 'Ft', locale: 'hu-HU', timezone: 'Europe/Budapest', suffix: '.BD', exchanges: ['BSE Budapest'], fiscalYearEnd: '12-31', benchmark: '^BUX', flag: '🇭🇺', bundleNote: 'Budapest listings' },
  { code: 'KE', name: 'Kenya', currency: 'KES', symbol: 'KSh', locale: 'en-KE', timezone: 'Africa/Nairobi', suffix: '.NR', exchanges: ['NSE Kenya'], fiscalYearEnd: '12-31', benchmark: '', flag: '🇰🇪', bundleNote: 'Nairobi listings' },
  { code: 'KW', name: 'Kuwait', currency: 'KWD', symbol: 'KD', locale: 'ar-KW', timezone: 'Asia/Kuwait', suffix: '.KW', exchanges: ['Boursa Kuwait'], fiscalYearEnd: '12-31', benchmark: '', flag: '🇰🇼', bundleNote: 'Kuwait listings' },
  { code: 'KZ', name: 'Kazakhstan', currency: 'KZT', symbol: '₸', locale: 'kk-KZ', timezone: 'Asia/Almaty', suffix: '.KZ', exchanges: ['KASE'], fiscalYearEnd: '12-31', benchmark: '', flag: '🇰🇿', bundleNote: 'Almaty listings' },
  { code: 'MA', name: 'Morocco', currency: 'MAD', symbol: 'DH', locale: 'ar-MA', timezone: 'Africa/Casablanca', suffix: '.MA', exchanges: ['CSE'], fiscalYearEnd: '12-31', benchmark: '^MASI', flag: '🇲🇦', bundleNote: 'Casablanca listings' },
  { code: 'NG', name: 'Nigeria', currency: 'NGN', symbol: '₦', locale: 'en-NG', timezone: 'Africa/Lagos', suffix: '.LG', exchanges: ['NGX'], fiscalYearEnd: '12-31', benchmark: '^NGSEINDX', flag: '🇳🇬', bundleNote: 'Lagos listings' },
  { code: 'PE', name: 'Peru', currency: 'PEN', symbol: 'S/', locale: 'es-PE', timezone: 'America/Lima', suffix: '.LM', exchanges: ['BVL'], fiscalYearEnd: '12-31', benchmark: '^SPBLPGPT', flag: '🇵🇪', bundleNote: 'Lima listings' },
  { code: 'QA', name: 'Qatar', currency: 'QAR', symbol: 'QR', locale: 'ar-QA', timezone: 'Asia/Qatar', suffix: '.QA', exchanges: ['QSE'], fiscalYearEnd: '12-31', benchmark: '^QSI', flag: '🇶🇦', bundleNote: 'Qatar listings' },
  { code: 'RO', name: 'Romania', currency: 'RON', symbol: 'lei', locale: 'ro-RO', timezone: 'Europe/Bucharest', suffix: '.RO', exchanges: ['BVB'], fiscalYearEnd: '12-31', benchmark: '^BET', flag: '🇷🇴', bundleNote: 'Bucharest listings' },
  { code: 'RU', name: 'Russia', currency: 'RUB', symbol: '₽', locale: 'ru-RU', timezone: 'Europe/Moscow', suffix: '.ME', exchanges: ['MOEX'], fiscalYearEnd: '12-31', benchmark: '^IMOEX', flag: '🇷🇺', bundleNote: 'Moscow listings' },
  { code: 'UA', name: 'Ukraine', currency: 'UAH', symbol: '₴', locale: 'uk-UA', timezone: 'Europe/Kyiv', suffix: '.UA', exchanges: ['UX'], fiscalYearEnd: '12-31', benchmark: '', flag: '🇺🇦', bundleNote: 'Ukrainian listings' },
  { code: 'VN', name: 'Vietnam', currency: 'VND', symbol: '₫', locale: 'vi-VN', timezone: 'Asia/Ho_Chi_Minh', suffix: '.VN', exchanges: ['HOSE'], fiscalYearEnd: '12-31', benchmark: '^VNINDEX', flag: '🇻🇳', bundleNote: 'Ho Chi Minh listings' },
  { code: 'ETF', name: 'ETFs', currency: 'USD', symbol: '$', locale: 'en-US', timezone: 'UTC', suffix: '', exchanges: ['ETF'], fiscalYearEnd: '12-31', benchmark: '', flag: '📦', bundleNote: 'Exchange-traded funds worldwide', pseudo: true },
  { code: 'INDEX', name: 'Indices', currency: 'USD', symbol: '$', locale: 'en-US', timezone: 'UTC', suffix: '', exchanges: ['INDEX'], fiscalYearEnd: '12-31', benchmark: '', flag: '📊', bundleNote: 'Benchmark indices worldwide', pseudo: true },
  { code: 'MONEY', name: 'Money markets', currency: 'USD', symbol: '$', locale: 'en-US', timezone: 'UTC', suffix: '', exchanges: ['MONEY'], fiscalYearEnd: '12-31', benchmark: '', flag: '🏦', bundleNote: 'Money-market instruments', pseudo: true },
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
