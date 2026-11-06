# The Coffee Rule and the GUT Test — source rules, implemented

Two Agora Circle checklists, extracted in full and implemented as `src/finance/core/coffee.ts`
and `src/finance/core/gut.ts`. This file records the source rules verbatim so the
implementation can be audited against them.

**Source documents**
1. *The Coffee Rule · Fundamental Checklist* — 18 pages, English (pages 1–9) and Hinglish
   (pages 10–18), same content in both languages.
2. *Agora Circle · Pre Trade Checklist · The GUT Test* — 2 pages.

Both state they are for educational purposes only, are not investment advice, and that
ratios and thresholds are general rules of thumb that vary by sector.

---

## Part 1 — The Coffee Rule

> Every stock price is like a glass of coffee. Some of it is real coffee. Some of it is just
> foam. Beginners often pay full price for a glass that is half foam.
>
> **Foam** = hype: speculation, news, tips, emotions. It can vanish when the market's mood
> changes. **Coffee** = real value: sales, profits, cash flow and the strength of the business.
>
> Price you pay = Coffee + Foam.

The stated goal is not to find a "cheap" stock but a well-run business with a strong
advantage at a reasonable price: more coffee, less foam.

### What you need before starting
1. The company's annual report — free on NSE, BSE or the company website
2. Last 5 years of results — sales, profit, debt, cash flow
3. This checklist
4. 45 minutes per stock (longer for the first few)

### Step 1 — Understand the business ("What's in the glass?")

> If you can't explain what a company does in two lines, don't buy it yet.

Questions to answer before looking at a single number:
1. What does the company sell, and who buys it?
2. How does it make money — one product or many?
3. Will people still need this in 10 years?
4. Who are its 2–3 biggest competitors?
5. Why would a customer choose it over them?

**The five moats:**

| Type of moat | What it means | Simple example |
|---|---|---|
| Brand | People pay more for the name | A biscuit brand people ask for by name |
| Cost advantage | Makes things cheaper than rivals | The largest, most efficient producer in its industry |
| Network effect | More users make it more useful | An exchange or payments platform |
| Switching cost | Painful for customers to leave | Core software a bank runs on |
| Licence / scale | Hard for new players to enter | Regulated businesses with few licences |

### Step 2 — Check the coffee (financial health)

> Look at at least 5 years, not one good quarter.

| Metric | What it tells you | Healthy sign* |
|---|---|---|
| Sales growth | Is the business growing? | Steady growth over 5 years |
| Profit growth | Is growth turning into profit? | Grows with or faster than sales |
| Operating margin | Profit on every ₹100 of sales | Stable or rising, not swinging wildly |
| ROE | Return on shareholders' money | Above 15% consistently |
| ROCE | Return on all capital used | Above 15% consistently |
| Debt to equity | How much it borrows | Below 1 (banks/NBFCs work differently) |
| Interest coverage | Can profits pay the interest? | Above 3× |
| Cash flow from operations | Is profit real cash? | Close to net profit over 5 years |
| Promoter holding & pledge | Owners' skin in the game | Stable holding, little or no pledge |

### Step 3 — Measure the foam (valuation)

> A great business can still be a bad buy if you pay too much.

**Signs the glass is mostly foam:**
- Everyone on social media is talking about it
- The price jumped on news, not on results
- A great "story" but no profits yet
- You're buying because of a tip or fear of missing out

| Check | How to read it |
|---|---|
| P/E vs its own history | Much higher than its 5–10 year average = more foam |
| P/E vs peers | Far above similar companies needs a clear reason |
| PEG (P/E ÷ growth %) | Around 1 or below is reasonable; well above 2 = expensive for its growth |
| P/B (for banks, NBFCs) | Compare with peers along with ROE |
| Price vs profit | Price up 3× while profit is flat = mostly foam |

### Step 4 — Spot red flags (management)

> Even good numbers can hide trouble. One red flag means dig deeper. Several means walk away.

1. Auditor resigns or the audit report has a qualified opinion
2. Promoters pledging more and more shares
3. Profit grows but operating cash flow stays weak for years
4. Receivables grow much faster than sales
5. Frequent new share issues that dilute existing shareholders
6. Large related-party transactions with promoter-owned firms
7. Repeated changes in accounting policy or year-end

### Step 5 — Where to look (free data on NSE / BSE)

> You don't need any paid tool.

| What you need | Where to find it |
|---|---|
| Quarterly & annual results | NSE / BSE → search the company → Financial Results |
| Shareholding & pledge | NSE / BSE → company page → Shareholding Pattern |
| Annual report | NSE / BSE → company page → Annual Reports, or the company's Investor Relations page |
| News & announcements | NSE / BSE → Corporate Announcements |
| Management commentary | Company website → Investor presentations & concall transcripts |

Tip from the document: start with the annual report's "Management Discussion & Analysis"
section, which explains the business in the company's own words.

### The Coffee Scorecard — 10 points

