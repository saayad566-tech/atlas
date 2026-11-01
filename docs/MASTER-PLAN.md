# Atlas — master plan and status ledger

Every item is one of: **done (verified)**, **blocked (with the unblock path)**, or
**not attempted (with the reason)**. There is no fourth state, and nothing sits in
"TODO".

## 1. Audit result — what was actually missing

Scanned the codebase rather than assuming:

| Check | Result |
|---|---|
| `TODO` / `FIXME` / stub markers | **0** |
| Empty function bodies | 7 — all constructors, not stubs |
| Swallowed exceptions | 2 — optional paths (source probing), intentional |
| **API endpoints defined** | **82** |
| **Endpoints reachable from the UI** | 16 → **30 were orphaned** |

That last row was the real gap: backend capability with no surface. Fixed this round.


## 1b. Round 34 — orphaned endpoints closed

Audited again and found **30 of 82 endpoints had no UI surface**. All are now wired:

| Endpoint group | Where it now lives |
|---|---|
| compare | **Compare** view — 2–5 companies side by side, 11 metric rows |
| universe/correlation | Intelligence view — 6×6 daily-return matrix |
| jobs, jobs/refresh, jobs/drain | Intelligence view — queue stats + queue/run buttons |
| backup, restore | Intelligence view — download / upload a full JSON backup |
| explain | Company page — "Why these numbers" card |
| investability, risk, total-return, earnings-reaction, strength, peers, valuation | Company page — "More intelligence" (4 cards) |
| news, import/news | Company page — headline table + fetch button |
| saved-screens | Screener — saved-screen picker + save button |
| export/enriched.csv | Screener — "Export enriched" |
| nl | Screener — NL box now shows the parsed expression before running |
| sectors | Screener — sector filter dropdown (11 sectors) |
| fields | Screener — expression autocomplete (30 fields) |
| health | Footer status line (version, companies, auth, jobs, uptime) |
| seed, profiles/seed, quotes/refresh | Intelligence view — Data actions card |

**Result: 75 routes defined, 75 wired, 0 orphaned.**

### Bugs found while wiring (all fixed)

| Bug | Detail |
|---|---|
| **NL parser dropped phrases** | It returned on the first matching phrase, so "low debt high roe" became only `Debt to Equity < 0.5`. Now every match is combined: `(Debt to Equity < 0.5) AND (ROE > 15)` |
| **NL vocabulary was thin** | Added high/low ROE, ROCE, growth, margin, cheap/expensive, high yield, profitable, loss-making |
| **Regex broke the build** | `p/e` inside a regex literal terminated it — escaped |
| **Field autocomplete empty** | `/api/fields` returns `[{column,label,...}]`; the UI read `.name`/`.key`. Now uses `.label` → 30 fields |
| **Second view map missed** | A duplicated nav map at line 1094 lacked `compare`, so the tab did nothing. Found by headless test |


## 1c. Round 35 — country bundles, isolation, on-device model

| Item | State |
|---|---|
| 9 country bundles, **no default market** | **Done** — registry with currency, suffix, locale, timezone, benchmark |
| **Market isolation** | **Done and proven** — one SQLite file per market; US starts empty, 0 symbol overlap both ways, India intact after a round trip |
| Market switcher in the UI | **Done** — 9 markets, live switch, 0 page errors |
| Bundle descriptor (db + universe + model) | **Done** — `/api/markets/bundle/:code` |
| On-device quantized model | **Integration done** — loopback-only client, grounded context, numeric cross-check, deterministic fallback |
| A model actually answering | **Blocked** — no model server or weights in this sandbox; documented with the install command |

### Bugs found and fixed this round

1. **The first seed landed in the wrong file.** The server kept the caller's database handle
   instead of the active market's, so switching back to India showed an empty database.
2. **Demo symbols collided across markets.** The generator produced identical tickers in
   every country, so the US market contained India's symbols. Seeding now prefixes them.
