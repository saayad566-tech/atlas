# Data pipeline — every function works for every stock

The gap this closes: a live-fetched stock had a *snapshot* but no **history**, so DCF,
Piotroski, Altman, DuPont, the cash cycle and CAGR all showed `—`. Now a fetch pulls the
fundamentals history too, maps it into the same `statements` table the demo pack uses,
and recomputes ratios for every period. Every analysis function works identically for a
demo company and a live one.

## Verified on real symbols (live network)

| | `RELIANCE.NS` | `AAPL` |
|---|---|---|
| Annual periods | 4 | 4 |
| Quarterly periods | 5 | 5 |
| Piotroski F-Score | **7 / 9** | **8 / 9** |
| Altman Z | **2.38** (grey) | **13.36** (safe) |
| DuPont ROE | **8.93%** | **151.91%** |
| Cash conversion cycle | **23.66 days** | **−51.37 days** |
| Sales CAGR 3y | **6.39%** | **1.81%** |
| Balance-sheet verdict | solid | solid |
| Blended fair value | **₹1,517.84** vs price ₹1,201.80 (**+26.3%**, undervalued) | — |

Those are computed numbers from real filings, not placeholders.

## Pipeline (10)

| # | Feature | Detail |
|---|---|---|
| 1 | **Annual fundamentals ingestion** | Yahoo `fundamentals-timeseries`, 27 line items |
| 2 | **Quarterly ingestion** | 13 line items, quarterly periods |
| 3 | **Mapping to the statement model** | Revenue, gross profit, EBITDA, operating income, pretax, tax, net income, EPS, interest, depreciation, CFO, capex, assets, liabilities, equity, debt, cash, inventory, receivables, payables, current assets/liabilities, PPE |
| 4 | **Per-period ratio recomputation** | ROE, ROCE, D/E, margins, P/E, P/B, market cap, current ratio, interest cover, asset turnover, 3-year CAGRs — for **every** stored year, not just the latest |
| 5 | **Exact share count** | market cap ÷ price (the old `equity ÷ 10` face-value assumption was wrong for foreign currencies) |
| 6 | **Snapshot-row cleanup** | The "today" placeholder ratio row is removed once real fiscal periods exist, so P/E bands are not distorted |
| 7 | **Coverage detection** | annual/quarterly counts, year span, and a `ready` flag (2+ annual periods = Piotroski possible) |
| 8 | **On-demand history** | `POST /api/fin/api/live/history/:symbol` for any company already stored |
| 9 | **One-call fetch** | The normal fetch now returns summary + prices + history + coverage |
| 10 | **Graceful degradation** | If history cannot be fetched, the snapshot still works and the UI says "no history yet" |

## Data quality (5)

| # | Feature | Detail |
|---|---|---|
| 11 | **Prefix normalisation** | Yahoo returns `annualTotalRevenue`; the parser normalises to `TotalRevenue` (and indexes the response with the original key) |
| 12 | **Field fallbacks** | EBITDA → OperatingIncome → GrossProfit; TotalDebt → LongTermDebt; cash variants; liabilities derived from assets − equity when absent |
| 13 | **Balance-sheet plug** | `otherAssets` absorbs the difference so `assets = liabilities` holds |
| 14 | **Derived tax rate** | from pretax income and tax provision when both exist |
| 15 | **EPS-based share fallback** | when no price is known, shares come from net income ÷ EPS |

## Coverage-driven UX (3)

| # | Feature | Detail |
|---|---|---|
| 16 | **Coverage chip** | "4 annual periods · 4y" or "no history yet" in the company header |
| 17 | **Fetch history button** | Appears only when coverage is not ready; one click backfills |
| 18 | **Honest empty state** | Missing history shows `—`, never a zero that looks like a real number |

## What the pipeline unlocks (4)

| # | Feature | Detail |
|---|---|---|
| 19 | **Piotroski for live stocks** | 9 checks need two annual periods — now available |
| 20 | **Altman / Beneish for live stocks** | Bankruptcy and manipulation screens on real filings |
| 21 | **Multi-model valuation for live stocks** | Graham, DCF, earnings multiple, EV/EBITDA all produce per-share values |
| 22 | **DuPont, cash cycle, CAGRs, strength** | The full deep-analysis panel, on real data |

## Honest limits

- **Yahoo gives ~4–5 years**, not 10. Three-year CAGRs work; five-year CAGRs return
  `null` rather than a fabricated number. Import a CSV for a longer history.
- **Quarterly is shallow** (~5 periods) on the free endpoint.
- **Ratios use the current price** for historical P/E and market cap — a real historical
  P/E band needs historical prices, which the chart gives for one year only.
- **The source is unofficial** and rate-limited; the client retries once and the bulk
  refresh paces itself. The demo pack and CSV import remain the durable paths.
