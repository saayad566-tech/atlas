# Atlas — Operations Manual

Sections 3–6: usage and deployment, testing and maintenance, scalability, and technical debt.

---

## 3. Usage and deployment

### 3.1 Requirements

One runtime: **Node 20 or newer**. One native dependency: `better-sqlite3`. No Python, no
Docker, no database server, no account.

### 3.2 Run it

```bash
npm install
npm run build
npm start                  # serves the console on http://127.0.0.1:8787
```

On first open, Atlas asks which country to install. That choice creates
`data/markets/<CODE>-STOCK.db` and nothing is fetched until you ask for it.

### 3.3 Deploy targets

| Target | How | Notes |
|---|---|---|
| Desktop (Windows/macOS/Linux) | `npm start`, or the platform zip | one process, one folder |
| Android | `atlas-release.apk` | WebView shell over the same console |
| Web/PWA | `atlas-pwa.zip` on any static host | installable, works offline after first load |
| LAN / team | bind to `0.0.0.0` behind a reverse proxy | add tenant keys first (§5.4) |

### 3.4 Data layout

```
data/
  active-market.json          which market and asset class is open
  markets/
    IN-STOCK.db               one file per (market x asset class)
    US-ETF.db
    FX-FOREX.db
    GLOBAL-CRYPTO.db
  tenants/<name>/             isolated storage per tenant
```

**Backup = copy the `data/` folder.** There is nothing else. SQLite is safe to copy while
running in WAL mode, but copying after a clean shutdown is simplest.

### 3.5 Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 8787 | listen port |
| `ATLAS_FORCE_MARKET` | none | pin a market at boot, ignoring the saved choice |
| `ATLAS_DATA_DIR` | `./data` | where databases live |

### 3.6 Offline behaviour

Everything that analyses data works with no network: screening, fundamentals, valuation,
briefing, journal, alpha factors, the bundled 27,117-company universe, 12,329 ETFs, all
per-class analysis. Only *fetching new data* needs a network, and that is optional.

---

## 4. Testing and maintenance

### 4.1 Test suites

65 suites, run with `npm test` or individually:

```bash
node scripts/verify-<name>.js
bash scripts/verify-all.sh        # everything
```

| Suite | Guards |
|---|---|
| `feature-inventory` | 50 endpoints, 8 write paths, 10 views still exist |
| `market-purity` | no data or news crosses a market |
| `multasset` | resolution, switching, per-class analysis |
| `design` | tokens, dark mode measured, no unstyled class |
| `quality` | WCAG AA in both themes |
| `isolation` | four isolation proofs |
| `apk` | packaging rules that decide whether MIUI installs it |

### 4.2 Routine maintenance

| Cadence | Task |
|---|---|
| Weekly | `npm test`; check `/api/perf` alerts |
| Monthly | refresh the bundled universe with `node scripts/import-financedatabase.mjs` |
| Monthly | refresh ETFs with `node scripts/import-etfs.mjs` |
| Quarterly | `VACUUM` each database to reclaim space |
| Per release | `bash scripts/pack.sh && bash scripts/build-apk.sh` |

### 4.3 Health checks

```bash
curl localhost:8787/api/fin/api/health    # ok, uptime, db counts
curl localhost:8787/api/fin/api/perf      # latency, throughput, alerts
curl localhost:8787/api/fin/api/sync/status  # sync queue and history
```

### 4.4 Reading a sync failure

`/api/sync/status` returns jobs and an event log. Every attempt is recorded with a reason:

```json
{ "kind": "quotes", "target": "RELIANCE.NS", "state": "failed",
  "detail": "quotes:RELIANCE.NS — no reachable source; queued for retry" }
```

Retry schedule: 2s, 8s, 30s, 2m, 10m, then every 10 minutes. `POST /api/sync/retry`
re-queues everything immediately.

---

## 5. Scalability

### 5.1 What scales today

| Dimension | Limit | Why |
|---|---|---|
| Companies per market | ~27,000 bundled, tested | SQLite with 12 indexes |
| Price history | millions of rows | WAL + covering index on `(company_id, date)` |
| Concurrent readers | many | WAL allows readers during a write |
| Concurrent writers | 2 | `busy_timeout = 5s` then a bounded retry |

### 5.2 Measured

```
p50 latency     1.2 ms
p95 latency    24.7 ms
slowest        /api/seed 636 ms (writes 10 companies with statements)
throughput     37 KB/s in the test loop
```

### 5.3 Scaling beyond one device

1. **One file per (market × class)** already partitions the data.
2. **Tenant isolation** (§5.4) gives each user a separate `data/tenants/<name>/` folder.
3. **Read replicas**: copy a `.db` file to a second process; WAL readers do not block.
4. **Beyond ~10 million price rows**, shard history by year into
   `price_history_2024` etc. The query layer already selects by date range.

### 5.4 Multi-tenant access

```bash
curl -X POST /api/fin/api/tenants -d '{"name":"Acme"}'
curl -X POST /api/fin/api/tenants/<id>/keys -d '{"label":"ci","scopes":["read","write"]}'
```

Keys are `atl_`-prefixed, stored **only as a SHA-256 hash**, and compared in constant time.
Scopes are `read`, `write`, `admin` (admin implies both). A revoked key stops working
immediately. The plaintext is shown once at creation and never again.

---

## 6. Technical debt

Honest list of what is knowingly imperfect, with the cost of each.

| # | Item | Impact | Plan |
|---|---|---|---|
| 1 | **Local LLM inference never executed** | the model path is built, the runtime is not present here | ship a llama.cpp binary per platform, then a real inference test |
| 2 | **"100% intent recognition" is not achievable** | `ask.ts` covers 7 intents by rule; anything outside falls back to the deterministic answer | keep the fallback; measure misroutes before claiming accuracy |
| 3 | **Direct newspaper scraping blocked** | all 12 national feeds refuse; news comes via Google News RSS | keep the aggregator; add direct feeds when reachable |
| 4 | **Forex carry unimplemented** | no policy-rate source in the free set | add a rate source, then compute the differential |
| 5 | **ETF holdings absent** | no free constituent feed | parse issuer pages, or ship a small holdings bundle |
| 6 | **History depth 4–5 years** | Yahoo's limit, not a code limit | document it; do not fake depth |
| 7 | **Cloud sync is an interface, not a service** | no server exists | the sync engine is ready; it needs an endpoint |
| 8 | **Windows EXE not built** | electron's 110 MB binary truncates through this proxy | build on a machine with direct egress |
| 9 | **Single-process only** | no horizontal scale | tenant folders + read replicas cover the realistic load |
| 10 | **`metrics.ts` and `perf.ts` both exist** | one is financial, one is runtime — the names invite confusion | rename `metrics.ts` to `financialMetrics.ts` in the next major |

### 6.1 Refactoring already done this round

- Storage: `busy_timeout`, `synchronous=NORMAL`, 16 MB cache, foreign keys, 12 indexes
- `withWriteRetry` for concurrent writers instead of surfacing `SQLITE_BUSY`
- Runtime metrics separated from financial metrics after a name collision
- Index creation made tolerant of lazily-created tables

### 6.2 Refactoring recommended next

1. Rename `metrics.ts` → `financialMetrics.ts` (breaking, so a major version).
2. Split `server.ts` (2,000+ lines) into route modules per area.
3. Replace the hand-rolled CSV parser in the importers with a shared module.
4. Add a migration runner instead of `CREATE TABLE IF NOT EXISTS` everywhere.
