# Data acquisition policy

Atlas reads public financial data. This document records what it does, what it refuses to
do, and why — so the boundary is explicit rather than implied.

## What Atlas does

- **Fetches public data politely.** Every request identifies the app honestly in its
  `User-Agent`, carries a contact URL, and is spaced at least 1.5 s apart per host.
- **Obeys `robots.txt`.** A `Disallow` rule is respected. If a path is disallowed, that
  source is skipped and a different one is used.
- **Caches aggressively.** A 10-minute body cache plus conditional requests (`If-None-Match`,
  `If-Modified-Since`) means an unchanged page costs one 304, not a full transfer.
- **Honours `Retry-After`.** A 429 backs off for exactly as long as the server asks.
- **Falls back to a different source.** The registry holds 10+ sources per data type, so a
  refusal is routed around by choosing another source, never by disguising the client.
- **Works offline.** The bundled universe (27,117 companies, 12,329 ETFs) means the app is
  fully usable with no network at all.

## What Atlas does not do, and will not

| Refused | Why |
|---|---|
| Proxy rotation to evade blocks | defeats a site's own access decision |
| Header or identity randomisation to avoid detection | is deception, not data access |
| TLS/JA3 fingerprint spoofing | circumvents a security control |
| Headless-browser stealth patching | same |
| CAPTCHA solving | same |
| Logging into a source as a user to scrape their entitlement | unauthorised access |

These are not capability gaps to be closed later. They are out of scope permanently, because
the app's value is trustworthy analysis, and analysis built on access the source did not
grant is not trustworthy.

## The alternative that actually works

1. **Prefer official and licensed endpoints.** Yahoo Finance, World Bank, IMF, Wikidata and
   Google News RSS are all reachable and permitted.
2. **Ship the data instead of scraping it.** The bundled universe removes the need to scrape
   a listing page at all.
3. **Detect change locally.** Listings are reconciled against a stored snapshot, so "new"
   means "appeared since the last check" — computed from data we already hold.
4. **Be a good citizen.** Rate limiting and caching keep the app inside every source's
   tolerance, which is what keeps a pipeline running for years rather than days.

## If a source blocks Atlas

The pipeline records the refusal with the reason, marks the source unhealthy, and routes to
the next one. It does not retry in a loop and it does not change identity. The user sees an
honest message: the data is stale, and why.
