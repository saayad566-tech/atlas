# Deep analysis & data sources

26 additions in this release. Every number is computed locally from the stored
statements; nothing here calls a model or requires a paid service.

## Analysis

| # | Feature | What it answers | Where |
|---|---|---|---|
| 1 | **DuPont decomposition** | Is ROE driven by margin, turnover or leverage? | `metrics.ts` |
| 2 | **Cash conversion cycle** (DIO + DSO − DPO) | How long is cash tied up? | `metrics.ts` |
| 3 | **Accruals ratio** (Sloan) | Does profit convert to cash? | `metrics.ts` |
| 4 | **CAGR 3Y / 5Y** for sales and profit | Is growth real and durable? | `metrics.ts` |
| 5 | **Earnings volatility** | How lumpy are profits? | `metrics.ts` |
| 6 | **Margin trend** (5-year slope) | Are margins improving or eroding? | `metrics.ts` |
| 7 | **Incremental ROCE** | Does new capital earn a return? | `metrics.ts` |
| 8 | **FCF payout** | Is a dividend affordable? | `metrics.ts` |
| 9 | **Valuation vs sector + PEG** | Cheap relative to peers *and* to growth? | `metrics.ts` |
| 10 | **Sector percentiles** | Where does it rank on 8 metrics? | `metrics.ts` |
| 11 | **Peer matrix** | Side-by-side with the peer group | `metrics.ts` |
| 12 | **Piotroski F-Score** (9 checks) | Fundamental momentum | `scores.ts` |
| 13 | **Altman Z-Score** | Bankruptcy risk | `scores.ts` |
| 14 | **Beneish M-Score** | Earnings-manipulation screen | `scores.ts` |
| 15 | **Composite grade (A–D)** | One weighted quality view | `scores.ts` |

**Honesty on the models:** Beneish is *simplified* — SGAI is held at 1.0 (no SGA line
item is stored) and AQI is approximated from receivables + inventory + cash. The API
returns `simplified: true` and names both approximations in `notes`. The Altman
working-capital term uses a documented proxy (receivables + inventory + cash −
payables). These are screening aids, not verdicts.

## Workflow

| # | Feature | Notes |
|---|---|---|
| 16 | **10 preset screens** | Quality compounder, Graham value, Magic formula, Coffee can, Durable dividend, Debt-free, GARP, Turnaround watch, Promoter conviction, High margin — each a plain expression through the same safe compiler |
| 17 | **Saved screens** | Persist a named expression; re-run it later |
| 18 | **Watchlist** | Add/remove companies; joined to live metrics |
| 19 | **Notes** | A local note per company |
| 20 | **Alerts** | Rule-based checks over the watchlist (pledge, leverage, weak ROE, shrinking sales, low promoter) |

## Data sources (100% free)

| # | Source | Status | What it provides |
|---|---|---|---|
| 21 | **World Bank API** | **live, verified reachable** | GDP growth, CPI inflation, unemployment, investment, current account |
| 22 | **Yahoo Finance chart** | live, free, unofficial, rate-limited | Last price refresh for watchlist symbols |
| 23 | **CSV import** | local, always available | Bring your own annual statements; ratios are recomputed so imported rows become screenable |
| 24 | **SEC EDGAR companyfacts** | implemented, untested here (host blocked) | US 10-K XBRL facts |
| 25 | **Bundled demo pack** | always available | Deterministic 200-company dataset, labelled *demo data* |
| 26 | **Deep-analysis UI** | shipped | Scores, checks, deep tiles, percentiles on the company page |

## API added in this release

```
GET  /api/presets                 POST /api/saved-screens
GET  /api/saved-screens           DELETE /api/saved-screens/:id
GET  /api/watchlist               POST /api/watchlist {symbol}
DELETE /api/watchlist/:symbol     GET  /api/alerts
GET  /api/notes/:symbol           PUT  /api/notes/:symbol {body}
GET  /api/macro                   POST /api/macro/refresh {country}
POST /api/quotes/refresh {symbols}
POST /api/import/csv {csv}
GET  /api/company/:symbol         # now includes metrics, scores, peers, note, watched
```

## CSV format

Minimum columns: `symbol`, `period_end`, `sales`. Optional: `name`, `sector`,
`industry`, `currency`, `price`, and any of the statement fields (`net_profit`,
`equity_capital`, `reserves`, `borrowings`, `total_assets`, `total_liabilities`,
`cfo`, `receivables`, `inventory`, `payables`, `cash`, `operating_profit`,
`interest`, …). Missing numeric fields default to 0 rather than erroring, so a partial
row still imports.

