// Rebuild the bundled universe from the full FinanceDatabase (MIT).
//
// The previous bundles carried nine markets. This builds every country the database knows,
// plus separate bundles for crypto, indices, currencies and money markets, so a fresh
// install has the real global universe offline before any network call.
//
// Usage: node scripts/build-global-universe.mjs <path-to-FinanceDatabase-main>

import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2];
if (!SRC || !fs.existsSync(SRC)) {
  console.error('Give the path to the FinanceDatabase checkout.');
  process.exit(1);
}
const OUT = path.join(process.cwd(), 'src', 'finance', 'data', 'universe');
fs.mkdirSync(OUT, { recursive: true });

// The primary exchange for each market, used to prefer a domestic listing.
const DOMESTIC_EXCHANGE = {
  US: 'NYQ', CA: 'TSE', GB: 'LSE', JP: 'JPX', DE: 'GER', IN: 'NSI', CN: 'SHH',
  HK: 'HKG', AU: 'ASX', SG: 'SES', FR: 'PAR', CH: 'SWX', NL: 'AMS', SE: 'STO',
  KR: 'KSC', TW: 'TAI', BR: 'SAO', ZA: 'JNB', ES: 'MCE', IT: 'MIL', NO: 'OSL',
  DK: 'CPH', FI: 'HEL', BE: 'BRU', IE: 'ISE', IL: 'TLV', PL: 'WSE', TR: 'IST',
  ID: 'JKT', MY: 'KLS', TH: 'BKK', PH: 'PHS', NZ: 'NZE', MX: 'MEX', AR: 'BUE',
  CL: 'SGO', SA: 'SAU', AE: 'ADX', QA: 'DSM', AT: 'VIE', PT: 'LIS', GR: 'ATH',
};

// Country name -> the two-letter market code the app uses.
const COUNTRY_CODE = {
  'United States': 'US', 'Canada': 'CA', 'United Kingdom': 'GB', 'Japan': 'JP',
  'Germany': 'DE', 'India': 'IN', 'China': 'CN', 'Hong Kong': 'HK',
  'Australia': 'AU', 'Singapore': 'SG', 'France': 'FR', 'Switzerland': 'CH',
  'Netherlands': 'NL', 'Sweden': 'SE', 'South Korea': 'KR', 'Taiwan': 'TW',
  'Brazil': 'BR', 'South Africa': 'ZA', 'Spain': 'ES', 'Italy': 'IT',
  'Norway': 'NO', 'Denmark': 'DK', 'Finland': 'FI', 'Belgium': 'BE',
  'Ireland': 'IE', 'Israel': 'IL', 'Poland': 'PL', 'Turkey': 'TR',
  'Indonesia': 'ID', 'Malaysia': 'MY', 'Thailand': 'TH', 'Philippines': 'PH',
  'New Zealand': 'NZ', 'Mexico': 'MX', 'Argentina': 'AR', 'Chile': 'CL',
  'Saudi Arabia': 'SA', 'United Arab Emirates': 'AE', 'Qatar': 'QA',
  'Kuwait': 'KW', 'Egypt': 'EG', 'Nigeria': 'NG', 'Kenya': 'KE',
  'Pakistan': 'PK', 'Bangladesh': 'BD', 'Sri Lanka': 'LK', 'Vietnam': 'VN',
  'Austria': 'AT', 'Portugal': 'PT', 'Greece': 'GR', 'Czechia': 'CZ',
  'Hungary': 'HU', 'Romania': 'RO', 'Russia': 'RU', 'Ukraine': 'UA',
  'Colombia': 'CO', 'Peru': 'PE', 'Kazakhstan': 'KZ', 'Morocco': 'MA',
};

function readCsv(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return [];
  const header = parseLine(lines[0]);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseLine(lines[i]);
    const row = {};
    for (let c = 0; c < header.length; c++) row[header[c]] = cells[c] ?? '';
    out.push(row);
  }
  return out;
}

/** A small CSV reader that respects quoted fields containing commas and doubled quotes. */
function parseLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const num = (v) => {
  if (!v) return null;
  const m = /^([0-9.]+)\s*([KMBT])?$/i.exec(String(v).trim());
  if (!m) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2]?.toUpperCase()] ?? 1;
  const x = Number(m[1]) * mult;
  return Number.isFinite(x) ? x : null;
};