| # | Line | Points |
|---|---|---|
| 1 | I can explain the business in two lines | 1 |
| 2 | It has a clear moat (brand, cost, network, switching cost, licence) | 1 |
| 3 | Sales have grown steadily for 5 years | 1 |
| 4 | Profits have grown with sales | 1 |
| 5 | ROE / ROCE above 15% most years | 1 |
| 6 | Debt is under control (D/E below 1, interest cover above 3×) | 1 |
| 7 | Operating cash flow is close to net profit | 1 |
| 8 | Promoters hold steady with little or no pledge | 1 |
| 9 | P/E is reasonable vs its history and peers | 1 |
| 10 | No major red flags from Step 4 | 1 |

**Bands:** 8–10 more coffee, worth deeper study · 5–7 some foam, watchlist and wait ·
0–4 mostly foam, skip.

### The six beginner mistakes the document names
1. Buying on a tip without checking the business
2. Thinking a ₹10 stock is "cheap" — price per share says nothing about value
3. Looking at P/E alone, without growth or quality
4. Ignoring debt because profits look good
5. Judging a company by one great quarter
6. Falling in love with a stock and ignoring red flags

---

## Part 2 — The GUT Test

> Gut feeling ek idea de sakti hai. Trade ka decision nahi.
> (A gut feeling can give you an idea. It cannot make the trade decision.)

Three questions to ask yourself, **and answer in writing**, before pressing buy or sell.

**1. Entry ka actual reason kya hai?**
Name the setup and the exact trigger. "Lag raha hai upar jayega" is not a reason. "Price held
the daily level and broke the 5 min range" is.

**2. Agar trade galat hua, toh kitna loss afford kar sakta hoon?**
Write the rupee amount before entry. Keep it inside your fixed risk per trade, for example
0.5% to 1% of capital.

**3. Kis point par maanunga ki mera setup fail ho gaya?**
This is your stop loss, placed where the idea is proven wrong — not where the loss starts
hurting.

> **THE RULE:** Teeno sawaalon ka jawab clear nahi hai? Entry lene ki jaldi mat karo. Missing
> one answer means no trade, even if the chart looks perfect.

### Beyond the entry — 14 checklist items in five categories

**SETUP**
1. This trade is one of my written, tested setups, not a new idea I saw today
2. Every condition of the setup is present, not "almost" present
3. I know the higher timeframe level (daily support or resistance) near my entry

**RISK**
4. Stop loss price is decided and will be placed with the order
5. Position size is calculated from my stop, not from how confident I feel
6. Today's total loss so far is still inside my daily loss limit

**EXIT**
7. Target or exit plan is written down, and reward is at least equal to risk
8. I know what I will do if price stalls halfway: trail, partial book, or exit

**MARKET CONTEXT**
9. No high impact news or result announcement is due during my holding time
10. The index and sector are not moving hard against my direction
11. The stock did not open with a large gap that my setup avoids

**MINDSET**
12. I am not trying to recover a previous loss (no revenge trade)
13. I am not chasing a candle that has already run (no FOMO entry)
14. If this trade hits stop loss, I am okay with it and will log it honestly

### Position size in one line

```
Quantity = Max loss (₹) ÷ (Entry price − Stop loss price)
```

Worked example from the document: capital ₹5,00,000 with 1% risk gives a max loss of ₹5,000.
Entry ₹500, stop loss ₹490, so risk per share is ₹10. Quantity = 5,000 ÷ 10 = 500 shares.

---

## How Atlas implements this

| Source rule | Implementation |
|---|---|
| 10 scorecard lines | `coffeeScorecard()` in `src/finance/core/coffee.ts`, one check per line |
| Bands 8–10 / 5–7 / 0–4 | `verdictFor()` — the same boundaries |
| Step 2 metrics and thresholds | read from `latest_metrics` and five years of `statements` |
| Step 4 red flags | three of the seven are computable from stored data; the rest need filings |
| 3 GUT questions | `gutTest()`, with a vague answer rejected as a non-answer |
| "Missing one answer means no trade" | `gutPassed` requires all three; the verdict is `blocked` otherwise |
| 14 checklist items | `CHECKLIST` in `src/finance/core/gut.ts`, in the document's five categories |
| Quantity formula | `positionSize()`, reproducing the worked example exactly |

### What cannot be implemented from data, and is marked unknown rather than passed

- **The moat** (scorecard line 2) is a judgement about competitive position, not a stored
  number. Inferring it from margin alone would be a guess.
- **Explaining the business in two lines** (line 1) is a comprehension test. Atlas can only
  confirm the business is classified at all.
- **P/E vs its own history** needs 5–10 years of P/E; the app stores 4–5 years of prices.
- **Four of the seven red flags** need the annual report: auditor changes, related-party
  transactions, accounting-policy changes and receivables growth.

Every unknown carries a stated reason. The score is out of the checks that could be answered,
and the note says so plainly.
