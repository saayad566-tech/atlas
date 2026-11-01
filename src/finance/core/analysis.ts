// Offline analysis: red-flag detection and a health score.
//
// Everything here is computed from the stored statements — no model, no network.
// The result is deterministic and explainable, which is the point: a user can see
// exactly which numbers produced which flag.
import type { Database as DB } from 'better-sqlite3';
import type { RedFlag, HealthReport } from './types';

interface AnnualRow {
  period_end: string; sales: number; net_profit: number; operating_profit: number;
  opm_pct: number; interest: number; cfo: number; receivables: number; borrowings: number;
  equity_capital: number; reserves: number; total_assets: number;
}

export function analyseCompany(db: DB, symbol: string): HealthReport | null {
  const c = db.prepare(`SELECT id, symbol FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number; symbol: string } | undefined;
  if (!c) return null;
  const rows = db.prepare(`SELECT period_end, sales, net_profit, operating_profit, opm_pct, interest, cfo,
      receivables, borrowings, equity_capital, reserves, total_assets
    FROM statements WHERE company_id=? AND period_type='annual' ORDER BY period_end DESC`).all(c.id) as AnnualRow[];
  if (rows.length === 0) return null;

  const latest = rows[0]!;
  const prev = rows[1];
  const sh = db.prepare(`SELECT promoter, pledge_pct FROM shareholding WHERE company_id=? ORDER BY period_end DESC LIMIT 1`).get(c.id) as { promoter: number; pledge_pct: number } | undefined;
  const equity = latest.equity_capital + latest.reserves;
  const de = latest.borrowings / Math.max(1, equity);
  const ic = latest.operating_profit / Math.max(0.01, latest.interest);
  const flags: RedFlag[] = [];

  const add = (code: string, severity: RedFlag['severity'], label: string, detail: string): void => { flags.push({ code, severity, label, detail }); };

  if (sh && sh.pledge_pct >= 20) add('promoter-pledge', 'high', 'Promoter pledge', `${sh.pledge_pct.toFixed(1)}% of the promoter stake is pledged.`);
  else if (sh && sh.pledge_pct > 0) add('promoter-pledge-low', 'low', 'Small promoter pledge', `${sh.pledge_pct.toFixed(1)}% pledged.`);

  if (de > 2) add('high-leverage', 'high', 'High leverage', `Debt/equity ${de.toFixed(2)} — above 2.0.`);
  else if (de > 1) add('moderate-leverage', 'medium', 'Moderate leverage', `Debt/equity ${de.toFixed(2)}.`);

  if (latest.interest > 0 && ic < 2) add('weak-interest-cover', 'high', 'Weak interest cover', `Operating profit covers interest only ${ic.toFixed(1)}×.`);
  else if (latest.interest > 0 && ic < 4) add('thin-interest-cover', 'medium', 'Thin interest cover', `${ic.toFixed(1)}×.`);

  if (latest.cfo < 0) add('negative-cfo', 'high', 'Negative operating cash flow', `CFO is ₹${latest.cfo.toFixed(0)} Cr in the latest year.`);
  if (latest.net_profit > 0 && latest.cfo > 0 && latest.cfo < latest.net_profit * 0.5) {
    add('cash-profit-gap', 'medium', 'Profit not converting to cash', `CFO ₹${latest.cfo.toFixed(0)} Cr vs net profit ₹${latest.net_profit.toFixed(0)} Cr.`);
  }

  if (prev) {
    if (latest.sales < prev.sales) add('sales-decline', 'medium', 'Sales declined', `${prev.sales.toFixed(0)} → ${latest.sales.toFixed(0)} Cr.`);
    if (latest.net_profit < prev.net_profit) add('profit-decline', 'medium', 'Profit declined', `${prev.net_profit.toFixed(0)} → ${latest.net_profit.toFixed(0)} Cr.`);
    const opmDrop = prev.opm_pct - latest.opm_pct;
    if (opmDrop > 3) add('margin-compression', 'medium', 'Margin compression', `OPM ${prev.opm_pct.toFixed(1)}% → ${latest.opm_pct.toFixed(1)}%.`);
    if (prev.sales > 0 && latest.receivables > 0 && prev.receivables > 0) {
      const recG = latest.receivables / prev.receivables - 1;
      const salesG = latest.sales / prev.sales - 1;
      if (recG > salesG + 0.15) add('receivables-outpacing', 'low', 'Receivables outpacing sales', `Receivables +${(recG * 100).toFixed(0)}% vs sales +${(salesG * 100).toFixed(0)}%.`);
    }
  }

  if (sh && sh.promoter < 25) add('low-promoter', 'medium', 'Low promoter holding', `${sh.promoter.toFixed(1)}% — little skin in the game.`);
  if (latest.net_profit < 0) add('loss-making', 'high', 'Loss-making', `Net loss ₹${Math.abs(latest.net_profit).toFixed(0)} Cr.`);

  // Health score: start at 100, subtract by severity, add for strengths.
  let score = 100;
  for (const f of flags) score -= f.severity === 'high' ? 18 : f.severity === 'medium' ? 9 : 3;
  const latestRatio = db.prepare(`SELECT roe, roce FROM ratios WHERE company_id=? AND period_type='annual' ORDER BY period_end DESC LIMIT 1`).get(c.id) as { roe: number; roce: number } | undefined;
  if (latestRatio) {
    if (latestRatio.roe > 20) score += 8;
    else if (latestRatio.roe < 5) score -= 6;
    if (latestRatio.roce > 18) score += 5;
  }
  if (latest.cfo > latest.net_profit && latest.net_profit > 0) score += 5;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const verdict: HealthReport['verdict'] = score >= 75 ? 'strong' : score >= 50 ? 'fair' : 'weak';

  const highs = flags.filter((f) => f.severity === 'high').length;
  const summary = flags.length === 0
    ? `${c.symbol} shows no red flags in the latest annual data: leverage ${de.toFixed(2)}×, interest cover ${ic.toFixed(1)}×, cash flow positive.`
    : `${c.symbol} scores ${score}/100 (${verdict}). ${highs > 0 ? `${highs} high-severity flag(s). ` : ''}${flags.slice(0, 3).map((f) => f.label.toLowerCase()).join(', ')}.`;

  return { symbol: c.symbol, score, verdict, flags, summary };
}
