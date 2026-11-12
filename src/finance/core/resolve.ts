// Resolve a symbol to its asset class and market.
//
// The PRD inverts navigation: the instrument decides the market, not the other way round.
// This is where that decision is made, and it refuses to guess — an unknown symbol returns
// null rather than being filed under whatever market happens to be active.
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { MARKETS } from './markets';
import type { AssetClass } from './assets';

export interface Resolution {
  symbol: string;
  assetClass: AssetClass;
  market: string;
  currency: string | null;
  name: string | null;
  /** How the answer was reached, so a wrong resolution can be diagnosed. */
  basis: 'forex-pattern' | 'crypto-pattern' | 'suffix' | 'etf-bundle' | 'stock-bundle' | 'assumed-us';
}

const CRYPTO = new Set([
  'BTC','ETH','SOL','XRP','ADA','DOGE','BNB','LTC','DOT','AVAX','LINK','MATIC','TRX','ATOM',
  'XLM','ALGO','NEAR','APT','ARB','OP','SHIB','PEPE','UNI','AAVE','FIL','ETC','BCH','HBAR','VET',
]);
const FIAT = new Set(['USD','EUR','GBP','JPY','AUD','CAD','CHF','CNY','INR','SGD','HKD','NZD','SEK','NOK','MXN','ZAR','TRY','BRL']);

/**
 * Suffix → market. Each market may have more than one: India lists on both NSE (.NS) and
 * BSE (.BO), so a BSE symbol must still resolve to India.
 */
const SUFFIX_ALIASES: Record<string, string[]> = {
  IN: ['.NS', '.BO'],
  JP: ['.T'],
  GB: ['.L'],
  DE: ['.DE', '.F'],
  SG: ['.SI'],
  HK: ['.HK'],
  AU: ['.AX'],
  CA: ['.TO', '.V'],
  US: [''],
};

const SUFFIXES: Array<{ suffix: string; market: string }> = Object.entries(SUFFIX_ALIASES)
  .flatMap(([market, list]) => list.filter((x) => x).map((suffix) => ({ suffix, market })))
  .sort((a, b) => b.suffix.length - a.suffix.length);

/**
 * Majors the upstream dataset is missing. FinanceDatabase lists QQQJ, QQQD and QQQU but not
 * QQQ itself, so a few well-known instruments are named here rather than refused. Kept
 * deliberately small and explicit — this is a correction list, not a guessing heuristic.
 */
const KNOWN_OVERRIDES: Record<string, { assetClass: AssetClass; market: string; currency: string; name: string }> = {
  QQQ: { assetClass: 'etf', market: 'US', currency: 'USD', name: 'Invesco QQQ Trust' },
  DIA: { assetClass: 'etf', market: 'US', currency: 'USD', name: 'SPDR Dow Jones Industrial Average ETF' },
  IWM: { assetClass: 'etf', market: 'US', currency: 'USD', name: 'iShares Russell 2000 ETF' },
  GLD: { assetClass: 'etf', market: 'US', currency: 'USD', name: 'SPDR Gold Shares' },
  SLV: { assetClass: 'etf', market: 'US', currency: 'USD', name: 'iShares Silver Trust' },
  TLT: { assetClass: 'etf', market: 'US', currency: 'USD', name: 'iShares 20+ Year Treasury Bond ETF' },
  ARKK: { assetClass: 'etf', market: 'US', currency: 'USD', name: 'ARK Innovation ETF' },
  VIX: { assetClass: 'etf', market: 'US', currency: 'USD', name: 'CBOE Volatility Index' },
  NIFTY: { assetClass: 'etf', market: 'IN', currency: 'INR', name: 'Nifty 50 Index' },
  SENSEX: { assetClass: 'etf', market: 'IN', currency: 'INR', name: 'BSE Sensex Index' },
};

interface BundleRow { s: string; n?: string; cur?: string }
const CACHE = new Map<string, Map<string, BundleRow>>();

