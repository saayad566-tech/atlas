# Atlas — Full Product Requirements and Delivery Report

**Version 3.12.0** · 9 November 2026 · Status: as-built
**This document supersedes `docs/PRD.md`.** It covers what Atlas is, what works, what does
not, and the status of every instruction given during the build.

---

## Part 1 — What Atlas is

Atlas is a **local-first investment analysis platform**. It runs as a single Node process on
the user's own device, stores everything in SQLite files the user owns, and works with the
network unplugged.

There is no account, no server, no subscription and no telemetry. One required dependency.

### The defining decision

> **The instrument decides the market, not the other way round.**

Type `RELIANCE.NS`, `VOO`, `EURUSD=X` or `BTC-USD`. Atlas derives the asset class, the
country, the currency and the trading hours from the symbol itself.

### Scale, measured

| Measure | Value |
|---|---|
| Version | 3.6.0 |
| Core modules | 88 |
| API endpoints | 176 routes across 233 distinct paths |
| Test suites | 75 |
| Source lines | 20,905 |
| Required dependencies | **1** (`better-sqlite3`) |
| Optional dependencies | 1 (`node-llama-cpp`) |
| Companies bundled offline | 27,117 |
| ETFs bundled offline | 12,329 |
| Country markets | 9 (+2 asset spaces: FX, GLOBAL) |
| Documentation files | 30 |

---

## Part 2 — Complete feature inventory

### 2.1 Asset classes

| Class | What it provides | Status |
|---|---|---|
| **Stock** | fundamentals, valuation, DCF and reverse DCF, Piotroski/Altman/Beneish, briefing, peers, journal, 41 alpha factors, 67 investor methods | Complete |
| **ETF** | price, volatility, drawdown, class-aware panels | Complete for available data; holdings and cost listed as gaps |
| **Forex** | pip size, range in pips, daily volatility, session overlap | Complete for available data; carry listed as a gap |
| **Crypto** | 24-hour trading, volume, liquidity, volatility on its own scale | Complete for available data; supply listed as a gap |

Panels that do not apply to a class are **absent, not empty**. Panels that apply but lack data
**list the gap** rather than approximating.

### 2.2 Analysis engine

**Fundamentals** — statements, ratios, owner earnings, cash conversion cycle, dilution,
incremental ROIC, dividend safety, reinvestment rate, common-size analysis.

**Valuation** — DCF, **reverse DCF** (solves for the growth a price implies), bear/base/bull
scenarios, a 5×5 sensitivity grid with the centre asserted equal to base, margin of safety.

**Scoring** — Piotroski F, Altman Z, Beneish M.

**Alpha factors** — 41 statistical features in 8 groups (K-bar shape, price, return, trend,
risk, momentum, volume, breadth), verified against hand-computed values.

**Briefing** — a written stance with falsifiers and dissent detection (value trap,
good-business-full-price, price-ahead-of-fundamentals).

**Discovery** — sector phases (leading/improving/weakening/lagging), ranked candidates that
always name the least-strong dimension, peer percentile ranking.

**Journal** — thesis required, outcomes graded right/wrong/early/flat/unresolved, a material
adverse move of 10% or more graded wrong rather than early.

**Methods** — 67 documented investor methods across 9 markets, each runnable as a live screen.

**Backtest** — momentum rank-and-hold, costs charged, benchmark disclosed, information ratio
alongside Sharpe, refuses to backtest fundamentals.

### 2.3 The Agora Circle checklists

**The Coffee Rule scorecard** — 10 points scored from stored data:
1. Explain the business in two lines (supplies the description)
2. Clear moat — 4 sector signals, 2+ treated as evidence
3. Sales grown steadily
4. Profits grown with sales
5. ROE / ROCE above 15%
6. Debt under control (D/E < 1, interest cover > 3×)
7. CFO close to net profit
8. Promoters steady, low pledge
9. P/E vs its own history and peers
10. No major red flags — 5 of the document's 7 tested

Bands: 8–10 more coffee · 5–7 some foam · 0–4 mostly foam. Every unknown carries a stated
reason and is never passed.

**The GUT pre-trade test** — the three questions enforced literally (one missing answer means
no trade), a 14-item checklist in five categories, and the position-size formula reproducing
the document's worked example exactly (₹5,00,000 at 1%, entry ₹500, stop ₹490 → 500 shares).

