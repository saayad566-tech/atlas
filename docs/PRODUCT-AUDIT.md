# Product Audit — capability, gaps and reality

**Date:** 27 October 2026 · **Version:** 8.1 · **Method:** every claim below was produced by
running the code in this environment; anything not run is marked *unverified*.

This is deliberately a document about what does **not** work, because the previous rounds
already document what does. If you only read one section, read §3 (Data reality) and §6
(Not verified).

---

## 1. What the product is

Two local-first tools in one console:

| Module | Purpose | Size |
|---|---|---|
| **Finance** | Screen, analyse and value listed companies | 29 core modules, ~5,700 LOC |
| **Console** | Dense tabular UI, no build step | ~1,400 LOC |
| **Docs** | Design record and limits | 13 documents |

Single Node process, one port, two SQLite files, no cloud, no API keys.

---

## 2. Verified capability (with evidence)

Run on 27 Oct 2026 against this build:

| Check | Result | Evidence |
|---|---|---|
| Feature audit, demo company | **24 / 24** | `node scripts/verify-deep.js` |
| Feature audit, live `RELIANCE.NS` | **24 / 24** | same run |
| Universe analytics (9 checks) | **9 / 9** | `node scripts/verify-universe.js` |
| Headless UI (5 checks) | **5 / 5** | `node scripts/verify-ui.js` |
| TypeScript build | clean | `tsc --noEmit` |

Live figures pulled from Yahoo during this audit: Reliance Piotroski **7/9**, Altman
**2.37**, DuPont ROE **8.93%**, CCC **23.66 days**, blended fair value **₹1,375.81** vs
price **₹1,192**; Apple analysts *hold* (3.48), dividends TTM 0.80 / 0.23%, institutions
**66.3%**, **86** insider trades, VaR95 **−1.68%**.

---

## 3. Data reality — the part that matters

### 3.1 What is synthetic

The bundled dataset is **generated fiction**, deterministic from a seed, stamped
`source: 'fixture'` and labelled "demo data" in the UI. 200 companies × 10 years of
annual + 8 quarters, with segments, order books, guidance, facilities, risks and
announcements — all invented.

**Coverage of the demo pack (measured):**

| Data | Coverage | How |
|---|---|---|
| Prices | **100%** | 400 deterministic daily closes per company |
| Volume | **100%** | deterministic, scaled by market cap |
| Statement history | **100%** | 10 annual + 8 quarterly periods |
| Analysts / targets | **100%** | generated: consensus and target from one valuation-gap signal |
| Dividends | **100%** | a payout of **each year's** profit, four payments a year, 5 years |
| Earnings calendar | **100%** | next earnings date + ex-dividend date derived from the fiscal year |
| Earnings estimates | **100%** | current/next quarter and year |
| Earnings surprises | **100%** | last four quarters, from the quarterly statements |
| Ownership | **100%** | insiders = promoter holding; institutions capped so the two cannot exceed 100% |
| Insider trades | **100%** | 3–6 deterministic trades per company |
| Splits | ~15% | only where the generator assigns one (realistic, not universal) |

**This is still fiction.** Every row is stamped `source: 'fixture'` and the UI labels it
"demo data". The difference from before is that the demo is now *internally consistent*:
dividends come from that year's profit, the analyst consensus agrees with the price
target beside it (verified: **0 disagreements in 60 companies**), and ownership
percentages sum to ≤ 100%. Previously those panels were empty; inventing them badly
would have been worse than leaving them blank.

**Verified consistency checks on the demo pack:**
- coverage: prices 100 · history 100 · analysts 100 · dividends 100 · calendar 100
- consensus vs target disagreements: **0 / 60**
- companies where insiders + institutions exceed 100%: **0 / 60**

### 3.2 What is real

Live-fetched companies carry real filings and real market data: fundamentals timeseries
(4–5 annual, ~5 quarterly), 1 year of daily closes, dividends, splits, analyst
recommendations, price targets, earnings estimates and surprises, insider trades,
institutional ownership, and volume.

### 3.3 What cannot be obtained at all

| Data | Why | Consequence |
|---|---|---|
| **Promoter holding & pledge (India)** | Not published by the live source | Two screener fields are permanently `—` for live stocks |
| **Auditor, registrar, announcements** | Only in the synthetic pack | Live companies show none |
| **Order book, guidance** | Only in filings, not in any free API | Live companies show none |
| **Consolidated vs standalone** | Not separated by the source | One view only |
| **10-year history** | Source caps at ~4–5 years | 5-year CAGRs return `null` |

