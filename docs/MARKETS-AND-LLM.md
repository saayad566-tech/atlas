# Country bundles, market isolation, and the on-device model

## 1. No default market — bundles are downloaded per country

The app ships with **no company data**. A market is a downloadable bundle; until you
download one, that market is empty.

Nine markets are registered, each with its own currency, exchange suffix, locale,
timezone, fiscal-year end and benchmark:

| Code | Market | Currency | Suffix | Benchmark |
|---|---|---|---|---|
| IN | India | ₹ INR | `.NS` | ^NSEI |
| US | United States | $ USD | — | ^GSPC |
| GB | United Kingdom | £ GBP | `.L` | ^FTSE |
| JP | Japan | ¥ JPY | `.T` | ^N225 |
| DE | Germany | € EUR | `.DE` | ^GDAXI |
| SG | Singapore | S$ SGD | `.SI` | ^STI |
| HK | Hong Kong | HK$ HKD | `.HK` | ^HSI |
| AU | Australia | A$ AUD | `.AX` | ^AXJO |
| CA | Canada | C$ CAD | `.TO` | ^GSPTSE |

Each bundle descriptor (`GET /api/markets/bundle/:code`) lists three files: the market
database, the symbol universe, and an optional quantized model.


## 1b. First run — a setup window, not a guess

The app **starts unconfigured**. `active` is `null` until the user chooses, and every data
route answers:

```
HTTP 428  {"error":"Choose a country bundle to begin.","code":"SETUP_REQUIRED","markets":[9 options]}
```

The console shows a full-screen setup window: nine country cards, each with flag, currency,
exchanges and what the bundle contains. Choosing one calls `/api/setup/complete`, writes
`data/active-market.json`, and reloads into that market.

There is no default. Nothing is loaded for a country the user did not pick.

## 1c. Every bundle verified one by one

`node scripts/verify-bundles.js` walks all nine:

| Market | Currency | Suffix | Companies | Screens ready | Audit | Cross-market overlap |
|---|---|---|---|---|---|---|
| IN | INR | `.NS` | 12 | 10/10 | 24/24 | 0 |
| US | USD | — | 12 | 10/10 | 24/24 | 0 |
| GB | GBP | `.L` | 12 | 10/10 | 24/24 | 0 |
| JP | JPY | `.T` | 12 | 10/10 | 24/24 | 0 |
| DE | EUR | `.DE` | 12 | 10/10 | 24/24 | 0 |
| SG | SGD | `.SI` | 12 | 10/10 | 24/24 | 0 |
| HK | HKD | `.HK` | 12 | 10/10 | 24/24 | 0 |
| AU | AUD | `.AX` | 12 | 10/10 | 24/24 | 0 |
| CA | CAD | `.TO` | 12 | 10/10 | 24/24 | 0 |

Nine separate database files, each with content. **Zero symbols shared between any two
markets.**

Per-market readiness is also exposed as data (`GET /api/markets/readiness/:code`), covering
ten screens: search & screener, statements & ratios, scores & deep analysis, valuation lab,
price analytics & risk, dividends & total return, analysts & targets, earnings calendar,
company intelligence, macro indicators.


## 1d. All stocks — a real universe per country

The demo pack is a fallback, not the product. Each market has a **live index constituent
source** (Wikipedia publishes the tables; no key needed), parsed into symbols and queued
for fetch into that market's own database.

| Market | Index | Constituents parsed |
|---|---|---|
| IN | NIFTY 50 | 49 |
| US | S&P 500 | 503 |
| GB | FTSE 100 | 100 |
| DE | DAX | 40 |
| SG | Straits Times Index | 30 |
| HK | Hang Seng | 79 |
| AU | S&P/ASX 50 | 49 |
| CA | S&P/TSX 60 | 60 |
| **JP** | Nikkei 225 | **0 — the Wikipedia page publishes no constituent table** |