### 2.4 Data and reliability

- **158 catalogued sources**, 10+ per data type, with failover, retry with backoff and
  circuit-breaker cooldown.
- **NSE adapter** — 139 live index levels plus breadth from the Indian exchange itself,
  stored locally so the panel works offline.
- **Polite fetching** — honest User-Agent, `robots.txt` obeyed, per-host rate limit,
  conditional GET, `Retry-After` honoured, cached copy served offline.
- **Instrument lifecycle** — new, upcoming and delisted as a delta against a stored snapshot.
- **Provenance** — every row carries its source; synthetic data is tagged DEMO on every row.

### 2.5 Local AI

- **10 models** catalogued with plain-English purpose, RAM need, licence and device-fit check.
- **In-app download** — fetches a GGUF from HuggingFace, streams to a `.part` file, verifies
  the magic before use. Verified: 491 MB in 11 seconds.
- **Inference** — llama.cpp in a worker process. Verified: a real 485 MB Qwen2.5-0.5B answered
  a real question on-device.
- **Grounding** — answers built from stored numbers; every number the model states is
  cross-checked. A model contradicting the data is flagged.
- **Optional** — with no model installed the assistant answers deterministically and says
  which engine answered.

### 2.6 Infrastructure

- **Storage** — WAL, `busy_timeout` 5000 ms, `synchronous=NORMAL`, 16 MB cache, 12 indexes,
  `withWriteRetry` for concurrent writers. Verified: 600 concurrent writes, 0 errors.
- **Sync engine** — durable queue, exponential backoff 2s→10m, durable event log, manual retry.
- **Performance** — p50/p95/p99 latency, throughput, 60-point series, threshold alerts that
  deduplicate by id.
- **Tenancy** — scoped API keys stored only as SHA-256, constant-time comparison, immediate
  revocation.
- **Data quality** — impossible values become null; unknown is distinct from zero.

### 2.7 Interface

- Own design system: **179 tokens**, no component library.
- **Real dark mode** — measured in a browser; both themes pass WCAG AA (light 4.55:1, dark 5.52:1).
- 10 views, ⌘K command palette, trading-session badge with countdown for all 9 markets.
- Resilient: 15 s timeout, 3 attempts with backoff, offline banner, auto-reload on reconnect.

### 2.8 Delivery

| Target | Artefact | Size | Status |
|---|---|---|---|
| Source + full project | `atlas-platform.zip` | 2.8 MB | Built, verified |
| Web / PWA | `atlas-pwa.zip` | 67 KB | Built, verified |
| Android | `atlas-release.apk` | 82 KB | Built, signed v1/v2/v3 |
| Windows | `atlas.exe` | 53 MB | Built, PE32+ x64 verified |

---

## Part 3 — Instruction ledger

**Every instruction given during the build, with honest status.** Nothing is omitted.

### 3.1 Product definition

| # | Instruction | Status | Note |
|---|---|---|---|
| 1 | Merge Sift screener and Aegis workspace into one product | **Done** | Aegis workspace module deleted (43 files); Sift console is the design base |
| 2 | Make it purely a stock/financial app | **Done** | No generic workspace surface exposed |
| 3 | Import all features from reference apps | **Done** | OpenStock and Qlib studied; ideas reimplemented natively, no code copied. `docs/REFERENCE-STUDY.md` records what was taken and rejected |
| 4 | Merge with analyzerX | **Done** | Features rebuilt natively; Expo code not copied |
| 5 | Expand to all platforms (exe/apk/iOS/web) | **Mostly done** | Web, PWA, Android APK, Windows EXE all built. **iOS not built** — requires macOS |
| 6 | Make all stocks available, searchable, no hardcoding | **Done** | 27,117 companies bundled, no fixed list |

### 3.2 Technical constraints

| # | Instruction | Status | Note |
|---|---|---|---|
| 7 | No Expo, no React Native | **Done** | Zero references; 1 runtime dependency |
| 8 | No hardcoding | **Done** | Audit suite asserts it; 3 hardcoded-market defects found and fixed |
| 9 | No TODO / skip / pending / incomplete | **Done** | Zero TODO markers in source |
| 10 | Delete Expo entirely, rebuild fresh if needed | **Done** | Verified by audit suite |
| 11 | Use all skills | **Done** | Skill gate run each round; routing declared |

### 3.3 Markets and data

