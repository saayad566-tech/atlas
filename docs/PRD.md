# Atlas — Product Requirements Document

**Version** 3.0 · **Status** proposal for review · **Date** 2 November 2026
**Supersedes** the implicit scope of v2.7.0, which is a stock-only product.

---

## 1. What Atlas is today

A local-first analysis platform that runs as one Node process on the user's own machine.
No account, no backend, one runtime dependency, all data in SQLite files the user owns.

**What exists and works (v2.7.0):**

| Area | Detail |
|---|---|
| Markets | 9 countries, one SQLite file each, isolation proven at four levels |
| Universe | 27,117 companies bundled offline from FinanceDatabase (MIT) |
| Screening | expression language, natural-language queries, custom ratios usable as columns and filters |
| Fundamentals | statements, ratios, Piotroski/Altman/Beneish, owner earnings, CCC, dilution, incremental ROIC, dividend safety |
| Valuation | DCF, reverse DCF, bear/base/bull scenarios, sensitivity grid, margin of safety |
| Analysis | written briefing with falsifiers, 41 alpha factors, multi-year trends, peer percentiles |
| Discovery | sector phases, ranked candidates that state what argues against them |
| Judgment | decision journal graded against what actually happened |
| Methods | 67 documented investor methods, market-scoped, runnable as screens |
| Data | 158 catalogued sources, failover with retry and cooldown, newsroom per country, back-data browser |
| Interface | own design system, 179 tokens, real dark mode, WCAG AA in both themes |

**What it is not:** it only understands **stocks**.

---

## 2. The change being proposed

Atlas becomes a **multi-asset platform**. Four asset classes — **stocks, ETFs, forex,
crypto** — each working independently, each with its own data, its own analysis and its own
screen.

And one inversion that changes the whole navigation model:

> **The instrument decides the market, not the other way round.**

Today the user picks a country, then browses stocks in it. After this change the user picks
an instrument — `RELIANCE.NS`, `VOO`, `EURUSD`, `BTC-USD` — and Atlas derives everything
else: which asset class it belongs to, which country, which currency, which exchange hours,
which analysis applies.

---

## 3. Why this inversion matters

| Today | After |
|---|---|
| Pick country → see stocks | Pick anything → Atlas knows the country |
| Wrong market selected = empty screen | Impossible: the instrument carries its market |
| Switching markets loses your place | Switching instruments keeps your context |
| One analysis engine for everything | The right analysis for the asset class |

The current model has a real failure mode: a user who searches `AAPL` while India is active
gets nothing. The inversion removes that class of bug entirely.

---

## 4. Asset classes and what each needs

### 4.1 Stocks — already built
Fundamentals, valuation, scores, briefing, peers. **No new work beyond registration.**

### 4.2 ETFs — new
| Need | Detail |
|---|---|
| Identity | ticker, name, issuer, domicile, inception date |
| Cost | expense ratio, tracking difference |
| Composition | holdings, sector weights, top-10 concentration |
| Size | AUM, average daily volume, bid-ask spread |
| Risk | tracking error vs benchmark, volatility, drawdown |
| Analysis | "is this ETF cheap for what it holds", overlap with another ETF |

### 4.3 Forex — new
| Need | Detail |
|---|---|
| Identity | pair, base, quote, pip size, lot convention |
| Rates | spot, bid/ask, forward points where available |
| Carry | interest rate differential between the two currencies |
| Sessions | the pair trades in overlapping sessions — London, New York, Tokyo |
| Analysis | range position, volatility in pips, carry direction, session activity |

### 4.4 Crypto — new
| Need | Detail |
|---|---|
| Identity | symbol, network, contract address where applicable |
| Market | price, volume, market cap, circulating vs total supply |
| Risk | volatility (far higher than equities), drawdown, liquidity depth |
| Sessions | 24/7 — the session model must say "always open", not force a fake close |
| Analysis | supply schedule, dominance, correlation with majors |

---

## 5. Architecture

### 5.1 Storage: one file per (asset class × market)

Today: `data/markets/IN.db`

After: `data/markets/IN-STOCK.db`, `US-ETF.db`, `GB-ETF.db`, `FX-FOREX.db`, `GLOBAL-CRYPTO.db`

**Why not one file with an `asset_class` column:** the isolation guarantee is currently
physical — separate files mean a bug cannot leak one market's rows into another. Adding a
column would replace a structural guarantee with a filter someone can forget. Keep it
physical.

**Migration:** `IN.db` becomes `IN-STOCK.db` on first run, with the old file kept until the
new one is verified.

### 5.2 Instrument resolution

New module `resolve.ts`:

```
resolve("RELIANCE.NS")  → { assetClass: 'stock', market: 'IN',  currency: 'INR', exchange: 'NSE' }
resolve("VOO")          → { assetClass: 'etf',   market: 'US',  currency: 'USD', exchange: 'NYSEARCA' }
resolve("EURUSD=X")     → { assetClass: 'forex', market: 'FX',  currency: 'USD', base: 'EUR' }
resolve("BTC-USD")      → { assetClass: 'crypto',market: 'GLOBAL', currency: 'USD' }
```

Rules, in order: explicit suffix → known exchange prefix → symbol shape → bundled universe
lookup → unknown. An unknown symbol is **refused**, never guessed into a market.

