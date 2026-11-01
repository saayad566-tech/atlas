# Valuation lab & personalisation — 30 features

Two themes this round: **valuation you can argue with** (every assumption editable and
saved), and **a UI you can shape** (choose columns, arrange them, pick a theme, hide
panels, keep your own ratings and portfolio).

## Valuation lab (13)

| # | Feature | Detail |
|---|---|---|
| 1 | **Five models** | Graham number · DCF on FCF/share · earnings multiple · EV/EBITDA · dividend discount |
| 2 | **Editable assumptions** | growth %, discount %, terminal %, years, target P/E, target EV/EBITDA, payout % |
| 3 | **Saved per company** | Reopen tomorrow and the valuation is identical, with the assumptions beside it |
| 4 | **Scenario presets** | Conservative (growth ×0.6, discount +2, multiple ×0.8), Base, Optimistic (growth ×1.4, discount −1, multiple ×1.2) |
| 5 | **Weighted blend** | Graham 15% · DCF 35% · earnings multiple 30% · EV/EBITDA 20%; weights shown per model |
| 6 | **Bear / base / bull band** | The same blend run under all three scenarios |
| 7 | **Upside % and verdict** | undervalued (> +15%) · fair · overvalued (< −15%) |
| 8 | **WACC-lite** | risk-free 7% + 1.1 × ERP 6% + a size premium (0–2 pts by market cap) |
| 9 | **EV metrics** | EV, EV/EBITDA, EV/Sales computed from market cap and net debt |
| 10 | **Sector premium/discount** | the company's P/E against its sector median |
| 11 | **P/E band** | 10-year min / median / max and where today sits in that range |
| 12 | **Report export** | `GET /api/fin/api/valuation2/:symbol/report.md` — a Markdown valuation sheet |
| 13 | **Reset** | One click back to the defaults, per company |

Models that cannot produce a number (e.g. negative FCF, or discount ≤ terminal growth)
return `null` and are excluded from the blend — they never quietly become zero.

## Personalisation (12)

| # | Feature | Detail |
|---|---|---|
| 14 | **Column chooser** | Add or remove any of 21 metrics from the screener table |
| 15 | **Column ordering** | Move a column up or down; the order is what you see |
| 16 | **Persisted preferences** | Stored server-side, so they survive a reload and a restart |
| 17 | **Theme** | Light / dark, persisted |
| 18 | **Density** | Comfortable / compact, persisted |
| 19 | **Panel visibility** | Hide scores, deep metrics, factors, valuation or strength on the company page |
| 20 | **Row limit** | 10–500 rows per page, clamped and saved |
| 21 | **Personal rating** | 1–5 stars per company |
| 22 | **Thesis note** | Your written reason, stored locally |
| 23 | **Custom alert rules** | metric · operator · threshold, evaluated over the watchlist |
| 24 | **Rule management** | Pause, resume, delete, and see what triggered |
| 25 | **Editable peers** | Choose up to 8 peers; falls back to the automatic sector set |
| 26 | **Portfolio** | Quantity + average cost → value, P&L, P&L %, weight |

## Portfolio & summary (3)

| # | Feature | Detail |
|---|---|---|
| 27 | Portfolio summary | holdings, total value, total P&L and %, best and worst performer |
| 28 | Holdings table | valued at the latest stored price, click through to the company |
| 29 | Weight % | position size as a share of the portfolio |

## Preferences guard rails (1)

| # | Feature | Detail |
|---|---|---|
| 30 | **Validation** | Unknown columns are dropped, an empty column list falls back to defaults, the row limit is clamped 10–500 — a bad preference can never break the table |

## API added

```
GET  /api/fin/api/prefs                 PUT /api/fin/api/prefs      POST /api/fin/api/prefs/reset
GET  /api/fin/api/valuation2/:symbol    POST .../assumptions        POST .../reset    GET .../report.md
GET  /api/fin/api/rating/:symbol        POST /api/fin/api/rating/:symbol
GET  /api/fin/api/alert-rules           POST /api/fin/api/alert-rules
POST /api/fin/api/alert-rules/:id/toggle  DELETE /api/fin/api/alert-rules/:id
GET  /api/fin/api/peers/:symbol         POST /api/fin/api/peers/:symbol
GET  /api/fin/api/portfolio             POST /api/fin/api/portfolio   DELETE /api/fin/api/portfolio/:symbol
```

## Honest notes

- Scenarios are **sensitivities, not forecasts** — they scale your assumptions.
- The dividend-discount model is shown for reference with weight 0 (no dividend history
  is stored, so payout is an assumption).
- Portfolio prices come from the stored quote table; use the Yahoo refresh (watchlist)
  or a CSV import to update them.
