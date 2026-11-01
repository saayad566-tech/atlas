# Repair plan — every blocked or incomplete function, and the decision taken

Each row: what is broken, what I decided, and what state it is in now.

## A. Data universes ("every stock")

| # | Problem | Decision | State |
|---|---|---|---|
| 1 | **Japan had no universe** — the Nikkei 225 Wikipedia page has a "Components" heading but the body is a pie-chart CSS block, not a table. `List of companies in the Nikkei 225` and `TOPIX 100` both 404 | **No free constituent source exists.** Rather than fabricate 225 names, Japan uses the **CSV import path**: paste `symbol,name,sector` rows, and the market suffixer appends `.T` automatically | Documented fallback, no fake data |
| 2 | **Singapore and Hong Kong had no sector column** in their index tables | Sector is filled from the **live quote** (`assetProfile.sector`) at fetch time — `upsertLiveCompany` already writes it. The index table is only a starter | Works after fetch |
| 3 | **Australia's sector column was a rank** ("25") | Column now chosen by inspecting **values** (text vs numeric), not just the header | Fixed — now "Consumer Discretionary" |
| 4 | Universe sync queued jobs but nothing ran them | Jobs are paced at 500 ms; a 503-symbol market takes ~4 min. The queue is driven by `POST /api/jobs/drain` and the Jobs panel | Deliberate — no unbounded background load |

## B. Blocked by the environment (unchanged, with the alternative chosen)

| Item | Why blocked | Decision |
|---|---|---|
| APK compile + signing | No JDK, Android SDK, Gradle, keytool, apksigner | Ship the **signing kit**; user runs `scripts/sign-apk.sh` on any machine with a JDK |
| Quantized model answering | No model server or weights | Ship the **integration + deterministic fallback**; user runs `ollama pull` |
| SEC EDGAR, Stooq, OpenFIGI, GLEIF, Frankfurter | Time out through this proxy | Adapters written to their contracts; **Wikipedia + Yahoo** cover the same needs for now |
| NSE shareholding | HTTP 403 bot protection | **Not circumvented.** CSV import is the interim path; a licensed feed is the real fix |
| Windows `.exe` | No Windows toolchain | PWA + flat archives ship; Electron build needs a Windows runner |
| TLS | Reverse proxy's job | Documented nginx/Caddy placement |

## C. Alternative sources found this round

| Need | Primary | Alternative found | Result |
|---|---|---|---|
| Index constituents | Wikipedia tables | Yahoo predefined screener (`/v1/finance/screener/predefined/saved`) returns live symbols with quotes | **Works** — usable for discovery, not a full index |
| Company descriptions | Wikipedia REST | — | Works once the UA is honest (browser-spoofed UA gets 403) |
| Sector taxonomy | Index table column | Live quote `assetProfile.sector` | **Works** — fills SG/HK after fetch |

## D. What "full pipeline per stock" means now

For any symbol in any market:

```
search → fetch → upsert company → statements (annual + quarterly) → ratios recomputed
      → prices + volume → dividends → analysts → ownership → insider trades
      → estimates → surprises → calendar → profile
```

`refreshSymbol()` performs all of it in one call, and the job queue runs it per symbol.
Verified per market by `verify-bundles.js` (24/24 audit checks in each of nine markets).

## E. Known gaps that remain, stated plainly

- **Japan** has no automatic universe (CSV only).
- **SG/HK sectors** appear only after a symbol is fetched.
- **Bulk sync is queued, not executed** in these tests.
- The **Nikkei** index itself is unsupported as a benchmark series.

## F. UPDATE — Japan solved: the whole market, not just an index

The earlier conclusion ("no free constituent source for Japan") was **wrong about the
goal**. An index constituent list was the wrong target: what was needed was every listed
stock. Yahoo's **custom screener** (`POST /v1/finance/screener` with a `region` operand)
returns the entire equity universe per country.

| Market | Region | Listed stocks |
|---|---|---|
| US | us | **19,862** |
| HK | hk | **9,177** |
| IN | in | **8,557** (BSE duplicates filtered → NSE only) |
| JP | jp | **3,814** |
| SG | sg | **539** |

