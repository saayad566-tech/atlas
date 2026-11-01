# Product Requirements — Sift (local-first screener)

## 1. Problem

Screening Indian equities usually means a web service: your queries, watchlists and
research habits live on someone else's server, behind a subscription, and stop
working offline. The analytical work — comparing ten years of statements, checking
leverage and cash conversion — is arithmetic over public filings, not a service.

## 2. Goal

A **single-user, offline-first** screener that:

1. stores 10+ years of statements for thousands of companies in one local file;
2. answers arbitrary screening expressions in milliseconds;
3. accepts natural language without requiring a model or a network;
4. explains *why* a company looks risky, from the numbers themselves.

Non-goals: live tick streaming, brokerage integration, multi-user accounts, advice.

## 3. Users

- **The self-directed investor** who wants repeatable screens and full data ownership.
- **The analyst** who needs to compare statements across peers quickly.
- **The tinkerer** who wants a queryable local dataset and an API.

## 4. Functional requirements

### 4.1 Data architecture
- **FR-1** Companies, sectors, industries, currency, source, listing.
- **FR-2** Annual and quarterly statements: P&L, balance sheet, cash flow, working
  capital — one row per company-period, idempotent on re-ingest.
- **FR-3** Ratios pre-computed per period (ROE, ROCE, D/E, P/E, P/B, margins, growth).
- **FR-4** Shareholding (promoter/FII/DII/public/pledge) per period.
- **FR-5** Peer groups (top 5 by market cap within a sector).
- **FR-6** A flat `v_latest` view so a screen is one scan, not a join fan-out.
- **FR-7** Ingestion is pluggable: a bundled demo pack, plus an EDGAR adapter.
- **FR-8** The balance sheet must balance; a test asserts `assets = liabilities`.

### 4.2 Screener logic engine
- **FR-9** Expression grammar: comparisons, `AND`/`OR`/`NOT`, parentheses, arithmetic,
  numeric suffixes (`Cr`, `lakh crore`, `%`).
- **FR-10** A field whitelist with human aliases ("P/E", "debt to equity", "mcap").
- **FR-11** Compilation to SQL with **bound parameters only**; user text never
  reaches SQL. Injection attempts are rejected with a clear error.
- **FR-12** Unknown fields produce a message naming valid alternatives.
- **FR-13** Natural language → the same expression, deterministically, offline.
- **FR-14** Unparsed clauses are reported, never silently dropped.
- **FR-15** Optional local model; its output is validated before use, else rules.

### 4.3 UI
- **FR-16** Global typeahead search over name and symbol.
- **FR-17** Screener bar with both a natural-language input and an expression input,
  kept in sync (the expression is always visible after a run).
- **FR-18** Dense results table: sortable columns, sticky header, tabular numerals,
  Indian digit grouping, red/green for negative/positive deltas.
- **FR-19** Click a row → company view.
- **FR-20** Company view: header metrics grid, health score with red flags, and tabs
  for Annual P&L, Quarterly, Balance Sheet, Cash Flow, Ratios, Shareholding, Peers.
- **FR-21** Empty state, loading state, and a CSV export of any screen.
- **FR-22** Keyboard: `/` focuses search, `Esc` closes the typeahead.
- **FR-23** Demo data is labelled wherever it appears.

### 4.4 Analysis
- **FR-24** Red flags: high leverage, weak interest cover, negative CFO, profit not
  converting to cash, sales/profit decline, margin compression, receivables outpacing
  sales, promoter pledge, low promoter holding, losses.
- **FR-25** A 0–100 health score with a verdict (strong / fair / weak) and a
  one-paragraph summary naming the drivers.

### 4.5 Performance
- **FR-26** Seed 200 companies × 10 years in under 2 s.
- **FR-27** Screen query under 50 ms at 200 companies; under 200 ms at 5,000.
- **FR-28** The results table keeps the DOM small (paged, "Load more").

## 5. Non-functional requirements

- **NFR-1** 100% free and open source; no API keys, no paid tier, no telemetry.
- **NFR-2** Works with the network unplugged (demo pack is local).
- **NFR-3** One SQLite file; backup = copy the file.
- **NFR-4** No user query text is ever executed as SQL.
- **NFR-5** Tests cover the parser, compiler, store, analysis and the EDGAR mapping.
- **NFR-6** The UI is verified headlessly against real Chromium.

## 6. Data pipeline

```
demo pack (deterministic, seeded)  ─┐
EDGAR companyfacts (10-K, free)    ─┼─► normalise ─► INSERT OR REPLACE ─► SQLite
future: NSE/BSE adapter            ─┘                                    │
                                                                         ▼
                                                        ratios → v_latest → screener
```

Normalisation rules: only annual 10-K/FY facts for the annual series; latest filing
wins per period; missing tags leave the field at 0 rather than inventing a value.

## 7. Acceptance criteria

| # | Criterion | Verified by |
|---|---|---|
| A1 | `ROE > 15` returns only companies with ROE > 15 | `data.test.ts` |
| A2 | Injection strings are rejected and the table survives | `expr.test.ts`, `data.test.ts` |
| A3 | "zero debt, ROE above 20" compiles to the right expression | `nl.test.ts` |
| A4 | Every annual statement balances | `data.test.ts` |
| A5 | A pledged company is flagged | `data.test.ts` |
| A6 | All seven company tabs render | `verify.ts` (18 checks) |
| A7 | Demo data is labelled in the UI | `verify.ts` |

## 8. Roadmap

1. **v1 (shipped)** — schema, demo pack, expression engine, NL rules, analysis, UI, API.
2. **v1.1** — live EDGAR ingestion for US filers; a real NSE/BSE adapter where allowed.
3. **v1.2** — saved screens and watchlists; alerts computed locally.
4. **v2** — DuckDB backend for factor scans across every company-year; Tauri shell for
   a native desktop binary.
