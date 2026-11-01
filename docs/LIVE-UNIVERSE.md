# Live universe — any listed stock, nothing hard-coded

The platform no longer depends on a fixed company list. A search reaches a live public
source; a fetch turns the result into a first-class, screenable company in the local
database. The bundled demo pack remains as an offline fallback.

## What was verified live (real network, real symbols)

| Symbol | Exchange | Sector | Market cap | P/E | Price history |
|---|---|---|---|---|---|
| `RELIANCE.NS` | NSE | Energy | ₹16,26,333 Cr | 21.8 | 246 sessions |
| `TMCV.NS` | NSE | Consumer Cyclical | ₹1,41,438 Cr | 22.4 | 235 sessions |
| `AAPL` | NASDAQ | Technology | $5.02 T | 39.4 | 251 sessions |

`TATAMOTORS.NS` returned **502** — because Tata Motors has actually demerged into
`TMCV.NS` / `TMPV.NS`. That is the point: the platform reports what the source says
rather than serving a stale hard-coded entry.

## Universe & search (10)

| # | Feature | Detail |
|---|---|---|
| 1 | **Live search** | Yahoo `/v1/finance/search` — any equity on any exchange, by name or symbol |
| 2 | **Fetch & analyse** | One click turns a search hit into a local company with fundamentals and price history |
| 3 | **Live fundamentals** | Sector, industry, country, employees, website, description, market cap, P/E, forward P/E, P/B, EPS, dividend yield, beta, 52-week range, analyst target, recommendation, revenue, margins, ROE, ROA, debt/equity, current ratio, cash, debt, FCF, growth |
| 4 | **Cookie + crumb session** | The handshake the public endpoint requires (consent → crumb → quoteSummary), handled once per session |
| 5 | **Price history** | One year of daily closes stored per company |
| 6 | **Live registry** | Every fetched company listed with exchange, currency and fetch time |
| 7 | **Bulk refresh** | Re-fetch up to 25 companies with a politeness delay between calls |
| 8 | **Exchange & currency aware** | NSE / BSE / NYSE / NASDAQ recorded per company |
| 9 | **Honest failure** | An unknown or delisted symbol returns 502 with a clear message — never a fake row |
| 10 | **Offline fallback** | With no network the demo pack and every stored company still work |

## Price & market analytics (7)

| # | Feature | Detail |
|---|---|---|
| 11 | **Returns** | 1m / 3m / 6m / 1y, computed **by date** (a trading year is ~250 sessions, not 252) |
| 12 | **Volatility** | Annualised σ of daily returns |
| 13 | **Max drawdown** | Peak-to-trough over the stored window |
| 14 | **52-week range** | High, low and where the price sits between them |
| 15 | **Momentum 12-1** | The classic skip-a-month momentum measure |
| 16 | **Sparkline** | Down-sampled close series for the UI |
| 17 | **Coverage** | Session count, so you know how much history a number is based on |

## Market & screening (5)

| # | Feature | Detail |
|---|---|---|
| 18 | **Market breadth** | % above the 52-week low, % with positive momentum, median drawdown across stored companies |
| 19 | **Live companies are screenable** | They enter `v_latest`, so the same expression engine filters them |
| 20 | **They join the factor ranking** | Percentiles and composite scores include live companies |
| 21 | **Search fallback chain** | Local full-text first, live search only when the local set has no match |
| 22 | **Price panel** | Returns, volatility, drawdown, range position and momentum on the company page |

## HTTP layer work this required (3)

| # | Feature | Why |
|---|---|---|
| 23 | **Chunked transfer decoding** | The proxy path returns raw sockets; Yahoo sends chunked bodies (Wikipedia did not) |
| 24 | **Redirect following** | Up to three hops, resolved against the original URL |
| 25 | **Proxy-aware egress** | A CONNECT tunnel when `https_proxy` is set — Node's fetch ignores it, curl honours it |

## API

```
GET  /api/fin/api/live/search?q=            GET  /api/fin/api/live/companies
POST /api/fin/api/live/fetch {symbol}       POST /api/fin/api/live/refresh {symbols?}
GET  /api/fin/api/price/:symbol             GET  /api/fin/api/market/breadth
```

## Honest limits

- **Fundamentals are a snapshot, not a history.** Yahoo's summary gives today's
  metrics; the 10-year statement table stays empty for live companies, so DCF, CAGR and
  Piotroski have nothing to work on until real statements are imported (CSV import does
  that today). The valuation lab will show `—` for those companies rather than inventing
  a number.
- **Rate limits are real.** Yahoo throttles bursts; the client retries once on 429 and
  the bulk refresh paces itself. Fetching thousands of symbols is a background job, not
  a click.
- **The source is unofficial.** Yahoo's endpoints are the ones its own web app uses;
  they are free but not a contract. The demo pack and CSV import are the durable paths.
- **Currency.** Market caps are stored in the company's own currency; a mixed-currency
  universe means the screener's "₹ Cr" label is only accurate for INR companies.
