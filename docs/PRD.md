# Atlas — Product Requirements Document

**Version 4.0** · Status: as-built · 2 November 2026 · Supersedes v3.0 (proposal)
**Product:** a local-first, multi-asset investment analysis platform.

---

## 1. Executive summary

Atlas is an investment analysis platform that runs entirely on the user's own device. There
is no account, no server, no subscription and no telemetry. One process, one SQLite file per
market, and a complete analysis engine that works with the network unplugged.

It covers **four asset classes** — stocks, ETFs, forex and crypto — across **nine country
markets**, with **27,117 companies** and **12,329 ETFs** bundled offline so a fresh install
is useful before any network call.

The product's defining decision is an inversion of the usual navigation:

> **The instrument decides the market, not the other way round.**

A user types `RELIANCE.NS`, `VOO`, `EURUSD=X` or `BTC-USD`. Atlas works out the asset class,
the country, the currency and the trading hours from the symbol itself.

---

## 2. What exists today

### 2.1 Scale

| Measure | Value |
|---|---|
| Version | 3.4.1 |
| Core modules | 85 |
| API endpoints | 64 |
| Test suites | 73 |
| Required dependencies | **1** (`better-sqlite3`) |
| Optional dependencies | 1 (`node-llama-cpp`) |
| Companies bundled | 27,117 |
| ETFs bundled | 12,329 |
| Country markets | 9 (+2 asset spaces: FX, GLOBAL) |

### 2.2 Asset classes

| Class | Analysis it provides | Status |
|---|---|---|
| **Stock** | fundamentals, valuation, Piotroski/Altman/Beneish, briefing, peers, journal | complete |
| **ETF** | price, volatility, drawdown; holdings/cost/tracking listed as gaps when data is absent | complete for the data available |
| **Forex** | pip size, range in pips, daily volatility in pips, session overlap | complete for the data available |
| **Crypto** | 24-hour trading, volume, liquidity, volatility on its own scale | complete for the data available |

A panel appears only where the class supports it. Panels that do not apply are **absent, not
empty**. When a class supports a panel but the data is missing, the gap is **listed**, never
approximated.

### 2.3 Analysis depth (stocks)

- **Fundamentals** — statements, ratios, owner earnings, cash conversion cycle, dilution,
  incremental ROIC, dividend safety, reinvestment rate, common-size analysis.
- **Valuation** — DCF, **reverse DCF** (solves for the growth a price implies), bear/base/bull
  scenarios, a 5×5 sensitivity grid, margin of safety.
- **Scoring** — Piotroski F, Altman Z, Beneish M.
- **Alpha factors** — 41 statistical features across 8 groups (K-bar shape, rolling
  statistics, momentum, volume behaviour, breadth).
- **Briefing** — a written stance with falsifiers and dissent detection (value trap,
  good-business-full-price, price-ahead-of-fundamentals).
- **Discovery** — sector phases (leading/improving/weakening/lagging), ranked candidates that
  always name the least-strong dimension, peer percentile ranking.
- **Judgment** — a decision journal where a thesis is required and outcomes are graded
  right/wrong/early/flat/unresolved.
- **Methods** — 67 documented investor methods across 9 markets, each runnable as a screen.

### 2.4 Data and reliability

- **158 catalogued sources**, 10+ per data type, with failover, retry with backoff, and
  circuit-breaker cooldown.
- **Polite fetching** — honest User-Agent, `robots.txt` obeyed, per-host rate limit,
  conditional GET, `Retry-After` honoured, cached copy served offline.
- **Instrument lifecycle** — new, upcoming and delisted tracked as a delta against a stored
  snapshot, so "new" means "appeared since the last check" and works offline.
- **Provenance** — every row carries its source; synthetic demo data is tagged DEMO on every
  row and never presented as real.

### 2.5 Local AI

- **10 models** in the catalogue, each with a plain-English description, RAM requirement,
  licence and a `fitsThisDevice` check.
- **Download** — the app fetches a model from HuggingFace itself, streaming to a `.part` file
  and verifying the GGUF magic before use.
- **Inference** — llama.cpp in a worker process. Verified: a real 485 MB Qwen2.5-0.5B model
  answered a real question on-device.
- **Grounding** — answers are built from stored numbers, and every number the model states is
  cross-checked against the data. A model that contradicts the data is flagged.
- **Optional** — with no model installed the assistant answers deterministically from stored
  data and says which engine answered.

### 2.6 Interface

- Own design system: **179 tokens**, no component library.
- **Real dark mode** — the same tokens redefined, measured in a browser, both themes pass
  WCAG AA (light 4.55:1, dark 5.52:1).
- 10 views, a ⌘K command palette, a trading-session badge with countdown for all 9 markets.
- Resilient: 15 s timeout, 3 attempts with backoff, offline banner, auto-reload on reconnect.

### 2.7 Delivery

| Target | Artefact | Size |
|---|---|---|
| Web / PWA | `atlas-pwa.zip` | 67 KB |
| Source + full project | `atlas-platform.zip` | 2.8 MB |
| Android | `atlas-release.apk` | 82 KB, signed v1/v2/v3 |
| Windows | `atlas.exe` | 53 MB, PE32+ x64 |

---

## 3. Architecture

### 3.1 Isolation, which is the load-bearing decision

One SQLite file per **(market × asset class)**:

