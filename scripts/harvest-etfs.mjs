// Harvest the ETF universe from Yahoo's public lookup endpoint.
//
// FinanceDatabase ships an empty etfs.csv, so the fund list has to come from somewhere. The
// lookup endpoint returns up to 100 funds per query, so this sweeps a set of query terms and
// accumulates the unique symbols. Progress is saved after every term, so a run that is cut
// short resumes where it stopped instead of starting again.
//
// Polite by construction: the shared client rate-limits per host and identifies the app.

import fs from 'node:fs';
import path from 'node:path';
import { polite } from '../dist/finance/core/polite.js';

const OUT = path.join(process.cwd(), 'src', 'finance', 'data', 'universe', 'ETF.json');
const STATE = path.join(process.cwd(), 'data', 'etf-harvest-state.json');

// Letters, digits and category words: together they reach most listed funds.
const TERMS = [
  ...'abcdefghijklmnopqrstuvwxyz'.split(''),
  ...'0123456789'.split(''),
  'S&P', 'Nasdaq', 'Dow', 'dividend', 'bond', 'treasury', 'gold', 'silver', 'oil', 'energy',
  'china', 'india', 'japan', 'europe', 'emerging', 'world', 'global', 'tech', 'health',
  'value', 'growth', 'small cap', 'large cap', 'mid cap', 'real estate', 'financial',
  'semiconductor', 'clean energy', 'crypto', 'bitcoin', 'currency', 'inverse', 'leveraged',
];

function load() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { done: [], funds: {} }; }
}
function save(s) {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(s));
}

const state = load();
const budgetMs = Number(process.env.HARVEST_BUDGET_MS || 240_000);
const started = Date.now();
let queries = 0;

for (const term of TERMS) {
  if (state.done.includes(term)) continue;
  if (Date.now() - started > budgetMs) break;
  const url = `https://query1.finance.yahoo.com/v1/finance/lookup?query=${encodeURIComponent(term)}&type=etf&count=100&start=0`;
  try {
    const r = await polite.get(url);
    if (!r.ok) { console.log(`  ${term}: HTTP ${r.status} — skipped`); continue; }
    const j = JSON.parse(r.body);
    const docs = j.finance?.result?.[0]?.documents ?? [];
    let added = 0;
    for (const d of docs) {
      if (!d.symbol || state.funds[d.symbol]) continue;
      state.funds[d.symbol] = {
        s: d.symbol,
        n: d.shortName || d.longName || d.symbol,
        sec: 'ETF',
        ind: d.quoteType || 'Exchange traded fund',
        c: 'Global',
        cur: null,
        cap: null,
        w: null,
        isin: null,
        ex: d.exchange || null,
      };
      added++;
    }
    state.done.push(term);
    queries++;
    save(state);
    console.log(`  ${term.padEnd(14)} docs ${String(docs.length).padStart(3)}  new ${String(added).padStart(3)}  total ${Object.keys(state.funds).length}`);
  } catch (e) {
    console.log(`  ${term}: ${e instanceof Error ? e.message.slice(0, 40) : 'failed'} — skipped`);
  }
}

const funds = Object.values(state.funds);
if (funds.length) {
  fs.writeFileSync(OUT, JSON.stringify({
    market: 'ETF', count: funds.length, source: 'Yahoo Finance lookup (public)',
    note: 'Harvested from the public lookup endpoint; symbols and names only.',
    companies: funds.sort((a, b) => a.s.localeCompare(b.s)),
  }));
}

console.log(`\nterms done: ${state.done.length}/${TERMS.length} | queries this run: ${queries}`);
console.log(`unique ETFs: ${funds.length}`);
console.log(state.done.length < TERMS.length ? 'more terms remain — run again to continue' : 'harvest complete');
