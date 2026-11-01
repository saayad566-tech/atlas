# Atlas roadmap — 110 items

**71 done · 30 planned · 9 blocked** (machine-readable: `docs/roadmap.json`)


## 1. Data & sources

| ID | Item | Status | Effort |
|---|---|---|---|
| D01 | Market bundle registry (9 countries) | **done** | S |
| D02 | Per-market database isolation | **done** | M |
| D03 | Bundle descriptor (db + universe + model) | **done** | S |
| D04 | Yahoo adapter (prices, statements, analysts, dividends, ownership) | **done** | L |
| D05 | Google News RSS + Yahoo RSS adapters | **done** | S |
| D06 | Wikipedia description adapter | **done** | S |
| D07 | World Bank macro adapter | **done** | S |
| D08 | CSV import (statements + company-only) | **done** | M |
| D09 | JSON import / backup / restore | **done** | M |
| D10 | Manual entry (ratings, peers, portfolio, assumptions) | **done** | S |
| D11 | Deterministic demo generator (100% coverage) | **done** | L |
| D12 | Source registry with live status probing | **done** | M |
| D13 | SEC EDGAR adapter | blocked | M |
| D14 | NSE India adapter (shareholding, announcements) | blocked | M |
| D15 | Stooq price history adapter | blocked | S |
| D16 | OpenFIGI identifier mapping | blocked | S |
| D17 | GLEIF corporate hierarchy | blocked | S |
| D18 | Frankfurter FX adapter | blocked | S |
| D19 | Bulk universe sync via job queue | planned | M |
| D20 | Scheduled nightly refresh | planned | M |

## 2. Analysis & intelligence

| ID | Item | Status | Effort |
|---|---|---|---|
| A01 | Expression screener (tokenizer → AST → SQL) | **done** | L |
| A02 | Natural-language query with visible parse | **done** | M |
| A03 | Sector, ratio, score and valuation presets | **done** | M |
| A04 | Piotroski / Altman / Beneish + composite | **done** | M |
| A05 | DuPont, CCC, CAGR, red flags | **done** | M |
| A06 | ROIC, EVA, reinvestment, growth quality | **done** | M |
| A07 | Trend series (margin, debt, accruals, WC days) | **done** | M |
| A08 | Quarterly YoY / QoQ | **done** | S |
| A09 | Anomaly detection (≥50% YoY moves) | **done** | S |
| A10 | Data-quality score with missing inputs named | **done** | S |
| A11 | Five valuation models + scenarios + blend | **done** | L |
| A12 | Bear/base/bull band, P/E band, Markdown report | **done** | M |
| A13 | Balance-sheet strength verdict | **done** | S |
| A14 | Company intelligence (segments, order book, guidance) | **done** | L |
| A15 | Dividends: history, TTM, growth, streak, yield on cost | **done** | M |
| A16 | Analyst consensus, targets, forward estimates | **done** | M |
| A17 | Ownership and insider transactions | **done** | M |
| A18 | Earnings estimates, surprises, calendar, reaction | **done** | M |
| A19 | Correlation matrix, Sharpe-like ratio, drawdown recovery | **done** | M |
| A20 | Sector rotation, breadth, freshness, coverage | **done** | M |
| A21 | Atlas Score (7 weighted inputs, all exposed) | **done** | M |
| A22 | Explainer ('why these numbers') | **done** | S |
| A23 | Total return (price + dividends) | **done** | S |
| A24 | Investability score A–D | **done** | S |
| A25 | Backtesting engine | planned | L |

## 3. AI & on-device

| ID | Item | Status | Effort |
|---|---|---|---|
| I01 | Local LLM client, loopback-only guard | **done** | M |
| I02 | Grounded answers from computed facts | **done** | M |
| I03 | Numeric cross-check (flags invented figures) | **done** | M |
| I04 | Deterministic fallback when no model | **done** | M |
| I05 | AI Store: catalogue, install, verify, uninstall | **done** | M |
| I06 | Quantized model packs (Qwen 1.5B/3B, Llama 1B) | **done** | S |
| I07 | Model download with resume + checksum | planned | M |
| I08 | Prompt library for market questions | planned | S |
| I09 | Multi-turn conversation memory | planned | M |
| I10 | On-device embeddings for peer similarity | planned | M |
| I11 | Local document Q&A (annual report PDFs) | planned | L |
| I12 | Model A/B comparison harness | planned | M |
| I13 | Speech input for questions | planned | M |
| I14 | Answer citations linking to the metric row | planned | S |
| I15 | A model actually running in CI | blocked | L |

