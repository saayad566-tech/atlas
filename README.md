# Atlas

**A local-first, multi-asset investment analysis platform.**

Stocks, ETFs, forex and crypto across nine country markets — running as a single Node
process on your own machine. No account, no cloud backend, no telemetry, one required
dependency.

```
27,117 companies and 12,329 ETFs bundled offline
9 country markets + forex and crypto asset spaces
85 modules · 64 API endpoints · 73 test suites
```

## The idea

> **The instrument decides the market, not the other way round.**

Type `RELIANCE.NS`, `VOO`, `EURUSD=X` or `BTC-USD` and Atlas works out the asset class, the
country, the currency and the trading hours from the symbol itself. There is no wrong-market
state to get stuck in.

## What it does

**Stocks** — screening over ~30 computed fields, fundamentals, DCF and reverse DCF with
scenarios and sensitivity, Piotroski/Altman/Beneish, a written briefing with falsifiers, 41
alpha factors, peer percentiles, a graded decision journal, and 67 documented investor
methods each runnable as a screen.

**ETFs, forex, crypto** — each class gets the analysis that fits it, and only that. Pip size
and session overlap for a currency pair; 24-hour trading and supply for a crypto asset.
Where a class supports an analysis the data cannot fill, the gap is listed rather than
approximated.

**Discovery** — sector phases, ranked candidates that always state what argues against them,
instrument lifecycle tracking for new, upcoming and delisted listings.

**Local AI** — 10 models in a catalogue with plain-English descriptions and a device-fit
check. The app downloads one itself, runs it through llama.cpp on-device, grounds every
answer in stored numbers, and cross-checks what the model says. With no model installed the
assistant answers deterministically from the data and tells you which engine answered.

## Run it

```bash
npm install          # one required dependency
npm run build
npm start            # http://127.0.0.1:8787
```

First open asks which country to install. Nothing is fetched until you ask for it.

To add a local model:

```bash
npm run get-model                              # downloads a 491 MB GGUF, verified
ATLAS_MODEL_PATH=data/models/qwen2.5-0.5b-q4.gguf npm start
```

## Why it can be trusted

- **Isolation is physical.** One SQLite file per market and asset class. A bug cannot leak
  one market's rows into another, because they are different files. Proven at four levels.
- **Unknown is not zero.** Ratios are nullable, so "no P/E" is distinguishable from "P/E of
  0" — and a `P/E < 15` screen cannot silently include a company whose P/E was never known.
- **Impossible values are rejected.** Every number passes a sanity boundary; a P/E of `1e308`
  becomes `null`, not a lie.
- **Provenance on every row.** Synthetic demo data is tagged on every row and never presented
  as real.
- **Offline by default.** Analysis works with the network unplugged, from bundled data.

## Delivery

| Target | Artefact |
|---|---|
| Web / PWA | `atlas-pwa.zip` |
| Android | `atlas-release.apk` (signed v1/v2/v3) |
| Windows | `atlas.exe` (PE32+ x64) |
| Source | `atlas-platform.zip` |

## Documentation

- [`docs/PRD.md`](docs/PRD.md) — product requirements, as built, with measured numbers and
  stated limitations
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — deployment, testing, scalability, technical debt
- [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) — the token layer and component rules
- [`docs/DATA-POLICY.md`](docs/DATA-POLICY.md) — what is fetched, and what is permanently refused
- [`docs/REFERENCE-STUDY.md`](docs/REFERENCE-STUDY.md) — what was learned from outside projects

## Test

```bash
npm test              # all suites
node scripts/verify-<name>.js
```

The suites that matter most: `feature-inventory`, `market-purity`, `multasset`, `fullstack`,
`shapes`, `null-pipeline`, `data-quality`, `robustness`, `design`.

## Licence

MIT — see [LICENSE](LICENSE).

Atlas is analysis software. It is not investment advice, and it does not place orders.
