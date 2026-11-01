# Data sources — every way in, for every screen

**Method.** 15 candidate sources probed twice through this environment's egress proxy
(JSON and RSS), with redirect following, at 27 Oct 2026. Status is re-checked live by the
app itself (`GET /api/fin/api/import/sources`) and cached for 10 minutes, so the Import
screen always shows today's truth rather than a claim baked into the code.

## 1. What is reachable from here

| Source | Kind | Provides | Status now |
|---|---|---|---|
| **Yahoo Finance** | JSON API | prices, statements, ratios, analysts, dividends, ownership, insider trades, estimates, calendar, splits, volume | live / **throttled** (429 under burst) |
| **Google News RSS** | RSS | news headlines by company name | **live** |
| **Yahoo Finance RSS** | RSS | per-symbol headlines | live / **throttled** |
| **Wikipedia REST** | JSON API | company descriptions | live / occasionally **403** |
| **World Bank** | JSON API | GDP, CPI, unemployment, investment | **live** |
| SEC EDGAR | JSON API | US filings, full ticker list | **unreachable** here |
| NSE India | JSON API | prices, shareholding, announcements | **403** (bot protection) |
| Stooq | CSV | daily price history | **unreachable** |
| OpenFIGI | JSON API | ticker → FIGI, exchange | **unreachable** |
| GLEIF | JSON API | LEI, parent/child ownership | **unreachable** |
| Frankfurter (ECB) | JSON API | FX rates | **unreachable** |

Status vocabulary is deliberately precise: **live**, **rate-limited** (worth retrying),
**blocked** (refused — needs headers or a different network), **unreachable** (timeout/DNS),
**offline-ok** (no network needed).

## 2. What always works, with no network at all

| Source | Kind | Provides |
|---|---|---|
| **CSV file** | file | statements, ratios, prices, anything tabular — with column mapping |
| **JSON import** | file | full intelligence packs, database backup/restore |
| **Manual entry** | forms | ratings, notes, portfolio, peers, valuation assumptions, alert rules |
| **Demo generator** | generated | a complete synthetic pack for every screen |

This is the guarantee that matters: **no screen is a dead end.** Verified — 26 features
mapped, **0 dead ends**.

## 3. Feature → data path

Every screen, with every way to fill it. `●` = live, `●` = offline-ok, `●` = throttled,
`●` = blocked.

| Feature | Screen | Paths |
|---|---|---|
| Company search | Global search | yahoo · generated · csv |
| Identity (name, sector, exchange) | Company header | yahoo · csv · manual |
| Business description | Overview | wikipedia · yahoo · json · generated |
| Statements (10y annual + quarterly) | P&L / Balance / Cash Flow | yahoo · sec-edgar · csv · generated |
| Ratios | Ratios tab | yahoo · csv · generated |
| Scores (Piotroski, Altman, Beneish) | Scores | yahoo · csv · generated |
| Deep metrics (DuPont, CCC, CAGR) | Deep analysis | yahoo · csv · generated |
| Factors & ranking | Rank | yahoo · csv · generated |
| Valuation lab | Valuation | yahoo · manual · generated |
| Balance-sheet strength | Strength | yahoo · csv · generated |
| Segments, order book, guidance, facilities | Business / Plans | json · manual · generated |
| Risk register | Risks | json · generated |
| Price history & analytics | Price panel | yahoo · stooq · csv · generated |
| Dividends | Market | yahoo · csv · generated |
| Analyst consensus & targets | Market | yahoo · csv · generated |
| Ownership & insider trades | Market | yahoo · nse · csv · generated |
| Shareholding (promoter/FII/pledge) | Shareholding | nse · csv · generated |
| Earnings estimates & surprises | Market | yahoo · csv · generated |
| Earnings calendar | Market | yahoo · manual · generated |
| News & announcements | News | google-news · yahoo-rss · generated |
| Macro indicators | Macro | worldbank · csv |
| FX / currency conversion | Screener | frankfurter · manual |
| Portfolio | Portfolio | manual · csv |
| Watchlist & alerts | Watchlist | manual |
| Ratings, notes, peers, assumptions | Company page | manual |
| Full backup / restore | API | json |

**18 of 26 features currently have a live network source**; the other 8 are covered by the
offline paths (JSON import, manual entry, generator).

## 4. On scraping — what is and is not done

- **RSS is used as published** — Google News and Yahoo both offer RSS feeds for exactly
  this purpose. No HTML scraping, no parsing of protected pages.
- **NSE India returns 403** to a plain request. It is recorded as blocked. I did **not**
  add header spoofing, cookie harvesting or any bot-protection bypass to get around it —
  that is a site's access control, not a technical puzzle.
- **No anti-bot circumvention anywhere** in the codebase. Where a source refuses, the
  product reports it and falls back to an offline path.
- If you need NSE data legitimately: use their published data products, a licensed vendor,
  or run the app on a network where you are authorised to access it.

## 5. Honest limitations

- **Rate limits are real.** Probing 12 sources in a burst made Yahoo return 429 twice. The
  app treats that as *rate-limited*, not *blocked*, and retries later.
- **News relevance is only as good as the name.** For a fictional demo company
  ("Quantum Systems"), Google News returns whatever matches those words — an electric
  drone article. For a real ticker it returns relevant coverage.
- **Blocked ≠ impossible.** EDGAR, Stooq, OpenFIGI, GLEIF and Frankfurter work on a normal
  network; they time out from this sandbox. The adapters are written against their public
  contracts but only the reachable ones are verified live.
- **Wikipedia gives a description, not financials.** It is a text source.

## 6. Reproduce

```bash
node scripts/verify-import.js     # source probe + feature matrix + RSS + news
curl localhost:8800/api/fin/api/import/sources
curl localhost:8800/api/fin/api/import/matrix
```
