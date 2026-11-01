# Reverse-Engineering Report — how Screener.in works, and what we replicate

> **Method and honesty.** This analysis is based on Screener.in's **publicly visible
> behaviour** and widely documented user-facing features, not on inspecting their
> source, scraping their API, or circumventing any control. I did **not** access
> screener.in from this environment (outbound access to it is blocked), so every
> statement below is either (a) observable public behaviour, or (b) marked as
> **inference**. No proprietary code, markup or data is reproduced. Where Sift
> differs, that is stated.

## 1. What the product is

Screener.in is a web service for Indian equities. Its two halves are:

1. **A company page** — a dense, text-first view of ten years of statements with
   tabs (Quarterly, P&L, Balance Sheet, Cash Flow, Ratios, Shareholding, Peers).
2. **A screener** — a text expression box (`Market Cap > 500 AND ROE > 15`) over the
   whole universe, plus saved screens and watchlists.

The distinguishing design decision is **density**: small type, tight rows, numbers
right-aligned, no charts on the default view. It is optimised for reading, not for
impressing.

## 2. Data architecture (inferred)

Public behaviour implies roughly this shape — **inference from the UI, not from their
schema**:

| Entity | Why we infer it |
|---|---|
| `company` (symbol, name, sector, industry, BSE/NSE codes) | Header, search, peer grouping |
| `period` (annual FY, quarterly) | Tabs show consistent period columns |
| `line_item` per period | P&L / BS / CF rows align to the same period columns |
| `ratio` per period | Ratio tab; ratios change with the underlying numbers |
| `shareholding` per period | Quarterly shareholding table |
| `peer_group` | Peer comparison block, grouped by sector/industry |

Normalisation challenges they must handle, and that Sift also faces:

- **Restatements** — the same period can be reported twice with different numbers;
  the later filing should win.
- **Corporate actions** — splits/bonuses change EPS and price history; ratios must be
  computed on adjusted share counts.
- **Consolidated vs standalone** — two different statement sets for the same company.
- **Missing line items** — a company that never reported "CWIP" must not break the
  column layout.

Sift's equivalent: one `statements` row per `(company, period_type, period_end)` with
`INSERT OR REPLACE` (restatement = latest wins), all statement fields defaulting to 0
rather than NULL so a missing item never breaks a table.

## 3. The screening engine (inferred design)

The expression box accepts arithmetic and boolean logic, which rules out a fixed
filter form. The plausible implementation — and the one Sift adopts — is:

```
text → tokenizer → parser (precedence: OR < AND < NOT < comparison < +− < ×÷)
     → AST → validated against a field whitelist → SQL with bound parameters
```

Two properties matter and are worth copying:

1. **A whitelist, not string interpolation.** Field names map to columns; anything
   else is rejected. This is both a security control and a UX one (typos are named).
2. **Pre-computed ratios.** If `ROE` were computed per row at query time, screening a
   thousand companies would be slow. Storing ratios per period makes a screen a single
   scan.

Sift implements exactly this, and additionally exposes the compiled SQL and its
parameters in the API response so the user can audit what ran.

## 4. UI/UX patterns worth replicating

| Pattern | Why it works | In Sift |
|---|---|---|
| Dense table, small type, tight rows | More companies per screen = faster comparison | yes — 6px vertical padding, 12.5px numerals |
| Right-aligned tabular numerals | Columns become scannable; digits line up | yes — `font-variant-numeric: tabular-nums` |
| Sticky header on a long table | Orientation while scrolling | yes |
| Tabs per statement type | One mental model, seven views | yes |
| Metric strip above the table | Answers "is this company any good?" before the detail | yes — 12-tile grid |
| Expression always visible | The user learns the query language by seeing it | yes — the NL result is written back into the expression box |
| Red/green only for deltas, not for levels | Colour carries meaning, not decoration | yes — growth and pledge only |

Deliberate differences: Sift shows a **health score with explicit red-flag reasoning**
(computed locally), and labels demo data inline. Screener.in's equivalent is a
qualitative pros/cons block curated by humans; Sift's is deterministic arithmetic.

## 5. Network & caching (inferred)

A service like this must serve static history cheaply and update prices often:

- historical statements → cache aggressively (they change only on restatement);
- prices → short TTL, separate endpoint;
- screen results → cache per (expression, universe-version).

Sift has no network at all: the "cache" is the SQLite file, and `quotes` is a snapshot
table. The lesson taken is the **split** — static history and volatile quotes live in
different tables, so a price refresh never rewrites statements.

## 6. What we deliberately did not do

- No scraping of screener.in, no API replay, no circumvention of any restriction.
- No copying of their markup, copy or data.
- No claim that this is a "clone": the data model is re-derived from first principles,
  and the analysis layer (red flags, health score) is new.

## 7. Gap analysis — what Sift still lacks

| Capability | Screener.in | Sift | Plan |
|---|---|---|---|
| Indian filings coverage | full | demo pack + EDGAR (US) | add a licensed/public NSE/BSE feed where permitted |
| Consolidated vs standalone | both | consolidated only | add `statement_scope` column |
| Saved screens / watchlists | yes | no | v1.2 |
| Human-curated pros/cons | yes | deterministic flags | keep deterministic; add citations |
| Corporate-action adjustment | yes | partial (share count fixed) | adjust EPS/series on split events |
| Live prices | yes | snapshot | scheduled refresh adapter |

## 8. Conclusion

The mechanics are not mysterious: a normalised statement store, pre-computed ratios, a
small expression language compiled to SQL, and a dense read-optimised UI. Sift
reproduces those mechanics in ~2,000 lines of dependency-light TypeScript, adds an
offline natural-language layer, and keeps every number auditable — which is the point
of running it locally.