### 3.4 Source fragility

Yahoo's endpoints are the ones its own web app calls — **free but not a contract**. They
require a cookie + crumb handshake, throttle bursts (the client retries once), and could
change without notice. The demo pack and CSV import are the durable paths; the live
source is a convenience.

---

## 4. Product gaps against the reference (Screener.in)

| Capability | Reference | Atlas | Gap |
|---|---|---|---|
| Company universe | ~5,000 Indian listed | Any symbol on demand, nothing pre-loaded | **No bulk universe sync** — fetching 5,000 symbols is a background job not yet built |
| Screener query language | Rich, saved screens | Expression engine + 10 presets + saved screens | Comparable |
| Shareholding (promoter/FII/DII/pledge) | Full history | Synthetic only | **Major gap for India** |
| Quarterly results with YoY | Yes | Yes (live: ~5 quarters) | History depth |
| Peer comparison | Curated peer sets | Sector peers + manual override | Peer sets are local-universe based, so thin until more companies are fetched |
| Saved screens / alerts | Yes (paid tiers) | Yes, local | Comparable |
| Exports | Excel | CSV + enriched CSV + Markdown | Excel not implemented |
| Mobile | Web | Web only | **No mobile app** |
| Multi-user | Yes | Single user, no accounts | **No authentication at all** |
| Real-time prices | Delayed/real-time tiers | Stored daily closes | **No streaming quotes** |
| News / announcements | Yes | Synthetic for demo, none live | **Gap** |
| Backtesting | Limited | None | **Gap** |
| Derivatives / mutual funds | Partial | Equity only | **Gap** |

---

## 5. Engineering gaps and risks

| Risk | Severity | Detail |
|---|---|---|
| **Single-user, no auth** | ~~High~~ **Closed in v9** | A PIN gate, bearer sessions, rate limiting and security headers are now in place. Open mode remains the default until a PIN is set. Still single-user, and TLS is not terminated by the app |
| **Currency mixing** | High | Market caps are stored in each company's currency, but the screener labels everything "₹ Cr" and sorts them together. A USD company ranked beside INR companies is misleading |
| **No test framework** | Medium | vitest could not be installed (registry/DNS); verification runs on hand-written plain-Node harnesses. They pass, but there is no coverage measurement |
| **Peer sets** | Medium | Derived from the local universe; a single fetched company has no peers until more are added |
| **Rate limits** | Medium | Bulk operations pace themselves; there is no job queue |
| **No packaging** | Medium | No Electron/Android build verified in this environment; web only |
| **Fixture intelligence** | Low | Demo companies carry invented segments and order books, clearly labelled, but a reader could mistake them for research |

---

## 6. Not verified (stated plainly)

- **Windows `.exe` and Android `.apk`** — no toolchain in this sandbox; not built.
- **Bulk universe ingestion** — never attempted at scale.
- **Indian small-cap fundamentals** — the live source's coverage of NSE/BSE small caps is
  untested here; only large caps were exercised.
- **Long-run stability** — the app has been exercised in short sessions, not left running
  for days.
- **Multi-user / concurrent writes** — SQLite WAL is configured, but concurrency was not
  stress-tested.

---

## 7. What I would fix first

Ordered by user harm per unit of work:

1. **Currency-aware screener** — label and sort per currency, or convert to one. Today a
   mixed screen is quietly wrong. *(High harm, small change)*
2. **Bulk universe sync with a job queue** — a paced background fetch of an index
   constituent list, with progress and resume. Turns "search any stock" into "the market
   is here".
3. **Authentication** — even a local PIN gate, before anyone exposes this beyond localhost.
4. **Shareholding via a second free source** — the largest content gap for Indian users.
5. **Job queue + scheduler** for nightly refresh, so data does not silently age.
6. **Test framework restoration** — vitest plus coverage, replacing the ad-hoc harnesses.

---

## 8. How to reproduce this audit

```bash
bash scripts/restore-deps.sh        # sandbox-safe dependency restore
node node_modules/typescript/bin/tsc -p tsconfig.json
node scripts/verify-deep.js         # 24-check audit, demo + live
node scripts/verify-universe.js     # 9 cross-sectional checks
node scripts/verify-ui.js           # 5 headless UI checks
```

Every number in §2 comes from those four commands. If a check fails, the output names the
feature and the value it produced.