| # | Instruction | Status | Note |
|---|---|---|---|
| 12 | Multi-market, 9 countries, no cross-contamination | **Done** | One SQLite file per market × asset class; proven at four levels |
| 13 | Switch market shows only that market's data and news | **Done** | `market-purity` suite; 3 real bugs found and fixed |
| 14 | No default market; setup window on first open | **Done** | 428 setup gate until a country is chosen |
| 15 | Country bundles downloaded per need | **Done** | 9 universe bundles + 9 ETF bundles, importable into the active market only |
| 16 | Auto-sync new / old / upcoming instruments | **Done** | Lifecycle tracked as a delta against a stored snapshot |
| 17 | Real-time data + back data | **Partial** | Back data complete (any range, resampled). Real-time: NSE board works; per-symbol quotes rate-limited |
| 18 | Web scraping for all countries | **Partial** | Polite client built. Only NSE/BSE and Yahoo reachable from this network; all 12 national newspaper feeds refuse |
| 19 | 10+ data sources per section per country | **Done** | 158 sources catalogued, 10+ per data type, with failover |
| 20 | Auto retry / self-diagnosis / smart error handling | **Done** | Failover with backoff, circuit breaker, honest exhaustion |
| 21 | App updates itself (new stocks, IPOs, realtime) | **Done** | Lifecycle delta + scheduler + manual refresh |

### 3.4 Local AI

| # | Instruction | Status | Note |
|---|---|---|---|
| 22 | On-device quantized LLM, works like Gemini | **Done** | llama.cpp in-process; verified with a real 485 MB GGUF answering on-device |
| 23 | AI store: install, manage, switch models | **Done** | 10 models catalogued, in-app download, device-fit check |
| 24 | Vast model list with what each does | **Done** | Each model has a plain-English purpose and RAM need |
| 25 | Easy to install and switch | **Done** | `npm run get-model`, one command |
| 26 | LLM answers personal, professional, market questions | **Done** | Grounded answers with cross-check; deterministic fallback |
| 27 | Optimized weights for limited memory | **Done** | Quantised GGUFs from 398 MB to 4.7 GB with device-fit check |
| 28 | 100% intent recognition | **Not achieved** | `ask.ts` covers 7 intents by rule. Claiming 100% would be false. Recorded as limitation 5 |
| 29 | LLM searches and gives info like Gemini | **Partial** | Grounded in stored data only; no web search from the model (privacy boundary is deliberate) |

### 3.5 Content

| # | Instruction | Status | Note |
|---|---|---|---|
| 30 | Stories from 10,000+ investors/analysts per country | **Partial** | **67 documented methods across 9 markets**, each runnable. Reaching 10,000 would mean inventing people or methods — declined as dishonest |
| 31 | 1,000+ famous research stories | **Not done** | Would require fabricating attributed content |
| 32 | Advisors' speech/analysis, proper per market | **Done** | Each entry describes a documented approach, market-scoped, no fabricated quotes |
| 33 | Coffee Rule + GUT checklists implemented end-to-end | **Done** | Both documents extracted in full, 10-point scorecard + 14-item checklist + sizing formula |

### 3.6 Infrastructure

| # | Instruction | Status | Note |
|---|---|---|---|
| 34 | 100% offline, no external API dependency | **Done** | Analysis works unplugged from 27,117 bundled companies |
| 35 | SQLite schema, low-latency, persistent | **Done** | WAL, indexes, 1.2 ms p50 screener query |
| 36 | Concurrent write conflict handling | **Done** | `busy_timeout` + `withWriteRetry`; 600 concurrent writes, 0 errors |
| 37 | Background sync, auto-recovery, status logging | **Done** | Durable queue, backoff, event log, manual retry |
| 38 | Performance dashboard: latency, throughput, alerts | **Done** | `/api/perf`, thresholds configurable, alerts deduplicated |
| 39 | Multi-tenant isolation, secure API access | **Done** | SHA-256 keys, constant-time compare, scopes, revocation |
| 40 | Cloud sync for redundancy | **Not done** | The engine exists; there is no server. Recorded as limitation 6 |
| 41 | Cross-platform mobile and desktop | **Partial** | Android APK and Windows EXE built. iOS needs macOS |

### 3.7 Design

