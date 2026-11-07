# ATLAS — BUILD SPECIFICATION PROMPT

**Paste this entire document into any AI coding platform** (Cursor, Claude Code, ChatGPT,
Replit, Bolt, Lovable, Windsurf, or any other). It is a complete specification. The
implementing architect chooses the stack, the language and the libraries. The behaviour below
is not negotiable.

---

## ROLE

You are a principal engineer and product architect. You will build **Atlas**, a local-first
investment analysis platform, from this specification to a working, tested, shippable product.
You decide the architecture. You do not decide the behaviour.

Read the whole document before writing a line of code. Build continuously. Do not stop to ask
questions that this document answers. Where it is silent, make a defensible choice and record
it.

---

## 1. THE PRODUCT IN ONE PARAGRAPH

Atlas is an investment analysis platform that runs entirely on the user's own device. There is
no account, no server, no subscription and no telemetry. It covers four asset classes — stocks,
ETFs, forex and crypto — across nine country markets. It ships with a complete symbol universe
bundled offline, so a fresh install is useful before any network call. It runs a local
language model on the device for question answering. It produces four artefacts: a web app, a
PWA, an Android APK and a Windows executable.

---

## 2. THE DEFINING DECISION

> **The instrument decides the market, not the other way round.**

A user types `RELIANCE.NS`, `VOO`, `EURUSD=X` or `BTC-USD`. The app derives the **asset class**,
the **country**, the **currency** and the **trading hours** from the symbol itself.

There is no "wrong market" state to get stuck in. Searching for `AAPL` while India is active
must work and must switch the app to the United States.

Implement this first. Everything else depends on it.

---

## 3. NON-NEGOTIABLE CONSTRAINTS

These are acceptance criteria, not preferences. A build that violates any of them fails.

1. **No account, no login, no cloud backend.** The app runs on the device.
2. **Offline by default.** Every analysis screen must work with the network unplugged, from
   bundled data. A network call is an improvement, never a requirement.
3. **One storage engine, local.** SQLite or equivalent embedded database. Files the user owns.
4. **Isolation is physical, not filtered.** Each (market × asset class) pair gets its own
   database file. A bug must be structurally unable to leak one market's rows into another.
5. **Unknown is not zero.** A missing financial ratio must be stored and returned as null,
   never as 0. A screen for "P/E under 15" must never include a company whose P/E was never
   known.
6. **Impossible values are rejected.** A P/E of `1e308`, a negative market cap, a dividend
   yield above 100% must become null at the data boundary, not reach the screen.
7. **Provenance on every row.** Synthetic or demo data is tagged on every row and never
   presented as real.
8. **No fabricated content.** Do not invent investor names, quotes, methods, ratios or
   sources. If a claim cannot be supported, say so in the interface.
9. **Honest failure.** When something does not work, the interface says so and explains why.
   No silent failures, no fake success, no placeholder data presented as live.
10. **No evasion of third-party controls.** Do not build proxy rotation to evade bans, TLS
    fingerprint spoofing, header randomisation to avoid detection, or stealth headless
    browsers. These defeat a site's own access decision. Fetch politely from sources that
    permit access, and degrade honestly when one does not.

---

## 4. ASSET CLASSES

Four classes, each independent, each with its own database and its own analysis.

### 4.1 Stocks
Full fundamental analysis. This is the deepest class.

### 4.2 ETFs
Price behaviour, volatility, drawdown, and class-appropriate panels. Holdings, expense ratio
and tracking error are **listed as gaps** when the data is not available — never approximated.

### 4.3 Forex
Pip size, daily range measured in pips, volatility in pips, and session overlap between
financial centres. Carry is listed as a gap when no rate source exists.

### 4.4 Crypto
Twenty-four-hour trading (the session model must say "always open", not invent a close),
volume, liquidity, and volatility judged on a crypto-appropriate scale.

**Rule:** a panel that does not apply to a class is **absent, not empty**. A panel that applies
but lacks data **lists the gap**.

---

## 5. MARKETS

Nine country markets: India, United States, United Kingdom, Japan, Germany, Singapore,
Hong Kong, Australia, Canada. Plus two asset spaces that are not countries: **FX** (forex) and
**GLOBAL** (crypto).

