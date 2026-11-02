// Convert FinanceDatabase exchange CSVs into compact per-market bundles.
//
// FinanceDatabase is a free, MIT-licensed dataset of listed companies. This keeps only the
// fields Atlas uses — symbol, name, sector, industry, country, currency, market cap — and
// writes one small JSON per market, so the app ships a real symbol universe offline.
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2] || '/scratch/work/findb';
const OUT = process.argv[3] || path.join(process.cwd(), 'src', 'finance', 'data', 'universe');

const MARKETS = {
  IN: ['NSE', 'BSE'],
  US: ['NYQ', 'NMS', 'ASE', 'PCX'],
  GB: ['LSE'],
  JP: ['JPX'],
  DE: ['GER'],
  SG: ['SES'],
  HK: ['HKG'],
  AU: ['ASX'],
  CA: ['TOR'],
};

/** Minimal CSV parser that respects quoted fields containing commas and newlines. */
function parseCsv(text) {
  const rows = [];
  let field = '', row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function findDatabaseRoot(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (fs.statSync(p).isDirectory()) {
      if (fs.existsSync(path.join(p, 'database', 'equities'))) return path.join(p, 'database');
      const deeper = findDatabaseRoot(p);
      if (deeper) return deeper;
    }
  }
  return null;
}

const dbRoot = findDatabaseRoot(SRC);
if (!dbRoot) { console.error('FinanceDatabase not found under', SRC); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

let totalRows = 0;
const summary = [];

for (const [code, exchanges] of Object.entries(MARKETS)) {
  const seen = new Set();
  const out = [];
  for (const ex of exchanges) {
    const file = path.join(dbRoot, 'equities', `${ex}.csv`);
    if (!fs.existsSync(file)) { console.warn(`  skip ${code}/${ex} (no file)`); continue; }
    const rows = parseCsv(fs.readFileSync(file, 'utf8'));
    const head = rows[0];
    const col = (name) => head.indexOf(name);
    const iSym = col('symbol'), iName = col('name'), iSec = col('sector'), iInd = col('industry'),
          iCtry = col('country'), iCur = col('currency'), iCap = col('market_cap'), iDel = col('delisted'),
          iSite = col('website'), iIsin = col('isin');

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length < 5) continue;
      const symbol = (row[iSym] || '').trim();
      if (!symbol || seen.has(symbol)) continue;
      if (iDel >= 0 && String(row[iDel]).toLowerCase() === 'true') continue;
      seen.add(symbol);
      out.push({
        s: symbol,
        n: (row[iName] || '').trim().slice(0, 90),
        sec: (row[iSec] || '').trim() || null,
        ind: (row[iInd] || '').trim() || null,
        c: (row[iCtry] || '').trim() || null,
        cur: (row[iCur] || '').trim() || null,
        cap: Number(row[iCap]) || null,
        w: iSite >= 0 ? (row[iSite] || '').trim() || null : null,
        isin: iIsin >= 0 ? (row[iIsin] || '').trim() || null : null,
      });
    }
  }
  out.sort((a, b) => (b.cap ?? 0) - (a.cap ?? 0));
  const file = path.join(OUT, `${code}.json`);
  fs.writeFileSync(file, JSON.stringify({ market: code, count: out.length, companies: out }));
  const kb = Math.round(fs.statSync(file).size / 1024);
  totalRows += out.length;
  summary.push({ market: code, count: out.length, kb });
  console.log(`  ${code}: ${out.length} companies, ${kb} KB`);
}

console.log(`\ntotal: ${totalRows} companies across ${summary.length} markets`);
console.log(`licence: FinanceDatabase is MIT. Source: github.com/JerBouma/FinanceDatabase`);