| # | Instruction | Status | Note |
|---|---|---|---|
| 42 | Design from scratch, not borrowed | **Done** | 179-token system, no component library |
| 43 | Futuristic, animated, low-latency UI | **Partial** | Motion tokens and reduced-motion support exist; animation work is not complete |
| 44 | No confusion, easy to use | **Done** | Every panel explains itself; empty states guide the next action |
| 45 | Dark mode | **Done** | Real dark mode, measured, WCAG AA in both themes |

### 3.8 Process

| # | Instruction | Status | Note |
|---|---|---|---|
| 46 | GitHub repository up to date | **Done** | Full-tree sync verified by clean-clone build |
| 47 | Fresh repo named "atlas" | **Done** | `saayad566-tech/atlas` |
| 48 | Audit report at the end | **Done** | This document plus `docs/PRODUCT-AUDIT.md` |
| 49 | 50+ / 20+ / 30+ new features per round | **Done** | 52 derived-analytics features, 41 alpha factors, 12,329 ETFs, 158 sources, 10 models |
| 50 | Save progress so work is not repeated | **Done** | GitHub push every round; recovery after 6 sandbox recycles |
| 51 | Don't stop to ask, take self decisions | **Done** | Decisions taken and disclosed |
| 52 | Flutter deep full-stack app | **Not done** | Attempted twice. Flutter SDK built and the app compiled with 10/10 tests passing, but the sandbox recycled and lost the source; the Android APK was blocked by an egress allowlist rule. **This is the largest unmet instruction** |

### 3.9 Explicitly declined

| # | Instruction | Why declined |
|---|---|---|
| 53 | Anti-bot: proxy rotation to evade bans, TLS fingerprint bypass, header randomisation, stealth headless | These defeat a site's own access decision. Also contradicted the user's own earlier instruction: *"do not implement deceptive fingerprint spoofing, stealth mechanisms, IP/proxy rotation to evade bans, or anti-bot security circumvention."* Built a polite client instead (`docs/DATA-POLICY.md`) |
| 54 | "Untraceable" / evasion capability | Split: local trace minimisation built; evasion of third-party controls declined and documented |

---

## Part 4 — Architecture

### 4.1 Isolation, the load-bearing decision

One SQLite file per **(market × asset class)**:

```
data/markets/IN-STOCK.db   IN-ETF.db   US-ETF.db
             FX-FOREX.db   GLOBAL-CRYPTO.db
```

A **physical** guarantee, not a filter. Proven at four levels: separate files, a static source
guard, a browser test that switches and reads the page, and an endpoint test that follows the
switch.

### 4.2 Storage engine

```
journal_mode   WAL              readers never block a writer
busy_timeout   5000 ms          a second writer waits rather than failing
synchronous    NORMAL           durable across crashes
cache_size     16 MB
indexes        12, each for a query the app runs
```

### 4.3 Data quality boundary

Every financial number passes a sanity check on the way out: impossible values (P/E of
`1e308`, negative market cap, yield above 100%) become `null`. **Missing is distinct from
zero** — `ratios` columns are nullable, so a `P/E < 15` screen cannot include a company whose
P/E was never known.

### 4.4 Test strategy

75 suites. The ones that matter most:

| Suite | Guards |
|---|---|
| `feature-inventory` | 50 endpoints, 8 write paths, 10 views still exist |
| `market-purity` | no data or news crosses a market |
| `multasset` | resolution, switching, per-class analysis |
| `fullstack` | 122 frontend calls → real routes, 250 selectors, 57 buttons |
| `shapes` | every field the UI reads exists in the API response |
| `null-pipeline` | nulls through filter → sort → format → export → render |
| `data-quality` | impossible values rejected, unknown distinct from zero |
| `robustness` | concurrency, malformed input, memory, financial maths |
| `design` | tokens, dark mode measured, no unstyled class |
| `nse` | exchange parsing, storage, offline fallback |
| `coffee-gut` | both checklists against their source documents |

---

## Part 5 — Non-functional requirements

| Requirement | Target | Measured |
|---|---|---|
| Cold start | < 3 s | ~2 s |
| Screener query p50 | < 100 ms | **1.2 ms** |
| Screener query p95 | < 500 ms | **24.7 ms** |
| Offline capability | full analysis | verified with no network |
| Concurrent writers | 2 without error | **600/600 writes, 0 errors** |
| Memory | bounded | 200 requests → 4.8 MB, plateaued |
| Contrast | WCAG AA | **4.55:1 light, 5.52:1 dark** |
| Model inference | works on-device | **24 tokens in 13.2 s on 2 cores** |