## 4. UX & accessibility

| ID | Item | Status | Effort |
|---|---|---|---|
| U01 | Dense tabular console with 11 views | **done** | L |
| U02 | Market switcher with 9 countries | **done** | S |
| U03 | Touch targets ≥44px on mobile | **done** | S |
| U04 | Every input has an accessible name | **done** | S |
| U05 | WCAG AA contrast (7.61:1 secondary text) | **done** | S |
| U06 | Lock screen with PIN | **done** | M |
| U07 | Dark/light theme | **done** | S |
| U08 | Import screen: sources + feature matrix | **done** | M |
| U09 | Intelligence view (breadth, rotation, coverage, jobs) | **done** | M |
| U10 | Compare view (2–5 companies) | **done** | S |
| U11 | AI Store view | **done** | M |
| U12 | Keyboard shortcuts (/, g+d, ?) | planned | S |
| U13 | Shareable screen URLs (?expr=) | planned | S |
| U14 | Hindi + regional UI strings | planned | M |
| U15 | Print/PDF tearsheet | planned | M |

## 5. Platform & ops

| ID | Item | Status | Effort |
|---|---|---|---|
| P01 | PIN auth, PBKDF2-SHA256, lockout, sessions | **done** | M |
| P02 | Rate limiting (240/min, token bucket) | **done** | S |
| P03 | Security headers (CSP, XFO, nosniff) | **done** | S |
| P04 | Clean error envelope, no stack leaks | **done** | S |
| P05 | Health endpoint, version single-sourced | **done** | S |
| P06 | Persistent job queue with crash recovery | **done** | M |
| P07 | Graceful shutdown (SIGINT/SIGTERM) | **done** | S |
| P08 | CI workflow, linted 0/0 | **done** | M |
| P09 | Ten verification suites, one command | **done** | L |
| P10 | Git repository with history | **done** | S |
| P11 | TLS termination | planned | S |
| P12 | Multi-user accounts and roles | planned | L |
| P13 | Postgres + Redis session store | planned | L |
| P14 | Audit log of user actions | planned | M |
| P15 | Container image + compose file | planned | M |

## 6. Distribution & packaging

| ID | Item | Status | Effort |
|---|---|---|---|
| X01 | PWA manifest, real icons, service worker | **done** | M |
| X02 | Flat archives, no wrapper folder | **done** | S |
| X03 | Archive validator (structure, icons, refs) | **done** | S |
| X04 | Android signing kit + TWA config + assetlinks route | **done** | M |
| X05 | APK compile and sign | blocked | M |
| X06 | Windows .exe via Electron | blocked | L |
| X07 | iOS wrapper (WKWebView) | planned | M |
| X08 | Auto-update channel | planned | M |
| X09 | Play Store listing assets | planned | S |
| X10 | Desktop menu-bar app | planned | M |

## 7. Compliance & trust

| ID | Item | Status | Effort |
|---|---|---|---|
| C01 | Synthetic data labelled everywhere (fixture) | **done** | S |
| C02 | Not-investment-advice disclaimer in reports | planned | S |
| C03 | Data provenance per row (source column) | **done** | S |
| C04 | Privacy note: device-only, no telemetry | **done** | S |
| C05 | No bot-protection circumvention (documented) | **done** | S |
| C06 | Licence audit of every dependency | planned | S |
| C07 | GDPR-style export/delete of personal data | planned | M |
| C08 | Financial-content review policy | planned | M |
| C09 | Source attribution page | planned | S |
| C10 | Incident disclosure template | planned | S |

## Reading this list

**done** = implemented and covered by a verification suite.
**planned** = designed, not built. Ordered by user harm if missing.
**blocked** = cannot run in this environment; the reason and unblock path are in
`ATLAS-COMPLETION-REPORT.md`.