Each market records: code, name, currency, currency symbol, locale, timezone, symbol suffix,
exchanges, fiscal year end, benchmark index.

**Trading sessions** must be modelled per market with real hours, including:
- pre-market and after-hours where they exist (the US has both)
- lunch breaks where exchanges close (Tokyo, Singapore, Hong Kong)
- weekend handling — a Friday-evening query must report the next open on Monday, correctly
- a live countdown to the next state change

---

## 6. FEATURE SPECIFICATION

Implement every item. Each is a testable acceptance criterion.

### 6.1 Screening
- An expression language over computed fields: `Market Cap > 500 AND ROE > 15`
- Natural-language queries translated to the same expression form
- Quick-filter chips for common screens
- Saved screens, a screen history, and a visual condition builder
- Sector filter, column sorting, pagination
- **Nulls sort last in both directions** — an unknown P/E is not the cheapest stock
- CSV and XLSX export that preserves numbers as numbers

### 6.2 Company analysis
- Header with name, sector, industry, currency
- Every ratio with its provenance
- Multi-year statements (annual and quarterly), with trend visualisation
- Peer comparison and percentile ranking within the sector
- A "data truth" panel: what is stored, how fresh, how complete, whether synthetic

### 6.3 Valuation
- Discounted cash flow with explicit assumptions
- **Reverse DCF** — solve for the growth rate a price implies; if the price falls outside the
  plausible bracket, return "no solution in this range" with a written explanation rather
  than inventing a number
- Bear / base / bull scenarios
- A sensitivity grid whose centre must equal the base case (assert this in a test)
- Margin of safety

### 6.4 Scoring
- Piotroski F-Score, Altman Z-Score, Beneish M-Score
- Each score must state which inputs were available; an incomplete score is marked incomplete

### 6.5 Alpha factors
At least 40 statistical features computed from stored price history, in groups:
- **K-bar shape**: `(close-open)/open`, `(high-low)/open`, position within range, upper and
  lower shadow, distance from the bar's midpoint
- **Rolling statistics**: moving averages, standard deviation, correlation, regression slope
- **Momentum**: rate of change over multiple windows, rank within window
- **Volume behaviour**: volume against its own average, up-volume versus down-volume
- **Breadth**: how the instrument sits against its own range

Every factor must be verified against a hand-computed value in a test.

### 6.6 Briefing
A written stance on a company or a market that includes:
- the position, stated plainly
- **falsifiers** — what would prove this view wrong
- **dissent detection** — flag a value trap, a good business at a full price, or a price
  running ahead of fundamentals
- a confidence level, and the basis for it

### 6.7 Discovery
- Sector phases: leading, improving, weakening, lagging — derived from trend, momentum and
  breadth
- Ranked candidates that **always name the least-strong dimension** of the case
- Instrument lifecycle: newly listed, upcoming, delisted, tracked as a delta against a stored
  snapshot so it works offline

### 6.8 Journal
- A decision record that **requires a written thesis**
- Outcomes graded right / wrong / early / flat / unresolved
- A material adverse move (10% or more) graded wrong, not early
- A scorecard comparing stated confidence against realised outcomes

### 6.9 Backtesting
- A documented strategy (for example, momentum rank-and-hold)
- Transaction costs charged
- The benchmark disclosed
- **Information ratio** reported alongside Sharpe
- Refuse to backtest what the strategy cannot test (a momentum strategy cannot be validated
  on fundamentals)

### 6.10 The Coffee Rule scorecard
Implement this ten-point fundamental checklist exactly, scoring from stored data:

| # | Line | Test |
|---|---|---|
| 1 | Explain the business in two lines | supply name, sector, industry |
| 2 | A clear moat | four sector signals: margin premium, margin stability, ROE above 15%, market-cap scale; two or more firing counts as evidence |
| 3 | Sales grown steadily | share of years that rose, minimum three periods |
| 4 | Profits grown with sales | growth is required — both falling fails |
| 5 | ROE / ROCE above 15% | from stored returns |
| 6 | Debt under control | D/E below 1 and interest cover above 3× |
| 7 | CFO close to net profit | ratio of at least 0.8 |
| 8 | Promoters steady, low pledge | holding change of 2 points or less, pledge 5% or less |
| 9 | P/E reasonable | against the company's own median built from stored prices, and against sector peers |
| 10 | No major red flags | five of seven testable: cash flow below half of profit, receivables outgrowing sales, share issuance, rising pledge, pledge above 20% |

