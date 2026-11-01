# LLM Prompt Pattern — natural language → structured filter

Sift's natural-language layer has one contract: **produce an expression string that
the existing compiler accepts**. The model is a translator, never an executor.

## Why this shape

- The model never sees SQL and never touches the database.
- Its output is validated by `compileExpression()`; a hallucinated field or an
  injection attempt fails validation and the deterministic rules take over.
- The same AST serves both paths, so behaviour is identical whether or not a model
  is present.

## System prompt (as implemented in `buildLlmPrompt`)

```
You translate a stock-screening request into ONE expression.
Allowed numeric fields: Market Cap, Price, P/E, P/B, ROE, ROCE, Debt to Equity,
  Sales, Net Profit, Expenses, Operating Profit, Interest, Depreciation,
  Cash from Operations, Cash, OPM, NPM, EPS, Dividend Yield, Promoter Holding,
  Pledged, Current Ratio, Interest Coverage, Sales Growth 3Y, Profit Growth 3Y,
  Asset Turnover.
Allowed text fields: Sector, Industry, Symbol, Name (quote values with double quotes).
Operators: > < >= <= = != AND OR NOT ( ). Numbers may end with Cr, lakh crore or %.
Reply with JSON only: {"expression": "..."}. No prose, no markdown.
Request: <user text>
```

`format: "json"`, `temperature: 0` — deterministic output for a translation task.

## Few-shot examples

| Request | Expression |
|---|---|
| zero debt, ROE above 20, P/E under 20 | `Debt to Equity < 0.1 AND ROE > 20 AND P/E < 20` |
| large cap with a dividend yield above 2% | `Market Cap > 20000 AND Dividend Yield > 2` |
| cheap banks with low leverage | `Sector = "Financials" AND P/E < 12 AND Debt to Equity < 1` |
| small caps growing sales fast | `Market Cap < 5000 AND Sales Growth 3Y > 20` |
| high promoter skin in the game | `Promoter Holding > 50 AND Pledged < 1` |
| everything except telecom, profitable | `NOT Sector = "Telecom" AND Net Profit > 0` |
| debt free and cash-generative | `Debt to Equity < 0.1 AND Cash from Operations > 0` |
| mid cap with strong returns | `Market Cap > 5000 AND Market Cap < 20000 AND ROE > 18` |

## Output contract

```json
{ "expression": "Debt to Equity < 0.1 AND ROE > 20" }
```

Anything else — prose, markdown fences, an unknown field, unbalanced parentheses —
is rejected by the compiler and the rule parser answers instead. The API returns a
`note` saying which path was used, so the user always knows.

## Rule parser (the offline default)

The deterministic parser handles the phrasings people actually type:

| Phrase | Expression |
|---|---|
| zero / no / nil debt, debt-free | `Debt to Equity < 0.1` |
| low debt | `Debt to Equity < 0.5` |
| no / zero pledge, unpledged | `Pledged < 0.5` |
| large cap / mid cap / small cap | `Market Cap > 20000` / `5000–20000` / `< 5000` |
| dividend paying | `Dividend Yield > 0.5` |
| in IT sector / excluding telecom | `Sector = "Information Technology"` / `Sector != "Telecom"` |
| <field> greater than / above / over N | `<field> > N` |
| <field> less than / under / below N | `<field> < N` |

Clauses it cannot parse are returned in `unresolved[]` rather than guessed.

## Running a local model (optional, free)

```bash
ollama pull llama3.2
ollama serve
SIFT_OLLAMA_MODEL=llama3.2 npm start
```

Then `POST /api/nl {"text": "...", "useLlm": true}`. If Ollama is not running, the
request still succeeds via the rules and the response says so.

## Safety notes

- No prompt contains user secrets; the prompt is a fixed template plus the query.
- The model's output is data, not code: it is parsed as JSON and compiled through a
  whitelist, never `eval`-ed and never concatenated into SQL.
- A malicious query cannot escalate: the worst case is an invalid expression, which
  is rejected.