`POST /api/universe/sync/:market` queues every constituent as a job for that market only.
`GET /api/universe/constituents/:market` returns the parsed list with its source.

### Bugs found while building this

| Bug | Effect |
|---|---|
| **Wikipedia 403s a browser-spoofed User-Agent** | Every Wikipedia fetch failed; an honest `Atlas/1.0` UA is accepted |
| **Decimal weights and dates parsed as tickers** | Japan returned "21.12", Germany returned "03.09.1990" |
| **Exchange prefixes were only stripped after counting** | `SGX: A17U` counted as zero, so the whole column was rejected — Singapore and Hong Kong returned nothing |
| **Non-breaking spaces survived `trim()`** | Cells like `SEHK: 5` never matched a ticker |
| **Hard-coded minimum of 10 rows** | Rejected legitimately small lists |

## 2. Isolation is physical, not a WHERE clause

**One SQLite file per market** — `data/markets/IN.db`, `data/markets/US.db`, and so on.
Switching market repoints every query at a different file. There is no filter to get
wrong, no join that can leak, and no shared table.

Verified by test (`node scripts/verify-markets.js`):

```
India seeded           20 companies, 20 screened
Switch to US           US starts EMPTY (0 companies) — no India rows visible
US seeded separately   12 companies
US cannot see India    overlap 0
Back to India          India intact (20 vs 20)
India cannot see US    overlap 0
Physical               IN.db 1,460 KB · US.db 1,016 KB — separate files
```

Two bugs were found and fixed while proving this:

1. **The first seed landed in a different file than the market DB.** The server accepted a
   caller-supplied handle and never repointed it at `markets/<active>.db`, so switching
   back to India showed an empty database. Now the active market is activated at startup.
2. **Demo symbols collided across markets** — the generator produced the same fake tickers
   everywhere, so the US market contained "India" symbols. Seeding now prefixes symbols
   with the market code outside India.

## 3. On-device quantized model

`src/finance/core/llm.ts` — a local-only client for a quantized model served by
Ollama/llama.cpp on the device.

**Three rules it enforces:**

1. **Loopback only.** The endpoint must be `127.0.0.1` / `localhost` / `[::1]`. A remote
   URL is refused outright — nothing leaves the device.
2. **Grounded.** The answer is generated from a fact block of **computed metrics** (21
   facts for a typical company: ROE, ROIC, WACC, EVA, valuation gap, volatility…), never
   from free text.
3. **Cross-checked.** Every number in the answer is matched against the fact block.
   Unsupported figures are returned in `unsupportedNumbers` and shown as a warning, so an
   invented number can never pass silently.

**When no model is installed — which is the case in this sandbox — a deterministic engine
answers from the same facts.** The UI says which source answered:

```
Q: Is the debt comfortable?
A: CREDIG011 carries debt/equity of 0.08. That is comfortable.
   ✓ every figure matches the computed facts · source: deterministic
```

### Installing a model (on a real device)

```bash
# ~1 GB, runs on a mid-range phone
ollama pull qwen2.5:1.5b-instruct-q4_K_M
ollama serve
export ATLAS_LLM_URL=http://127.0.0.1:11434
export ATLAS_LLM_MODEL=qwen2.5:1.5b-instruct-q4_K_M
```

The status endpoint reports honestly: `available`, the model actually found, and why not
if not.

## 4. What is verified and what is not

| Claim | Status |
|---|---|
| Markets are isolated (no cross-contamination) | **Verified by test**, both directions |
| Separate database file per market | **Verified** (file sizes, contents) |
| Currency/locale/suffix per market | **Verified** |
| Bundle descriptor lists db + universe + model | **Verified** |
| Remote model endpoint is refused | **Verified** (guard test) |
| Answers are grounded and cross-checked | **Verified** (deterministic path) |
| **A quantized model actually running and answering** | **NOT verified** — no model server or weights in this sandbox. The integration is written to the Ollama API contract; the model path itself is untested here |
