# Production readiness — 22 additions

The previous audit named **no authentication** as the top risk and **no job queue** as the
second. Both are now closed, along with the operational basics.

## Authentication (6)

| # | Feature | Detail |
|---|---|---|
| 1 | **PIN gate** | PBKDF2-SHA256, 210,000 iterations, 16-byte random salt |
| 2 | **Constant-time compare** | `crypto.timingSafeEqual` — no early return on mismatch |
| 3 | **Lockout** | 5 failures → 15-minute lock, with the remaining attempts reported |
| 4 | **Session tokens** | 32 random bytes, 12-hour TTL, pruned on use |
| 5 | **Session invalidation** | Changing or removing the PIN clears every session |
| 6 | **UI lock screen** | 401 anywhere opens an unlock card; the token lives in `sessionStorage` |

**Open mode is preserved:** with no PIN set, the app behaves exactly as before — the gate
only engages once a PIN exists. That keeps localhost usage frictionless.

## API hardening (6)

| # | Feature | Detail |
|---|---|---|
| 7 | **Auth gate** | Every `/api/*` route except `/api/health` and `/api/auth/*` |
| 8 | **Rate limiting** | Token bucket, 240 requests/minute per client, `429` + `Retry-After` |
| 9 | **Security headers** | CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` |
| 10 | **Error envelope** | `{ error, code }` with classified codes — a stack trace never reaches the client |
| 11 | **Health endpoint** | Version, uptime, auth state, job counts, company count |
| 12 | **Forged tokens rejected** | Unknown or expired bearer tokens are refused |

## Background jobs (4)

| # | Feature | Detail |
|---|---|---|
| 13 | **Persistent queue** | Jobs in SQLite, so a restart does not lose work |
| 14 | **Paced + retried** | 500 ms between jobs, 3 attempts, exponential backoff capped at 5 minutes |
| 15 | **Crash recovery** | Jobs left `running` by a crash are re-queued on boot |
| 16 | **Bulk enqueue + drain** | `POST /api/jobs/refresh` and `POST /api/jobs/drain` |

This is the mechanism that makes "fetch the whole market" possible without blocking a
request or hammering the source.

## Operations (4)

| # | Feature | Detail |
|---|---|---|
| 17 | **Graceful shutdown** | SIGINT/SIGTERM drains connections and closes both databases |
| 18 | **Shared refresh pipeline** | One `refreshSymbol()` used by the endpoint and the queue — no duplicated logic |
| 19 | **Production audit** | 12 executable checks: `node scripts/verify-prod.js` |
| 20 | **Dependency restore** | `bash scripts/restore-deps.sh` rebuilds the tree through the proxy |

## Analysis (2)

| # | Feature | Detail |
|---|---|---|
| 21 | **Total return** | price return + dividends received, expressed against the first close |
| 22 | **Earnings reaction** | the price move across the stored earnings date |

## Verified

```
production checks : 12/12  → PRODUCTION CHECKS PASSED
deep audit        : demo 24/24 · live 24/24
universe          : 9/9
headless UI       : 5/5
TypeScript        : clean
```

The production suite proves, by execution: the gate blocks unauthenticated calls, a wrong
PIN is refused with a countdown, a correct PIN mints a 64-character session, a forged token
is rejected, the rate limiter engages, security headers are present, and unknown routes
return a clean envelope.

## Still not production-ready (stated plainly)

- **TLS is not terminated here.** Run it behind a reverse proxy, or bind to localhost only.
- **Single user.** One PIN, one session store in memory — a restart logs everyone out.
- **No audit log of user actions** (the Aegis module has one; the finance API does not).
- **No horizontal scaling.** SQLite + in-memory sessions means one process.
- **No container image or Windows/Android build verified** in this environment.
- **No backup schedule** — the JSON export exists, but nothing runs it automatically.