Bands: 8–10 more coffee · 5–7 some foam · 0–4 mostly foam.

**Every unknown must carry a stated reason and must never be scored as a pass.** The three
red flags that need the annual report (auditor change, related-party transactions,
accounting-policy change) must be named as untestable rather than silently skipped.

### 6.11 The GUT pre-trade test
Three questions that must be answered before any trade:
1. What is the actual reason for this entry? — name the setup and the exact trigger
2. How much loss can I afford? — a rupee amount, inside 0.5% to 1% of capital
3. Where is the setup proven wrong? — a price, not a pain threshold

**The rule, enforced literally: one missing answer means no trade**, regardless of anything
else. A vague answer ("feels like it will go up") must be rejected as a non-answer.

A fourteen-item checklist in five categories: SETUP (3), RISK (3), EXIT (2), MARKET CONTEXT
(3), MINDSET (3).

**Position size:**
```
Quantity = Max loss ÷ (Entry price − Stop loss price)
```
The worked example must reproduce exactly: capital ₹5,00,000 at 1% gives ₹5,000; entry ₹500,
stop ₹490 gives risk per share ₹10 and **500 shares**.

### 6.12 Investor methods
At least 60 documented methods drawn from real, published investment approaches across the
nine markets, each runnable as a live screen. Each entry states:
- the approach in plain words
- the market it comes from
- the basis (documented or summary)
- **no invented quotes** — describe the method, never put words in a real person's mouth

Do not pad the list. Sixty real methods beat ten thousand invented ones.

### 6.13 News
- Per-market newsroom that follows the active market
- Named national press per country
- Deduplication, caching for offline reading, and a fallback source
- **No headline from one market may appear in another's view**

### 6.14 Local AI
- A catalogue of at least ten open models, each with a plain-English description of what it is
  good for, its RAM requirement, its licence and a device-fit verdict
- The app downloads a model itself, streaming to a temporary file and verifying the format
  before use
- Inference runs **on the device**, in a separate worker process
- Every answer is grounded in stored numbers, and every number the model states is
  cross-checked against the data; a model contradicting the data is flagged
- With no model installed, the assistant answers deterministically from stored data and says
  which engine answered
- The runtime is an **optional** dependency; the app must work without it

### 6.15 Data acquisition
- A catalogue of at least 100 sources, ten or more per data type, with priority ordering
- Failover: retry with exponential backoff and jitter, a circuit breaker with cooldown, and an
  honest report when every source is exhausted
- A polite client: honest User-Agent with a contact URL, `robots.txt` obeyed, a per-host rate
  limit, conditional requests, `Retry-After` honoured, and a stored copy served when offline

### 6.16 Infrastructure
- **Storage**: WAL mode, a busy timeout so concurrent writers wait rather than fail, an
  explicit retry on lock contention, and indexes for the queries the app actually runs
- **Sync**: a durable job queue, exponential recovery, a durable event log a developer can
  read, and a manual retry that bypasses the backoff
- **Performance**: latency percentiles, throughput, a series for charting, and threshold
  alerts that deduplicate
- **Tenancy**: scoped API keys stored only as hashes, compared in constant time, revocable
  immediately

---

## 7. INTERFACE

- Build your own design system. **Do not use a component library.** Define named tokens for
  colour, space, radius, type, elevation and motion, and use them everywhere.
- **Light and dark are equal citizens.** Dark mode must redefine the same tokens, not patch
  rules. Measure contrast in a browser: both themes must pass WCAG AA (4.5:1 for body text).
- No rule may contain a raw colour value; no class in the markup may be left unstyled.
- Every panel explains itself. Every empty state tells the user the next action.
- Every destructive or consequential action confirms.
- A command palette (Ctrl/Cmd+K) for jumping to any instrument or view.
- Resilient: a request timeout, bounded retries with backoff, no retry on client errors, an
  offline banner with a retry, and automatic reload when the connection returns.
