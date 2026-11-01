# Deep analysis v2 + feature audit — 22 additions

Two things this round: a **feature audit** that proves every function works for a given
stock, and a **deeper analysis layer** (capital efficiency, quality trends, anomalies).

## The audit (1)

| # | Feature | Detail |
|---|---|---|
| 1 | **Feature-coverage audit** | Runs all 19 features for one symbol and reports pass / no-data / error with the value each produced. `GET /api/fin/api/audit/:symbol`, and a *Run feature audit* button on the company page |

Verified output: **19/19 passing for a demo company** and **19/19 for a live-fetched
`RELIANCE.NS`** (Piotroski 7/9, Altman 2.37, DuPont ROE 8.93%, CCC 23.66 d, CAGR 6.39%,
valuation ₹1,375.81, strength solid, 248 price sessions).

## Capital efficiency (5)

| # | Feature | Detail |
|---|---|---|
| 2 | **Invested capital** | equity + debt − cash — the capital actually deployed |
| 3 | **ROIC** | NOPAT ÷ invested capital, with the tax rate taken from the statements |
| 4 | **WACC-lite comparison** | ROIC against a risk-free + beta×ERP + size-premium cost of capital |
| 5 | **Economic value added** | (NOPAT − WACC × invested capital) in ₹ Cr — value created or destroyed |
| 6 | **Reinvestment rate & growth quality** | capex + net debt raised, over NOPAT; multiplied by ROIC to show whether growth creates value |

## Trends (7)

| # | Feature | Detail |
|---|---|---|
| 7 | **DuPont trend** | 5-year NPM × asset turnover × equity multiplier, with the resulting ROE |
| 8 | **ROE stability** | standard deviation of ROE — a compounder is steady, not spiky |
| 9 | **Earnings quality trend** | accruals (profit − cash flow) ÷ assets, per year |
| 10 | **Cash conversion trend** | CFO ÷ EBITDA, per year |
| 11 | **Working-capital days trend** | DIO + DSO − DPO, per year |
| 12 | **Margin trend** | operating margin, per year |
| 13 | **Debt trend** | debt/equity, per year |

## Quarterly (2)

| # | Feature | Detail |
|---|---|---|
| 14 | **Quarterly YoY** | latest quarters against the same quarter a year earlier |
| 15 | **Quarterly QoQ** | sequential growth for sales and profit |

## Quality & risk (4)

| # | Feature | Detail |
|---|---|---|
| 16 | **Capital allocation verdict** | self-funding / debt-funded / capex above CFO, from CFO vs capex vs Δdebt |
| 17 | **Anomaly detection** | any ≥50% year-on-year move in sales, profit, borrowings or receivables, named with its period |
| 18 | **Revenue vs receivables divergence** | receivables growing much faster than sales |
| 19 | **Data quality score** | how many of 13 required fields are populated, and exactly which are missing |

## Scores (2)

| # | Feature | Detail |
|---|---|---|
| 20 | **Valuation vs own history** | current P/E against the company's own 10-year median |
| 21 | **Scorecard** | weighted composite (ROIC 25%, stability 20%, cash conversion 20%, growth quality 20%, data quality 15%) graded A–D |
| 22 | **Everything surfaced in the UI** | capital-efficiency cards plus an audit table on the company page |

## Wiring fixes this round

| Fix | Why |
|---|---|
| **Demo companies now have 400 days of price history** | Price analytics was empty for every demo stock |
| **Peer fallback to the largest companies** | A freshly fetched live company has no same-sector peers yet |
| **No fabricated intelligence for live companies** | Segments, order books and guidance are no longer invented for a real stock |

## Honest notes

- Anomalies are **threshold flags**, not judgements — a 60% jump can be an acquisition.
- The scorecard weights are a choice, printed in the response so they can be argued with.
- Data quality reports **missing inputs** rather than silently scoring zero for them.
- Yahoo provides ~4–5 years, so 5-year trends are shorter than the demo pack's 10.