```
data/markets/IN-STOCK.db   IN-ETF.db   US-ETF.db
             FX-FOREX.db   GLOBAL-CRYPTO.db
```

This is a **physical** guarantee, not a filter. A bug cannot leak one market's rows into
another because they are different files. It is proven at four levels: separate files, a
static source guard, a browser test that switches and reads the page, and an endpoint test
that follows the switch.

### 3.2 Storage engine

```
journal_mode   WAL              readers never block a writer
busy_timeout   5000 ms          a second writer waits rather than failing
synchronous    NORMAL           durable across app crashes
cache_size     16 MB
indexes        12, each for a query the app actually runs
```

`withWriteRetry` backs off and retries on `SQLITE_BUSY` only; a real error still throws.
Verified: two writers, 600 inserts, zero errors, integrity intact.

### 3.3 Data quality boundary

Every financial number passes a sanity check on the way out:

- impossible values (P/E of `1e308`, negative market cap, a yield above 100%) become `null`
- **missing is distinct from zero** — `ratios` columns are nullable, so "unknown" is
  representable and a `P/E < 15` screen cannot include a company whose P/E was never known
- `ScreenerRow` types declare `number | null`, so the compiler prevents the bug returning

### 3.4 Sync and observability

- **Sync engine** — durable job queue, exponential backoff (2s→10m), a durable event log for
  tracing, and a manual retry that bypasses the backoff.
- **Performance** — p50/p95/p99 latency, throughput, a 60-point series for charting, and
  threshold alerts (latency breach, 5xx, error rate) that deduplicate by id.
- **Tenancy** — scoped API keys stored only as SHA-256, compared in constant time, with
  immediate revocation.

---

## 4. Non-functional requirements

| Requirement | Target | Measured |
|---|---|---|
| Cold start | < 3 s | ~2 s |
| Screener query (p50) | < 100 ms | 1.2 ms |
| Screener query (p95) | < 500 ms | 24.7 ms |
| Offline capability | full analysis | verified with no network |
| Concurrent writers | 2 without error | 600/600 writes, 0 errors |
| Memory | bounded | 200 requests → 4.8 MB, plateaued |
| Contrast | WCAG AA | 4.55:1 light, 5.52:1 dark |
| Model inference | works on-device | 24 tokens in 13.2 s on 2 cores |

---

## 5. Test strategy

73 suites. The ones that matter most:

| Suite | What it guards |
|---|---|
| `feature-inventory` | 50 endpoints, 8 write paths, 10 views still exist |
| `market-purity` | no data or news crosses a market |
| `multasset` | resolution, switching, per-class analysis |
| `fullstack` | 122 frontend calls → real routes, 250 selectors, 57 buttons, 10 views |
| `shapes` | every field the UI reads exists in the API response |
| `null-pipeline` | nulls through filter → sort → format → export → render |
| `data-quality` | impossible values rejected, unknown distinct from zero |
| `robustness` | concurrency, malformed input, memory, financial maths |
| `design` | tokens, dark mode measured, no unstyled class |
| `apk` | the packaging rules that decide whether MIUI installs it |
| `unproven` | local inference, live fetch and the Windows binary |

---

## 6. Honest limitations

These are recorded because a product document that hides them is not useful.

| # | Limitation | Impact | What would close it |
|---|---|---|---|
| 1 | **Live quotes are rate-limited from shared IPs** | Yahoo returns 429. An official **NSE adapter** now fetches the index board and market status from the exchange itself (`/api/nse/board`), which is not rate-limited the same way; it degrades to the last stored board when unreachable | a licensed per-symbol feed for non-index quotes |
| 2 | **Forex carry unimplemented** | no policy-rate source in the free set | add a rates source |
| 3 | **ETF holdings absent** | no free constituent feed | parse issuer pages, or ship a bundle |
| 4 | **History depth 4–5 years** | Yahoo's limit, not a code limit | a deeper historical source |
| 5 | **"100% intent recognition" is not achievable** | `ask.ts` covers 7 intents by rule; anything outside falls back | measure misroutes before claiming accuracy |
| 6 | **Cloud sync is an interface, not a service** | the sync engine is ready; no server exists | an endpoint |
| 7 | **67 advisor methods, not 10,000** | padding further would mean inventing people | genuine research |
| 8 | **Direct newspaper scraping blocked** | all 12 national feeds refuse; news comes via Google News RSS | direct feeds when reachable |

---

## 7. Roadmap

**Shipped:** v3.4.1 — multi-asset, instrument-first navigation, offline universe, design
system, local inference, model download, Windows binary.

**Next, in priority order:**

1. **Broker/paper trading** — turn analysis into a tested decision loop.
2. **Cloud sync** — the engine exists; it needs an endpoint and conflict resolution UI.
3. **ETF holdings and forex carry** — the two analysis gaps that matter most.
4. **Deeper history** — a paid or licensed source for 10+ years.
5. **Mobile-first layout** — the console works on a phone but is designed for a desktop.

---

## 8. Success criteria

A release is accepted when all of these hold:

1. `npm test` passes with zero failures.
2. Every frontend call resolves to a real route and every field it reads exists.
3. No market or asset class leaks into another, proven by test.
4. No number reaches the screen without passing the sanity boundary.
5. Both themes pass WCAG AA.
6. All four artefacts build and verify.
7. Every limitation above is either closed or restated in the release notes.
