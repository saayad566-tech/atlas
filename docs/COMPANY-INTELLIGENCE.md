# Company intelligence — what a business does, where, and what it plans

24 features added in this round. The bundled pack is **synthetic and labelled**; real
text can come from **Wikipedia** (free, no key, verified reachable) or from a **JSON
import**.

## Profile
| # | Feature | Detail |
|---|---|---|
| 1 | Business description | What the company actually does, in one paragraph, generated per sector |
| 2 | Founded / HQ / employees / website | Core identity fields |
| 3 | Business model | B2B services, B2C branded, B2B commodity, B2C cyclical, … |
| 4 | **Moat score (0–100)** | ROCE (35) + margin level (30) + margin stability (20) + scale (15), with a written explanation of each contribution |
| 5 | Products & services | What it sells, and to whom |
| 6 | Auditor & registrar | Governance basics |

## Business mix
| # | Feature | Detail |
|---|---|---|
| 7 | Revenue by segment | Percentage split per segment (sums to ~100%) |
| 8 | Segment margin & growth | Which segment actually makes the money |
| 9 | Revenue by geography | Region mix |
| 10 | Subsidiaries & JVs | Name, stake, country |

## Demand & plans
| # | Feature | Detail |
|---|---|---|
| 11 | **Order book** | Value in ₹ Cr, book-to-bill, share executable within 12 months |
| 12 | Order book trend | Three years of history |
| 13 | Management guidance | Revenue growth, operating margin, capex |
| 14 | **Guidance vs actual** | Reported figure against the guided number, with variance |
| 15 | Facilities | Plants / branches / network hubs with location and utilisation |
| 16 | Corporate actions | Dividends, splits, bonuses, buybacks |
| 17 | Announcements | Dated timeline with category and summary |

## Risk
| # | Feature | Detail |
|---|---|---|
| 18 | **Risk register** | Sector-specific risks with severity (high/medium/low) |
| 19 | Risk ordering | High severity first |

## Data sources
| # | Source | Status |
|---|---|---|
| 20 | **Wikipedia REST summary** | **Live, verified** — free, no key; stores the extract and marks `source: wikipedia` |
| 21 | **JSON intelligence import** | `POST /api/fin/api/profile/:symbol` — any subset of the pack; marks `source: import` |
| 22 | Generated demo pack | Deterministic per company, labelled `source: generated` |
| 23 | Seed API | `POST /api/fin/api/profiles/seed?force=1` regenerates |

## Merge
| # | Feature | Detail |
|---|---|---|
| 24 | One console, one port | `/api/fin` + `/api/ws` behind a single gateway; see `docs/MERGE.md` |

## Honesty

- The generated pack is **fiction**, coherent with each company's sector and numbers,
  but not a real filing. The UI labels it `generated`, and the Overview tab shows the
  source chip.
- The Wikipedia adapter stores a *description only*; it does not invent financials.
- Order books exist only for businesses that carry one — a lender or an FMCG company
  shows an explicit "does not carry an order book" message rather than zeros.
