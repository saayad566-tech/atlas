# Market intelligence + sanity audit — 31 additions

Two halves: a **sanity audit** that catches numbers that exist but are *wrong*, and a
**market-intelligence layer** (analysts, earnings, ownership, dividends, volume, risk)
that works for any stock the platform can fetch.

## Sanity audit (5) — the "real bugs" half

The previous audit only checked that a function produced *something*. It now also checks
that the something is **plausible**.

| # | Check | Catches |
|---|---|---|
| 1 | Price & market cap plausible | unit errors (a rupee value stored as crore) |
| 2 | Ratios in range | ROE outside −100…300, negative D/E or P/E |
| 3 | **Balance sheet balances** | assets ≠ liabilities — found a real bug this round |
| 4 | Valuation vs price | a fair value 0.001× or 1000× the price |
| 5 | CAGR plausible | growth outside ±200% |

A failing check reports `suspect` with the actual numbers, so it is actionable.

## Analysts (6)

| # | Feature | Detail |
|---|---|---|
| 6 | Recommendation trend | strong buy → strong sell counts by period |
| 7 | **Consensus score** | weighted 1–5 with a label (strong buy … strong sell) |
| 8 | Price targets | low / mean / high / median |
| 9 | Target upside | mean target against the current price |
| 10 | Analyst count | how many opinions the consensus rests on |
| 11 | Earnings estimates | current/next quarter and year: EPS, revenue, growth, forward P/E |

## Earnings (4)

| # | Feature | Detail |
|---|---|---|
| 12 | **Surprise history** | actual vs estimate for the last four quarters |
| 13 | Average surprise | mean beat/miss across those quarters |
| 14 | Next earnings date | from the calendar module, with EPS and revenue estimates |
| 15 | Ex-dividend date | upcoming dividend timing |

## Ownership (4)

| # | Feature | Detail |
|---|---|---|
| 16 | Institutional ownership % | and float-adjusted % |
| 17 | Insider ownership % | |
| 18 | Institution count | how many institutions hold it |
| 19 | **Insider transactions** | filer, relation, transaction text, shares, value; plus net value |

## Dividends (5)

| # | Feature | Detail |
|---|---|---|
| 20 | Dividend history | every payment from the chart events feed |
| 21 | TTM dividend | trailing twelve months |
| 22 | Dividend yield | TTM ÷ price |
| 23 | Dividend growth | CAGR of annual dividends |
| 24 | Streak | consecutive years with a payment |
| 25 | Yield on cost | TTM against the first year's dividend |

## Volume & risk (6)

| # | Feature | Detail |
|---|---|---|
| 26 | Average volume | 20-day and 60-day |
| 27 | Volume trend | recent vs longer average |
| 28 | Turnover & liquidity | ₹ Cr traded per day, labelled high/medium/low |
| 29 | **Momentum composite** | 1m, 3m, 6m and 12m returns averaged |
| 30 | Volatility regime | 20-day vs 250-day annualised σ (calm / normal / elevated) |
| 31 | 1-day 95% VaR | parametric, from the 20-day volatility |

## Real bugs found and fixed this round

| Bug | What happened |
|---|---|
| **`transaction` is a SQLite reserved word** | The insider-trades table failed to create with a syntax error; the column is now `txn`. |
| **Yahoo returns `{raw, fmt}` for dates** | Earnings-surprise quarters and insider trade dates parsed as empty strings — zero rows. Both now read `fmt`, falling back to epoch seconds. |
| **Yahoo's total liabilities exclude equity** | Assets showed ₹21.78 lakh crore against ₹10.92 lakh crore of liabilities — a 50% gap on every live company. `total_liabilities` is now the full funding side, and the sanity check proves it balances. |

## Verified

```
demo company : 24/24 audit checks passing (including 5 sanity checks)
RELIANCE.NS  : 24/24 audit checks passing
AAPL live    : analysts hold (3.48), target 329.25, dividends TTM 0.80 / 0.23% / 6y streak,
               institutions 66.3%, 86 insider trades, vol20 16.2% (calm), VaR −1.68%,
               turnover ₹1,341 Cr (high liquidity), 4 surprises averaging +5.27%
```

## Honest notes

- **Demo companies have no analysts, dividends or ownership** — those panels show `—`.
  Fabricating them would be the exact dishonesty this audit exists to prevent.
- Consensus weights (5-4-3-2-1) are a convention, not a truth; the raw counts are stored.
- VaR is **parametric** (normal assumption) and one-day; it understates fat tails.
- Turnover is computed from average volume × price and is only meaningful in the
  company's own currency.
