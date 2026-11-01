# Completion report — every outstanding item, closed or explained

**Build:** v15.0.0 · commit `f8d4009` · 27 Oct 2026

One command proves the whole product:

```
$ bash scripts/verify-all.sh
typecheck  clean
deep       ALL CHECKS PASSED
universe   UNIVERSE CHECKS PASSED
ui         UI CHECKS PASSED
prod       PRODUCTION CHECKS PASSED
import     IMPORT CHECKS PASSED
pwa        PWA CHECKS PASSED
markets    MARKET + LLM CHECKS PASSED
zip        ZIP CHECKS PASSED
------------------
ALL SUITES PASSED
```

## 1. Defects found in this pass and fixed

| # | Defect | Impact | Fix |
|---|---|---|---|
| 1 | **Health endpoint reported v9.0.0** while `package.json` said 15.0.0 | The endpoint that exists to tell the truth was lying about the version | Read the version from `package.json` at startup — one source of truth |
| 2 | **`DATA_DIR` env var was ignored** | Could not run two instances or point at a different disk | Accepts `ATLAS_DATA` **or** `DATA_DIR` |
| 3 | **The server auto-seeded 200 companies on boot** | Contradicted "no default market — bundles are downloaded per country" | Seeding is now opt-in via `ATLAS_SEED_DEMO=1`; default start is empty |
| 4 | **The boot seeder wrote to `atlas-finance.db`** — a file nothing reads since markets moved to `markets/IN.db` | The log said "Seeded 200 companies" while the app showed 0. A silent lie | The seeder opens the **active market's** file |
| 5 | **`verify:all` typecheck used `npx`**, which is broken in this sandbox | The one-command verifier reported a false failure | Calls the local compiler binary directly |


## 1b. Round 37 — paths that were built but never exercised

A new suite (`scripts/verify-integrity.js`) exercises the flows that had endpoints but no
end-to-end test. Two real defects surfaced.

| # | Defect | Impact | Fix |
|---|---|---|---|
| 6 | **CSV import silently imported nothing** | A CSV of `symbol,name,sector` returned `200` with zero rows, because `period_end` was mandatory. A symbol universe is a legitimate import | Company-only rows are now accepted; statements remain optional. A missing `period_end` no longer blocks the company |
| 7 | **Alert rules rejected `ROE`** | `addRule` only accepted lowercase snake_case, so a caller using the display name got a 400 | The metric is normalised (`ROE`, `roe`, `Debt to Equity` all work) |

### Now covered by tests (previously untested)

| Flow | Result |
|---|---|
| Backup → restore round trip | 239 KB backup, company count preserved 15 → 15 |
| CSV import → screenable | company-only CSV imports and screens |
| Saved screens | save returns 201, appears in list |
| Alert rules | create 201, evaluation returns findings |
| Concurrency during a market switch | 20 parallel screens + a switch: **0 server errors**, US market clean afterwards |
| Service worker | served as `text/javascript`, valid JS |
| Auth lockout | locks after repeated failures, correct PIN refused while locked |

**Two test-ordering bugs of my own** were also fixed: the auth-lockout block locked the API
for every later assertion, and my first alert-rule payload used the wrong field names.
Both made the suite lie in opposite directions — one hid failures, one invented them.


## 1c. Round 38 — security, accessibility and performance audit

New suite: `scripts/verify-quality.js`. Three real defects found.

| # | Defect | Measured | Fix |
|---|---|---|---|
| 8 | **7 inputs had no accessible name** | 7 of 23 inputs unlabelled — screen readers announce nothing | `aria-label` added to all seven; now **0 unlabelled of 23** |
| 9 | **Atlas Score was 5x slower than needed** | p50 **230 ms**, p95 **462 ms** — `riskProfile` recomputed the universe median by looping every company's price history on each call | Memoised for 30 s, then replaced the loop with a single SQL window-function query: p50 **37 ms**, p95 **190 ms** |
| 10 | *(test defect, not product)* my injection check flagged the word UNION inside a validation message | The database was intact and nothing executed | Assertion now tests what matters — no execution, no `SQLITE_`/`no such table` leakage |