3. **Activation ordering.** The activation call was placed before its declaration and broke
   the build — caught by typecheck.

## 2. Done this round (verified)

| Item | Evidence |
|---|---|
| **Atlas Score** — one composite number from quality, value, growth, momentum, analysts, risk and balance sheet, with every input shown | `/api/atlas-score/:symbol`; card renders "46/100 C — Mixed. Value is the main concern." |
| **Explainer** — plain-English reasons for each metric and what it means | `/api/explain/:symbol`, 10 lines |
| **Intelligence view** — market breadth, coverage, freshness, sector rotation, stale-company table | Headless render: breadth "50% advancing (20 up · 19 down · 1 flat)", 10 rotation rows, 40 freshness rows, 0 page errors |
| **30 orphaned endpoints surfaced** | Universe (breadth/rotation/coverage/freshness/correlation), risk, investability, compare, portfolio analytics, total return, earnings reaction, news import, jobs, NL query, peers, strength, saved screens |

## 3. Done in earlier rounds (verified)

Feature audit 24/24 demo and live · deep analysis v2 (22 features) · market intelligence
(31) · cross-sectional analytics · production security (PIN, rate limit, headers, jobs) ·
data import framework (15 sources, 26 features, 0 dead ends) · PWA + flat archives ·
demo pack at 100% coverage.

## 4. Blocked — with the unblock path

| Item | Why blocked | Unblock |
|---|---|---|
| **APK compile + signing** | No JDK, Android SDK, Gradle or C++ toolchain in this sandbox (verified: `java`, `keytool`, `apksigner`, `gradle` all missing) | `bash scripts/sign-apk.sh` on any machine with a JDK; or upload the built APK and I will inspect its signature block |
| **SEC EDGAR / Stooq / OpenFIGI / GLEIF / Frankfurter** | Timeout through the egress proxy | Adapters are written to their public contracts; run on an unrestricted network |
| **NSE India** | HTTP 403 — bot protection | Licensed vendor, their published data products, or an authorised network. Not circumvented |
| **Indian shareholding (promoter/FII/pledge)** | Only available from NSE, which is blocked | Same as above; CSV import is the interim path |
| **Windows `.exe`** | No Windows toolchain | Electron build on a Windows runner |
| **Multi-user / horizontal scale** | SQLite + in-memory sessions | Postgres + Redis session store (architecture change, not a bug) |
| **TLS** | Terminated by a reverse proxy, not the app | nginx/Caddy in front |

## 5. Not attempted — with the reason

| Item | Reason |
|---|---|
| Real-time streaming quotes | No free streaming feed reachable; daily closes only |
| Backtesting engine | Would need survivorship-bias-free history the free source does not provide |
| Derivatives / mutual funds | Out of scope for an equity screener |
| Chart library | Deliberate: the price panel is a table, and a chart library adds a build step this project avoids |
| Competitive teardown | No competitor under analysis this round |

## 6. Known limitations (not defects)

- Demo data is **synthetic**, labelled `fixture` — coherent but fictional.
- Live data is from an **unofficial** Yahoo API: ~4–5 years of history, no shareholding,
  subject to rate limiting (handled as `rate-limited`, retried later).
- The Atlas Score weights are a **choice**, printed with every score so they can be argued with.
- `coverage` on the score shows how much of it rested on real data.

## 7. Verification commands

```bash
node scripts/verify-deep.js       # 24-check audit, demo + live
node scripts/verify-universe.js   # 9 cross-sectional checks
node scripts/verify-ui.js         # 5 headless UI checks
node scripts/verify-prod.js       # 12 production/security checks
node scripts/verify-import.js     # sources + 26-feature matrix + RSS
node scripts/verify-pwa.js        # manifest, service worker, viewport, assetlinks
node scripts/verify-zip.js        # flat archives, real PNG dimensions
```

All seven pass as of this build.