### 5.3 Switching by instrument

`POST /api/focus { symbol }` — resolves the symbol, switches asset class and market if
needed, and returns the resolved context. The console then reloads with that context.

### 5.4 What must not regress

The four isolation proofs must extend to asset classes:

1. Separate files (physical)
2. Static source guard (no cross-handle construction)
3. Browser test (switch and read the page)
4. Market-purity test (endpoints follow the switch)

---

## 6. Interface

### 6.1 Asset switcher
A control beside the market selector: `Stocks · ETFs · Forex · Crypto`. Choosing one filters
the universe and the screens to that class. It is a **filter over what exists**, not a
separate app.

### 6.2 Instrument-first search
`Ctrl+K` already searches stocks. It extends to all four classes, each result showing its
class and market:

```
RELIANCE.NS   Stock · India · Energy
VOO           ETF   · United States · S&P 500
EURUSD=X      Forex · EUR/USD
BTC-USD       Crypto · Bitcoin
```

Choosing a result **sets the market**, then opens the instrument.

### 6.3 Analysis panel per class
The company view becomes an instrument view whose panels depend on class:

- **Stock** — fundamentals, valuation, scores, briefing, peers, journal
- **ETF** — holdings, cost, tracking, overlap, exposure
- **Forex** — rate, carry, session overlap, pip volatility
- **Crypto** — supply, liquidity, volatility, dominance

Panels that do not apply are absent, not empty.

---

## 7. Acceptance criteria

A release is accepted when **all** of these pass:

1. `resolve()` returns the correct class and market for 40+ symbols across all four classes.
2. An unknown symbol is refused with a clear message, never assigned to a market.
3. Switching from a stock to an ETF changes the asset class **and** the market when needed.
4. After switching, no instrument from the previous class appears anywhere in the UI.
5. Each class's analysis panels render with real stored data — no placeholders.
6. Sessions say "24/7" for crypto instead of inventing a close.
7. Forex shows the session overlap correctly across London/New York/Tokyo.
8. The 63 existing suites still pass, including the feature inventory.
9. Four isolation proofs hold across asset classes as well as markets.
10. `data/markets/IN.db` migrates to `IN-STOCK.db` without data loss.

---

## 8. Plan

### Phase 1 — Foundation (no UI change)
- `assets.ts`: the four asset-class definitions with their capabilities
- `resolve.ts`: symbol → class + market, with tests over 40+ real symbols
- Storage key becomes `<market>-<class>`; migration of existing files
- **Gate:** resolution and migration suites pass

### Phase 2 — Instrument-first switching
- `POST /api/focus` and the console flow that follows it
- Command palette searches all four classes
- Asset switcher control
- **Gate:** switching a stock → ETF → stock leaves no residue

### Phase 3 — ETFs
- ETF schema: issuer, expense, AUM, holdings, tracking
- Analysis: cost, concentration, overlap, exposure
- **Gate:** a real ETF shows real holdings

### Phase 4 — Forex
- Pair schema, carry from rate differentials, session overlap
- **Gate:** EURUSD shows a rate, a carry direction and correct session state

### Phase 5 — Crypto
- Asset schema, supply, liquidity
- 24/7 session handling
- **Gate:** BTC shows price, supply and volatility; session reads "always open"

### Phase 6 — Isolation proofs extended
- Static guard, browser test, purity test all cover asset classes
- **Gate:** all four proofs green

---

## 9. Data sources

| Class | Free sources | Status |
|---|---|---|
| Stocks | Yahoo, bundled universe, 158 catalogued | working |
| ETFs | Yahoo, bundled universe, issuer pages | reachable |
| Forex | Yahoo (`EURUSD=X`), World Bank rate differentials | reachable |
| Crypto | Yahoo (`BTC-USD`), CoinGecko (blocked here) | Yahoo reachable |

The failover engine already handles a source being down; each class registers its own
sources rather than assuming one.

---

## 10. Risks and how they are handled

| Risk | Handling |
|---|---|
| Scope explosion — four analysis engines | Phase 3–5 each ship one class; nothing is half-built |
| Cross-class contamination | Physical separation, four proofs, not a filter |
| Crypto volatility misread as a bug | Volatility thresholds are per-class, not global |
| Forex needs sessions that never close | Session model gains a `continuous` phase |
| Migration loses data | Old file kept until the new one verifies |
| Analysis depth dilutes | Stocks stay the deepest; other classes get their own correct analysis, not a stripped copy |

---

## 11. What is explicitly out of scope

- Options, futures, bonds, commodities — a later decision, not this PRD
- Multi-user accounts, cloud sync — Atlas stays local-first
- Broker execution — Atlas analyses, it does not trade
- Real-time streaming for every class — polling cadence differs per class and is stated

---

## 12. Open questions for the reviewer

1. **Should crypto and forex be market-scoped at all?** They are global, not per-country.
   The proposal gives them `GLOBAL` and `FX` as pseudo-markets so the same isolation model
   applies unchanged. Is that the right call, or should they bypass market switching?
2. **Which ETF and crypto sources do you want prioritised?** Yahoo covers both; dedicated
   providers are blocked from this network.
3. **Should the asset switcher hide other classes or show them greyed?** Hiding is cleaner;
   greying teaches the user what exists.
