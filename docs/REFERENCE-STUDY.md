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