`GET /api/universe/region/:market?limit=N` returns the list; pagination is 250 per request
and cached for 30 minutes.

### What this changed

- Japan no longer needs a CSV workaround — it has 3,814 stocks like every other market.
- The index tables (NIFTY 50, S&P 500 …) remain useful as **curated** subsets and for
  sector labels, but they are no longer the definition of "all stocks".
- India returns both BSE (`.BO`) and NSE (`.NS`) lines for the same company; the loader
  keeps NSE only, which is why 8,557 unique names come back from ~10,000 rows.

### Engineering note

Yahoo's screener is POST-only and the HTTP client was GET-only. Added `httpsPostText` and
`HttpSession.post`, including the proxy CONNECT tunnel and body writing — otherwise the
request went out with a body nobody sent.

## G. The research report — all 20 sections of the master prompt

The attached research specification asks for institutional-grade coverage across 16
sections. The platform now generates that report per stock (`GET /api/research/:symbol`,
Markdown at `.md`), filling each section from the local database and **marking every gap
with the reason and what would fill it**.

Measured on a seeded company: **69% coverage — 8 complete, 6 partial, 2 unavailable.**

| § | Section | Status | Filled from |
|---|---|---|---|
| 1 | Research inputs | complete | company record |
| 2 | Sources & evidence standard | complete | provenance columns |
| 3 | Identity & business model | complete | profile + segments |
| 4 | Current operations | partial | facilities, guidance (no project tracker) |
| 5 | Future plans & catalysts | partial | estimates + guidance |
| 6 | Customers & revenue quality | partial | receivables, cash conversion, WC days |
| 7 | Competitor intelligence | partial | peer matrix (same-sector only) |
| 8 | Industry & market size | **unavailable** | no free TAM/SAM source exists |
| 9 | Financial performance | complete | 10 annual periods + ratios + scores |
| 10 | Forecast & model | partial | consensus estimates only |
| 11 | Valuation | complete | 5 models, blend, band, verdict |
| 12 | Management & governance | partial | insider trades, holders |
| 13 | News & sentiment | complete* | RSS headlines (when fetched) |
| 14 | Risks & red flags | complete | anomalies, leverage, drawdown |
| 15 | Catalyst calendar | complete | earnings date, ex-div |
| 16 | Shareholder returns | complete | total return, dividends, Atlas score |

\* Section 13 shows `unavailable` until headlines are fetched — that is the honest state,
not a bug.

### The design rule

A section is **never written from assumption**. Where the data does not exist, the report
says so and names the source that would fill it. A research report that invents a
competitor landscape is worse than one that admits it has none.


### Update — all 20 sections, coverage 75%

The master prompt has **20 sections**, not 16. The four that were missing are now built:

| § | Section | Status | How it is produced |
|---|---|---|---|
| 17 | **Final investment thesis** | **complete** | Derived from the Atlas Score parts: reasons to own (inputs ≥60), reasons to avoid (<45), competitive advantage (ROIC vs WACC), growth drivers, unresolved questions (pulled from the gap register), scenarios, what the market expects from the P/E, surprises (anomalies), next events, invalidation conditions, and a **conditional conclusion** chosen by rule |
| 18 | Source audit & completeness | **complete** | Source register (28 entries), gap register, and a 13-item checked/unchecked table |
| 19 | Required output files | partial | Markdown generated; PDF and XLSX are **not** produced and the report says so |
| 20 | Strict rules compliance | **complete** | Each of the 11 rules recorded against what the report actually did |

Section 8 (industry) moved from *unavailable* to *partial*: sector aggregates are computed
from the market database (average P/E, ROE, OPM, D/E, growth, and the company's ROE rank
among peers), while TAM/SAM remain genuinely unavailable.

Section 7 (competitors) now includes computed side-by-side metrics and a relative-valuation
statement instead of just a peer list.

**Measured coverage: 75% — 11 complete, 8 partial, 1 unavailable.**