### Security fuzzing — results

| Attack | Result |
|---|---|
| `Symbol = "x"; DROP TABLE companies; --` | 400, no execution |
| `Sector = "x" OR 1=1` | 200, parameterised (returns matches only) |
| `Symbol = "x" UNION SELECT * FROM companies` | 400, no execution |
| `Symbol = "x" --` | 400 |
| Quote-escape breakout | 400 |
| Malformed JSON body | 400 |
| Path traversal `/../../etc/passwd` | 404 |
| **Database after all attempts** | **120 → 120 companies, intact** |

### Accessibility — results

- Every input has an accessible name (0 unlabelled)
- All 39 buttons carry text or `aria-label`
- `lang` attribute present
- Secondary text contrast **7.61:1** (WCAG AA needs 4.5:1)

### Performance — measured, not asserted

| Endpoint | p50 | p95 |
|---|---|---|
| Screen (120 companies) | 10 ms | 49 ms |
| Company detail | 55 ms | 112 ms |
| Atlas Score | 37 ms | 190 ms |
| Deep analysis | 4 ms | 20 ms |

## 2. Past rounds — all closed

| Item | State |
|---|---|
| 30 orphaned API endpoints | **Closed** — 75 routes, 75 wired, 0 orphaned |
| Demo pack at 0% analysts/dividends/calendar | **Closed** — 100% coverage, internally consistent |
| No authentication | **Closed** — PIN, sessions, rate limit, headers |
| No job queue | **Closed** — persistent, paced, crash-recovering |
| No CI | **Closed** — `.github/workflows/ci.yml`, linted 0/0 |
| No `.gitignore` | **Closed** |
| Viewport below packager spec | **Closed** — exact string, validator PASS |
| Touch targets 28px | **Closed** — 61px rows, 44px nav |
| No feature inventory | **Closed** — 39 modules, 159 features, hub audit 0/0 |
| No market isolation | **Closed** — one DB file per country, proven both ways |
| No version control | **Closed** — git repo, 142 files, first commit |
| Broken doc links | **Closed** — 0 of 20 documents have a broken link |

## 3. Still blocked — environmental, with the unblock path

These are **not** unfinished code. They cannot run in this sandbox, and each has a
written path:

| Item | Why | Unblock |
|---|---|---|
| APK compile + signing | No JDK, Android SDK, Gradle, keytool or apksigner (all verified missing) | `bash scripts/sign-apk.sh` on any machine with a JDK |
| A quantized model answering | No model server, no weights | `ollama pull qwen2.5:1.5b-instruct-q4_K_M` then set `ATLAS_LLM_URL` |
| SEC EDGAR, Stooq, OpenFIGI, GLEIF, Frankfurter | Timeout through this proxy | Adapters written to their contracts; run on an open network |
| NSE India (shareholding) | HTTP 403 bot protection | Licensed vendor or authorised network — **not circumvented** |
| Windows `.exe` | No Windows toolchain | Electron build on a Windows runner |
| TLS | Terminated by a reverse proxy | nginx/Caddy in front |

## 4. Known limitations (design, not defects)

- Demo data is **synthetic**, labelled `fixture`. Coherent, but not research.
- Live data comes from an **unofficial** Yahoo API: ~4–5 years, no shareholding,
  rate-limited (handled as `rate-limited`, retried).
- Atlas Score weights are a **choice**, printed with every score.
- VaR is parametric and one-day; it understates fat tails.

## 5. Reproduce everything

```bash
bash scripts/restore-deps.sh     # sandbox-safe dependency restore
bash scripts/verify-all.sh       # typecheck + 8 suites
bash scripts/pack.sh             # flat archives + zip verification
```