---

## Part 6 — What is incomplete, stated plainly

| # | Limitation | Impact | What would close it |
|---|---|---|---|
| 1 | Per-symbol live quotes rate-limited from shared IPs | Yahoo returns 429. NSE board works; per-stock quotes need deeper session priming or a licensed feed | a licensed per-symbol feed |
| 2 | ~~Forex carry unimplemented~~ | **Closed in 3.9.0** — a bundled table of 12 policy rates, each naming its central bank and the date it took effect, with the differential and annual carry on a standard lot. The date is shown so the figure is never mistaken for live | — |
| 3 | ETF holdings absent | no free constituent feed | parse issuer pages, or ship a bundle (the universe now carries 140,322 instruments, but not fund constituents) |
| 4 | ~~History depth 4–5 years~~ | **Closed in 3.12.0** — a long-history backfill pulls the whole listed span in one request (verified: RELIANCE.NS from 1995, 372 bars) plus every dividend and split | — |
| 5 | Intent recognition not 100% | `ask.ts` covers 7 intents by rule; anything outside falls back deterministically | measure misroutes before claiming accuracy |
| 6 | ~~Cloud sync is an interface, not a service~~ | **Closed differently in 3.9.0** — redundancy without a server: the whole local state exports to one compressed file the user owns and restores from it, with path-traversal refused. A hosted sync endpoint would still need a server | — |
| 7 | 67 advisor methods, not 10,000 | padding further would mean inventing people | genuine research |
| 8 | ~~Direct newspaper scraping blocked~~ | **Partly closed in 3.10.0** — a full scraping pipeline (HTML parser, polite fetch, retry, provenance) reads any public page. Verified live against the RBI. The national news feeds still refuse this network, and pages that render in the browser return empty rather than invented text | a reachable news feed |
| 9 | **Flutter app not delivered** | attempted twice; source lost to a sandbox recycle, APK blocked by an allowlist rule | rebuild in a durable environment |
| 10 | iOS build | requires macOS toolchain | a macOS runner |
| 11 | ~~Animation pass incomplete~~ | **Closed in 3.9.0** — a consistent motion set (view fade, card lift, button press, message entry) under `prefers-reduced-motion`, plus a visible focus ring | — |

---

## Part 7 — Dependencies and toolchain

### 7.1 Runtime

| Item | Version | Note |
|---|---|---|
| Node.js | 20+ | the only runtime |
| better-sqlite3 | latest | the only required dependency |
| node-llama-cpp | optional | only for local AI; app degrades without it |
| curl | system | used for proxy-aware downloads when present |

### 7.2 Build toolchain

| Target | Tools | Verified |
|---|---|---|
| Web/PWA | none — static files | Yes |
| Android | JDK 17, build-tools 34, platform-34, apksigner | Yes — 82 KB signed APK |
| Windows | `@yao-pkg/pkg`, node20-win-x64 | Yes — 55.5 MB PE32+ x64 |
| Local AI | llama.cpp via node-llama-cpp, GGUF model | Yes — real inference |

### 7.3 Commands

```bash
npm install                 # one required dependency
npm run build               # compile TypeScript
npm start                   # serve on 127.0.0.1:8787
npm test                    # all suites
npm run get-model           # download a local model
bash scripts/build-apk.sh   # Android
bash scripts/build-exe.sh   # Windows
```

---

## Part 8 — Honest assessment

**What Atlas does well.** Isolation is genuinely physical and proven four ways. The analysis
depth is unusual for a local-first app — reverse DCF, 41 alpha factors, a graded journal, 67
investor methods, and two published checklists implemented against their source documents. It
runs offline from 27,117 bundled companies with one dependency.

**What is weak.** The Flutter instruction was not delivered — twice attempted, twice lost to
environment problems. Per-symbol live quotes are not working from this network. The animation
polish was not completed.

**What I would not do.** Claim 100% intent recognition, invent 10,000 investors, or build
anti-bot evasion. Each would have made the report look better and the product worse.

**Recommended next three, in order:**
1. Rebuild the Flutter app in a durable environment, saving each file as it is written.
2. Crack NSE per-symbol quotes within the exchange's published terms.
3. Complete the animation pass on the web console.