- Support `prefers-reduced-motion`.

---

## 8. DATA MODEL

Minimum tables. Add what your design needs.

```
companies      id, symbol (unique), name, sector, industry, currency, source, listed_on, updated_at
statements     company_id, period_type, period_end, sales, expenses, operating_profit,
               interest, depreciation, net_profit, eps, equity_capital, borrowings,
               total_assets, receivables, cfo, cfi, cff
ratios         company_id, period_type, period_end, roe, roce, debt_to_equity, opm, npm,
               pe, pb, dividend_yield, market_cap, current_ratio, interest_coverage,
               asset_turnover, sales_growth, profit_growth    ← ALL NULLABLE
price_history  company_id, date, open, high, low, close, volume
shareholding   company_id, period_end, promoter, fii, dii, public, pledge_pct
watchlist      symbol, added_at
portfolio      symbol, quantity, avg_cost, added_at
journal        symbol, action, thesis, max_loss, stop_price, entry_price, created_at
```

**Critical:** every ratio column must be nullable. `NOT NULL DEFAULT 0` makes "unknown"
indistinguishable from "zero" and will silently corrupt every screen.

---

## 9. TESTING

Ship with at least 50 automated tests. These are mandatory:

| Test | What it must prove |
|---|---|
| Feature inventory | every endpoint, write path and view still exists |
| Market purity | no data, news or advisor crosses a market boundary |
| Asset isolation | stocks, ETFs, forex and crypto never mix |
| Full stack | every frontend call reaches a real route; every selector resolves; every button is wired |
| Response shapes | every field the UI reads exists in the API response |
| Null pipeline | nulls survive filter → sort → format → export → render |
| Data quality | impossible values rejected; unknown distinct from zero |
| Robustness | concurrent writers, malformed input, oversized bodies, memory bounds |
| Design | tokens defined, dark mode measured, no unstyled class, contrast measured |
| Mathematics | reverse DCF round-trips; sensitivity centre equals base; alpha factors match hand-computed values |
| Checklists | both checklists reproduce their source documents exactly |

A test that has not been run has not passed. Report actual results.

---

## 10. DELIVERY

Produce four artefacts:

1. **Source archive** — files at the archive root, no wrapper folder
2. **PWA** — a populated manifest, real PNG icons at 192 and 512, a registered service worker,
   a strict mobile viewport with `viewport-fit=cover`
3. **Android APK** — signed with a real release key, `resources.arsc` stored uncompressed and
   aligned, v1 and v2 signatures present
4. **Windows executable** — a genuine PE executable for x64

Each must be verified as a real artefact, not a renamed archive.

---

## 11. DEFINITION OF DONE

The build is complete only when all of these hold:

1. Every screen works with the network unplugged.
2. Every frontend call resolves to a real route, and every field the UI reads exists.
3. No market or asset class leaks into another, proven by test.
4. No number reaches the screen without passing a sanity check.
5. Unknown is distinguishable from zero everywhere.
6. Both themes pass WCAG AA.
7. Every test suite passes, and the results are reported as measured.
8. All four artefacts build and verify.
9. Every known limitation is either closed or written down with what would close it.

---

## 12. WHAT NOT TO DO

- Do not invent data, people, quotes, sources or ratios to fill a screen.
- Do not present demo or synthetic data as real.
- Do not claim a feature works because the code exists — run it.
- Do not build anti-bot evasion of any kind.
- Do not silently drop a requirement. If something cannot be built, say so in the interface
  and in the documentation, with the closest honest alternative.
- Do not stop at a plan. Build the product.

---

## 13. START HERE

1. Read this document completely.
2. Decide and record your architecture: language, storage, UI approach, build targets.
3. Implement the instrument resolver first — symbol to asset class and market.
4. Implement physical isolation: one database per (market × asset class).
5. Build the storage layer with nullable ratios and the sanity boundary.
6. Build the screener, then company analysis, then valuation.
7. Add the two checklists; they are small and high-value.
8. Add local AI last, as an optional layer.
9. Test continuously. Every feature ships with a test that would fail if it broke.
10. Deliver four verified artefacts and a document listing what you did not build and why.

**Build it completely. Ship it honestly.**
