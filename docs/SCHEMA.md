# Database Schema

One SQLite file (WAL mode). Money is in **₹ crore**; percentages are stored as plain
numbers (15.2 means 15.2%).

## Tables

### `companies`
| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `symbol` | TEXT UNIQUE | e.g. `APESTE008` / `CIK0000320193` |
| `name` | TEXT | |
| `sector` | TEXT | indexed |
| `industry` | TEXT | |
| `currency` | TEXT | `INR` or `USD` |
| `source` | TEXT | `fixture` (demo) or `edgar` (live) |
| `listed_on` | TEXT | `NSE` / `SEC` |
| `updated_at` | INTEGER | epoch ms |

### `statements`
One row per company per period. Holds P&L, balance-sheet and cash-flow lines together
because they are always read together for a period.

| Group | Columns |
|---|---|
| P&L | `sales`, `expenses`, `operating_profit`, `opm_pct`, `other_income`, `interest`, `depreciation`, `profit_before_tax`, `tax_pct`, `net_profit`, `eps` |
| Balance sheet | `equity_capital`, `reserves`, `borrowings`, `other_liabilities`, `total_liabilities`, `fixed_assets`, `cwip`, `investments`, `other_assets`, `total_assets` |
| Cash flow | `cfo`, `cfi`, `cff`, `net_cash_flow` |
| Working capital | `receivables`, `inventory`, `payables`, `cash` |

`UNIQUE(company_id, period_type, period_end)` makes re-ingestion idempotent.
Index: `(company_id, period_type, period_end DESC)` — every read is "latest N for a
company".

**Invariant:** `total_assets = total_liabilities` for every row. The generator plugs
`other_assets` to satisfy it, and a test asserts the identity across ~2,000 rows.

### `ratios`
Pre-computed per period so the screener never divides at query time:
`roe`, `roce`, `debt_to_equity`, `opm`, `npm`, `pe`, `pb`, `dividend_yield`,
`market_cap`, `current_ratio`, `interest_coverage`, `asset_turnover`,
`sales_growth_3y`, `profit_growth_3y`.

### `shareholding`
`promoter`, `fii`, `dii`, `public`, `pledge_pct` per `period_end`.

### `peers`
`(company_id, peer_id, rank)` — top 5 by market cap within the same sector.

### `quotes`
Latest `price`, `market_cap`, `pe`, `updated_at` per company (the "live" snapshot).

### `meta`
`schema_version` and future settings.

## The screener view

`v_latest` is the flat, one-row-per-company snapshot the screener queries:

```sql
SELECT c.id, c.symbol, c.name, c.sector, c.industry,
       COALESCE(q.market_cap, r.market_cap, 0) AS market_cap,
       r.roe, r.roce, r.debt_to_equity, s.sales, s.net_profit,
       sh.promoter AS promoter_holding, sh.pledge_pct AS pledge, …
FROM companies c
LEFT JOIN ratios r       ON r.company_id = c.id AND r.period_type='annual'
  AND r.period_end = (SELECT MAX(period_end) FROM ratios WHERE company_id=c.id AND period_type='annual')
LEFT JOIN statements s   ON s.company_id = c.id AND s.period_type='annual'
  AND s.period_end = (SELECT MAX(period_end) FROM statements WHERE company_id=c.id AND period_type='annual')
LEFT JOIN shareholding sh ON sh.company_id = c.id
  AND sh.period_end = (SELECT MAX(period_end) FROM shareholding WHERE company_id=c.id)
LEFT JOIN quotes q       ON q.company_id = c.id;
```

Correlated `MAX(period_end)` subqueries are cheap here because they hit the
`(company_id, period_type, period_end DESC)` index.

## Indexing strategy

| Index | Serves |
|---|---|
| `statements(company_id, period_type, period_end DESC)` | company detail, `v_latest` |
| `ratios(company_id, period_type, period_end DESC)` | `v_latest`, ratios tab |
| `companies(sector)` | sector filters, peer grouping |
| `companies_fts` (FTS5) | name/symbol search |
| `UNIQUE(company_id, period_type, period_end)` | idempotent ingest |

A screen is a single scan of `v_latest` (one row per company) with bound parameters —
no join fan-out at query time.

## Scaling notes

- 5,000 companies × (10 annual + 8 quarterly) ≈ 90k statement rows ≈ 30–60 MB.
- For 20 years × 20k companies, add a covering index on
  `(company_id, period_type, period_end) INCLUDE (sales, net_profit)` — or move the
  analytical scans to DuckDB behind the same `Store` interface.
- Compression: numbers are REAL; a delta/varint scheme would shrink the file further
  but complicates queries. Not worth it at this scale.
