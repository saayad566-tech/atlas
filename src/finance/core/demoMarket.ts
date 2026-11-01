// Demo market data.
//
// The fixture pack is synthetic and labelled as such. It was missing analysts,
// dividends and the earnings calendar, which left four panels empty on every demo
// company. This module generates them DETERMINISTICALLY from each company's own
// numbers, so the demo is complete and internally consistent — and still labelled
// `fixture` everywhere, never presented as real research.
import type { Database as DB } from 'better-sqlite3';
import { ensureMarketTables } from './marketdata';

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Deterministic PRNG seeded from a number (mulberry32). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ['A. Sharma', 'R. Iyer', 'M. Chen', 'S. Patel', 'L. Fernandez', 'K. Rao', 'D. Whitfield', 'P. Nair', 'J. Okafor', 'T. Suzuki'];
const RELATIONS = ['Officer', 'Director', 'Chief Executive Officer', 'Chief Financial Officer', 'VP Operations'];

export interface DemoMarketResult { companies: number; dividends: number; recommendations: number; estimates: number; surprises: number; insiders: number; calendars: number }

export function generateDemoMarketData(db: DB): DemoMarketResult {
  ensureMarketTables(db);
  const out: DemoMarketResult = { companies: 0, dividends: 0, recommendations: 0, estimates: 0, surprises: 0, insiders: 0, calendars: 0 };

  const companies = db.prepare(`SELECT id, symbol, name, sector FROM companies WHERE source='fixture'`).all() as Array<{ id: number; symbol: string; name: string; sector: string }>;

  const insDividend = db.prepare(`INSERT OR REPLACE INTO dividends (company_id,date,amount) VALUES (?,?,?)`);
  const insRec = db.prepare(`INSERT OR REPLACE INTO recommendations (company_id,period,strong_buy,buy,hold,sell,strong_sell) VALUES (?,?,?,?,?,?,?)`);
  const insTarget = db.prepare(`INSERT OR REPLACE INTO analyst_targets (company_id,target_low,target_mean,target_high,target_median,recommendation,num_analysts,fetched_at) VALUES (?,?,?,?,?,?,?,?)`);
  const insEst = db.prepare(`INSERT OR REPLACE INTO earnings_estimates (company_id,period,end_date,eps_est,eps_low,eps_high,revenue_est,growth,forward_pe) VALUES (?,?,?,?,?,?,?,?,?)`);
  const insSurprise = db.prepare(`INSERT OR REPLACE INTO earnings_surprises (company_id,quarter,actual,estimate,surprise_pct) VALUES (?,?,?,?,?)`);
  const insHolders = db.prepare(`INSERT OR REPLACE INTO holders (company_id,insiders_pct,institutions_pct,institutions_float_pct,institutions_count,fetched_at) VALUES (?,?,?,?,?,?)`);
  const insInsider = db.prepare(`INSERT OR REPLACE INTO insider_trades (company_id,date,name,relation,txn,shares,value) VALUES (?,?,?,?,?,?,?)`);
  const insCal = db.prepare(`INSERT OR REPLACE INTO calendar_events (company_id,earnings_date,eps_estimate,revenue_estimate,ex_dividend_date,dividend_date,fetched_at) VALUES (?,?,?,?,?,?,?)`);
  const insSplit = db.prepare(`INSERT OR REPLACE INTO splits (company_id,date,numerator,denominator) VALUES (?,?,?,?)`);

  const tx = db.transaction(() => {
    for (const c of companies) {
      const rand = prng(c.id * 7919 + 13);
      const latest = db.prepare(`SELECT * FROM statements WHERE company_id=? AND period_type='annual' ORDER BY period_end DESC LIMIT 1`).get(c.id) as Record<string, number | string> | undefined;
      const annuals = db.prepare(`SELECT * FROM statements WHERE company_id=? AND period_type='annual' ORDER BY period_end ASC`).all(c.id) as Array<Record<string, number | string>>;
      const quarters = db.prepare(`SELECT * FROM statements WHERE company_id=? AND period_type='quarterly' ORDER BY period_end ASC`).all(c.id) as Array<Record<string, number | string>>;
      const q = db.prepare(`SELECT price, market_cap AS mc, pe, roe, sales_growth_3y AS sg FROM v_latest WHERE id=?`).get(c.id) as { price: number; mc: number; pe: number; roe: number; sg: number } | undefined;
      const sh = db.prepare(`SELECT promoter, pledge_pct AS pledge FROM shareholding WHERE company_id=? ORDER BY period_end DESC LIMIT 1`).get(c.id) as { promoter: number; pledge: number } | undefined;
      if (!latest || !q || q.price <= 0) continue;

      const price = q.price;
      const shares = q.mc > 0 && price > 0 ? (q.mc * 1e7) / price : 0;      // count
      const netProfit = Number(latest['net_profit'] ?? 0);                    // crore
      const eps = Number(latest['eps'] ?? 0);
      const equity = Number(latest['equity_capital'] ?? 0) + Number(latest['reserves'] ?? 0);
      const bvps = shares > 0 ? (equity * 1e7) / shares : 0;
      const roe = Number(q.roe ?? 0);
      const growth = Number(q.sg ?? 0);

      // ---- dividends: a payout of THAT year's profit, four payments a year -----
      // Basing the payout on each year's profit is both more realistic and gives a
      // loss-making company a dividend history from its profitable years.
      const payout = 0.15 + rand() * 0.35;                                    // 15–50%
      let dividendCount = 0;
      let latestDps = 0;
      const window = annuals.slice(-5);
      const profitableYears = window.filter((r) => Number(r['net_profit'] ?? 0) > 0);
      // Guarantee a history: if every recent year was a loss, use the best year available.
      const payYears = profitableYears.length > 0 ? profitableYears
        : (annuals.length > 0 ? [annuals.reduce((best, r) => (Number(r['net_profit'] ?? 0) > Number(best['net_profit'] ?? 0) ? r : best), annuals[0]!)] : []);
      for (const row of payYears) {
        const profit = Number(row['net_profit'] ?? 0);
        if (shares <= 0) break;
        const yearDps = (Math.max(profit, 0) * payout * 1e7) / shares;
        if (yearDps <= 0.01) continue;
        latestDps = yearDps;
        const fyEnd = String(row['period_end']);
        const fy = Number(fyEnd.slice(0, 4));
        const endMonth = Number(fyEnd.slice(5, 7));
        for (let k = 0; k < 4; k++) {
          const month = ((endMonth + 2 + k * 3 - 1) % 12) + 1;
          const year = fy + (month <= endMonth ? 1 : 0);
          insDividend.run(c.id, `${year}-${String(month).padStart(2, '0')}-15`, r2(yearDps / 4));
          dividendCount++;
        }
      }
      const annualDps = latestDps;

      // ---- analysts: one signal (valuation gap vs price) drives BOTH the -------
      // recommendation counts and the price target, so they cannot disagree.
      const graham = eps > 0 && bvps > 0 ? Math.sqrt(22.5 * eps * bvps) : price;
      const gap = Math.max(-0.35, Math.min(0.45, (graham - price) / price));
      const target = r2(price * (1 + gap * 0.8));
      const upside = (target - price) / price;
      const quality = Math.max(0, Math.min(100, roe * 2 + growth * 1.2 + (payout > 0 ? 10 : 0)));
      const analysts = 5 + Math.floor(rand() * 30);
      const lean = Math.max(0, Math.min(1, 0.5 + upside * 2));
      const strongBuy = Math.round(lean * analysts * 0.35);
      const buy = Math.round(lean * analysts * 0.4);
      const hold = Math.max(0, analysts - strongBuy - buy - Math.round((1 - quality / 100) * analysts * 0.3));
      const sell = Math.max(0, analysts - strongBuy - buy - hold - Math.round((1 - quality / 100) * analysts * 0.15));
      const strongSell = Math.max(0, analysts - strongBuy - buy - hold - sell);
      insRec.run(c.id, '0m', strongBuy, buy, hold, sell, strongSell);
      insRec.run(c.id, '-1m', Math.max(0, strongBuy - 1), buy + 1, hold, sell, strongSell);
      insRec.run(c.id, '-2m', Math.max(0, strongBuy - 2), buy + 1, hold + 1, sell, strongSell);

      insTarget.run(c.id, r2(target * 0.78), target, r2(target * 1.28), r2(target * 1.02),
        upside > 0.1 ? 'buy' : upside > -0.05 ? 'hold' : 'sell', analysts, Date.now());

      // ---- earnings estimates for the current/next quarter and year ----------
      const lastQ = quarters[quarters.length - 1];
      const qEps = lastQ ? Number(lastQ['eps'] ?? 0) : eps / 4;
      const g = growth > 0 ? growth / 100 : 0.05;
      insEst.run(c.id, '0q', String(lastQ ? lastQ['period_end'] : ''), r2(qEps * (1 + g / 4)), r2(qEps * (1 + g / 4) * 0.9), r2(qEps * (1 + g / 4) * 1.1), r2(Number(lastQ ? lastQ['sales'] : 0)), r2(g * 100), r2(price / Math.max(0.01, qEps * (1 + g / 4))));
      insEst.run(c.id, '+1q', '', r2(qEps * (1 + g / 2)), r2(qEps * (1 + g / 2) * 0.9), r2(qEps * (1 + g / 2) * 1.1), null, r2(g * 100), null);
      insEst.run(c.id, '0y', String(latest['period_end']), r2(eps * (1 + g)), r2(eps * (1 + g) * 0.88), r2(eps * (1 + g) * 1.12), r2(Number(latest['sales'] ?? 0)), r2(g * 100), r2(price / Math.max(0.01, eps * (1 + g))));
      insEst.run(c.id, '+1y', '', r2(eps * (1 + g) ** 2), r2(eps * (1 + g) ** 2 * 0.85), r2(eps * (1 + g) ** 2 * 1.15), null, r2(g * 100), null);

      // ---- earnings surprises from the last four quarters -------------------
      let surprises = 0;
      for (const row of quarters.slice(-4)) {
        const actual = Number(row['eps'] ?? 0);
        if (actual === 0) continue;
        const beat = 0.92 + rand() * 0.18;                                    // −8% … +10%
        const estimate = actual / beat;
        insSurprise.run(c.id, String(row['period_end']), r2(actual), r2(estimate), r2(((actual - estimate) / Math.abs(estimate)) * 100));
        surprises++;
      }

      // ---- ownership ---------------------------------------------------------
      const insidersPct = Math.max(5, Math.min(80, sh ? sh.promoter : 35 + rand() * 30));
      // Institutions and insiders are disjoint holders, so together they cannot exceed
      // the whole company (leaving a float for the public).
      const institutionsPct = Math.max(1, Math.min(100 - insidersPct - 5, 15 + rand() * 45 + (q.mc > 20000 ? 15 : 0)));
      insHolders.run(c.id, r2(insidersPct), r2(institutionsPct), r2(institutionsPct * 0.9),
        50 + Math.floor(rand() * 400), Date.now());

      // ---- insider trades ----------------------------------------------------
      const trades = 3 + Math.floor(rand() * 4);
      for (let i = 0; i < trades; i++) {
        const daysAgo = 10 + Math.floor(rand() * 300);
        const date = new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
        const isSale = rand() > 0.45;
        const qty = Math.round((10000 + rand() * 90000) * (q.mc > 20000 ? 10 : 1));
        insInsider.run(c.id, date, NAMES[Math.floor(rand() * NAMES.length)]!, RELATIONS[Math.floor(rand() * RELATIONS.length)]!,
          isSale ? 'Sale at market price' : 'Purchase at market price', qty, r2(qty * price));
        out.insiders++;
      }

      // ---- calendar ----------------------------------------------------------
      const fyEnd = String(latest['period_end']);
      const earnings = new Date(Date.parse(fyEnd) + 45 * 86400000);
      const exDiv = new Date(earnings.getTime() + 20 * 86400000);
      insCal.run(c.id, earnings.toISOString().slice(0, 10), r2(eps * (1 + g)), r2(Number(latest['sales'] ?? 0)),
        annualDps > 0 ? exDiv.toISOString().slice(0, 10) : null,
        annualDps > 0 ? new Date(exDiv.getTime() + 10 * 86400000).toISOString().slice(0, 10) : null, Date.now());

      // ---- occasional split --------------------------------------------------
      if (rand() > 0.85) {
        const when = new Date(Date.now() - (200 + rand() * 800) * 86400000).toISOString().slice(0, 10);
        insSplit.run(c.id, when, 2, 1);
      }

      out.companies++;
      out.dividends += dividendCount;
      out.recommendations += 3;
      out.estimates += 4;
      out.surprises += surprises;
      out.calendars++;
    }
  });
  tx();
  return out;
}
