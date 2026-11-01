# Architecture Blueprint

## 1. Shape

```
┌──────────────────────────────────────────────────────────────┐
│  Console (vanilla HTML/CSS/JS, no build step)                │
│  search · screener builder · dense tables · company view     │
└───────────────▲──────────────────────────────────────────────┘
                │ JSON over HTTP (localhost)
┌───────────────┴──────────────────────────────────────────────┐
│  API (node:http, dependency-free)                            │
│  /api/screen · /api/nl · /api/company · /api/export.csv      │
└───────▲───────────────────────▲──────────────────────────────┘
        │                       │
┌───────┴────────┐   ┌──────────┴──────────┐   ┌──────────────┐
│ Query layer    │   │ NL parser           │   │ Analysis     │
│ expr.ts        │   │ nl.ts               │   │ analysis.ts  │
│ tokenizer→AST  │   │ rules (offline) +   │   │ red flags,   │
│ →SQL (bound)   │   │ optional Ollama     │   │ health score │
└───────▲────────┘   └─────────────────────┘   └──────▲───────┘
        │                                             │
┌───────┴─────────────────────────────────────────────┴───────┐
│  SQLite (WAL) — one file                                    │
│  companies · statements · ratios · shareholding · peers     │
│  quotes · v_latest (flat screener view) · FTS5 search       │
└───────▲─────────────────────────────────────────────────────┘
        │
┌───────┴─────────────────────────────────────────────────────┐
│  Ingestion                                                  │
│  dataset.ts (deterministic demo pack)                       │
│  ingest.ts  (fixture writer · EDGAR companyfacts adapter)   │
└─────────────────────────────────────────────────────────────┘
```

## 2. Why these choices

**SQLite over DuckDB.** Both are free. SQLite gives one file, WAL, FTS5 for search,
and no extra native dependency beyond `better-sqlite3`. For 5,000 companies × 40
periods (≈200k statement rows) the screener answers in single-digit milliseconds.
DuckDB is the better choice for heavy columnar scans (e.g. computing factors across
every company-year) — the query layer is plain SQL, so it can be swapped behind
`store.ts` without touching the UI.

**A real expression language, not a query builder.** Screener.in's power feature is
`ROE > 15 AND Debt to Equity < 0.5`. A structured UI cannot express arbitrary
arithmetic; a parser can. The parser produces an AST, and the compiler emits SQL with
a whitelist and bound parameters — the injection surface is structurally absent.

**NL on top of the same AST.** The natural-language layer does not get its own query
path. It produces the *same* expression string, which is then compiled by the same
code. So a language mistake cannot become a data-access mistake.

**No model required.** A local LLM is a nice-to-have, not a dependency. The rule
parser covers the common screening phrasings deterministically and offline; if an
Ollama model is running, its answer is *validated* by the compiler before use and
silently discarded if wrong.

## 3. Request lifecycle for a screen

1. UI posts `{expression}` or `{text}`.
2. If `text`: `parseQuery()` splits clauses, matches phrases, builds an expression.
3. `compileExpression()` tokenises → parses → validates fields → emits `(sql, params)`.
4. `store.screener()` runs `SELECT … FROM v_latest WHERE <sql> ORDER BY … LIMIT ?`.
5. Rows are mapped to a typed `ScreenerRow`; the response includes the SQL and params
   so the user can see exactly what ran.

## 4. Data pipeline

```
generateDataset(seed) ──► ingestFixture() ──► SQLite
                              │
EDGAR companyfacts ──► normaliseEdgarFacts() ──► ingestEdgar() ──► SQLite
```

- The **demo pack** is deterministic: same seed → byte-identical rows (tested).
- The **EDGAR adapter** fetches `data.sec.gov/api/xbrl/companyfacts/CIK…json`, keeps
  only `10-K` / `FY` rows, maps us-gaap tags to statement fields, and writes annual
  statements. Its mapping is unit-tested against a fixture of the *response shape*.
- Incremental updates: re-running an adapter is idempotent (`INSERT OR REPLACE` on
  `(company_id, period_type, period_end)`).

## 5. Free data sources (researched, with live reachability)

| Source | Licence / cost | What it gives | Reachable from this sandbox |
|---|---|---|---|
| **SEC EDGAR companyfacts** (`data.sec.gov`) | Public domain, free, no key | 10-K/10-Q XBRL facts for US filers | **No** (connection blocked here; adapter implemented) |
| **Yahoo Finance chart/quote** | Free, unofficial, rate-limited | Prices, some fundamentals | **429** (rate-limited) |
| **NSE India public JSON** | Free, unofficial, needs session cookies | Indian quotes/indices | **No** (blocked) |
| **World Bank API** | Free, open | Macro series (GDP, inflation) | **Yes (200)** |
| **Bundled demo pack** | Generated locally, MIT | Full 10-year statements for 200 companies | **Yes — always** |
| Ollama + llama.cpp | MIT / Apache-2.0 | On-device LLM | Yes if installed (optional) |

Honest summary: this environment reaches only some hosts, so the app ships with a
self-contained dataset and treats live adapters as optional enrichment. That is also
the right product decision for an offline-first app.

## 6. Performance

- 200 companies / 3,600 statements: seed **≈0.5 s**, screen query **1–5 ms**.
- Indexes: `statements(company_id, period_type, period_end DESC)`,
  `ratios(company_id, period_type, period_end DESC)`, `companies(sector)`.
- `v_latest` pre-joins the latest annual row per company so the screener never
  scans the full statement history.
- The results table renders 100 rows per page with "Load more"; the DOM stays small
  even with thousands of matches.

## 7. Tech stack recommendation

| Layer | Choice | Why |
|---|---|---|
| UI | Vanilla HTML/CSS/JS | Zero build, instant load, no framework churn; a dense table needs no virtual DOM |
| API | `node:http` | No framework dependency for 8 routes |
| DB | SQLite + FTS5 | One file, WAL, free, fast at this scale |
| Query | Custom tokenizer/parser → SQL | Arbitrary expressions, structurally injection-free |
| NL | Rules, optional Ollama | Works offline; model is an enhancement, never a requirement |
| Packaging | `tsc` → `dist/`, `node dist/api/server.js` | Simple, debuggable |
| Alternative | Tauri + Svelte + DuckDB | Better if you want a native desktop binary and columnar scans |

## 8. Known limits

- The bundled dataset is synthetic; the UI says so.
- EDGAR covers US filers only, and is untested live here.
- No live price streaming (quotes are a snapshot table).
- The NL parser covers common phrasings, not arbitrary English — unresolved clauses
  are reported rather than guessed.
