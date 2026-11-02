# Changelog

All notable changes to Atlas. Dates are ISO.

## [3.4.1] — 2026-11-02

### Added
- In-app model download: exact HuggingFace filenames in the catalogue, streaming to a
  `.part` file, GGUF magic verified before use, curl-first for proxy environments.
- `npm run get-model` for a one-command local model.

### Changed
- `node-llama-cpp` moved to `optionalDependencies`. One required dependency remains
  (`better-sqlite3`); the app degrades to deterministic answers without a model.
- The model path is read at call time rather than captured at module load.

## [3.4.0] — 2026-11-02

### Added
- In-process llama.cpp inference through a serialised worker process. Verified with a real
  485 MB GGUF answering a real question on-device.
- Standalone Windows executable (`atlas.exe`, PE32+ x64, 53 MB) built with pkg.

### Fixed
- The context ran out of sequences because each session was created without release.
- Piped stdin closed before inference finished, discarding the answer.

## [3.3.3] — 2026-11-02

### Added
- Response-shape audit: every field the UI reads is verified against the API response.

### Fixed
- The sector filter rendered `[object Object]` for every option; the API returns objects.
- A race in the back-data suite that asserted before the async fetch completed.

## [3.3.2] — 2026-11-02

### Fixed
- A request body over 1 MB called `req.destroy()`, resetting the connection and leaving the
  promise unsettled. It now drains, rejects with a typed error and answers 413.

## [3.3.1] — 2026-11-02

### Fixed
- `money()` had no null guard, rendering `₹NaN` for a missing price.
- Nulls sorted first; they now sort last in both directions.
- Sector filter options rendered as `[object Object]`.

## [3.3.0] — 2026-11-02

### Fixed
- **Ratios were `NOT NULL DEFAULT 0`, so a missing P/E was stored and served as `0`.**
  A `P/E < 15` screen would include every company whose P/E was never known. Columns are now
  nullable, 26 `COALESCE(..., 0)` fallbacks were removed, and `ScreenerRow` declares
  `number | null`.

### Added
- A sanity boundary rejecting impossible values (1e308, negative market cap, yield > 100%).

## [3.2.0] — 2026-11-02

### Added
- Polite fetch client: honest User-Agent, robots.txt obeyed, per-host rate limit,
  conditional GET, Retry-After honoured, cached copy served offline.
- Instrument lifecycle tracking for new, upcoming and delisted listings as a delta against
  a stored snapshot, so it works offline.
- `docs/DATA-POLICY.md` recording what is fetched and what is permanently refused.

## [3.1.0] — 2026-11-02

### Added
- Hardened storage: `busy_timeout`, `synchronous=NORMAL`, 16 MB cache, 12 indexes,
  `withWriteRetry` for concurrent writers.
- Background sync engine with exponential recovery and a durable event log.
- Runtime performance metrics: latency percentiles, throughput, threshold alerts.
- Multi-tenant scoped API keys stored only as SHA-256, compared in constant time.
- `docs/OPERATIONS.md` sections 3–6.

## [3.0.0] — 2026-11-02

### Added
- **Multi-asset platform.** Stocks, ETFs, forex and crypto as independent classes, each with
  its own database, its own analysis and its own panels.
- **Instrument-first navigation**: the symbol determines the asset class and market.
- 12,329 ETFs bundled so resolution can tell an ETF from a stock.
- Storage key became `<market>-<class>`; the pre-3.0 file migrates on first use.

## [2.7.0] — 2026-11-02

### Added
- Atlas design system from scratch: 179 tokens, real dark mode, WCAG AA in both themes,
  53 feature components re-expressed with tokens.

### Fixed
- Dark mode set `color-scheme` and no colours, so the app stayed white.

## [2.5.0] — 2026-11-02

### Added
- 27,117-company offline symbol universe bundled from FinanceDatabase (MIT), importable into
  the active market only.

## [2.4.0] — 2026-11-02

### Added
- 41 alpha factors following Qlib's Alpha158 conventions, and an information ratio in the
  backtest.
- `docs/REFERENCE-STUDY.md`.

## [2.3.0] — 2026-11-02

### Added
- Trading sessions for all nine markets with lunch breaks, pre/after hours and a weekend
  countdown.
- Ctrl+K command palette.