// ---- equities, grouped by country ----
const byCountry = new Map();
let equityRows = 0;
const eqDir = path.join(SRC, 'database', 'equities');
for (const file of fs.readdirSync(eqDir).filter((f) => f.endsWith('.csv'))) {
  for (const r of readCsv(path.join(eqDir, file))) {
    if (!r.symbol || !r.name) continue;
    // Delisted instruments are kept but flagged: a backtest must not silently include them.
    if (String(r.delisted).toLowerCase() === 'true') continue;
    const country = r.country || 'Unknown';
    const code = COUNTRY_CODE[country];
    if (!code) continue;
    // A company can be listed in several places. Rank the listing so the domestic one wins:
    // a German GDR of an Indian company must not stand in for the Indian listing.
    const domestic = DOMESTIC_EXCHANGE[code];
    const ex = String(r.exchange || '').toUpperCase();
    const rank = ex === domestic ? 0 : (String(r.market || '').toLowerCase().includes(String(country).toLowerCase()) ? 1 : 2);
    equityRows++;
    if (!byCountry.has(code)) byCountry.set(code, []);
    byCountry.get(code).push({
      s: r.symbol,
      n: r.name,
      sec: r.sector || null,
      ind: r.industry || null,
      c: country,
      cur: r.currency || null,
      cap: num(r.market_cap),
      w: r.website || null,
      isin: r.isin || null,
      ex: r.exchange || null,
      rank,
    });
  }
}

// ---- other asset classes as their own bundles ----
function otherBundle(file, map) {
  const p = path.join(SRC, 'database', file);
  if (!fs.existsSync(p)) return [];
  return readCsv(p).filter((r) => r.symbol && r.name).map(map);
}

const crypto = otherBundle('cryptos.csv', (r) => ({
  s: r.symbol, n: r.name, sec: 'Crypto', ind: r.category || 'Cryptocurrency',
  c: 'Global', cur: r.currency || 'USD', cap: null, w: null, isin: null, ex: r.exchange || null,
}));
const indicesAll = otherBundle('indices.csv', (r) => ({
  s: r.symbol, n: r.name, sec: 'Index', ind: r.category || 'Index',
  c: r.country || 'Global', cur: r.currency || null, cap: null, w: null, isin: null, ex: r.exchange || null,
}));
// 82,371 index rows is 13 MB of mostly obscure series. Keep the ones whose name reads like a
// national or sector benchmark, which is what a user actually looks up.
const indices = indicesAll.filter((r) => {
  const name = r.n;
  if (name.length > 70) return false;
  // A benchmark reads like "NIFTY 50" or "S&P 500"; an obscure series carries a long code.
  const benchmark = /(index|indices|composite|sensex|nifty|dow jones|s&p|nasdaq|ftse|dax|nikkei|hang seng|\bcac\b|tsx|asx|kospi|straits times|shanghai|bovespa|ipsa|merval|tadawul)/i.test(name);
  const noisy = /\b(total return|net return|gross return|tr|nr|decrement|increment|leveraged|2x|3x|inverse)\b/i.test(name);
  return benchmark && !noisy;
});

const currencies = otherBundle('currencies.csv', (r) => ({
  s: r.symbol, n: r.name, sec: 'Currency', ind: 'Foreign exchange',
  c: 'Global', cur: r.currency || null, cap: null, w: null, isin: null, ex: r.exchange || null,
}));
const moneyMarkets = otherBundle('moneymarkets.csv', (r) => ({
  s: r.symbol, n: r.name, sec: 'Money Market', ind: r.category || 'Money market',
  c: r.country || 'Global', cur: r.currency || null, cap: null, w: null, isin: null, ex: r.exchange || null,
}));

// ---- write ----
let written = 0;
let total = 0;
const summary = [];
for (const [code, companies] of [...byCountry].sort((a, b) => b[1].length - a[1].length)) {
  // Deduplicate on symbol: a company listed on two exchanges appears twice.
  // Dedupe on the symbol only. Two share classes are two instruments, and a domestic listing
  // and its ADR are two listings — collapsing either would lose real rows.
  const seen = new Set();
  const unique = [...companies]
    .sort((a, b) => a.rank - b.rank || (b.cap ?? 0) - (a.cap ?? 0))
    .filter((c) => (seen.has(c.s) ? false : (seen.add(c.s), true)))
    .map(({ rank, ...rest }) => rest);
  fs.writeFileSync(path.join(OUT, `${code}.json`),
    JSON.stringify({ market: code, count: unique.length, source: 'FinanceDatabase (MIT)', companies: unique }));
  written++; total += unique.length;
  summary.push([code, unique.length]);
}

const extras = [
  ['GLOBAL', crypto], ['INDEX', indices], ['FX', currencies], ['MONEY', moneyMarkets],
];
for (const [code, rows] of extras) {
  if (!rows.length) continue;
  fs.writeFileSync(path.join(OUT, `${code}.json`),
    JSON.stringify({ market: code, count: rows.length, source: 'FinanceDatabase (MIT)', companies: rows }));
  written++; total += rows.length;
  summary.push([code, rows.length]);
}

console.log(`equity rows considered: ${equityRows}`);
console.log(`bundles written: ${written}`);
console.log(`instruments: ${total.toLocaleString()}`);
console.log('largest:', summary.slice(0, 12).map(([c, n]) => `${c}=${n}`).join(' '));
