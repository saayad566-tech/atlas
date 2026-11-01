# Atlas — module hub

39 modules · 159 features


## Screening & Discovery


### Expression screener

- tokenizer → AST → parameterised SQL
- field whitelist
- 10 presets
- saved screens

### Natural-language query

- rule-based parser
- optional Ollama fallback validated by the compiler

### Ranking & factors

- factor scores
- universe ranking
- sector percentiles with thin-sector fallback

### Etc. / Additional Assets

- CSV export
- enriched CSV export

## Company Analysis


### Statements & ratios

- annual + quarterly
- 10y history
- ratio recomputation per period

### Scores

- Piotroski F
- Altman Z
- Beneish M
- composite grade

### Deep metrics

- DuPont
- cash conversion cycle
- CAGR 3Y
- red-flag analysis

### Deep analysis v2

- ROIC
- EVA
- reinvestment rate
- growth quality
- trends
- anomalies
- data-quality score
- scorecard

### Valuation lab

- 5 models
- editable assumptions
- scenarios
- blend
- bear/base/bull
- P/E band
- Markdown report

### Balance-sheet strength

- net debt / EBITDA
- interest cover
- verdict

### Company intelligence

- description
- segments
- order book
- guidance vs actual
- facilities
- risks
- moat score

### Feature audit

- 24 checks per symbol
- sanity/plausibility checks
- pass / no-data / suspect / error

### Etc. / Additional Assets

- peer matrix
- ratings & notes
- peer overrides

## Market Intelligence


### Prices & volume

- daily closes
- volume
- price analytics
- momentum composite
- volatility regime
- 1-day VaR

### Dividends

- history
- TTM
- yield
- growth
- streak
- yield on cost
- total return

### Analysts

- recommendation trend
- consensus score
- price targets
- upside
- forward estimates

### Ownership

- institutional %
- insider %
- insider transactions
- net insider value

### Earnings

- estimates
- surprises
- average surprise
- earnings calendar
- earnings reaction

### News

- Google News RSS
- Yahoo RSS
- stored headlines

### Etc. / Additional Assets

- splits
- ex-dividend date
- 52-week range

## Cross-Sectional & Portfolio


### Risk

- correlation matrix
- Sharpe-like ratio
- drawdown recovery
- relative strength

### Market structure

- sector rotation
- market breadth
- data freshness
- coverage report

### Scoring

- investability score A–D
- multi-company comparison

### Portfolio

- sector allocation
- HHI concentration
- weighted volatility
- watchlist digest

### Etc. / Additional Assets

- alert rules
- portfolio holdings

## Data Import


### Live adapters

- Yahoo JSON
- Yahoo RSS
- Google News RSS
- Wikipedia
- World Bank

### Offline paths

- CSV import
- JSON import
- manual entry
- deterministic generator

### Source registry

- 15 sources catalogued
- live status probe (5 states)
- feature × path matrix

### Etc. / Additional Assets

- backup / restore
- blocked-source reporting

## Platform & Operations


### Authentication

- PIN (PBKDF2-SHA256, 210k)
- constant-time compare
- lockout
- bearer sessions
- UI lock screen

### API hardening

- auth gate
- rate limiting
- security headers
- error envelope
- health endpoint

### Jobs

- persistent queue
- pacing
- retry with backoff
- crash recovery

### Workspaces

- isolated browser contexts
- master → follower broadcast
- 10k-screen provisioning
- self-diagnosis

### Etc. / Additional Assets

- graceful shutdown
- dependency restore script
- SQLite WAL

## Delivery & Packaging


### PWA

- manifest start_url ./
- real 192/512 PNG icons
- service worker
- viewport-fit=cover
- relative ./ paths

### Archives

- flat platform zip
- PWA shell zip
- structure verification

### Android kit

- TWA manifest
- assetlinks template + route
- signing script
- install-gate guide

### Verification suites

- deep audit
- universe
- UI
- production
- import
- PWA
- zip

### Etc. / Additional Assets

- CI workflow
- .gitignore
- docs set
