# What Atlas learned from OpenStock and Qlib

Two outside codebases were studied to decide what Atlas should adopt. Neither is Atlas's
app, and no code was copied — the ideas were reimplemented against Atlas's own data model.

## The three products

| | Atlas | OpenStock | Qlib |
|---|---|---|---|
| Kind | local-first analysis platform | polished market viewer | quantitative research library |
| Stack | Node + vanilla JS, 1 runtime dep | Next.js + Radix, 30 deps | Python, ML stack |
| Markets | 9 | 2 | configurable |
| Users | single device, no account | accounts, cloud | researchers |
| Strength | analysis depth | UI polish | factor models |

## Adopted from OpenStock

| Idea | Why it mattered | Status |
|---|---|---|
| Market session with countdown | a price at 2am looked like one at 11am | **built** — 9 markets, lunch breaks, pre/after |
| Command palette (Ctrl+K) | search was a plain box | **built** — keyboard nav, demo tags |
| Data freshness label | "as of when" was unknowable | already had (data truth); now also `generatedAt` everywhere |
| Price flash on change | needs a live tick feed to be honest | **deferred** — would flash on nothing today |
| Change pill | needs live change data | **deferred**, same reason |

## Adopted from Qlib

| Idea | Why it mattered | Status |
|---|---|---|
| K-bar features | (close-open)/open and friends are the base of every factor model | **built** — alpha factor library |
| Rolling statistics | ROC, MA, STD, RANK, RSV over windows | **built** |
| Information ratio | mean/std x sqrt(N), the standard risk-adjusted measure | **built** into backtest |
| IC / rank IC | does a signal predict forward returns at all | **built** |
| Alpha158 full set | 158 formulaic features for ML pipelines | **partial** — the computable subset; the rest need VWAP and tick data we do not store |

## Deliberately not adopted

- **OpenStock's auth, marketing, sponsors, changelog** — Atlas is local-first with a PIN and
  no backend. An account system would be a second product.
- **Qlib's ML model zoo (LSTM, Transformer, GATs)** — needs a Python runtime and training
  pipeline. Atlas runs one Node process on a phone. The *factors* transfer; the models do not.
- **Qlib's expression engine** — Atlas already has one, plus custom ratios and a visual
  condition builder.

## Where Atlas remains ahead

Reverse DCF with scenarios, the written briefing with falsifiers, the graded decision
journal, 67 documented investor methods, nine-market isolation proven at four levels,
custom ratios usable as columns and filters, and provenance on every row.

## Where the others remain ahead

OpenStock: visual polish and a design system. Qlib: statistical rigour and ML models.

---

# FinanceDatabase (added later)

A third reference: a free, MIT-licensed dataset of listed companies worldwide, published as
one CSV per exchange with sector, industry, country, ISIN and website.

## Adopted

| Idea | Why it mattered | Status |
|---|---|---|
| Complete symbol universe per market | Atlas's directory came from a live screener that fails; a fresh install had no universe at all | **built** — 27,117 companies bundled offline |
| Sector and industry metadata | the screener alone gave a sector, not an industry | **built** |
| ISIN and website per company | useful identifiers Atlas did not store | **built** into the bundle |
| Delisted flag | keeps dead tickers out of the universe | **built** — excluded at import |

## What was reduced

The source is 105 MB of equities across 88 exchanges. Atlas keeps the 11 exchanges behind
its 9 markets and five fields, which is **4.9 MB across 9 files** — small enough to ship, so
a fresh install can show the real universe before any network call.

```
IN 7257 · US 6407 · JP 3783 · HK 2754 · GB 2685 · AU 1829 · CA 1150 · DE 760 · SG 492
```

## Not adopted

- **ETFs, funds, indices, currencies, crypto** (another 56 MB) — Atlas is a stock app.
- **Full company summaries** — several hundred bytes per company for text the app does not
  display; the description comes from the live profile instead.

## How it is used

Importing a bundle writes rows into `companies` **and** `universe_symbols`, so both the
screener and the directory search see them. Prices and statements stay empty until fetched,
so no company ever appears with an invented number. Import is refused unless the market is
active, keeping the isolation guarantee.
