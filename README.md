# Atlas — a local-first platform for deep fundamental analysis

One application for screening and analysing listed companies across nine markets, on real
market data. It runs as a single Node process on your own machine, serves a browser console,
keeps everything in local SQLite files, and fetches from public sources.

No account. No cloud backend. No telemetry. One runtime dependency.

## Analysis

- **Screening** — a validated expression language over ~30 computed fields, natural-language
  queries, quick filters, saved screens and a block query builder.
- **Custom ratios** — define your own metric as arithmetic over existing fields
  (`cfo / net_profit * 100`) and it becomes a column, a sort key and a screen condition.
  Evaluated by a hand-written parser: no `eval`, no `Function`, no property access.
- **Deep fundamentals** — owner earnings, cash conversion cycle, share dilution,
  incremental ROIC, dividend safety against free cash flow, reinvestment rate,
  common-size statements, DuPont, Piotroski F-score, Altman Z, Beneish M.
- **Reverse DCF** — solves for the growth rate today's price implies, then states whether
  that is ambitious or modest. Paired with bear/base/bull scenarios, a 5×5 sensitivity grid
  and a margin of safety against each case.
- **Company briefing** — an analyst-style written account composed from stored numbers:
  four independent stances (value, quality, momentum, safety), explicit dissent when they
  contradict, and falsifiers naming what would prove the view wrong.
- **Decision journal** — record the thesis when you commit; the app grades your reasoning
  against what actually happened and reports your own accuracy.
- **Sector phases** — leading / improving / weakening / lagging from the year's trend, the
  last month's momentum and breadth, with the evidence stated in words.
- **Ranked candidates** — scored by how well independent dimensions agree, with
  contradiction penalised, and every candidate stating what argues against it.

## Data

- **Live market data** — quotes, OHLCV, statements, dividends, splits, analysts, holdings,
  insiders and news, fetched and stored per market.
- **158 catalogued sources** across 15 data types, 10+ per type, each marked keyless or
  key-required and tagged with the markets it covers.
- **Failover engine** — priority order, retry with exponential backoff and jitter, a
  circuit breaker that cools a failing source, and an honest report when every source fails.
- **Working adapters** for Yahoo (quotes, history, fundamentals), Google News, Bing News,
  World Bank, IMF and Wikidata — each verified live.
- **Provenance on every row** — synthetic demo data is tagged `DEMO` wherever it appears;
  real data carries its source name.

## Keeping itself current

A background scheduler refreshes prices, discovers newly listed symbols across all nine
markets, tracks upcoming events and graduates pre-listing companies as they price. It
rotates markets so no single source is hammered.

## Markets

India · United States · United Kingdom · Japan · Germany · Singapore · Hong Kong ·
Australia · Canada. Each has its own SQLite file, currency, timezone and benchmark.
Switching market swaps the database handle; a static guard fails the build if any code
opens a database outside the market manager, and a browser test proves no row crosses.

## Export

CSV, TSV and a native `.xlsx` written from scratch — numbers stay numeric so Excel can
compute on them. No dependency added.

## Quick start

```bash
npm install          # one runtime dependency: better-sqlite3
npm run build
npm start            # http://127.0.0.1:8800
```

First run asks you to choose a country bundle — there is deliberately no default market.
An empty market explains itself and offers demo data, a directory sync, or a single fetch.

```bash
npm run verify:all   # 43 verification suites
```

## Building the Android app

```bash
bash scripts/install-toolchain.sh   # JDK 17, build-tools 34, platform 34
bash scripts/build-apk.sh           # signed release APK, no Gradle
```

The keystore is generated from documented values at build time, so no binary secret needs
to survive between machines.

## Honest status

- Market data comes from an **unofficial** Yahoo source with 4–5 years of history. The best
  competitors carry 10+; closing that is a data-source problem, not a code one.
- Of 158 catalogued sources, **23 have a working adapter**. The rest are catalogued and
  either blocked from this network or need a free key. Building an adapter that cannot be
  run would be untested code presented as working, which this project does not do.
- Demo data is synthetic and labelled `DEMO` on every row and every company page.
- On-device model inference is unmanaged: the catalogue and installer are complete and
  tested, but no quantised model has been run end to end.
- The Windows EXE is not built — Electron's binary truncates through this network.
- Licence: MIT.