function dataDir(kind: 'universe' | 'etfs'): string {
  const candidates = [
    path.join(__dirname, '..', 'data', kind),
    path.join(process.cwd(), 'src', 'finance', 'data', kind),
    path.join(process.cwd(), 'dist', 'finance', 'data', kind),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[1]!;
}

function bundle(kind: 'universe' | 'etfs', market: string): Map<string, BundleRow> {
  const key = `${kind}:${market}`;
  const hit = CACHE.get(key);
  if (hit) return hit;
  const empty = new Map<string, BundleRow>();
  try {
    // A large bundle ships compressed to fit the repository; accept either form.
    const dir = dataDir(kind);
    const plain = path.join(dir, `${market}.json`);
    const gz = `${plain}.gz`;
    const file = fs.existsSync(gz) ? gz : plain;
    const raw = fs.readFileSync(file);
    const text = file.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
    const j = JSON.parse(text) as { companies?: BundleRow[]; etfs?: BundleRow[] };
    const rows = j.companies ?? j.etfs ?? [];
    const map = new Map<string, BundleRow>();
    for (const r of rows) map.set(r.s.toUpperCase(), r);
    CACHE.set(key, map);
    return map;
  } catch { CACHE.set(key, empty); return empty; }
}

function marketOfSuffix(symbol: string): { market: string; suffix: string } | null {
  const up = symbol.toUpperCase();
  for (const s of SUFFIXES) if (up.endsWith(s.suffix)) return { market: s.market, suffix: s.suffix };
  return null;
}

/**
 * Resolve a symbol. Returns null when the symbol cannot be placed — never a guess.
 */
export function resolve(raw: string): Resolution | null {
  const symbol = raw.trim();
  if (!symbol) return null;
  const up = symbol.toUpperCase();

  // 1. Forex: EURUSD=X, EUR/USD, or a bare six-letter pair of known currencies.
  const fxEq = /^([A-Z]{3})([A-Z]{3})=X$/.exec(up);
  if (fxEq && FIAT.has(fxEq[1]!) && FIAT.has(fxEq[2]!)) {
    return { symbol: up, assetClass: 'forex', market: 'FX', currency: fxEq[2]!, name: `${fxEq[1]}/${fxEq[2]}`, basis: 'forex-pattern' };
  }
  const fxSlash = /^([A-Z]{3})\/([A-Z]{3})$/.exec(up);
  if (fxSlash && FIAT.has(fxSlash[1]!) && FIAT.has(fxSlash[2]!)) {
    return { symbol: `${fxSlash[1]}${fxSlash[2]}=X`, assetClass: 'forex', market: 'FX', currency: fxSlash[2]!, name: `${fxSlash[1]}/${fxSlash[2]}`, basis: 'forex-pattern' };
  }

  // 2. Crypto: BTC-USD, or a known crypto ticker paired with a fiat quote.
  const cryptoPair = /^([A-Z0-9]{2,10})-([A-Z]{3})$/.exec(up);
  if (cryptoPair && CRYPTO.has(cryptoPair[1]!) && FIAT.has(cryptoPair[2]!)) {
    return { symbol: up, assetClass: 'crypto', market: 'GLOBAL', currency: cryptoPair[2]!, name: `${cryptoPair[1]}/${cryptoPair[2]}`, basis: 'crypto-pattern' };
  }

  // 3. An explicit exchange suffix names the market. ETF first, then stock.
  const bySuffix = marketOfSuffix(up);
  if (bySuffix) {
    const etf = bundle('etfs', bySuffix.market).get(up);
    if (etf) return { symbol: up, assetClass: 'etf', market: bySuffix.market, currency: etf.cur ?? null, name: etf.n ?? null, basis: 'etf-bundle' };
    const stock = bundle('universe', bySuffix.market).get(up);
    if (stock) return { symbol: up, assetClass: 'stock', market: bySuffix.market, currency: stock.cur ?? null, name: stock.n ?? null, basis: 'stock-bundle' };
    // The suffix is real, so the market is known even if the symbol is not in the bundle.
    const def = MARKETS.find((m: { code: string }) => m.code === bySuffix.market);
    return { symbol: up, assetClass: 'stock', market: bySuffix.market, currency: def?.currency ?? null, name: null, basis: 'suffix' };
  }

  // 4a. A short explicit override list for instruments the dataset omits.
  const known = KNOWN_OVERRIDES[up];
  if (known) return { symbol: up, assetClass: known.assetClass, market: known.market, currency: known.currency, name: known.name, basis: 'etf-bundle' };

  // 4b. A bare ticker is American unless it is a known ETF elsewhere. Check the US first.
  const usEtf = bundle('etfs', 'US').get(up);
  if (usEtf) return { symbol: up, assetClass: 'etf', market: 'US', currency: usEtf.cur ?? 'USD', name: usEtf.n ?? null, basis: 'etf-bundle' };
  const usStock = bundle('universe', 'US').get(up);
  if (usStock) return { symbol: up, assetClass: 'stock', market: 'US', currency: usStock.cur ?? 'USD', name: usStock.n ?? null, basis: 'stock-bundle' };

  // 5. Nothing matched. Refuse rather than invent a market.
  return null;
}

/** Resolve, or explain why it could not be. */
export function resolveOrExplain(raw: string): { ok: true; resolution: Resolution } | { ok: false; error: string } {
  const r = resolve(raw);
  if (r) return { ok: true, resolution: r };
  return {
    ok: false,
    error: `"${raw.trim()}" is not a recognised stock, ETF, forex pair or crypto asset. Try a symbol like RELIANCE.NS, VOO, EURUSD=X or BTC-USD.`,
  };
}

/** The storage key for a market and asset class. */
export function storageKey(market: string, assetClass: AssetClass): string {
  return `${market.toUpperCase()}-${assetClass.toUpperCase()}`;
}