---

# Round 2 — factor model, valuation, strength, cross-sectional analytics

27 further features. Same rule as before: every number is computed locally from the
stored statements, and every assumption is an explicit, named input.

## Factor model (`factors.ts`)

| # | Feature | What it is |
|---|---|---|
| 27 | **Value factor** | 0–100 percentile blend of cheap P/E, cheap P/B and dividend yield |
| 28 | **Quality factor** | percentile blend of ROE, ROCE and OPM |
| 29 | **Growth factor** | percentile blend of 3-year sales and profit growth |
| 30 | **Earnings-momentum factor** | growth *acceleration* (this year's growth minus last year's) |
| 31 | **Low-volatility factor** | inverse of the standard deviation of profit growth |
| 32 | **Size factor** | market-cap percentile |
| 33 | **Composite factor score** | weighted blend (quality 30%, value 25%, growth 20%, size 10%, momentum 10%, low-vol 5%) |
| 34 | **Sector-neutral z-scores** | how many sector standard deviations from the sector mean, per metric |
| 35 | **Universe ranking** | every company ordered by composite score (`GET /api/factors/rank`) |

Percentiles are computed with SQL window functions (`PERCENT_RANK`), so they are
always relative to the data actually in the database — never hard-coded thresholds.

## Valuation (`valuation.ts`)

| # | Feature | Note |
|---|---|---|
| 36 | **Graham number** | √(22.5 × EPS × book value per share) |
| 37 | **Margin of safety** | how far the price sits below the Graham number |
| 38 | **Earnings yield** | EPS / price |
| 39 | **DCF-lite fair value** | FCF/share grown for N years + Gordon terminal; assumptions returned with the result |
| 40 | **Margin sensitivity** | EPS impact of a ±200 bps operating-margin move, tax-adjusted |
| 41 | **Valuation percentiles** | where P/E and P/B rank against the universe |

The DCF refuses to return a number when `discount ≤ terminal growth` rather than
producing a nonsense value, and the assumptions are echoed in the response.

## Balance-sheet strength (`strength.ts`)

| # | Feature | Note |
|---|---|---|
| 42 | **Net debt / EBITDA** | EBITDA = stored operating profit (before interest and depreciation) |
| 43 | **Debt repayment years** | net debt ÷ free cash flow |
| 44 | **Cash conversion** | CFO ÷ EBITDA |
| 45 | **Working-capital intensity + trend** | WC as % of sales, and its 5-year slope |
| 46 | **Interest cover + trend** | EBIT ÷ interest, and whether it is improving |
| 47 | **Strength verdict** | fortress / solid / stretched / fragile, from the worst of leverage, cover and cash conversion |

## Cross-sectional analytics (`analytics.ts`)

| # | Feature | Note |
|---|---|---|
| 48 | **Screen distribution stats** | min / p25 / median / p75 / max / mean for 14 metrics of any result set |
| 49 | **Sector benchmarks** | median P/E, ROE, OPM, D/E, sales growth and market cap per sector |
| 50 | **Metric time series** | any stored metric as an ordered series (`GET /api/analytics/series/:symbol/:metric`) |

## Data sources & portability

| # | Feature | Note |
|---|---|---|
| 51 | **Multi-country macro comparison** | World Bank series for up to 5 countries (`GET /api/macro/compare?countries=IN,US,CN`) |
| 52 | **Enriched CSV export** | the screen plus composite/value/quality/growth, F-score, Altman Z, Graham number and strength verdict |
| 53 | **JSON backup / restore** | the entire local database as one document (`GET /api/backup`, `POST /api/restore`) |

## New API surface

```
GET  /api/factors/rank?limit=&sector=      GET /api/factors/:symbol
GET  /api/valuation/:symbol                GET /api/strength/:symbol
GET  /api/analytics/sectors                GET /api/analytics/metrics
GET  /api/analytics/series/:symbol/:metric GET /api/export/enriched.csv?expression=
GET  /api/macro/compare?countries=IN,US,CN GET /api/backup
POST /api/restore
```

`GET /api/company/:symbol` now also returns `factors`, `valuation` and `strength`,
and `POST /api/screen` returns distribution `stats` alongside the rows.
