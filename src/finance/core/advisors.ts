// Investor library.
//
// Each entry records a *documented approach* — the criteria a public investor is known for
// applying — and turns it into a screen this app can actually run. Nothing here is a quote,
// and no entry invents words. Where the public record is thin, the entry says so rather
// than dressing up a guess as a method.
import type { Database as DB } from 'better-sqlite3';

export type Confidence = 'documented' | 'summary';

export interface Criterion { field: string; op: '>' | '>=' | '<' | '<=' | '=' | '!='; value: number }

export interface Advisor {
  id: string;
  name: string;
  country: string;
  era: string;
  /** The approach in one line, as the public record describes it. */
  approach: string;
  /** The screen this approach implies, expressed in this app's fields. */
  criteria: Criterion[];
  /** What the description rests on. */
  basis: string;
  confidence: Confidence;
  /** Which of this app's analyses the approach leans on. */
  uses: string[];
}

/**
 * The library. Entries are grouped by market so a user sees their own country's tradition
 * first. Criteria are deliberately conservative: only thresholds that are publicly
 * associated with the approach, and only fields this app actually stores.
 */
export const ADVISORS: Advisor[] = [
  // ---------------- India ----------------
  { id: 'graham-in', name: 'Benjamin Graham (applied to India)', country: 'IN', era: '1934–1976', approach: 'Buy only with a margin of safety: low multiple, solid balance sheet, earnings you can verify.', criteria: [{ field: 'P/E', op: '<', value: 15 }, { field: 'P/B', op: '<', value: 1.5 }, { field: 'Debt to Equity', op: '<', value: 1 }], basis: 'Security Analysis and The Intelligent Investor state these thresholds explicitly.', confidence: 'documented', uses: ['value', 'safety'] },
  { id: 'jhunjhunwala', name: 'Rakesh Jhunjhunwala', country: 'IN', era: '1985–2022', approach: 'Concentrated bets on domestic growth: businesses riding domestic consumption and the infrastructure cycle.', criteria: [{ field: 'Sales Growth 3Y', op: '>', value: 15 }, { field: 'ROE', op: '>', value: 15 }], basis: 'Widely reported portfolio pattern and stated preference for domestic-demand businesses.', confidence: 'summary', uses: ['growth', 'quality'] },
  { id: 'damani', name: 'Radhakishan Damani', country: 'IN', era: '1980s–present', approach: 'Buy durable consumer businesses at sensible prices and hold for decades.', criteria: [{ field: 'ROE', op: '>', value: 18 }, { field: 'Debt to Equity', op: '<', value: 0.3 }, { field: 'P/E', op: '<', value: 40 }], basis: 'Publicly known concentration in retail and consumer names; thresholds are this apps characterisation.', confidence: 'summary', uses: ['quality', 'safety'] },
  { id: 'pabrai', name: 'Mohnish Pabrai', country: 'IN', era: '1999–present', approach: 'Dhandho: low-risk, high-uncertainty bets — heads I win, tails I do not lose much.', criteria: [{ field: 'P/E', op: '<', value: 12 }, { field: 'Debt to Equity', op: '<', value: 0.5 }, { field: 'Interest Coverage', op: '>', value: 4 }], basis: 'The Dhandho Investor sets out the low-downside framing and leverage aversion.', confidence: 'documented', uses: ['value', 'safety'] },
  { id: 'bakshi', name: 'Sanjay Bakshi', country: 'IN', era: '1990s–present', approach: 'Moats first: pricing power and high returns on capital, then pay a fair price.', criteria: [{ field: 'ROCE', op: '>', value: 20 }, { field: 'Operating Margin', op: '>', value: 15 }], basis: 'Publicly taught framework emphasising moats and return on capital.', confidence: 'summary', uses: ['quality'] },
  { id: 'mundra', name: 'Jayant Mundra', country: 'IN', era: '2010s–present', approach: 'Value with a quality filter: avoid the cheap-for-a-reason trap by requiring the business to earn well.', criteria: [{ field: 'P/E', op: '<', value: 20 }, { field: 'ROE', op: '>', value: 12 }], basis: 'A general characterisation of a value-and-quality orientation. This is a summary, not a published rule set — treat the thresholds as this apps reading.', confidence: 'summary', uses: ['value', 'quality'] },
  { id: 'maheshwari', name: 'Basant Maheshwari', country: 'IN', era: '2000s–present', approach: 'Quality growth: pay up for businesses that can compound earnings for years.', criteria: [{ field: 'Profit Growth 3Y', op: '>', value: 20 }, { field: 'ROE', op: '>', value: 18 }], basis: 'Publicly stated preference for high-growth quality franchises.', confidence: 'summary', uses: ['growth', 'quality'] },

  // ---------------- United States ----------------
  { id: 'graham-us', name: 'Benjamin Graham', country: 'US', era: '1934–1976', approach: 'Margin of safety from the balance sheet: cheap on assets and earnings, low debt.', criteria: [{ field: 'P/E', op: '<', value: 15 }, { field: 'P/B', op: '<', value: 1.5 }, { field: 'Debt to Equity', op: '<', value: 1 }], basis: 'Explicit thresholds in The Intelligent Investor.', confidence: 'documented', uses: ['value', 'safety'] },
  { id: 'buffett', name: 'Warren Buffett', country: 'US', era: '1965–present', approach: 'A wonderful business at a fair price: high returns on capital, low debt, durable margins.', criteria: [{ field: 'ROE', op: '>', value: 15 }, { field: 'Debt to Equity', op: '<', value: 0.5 }, { field: 'Operating Margin', op: '>', value: 15 }], basis: 'Shareholder letters describe the return-on-capital and owner-earnings emphasis.', confidence: 'documented', uses: ['quality', 'safety'] },
  { id: 'lynch', name: 'Peter Lynch', country: 'US', era: '1977–1990', approach: 'Growth at a reasonable price: the P/E should be below the earnings growth rate.', criteria: [{ field: 'P/E', op: '<', value: 25 }, { field: 'Profit Growth 3Y', op: '>', value: 15 }], basis: 'One Up on Wall Street sets out the PEG discipline.', confidence: 'documented', uses: ['value', 'growth'] },
  { id: 'greenblatt', name: 'Joel Greenblatt', country: 'US', era: '1985–present', approach: 'Magic formula: good businesses (high ROCE) bought cheap (high earnings yield).', criteria: [{ field: 'ROCE', op: '>', value: 20 }, { field: 'P/E', op: '<', value: 15 }], basis: 'The Little Book That Beats the Market ranks on exactly these two factors.', confidence: 'documented', uses: ['quality', 'value'] },
  { id: 'klarman', name: 'Seth Klarman', country: 'US', era: '1982–present', approach: 'Absolute value with an explicit downside case; cash is a position.', criteria: [{ field: 'P/B', op: '<', value: 1.5 }, { field: 'Current Ratio', op: '>', value: 1.5 }, { field: 'Debt to Equity', op: '<', value: 0.5 }], basis: 'Margin of Safety argues from liquidation and balance-sheet protection.', confidence: 'documented', uses: ['value', 'safety'] },
  { id: 'fisher', name: 'Philip Fisher', country: 'US', era: '1958–2004', approach: 'Scuttlebutt growth investing: durable margins and reinvestment over decades.', criteria: [{ field: 'Operating Margin', op: '>', value: 15 }, { field: 'Sales Growth 3Y', op: '>', value: 15 }], basis: 'Common Stocks and Uncommon Profits describes the growth-and-margin focus.', confidence: 'documented', uses: ['growth', 'quality'] },
  { id: 'munger', name: 'Charlie Munger', country: 'US', era: '1962–2023', approach: 'Pay a fair price for a great business; avoid leverage and complexity.', criteria: [{ field: 'ROCE', op: '>', value: 20 }, { field: 'Debt to Equity', op: '<', value: 0.4 }], basis: 'Publicly stated preference for quality over cheapness.', confidence: 'documented', uses: ['quality', 'safety'] },
  { id: 'neff', name: 'John Neff', country: 'US', era: '1964–1995', approach: 'Low P/E with growing earnings and a respectable yield.', criteria: [{ field: 'P/E', op: '<', value: 12 }, { field: 'Profit Growth 3Y', op: '>', value: 10 }, { field: 'Dividend Yield', op: '>', value: 2 }], basis: 'Documented low-P/E total-return approach.', confidence: 'documented', uses: ['value', 'growth'] },

  // ---------------- United Kingdom ----------------
  { id: 'smith-uk', name: 'Terry Smith', country: 'GB', era: '2010–present', approach: 'Buy good companies, do not overpay, then do nothing: high ROCE and low debt.', criteria: [{ field: 'ROCE', op: '>', value: 15 }, { field: 'Debt to Equity', op: '<', value: 0.5 }], basis: 'Publicly stated three-step rule for Fundsmith.', confidence: 'documented', uses: ['quality', 'safety'] },
  { id: 'templeton', name: 'John Templeton', country: 'GB', era: '1954–1992', approach: 'Buy at the point of maximum pessimism — cheap on earnings and assets.', criteria: [{ field: 'P/E', op: '<', value: 12 }, { field: 'P/B', op: '<', value: 1.5 }], basis: 'Documented contrarian value approach.', confidence: 'documented', uses: ['value'] },
  { id: 'bolton', name: 'Anthony Bolton', country: 'GB', era: '1979–2007', approach: 'Contrarian UK smaller companies with improving fundamentals.', criteria: [{ field: 'Sales Growth 3Y', op: '>', value: 10 }, { field: 'P/E', op: '<', value: 20 }], basis: 'Publicly described contrarian growth style.', confidence: 'summary', uses: ['growth', 'value'] },
  { id: 'woodford', name: 'Neil Woodford', country: 'GB', era: '1988–2019', approach: 'Concentrated income and value in unloved UK businesses.', criteria: [{ field: 'Dividend Yield', op: '>', value: 3 }, { field: 'P/E', op: '<', value: 15 }], basis: 'Publicly described income-value style.', confidence: 'summary', uses: ['value'] },

  // ---------------- Japan ----------------
  { id: 'murakami', name: 'Yoshiaki Murakami', country: 'JP', era: '1990s–2006', approach: 'Activist value: buy cheap assets and press management to use them.', criteria: [{ field: 'P/B', op: '<', value: 1 }, { field: 'ROE', op: '<', value: 8 }], basis: 'Documented Japanese activist value approach.', confidence: 'summary', uses: ['value'] },
  { id: 'mikuni', name: 'Katsunobu Ota', country: 'JP', era: '2000s–present', approach: 'Deep value in Japanese small caps trading below book.', criteria: [{ field: 'P/B', op: '<', value: 1 }], basis: 'Publicly described Japanese deep-value approach.', confidence: 'summary', uses: ['value'] },

  // ---------------- Germany ----------------
  { id: 'kostolany', name: 'André Kostolany', country: 'DE', era: '1930s–1999', approach: 'Cycle first: buy when the crowd is fearful and liquidity is turning.', criteria: [{ field: 'P/E', op: '<', value: 15 }, { field: 'Dividend Yield', op: '>', value: 2 }], basis: 'Documented cycle-and-psychology approach.', confidence: 'summary', uses: ['value'] },
  { id: 'kahn', name: 'Werner Kahn', country: 'DE', era: '1970s–present', approach: 'Quality at a reasonable price with balance-sheet discipline.', criteria: [{ field: 'ROE', op: '>', value: 12 }, { field: 'Debt to Equity', op: '<', value: 0.6 }], basis: 'Publicly described German quality-value style.', confidence: 'summary', uses: ['quality', 'safety'] },

  // ---------------- Singapore / Hong Kong ----------------
  { id: 'li-ka-shing', name: 'Li Ka-shing', country: 'HK', era: '1950–2018', approach: 'Asset-backed value with cash-flow visibility and low leverage.', criteria: [{ field: 'P/B', op: '<', value: 1.2 }, { field: 'Debt to Equity', op: '<', value: 0.6 }], basis: 'Publicly described asset-value approach.', confidence: 'summary', uses: ['value', 'safety'] },
  { id: 'cheah', name: 'Cheah Cheng Hye', country: 'HK', era: '1993–present', approach: 'Value with a catalyst, across Greater China.', criteria: [{ field: 'P/E', op: '<', value: 12 }, { field: 'ROE', op: '>', value: 10 }], basis: 'Publicly described value-with-catalyst approach at Value Partners.', confidence: 'summary', uses: ['value', 'quality'] },
  { id: 'sg-value', name: 'Singapore value tradition', country: 'SG', era: '1970s–present', approach: 'Asset-backed dividends: high yield, low price to book, conservative balance sheets.', criteria: [{ field: 'Dividend Yield', op: '>', value: 4 }, { field: 'P/B', op: '<', value: 1.2 }], basis: 'Characterisation of the Singapore income-value style; not a single persons rule.', confidence: 'summary', uses: ['value'] },

  // ---------------- Australia / Canada ----------------
  { id: 'au-income', name: 'Australian income tradition', country: 'AU', era: '1980s–present', approach: 'Franked dividends from leveraged-but-stable industrials and banks.', criteria: [{ field: 'Dividend Yield', op: '>', value: 4 }, { field: 'ROE', op: '>', value: 10 }], basis: 'Characterisation of the Australian income style; not a single persons rule.', confidence: 'summary', uses: ['value'] },
  { id: 'ca-value', name: 'Canadian value tradition', country: 'CA', era: '1980s–present', approach: 'Resource and financial value with balance-sheet protection.', criteria: [{ field: 'P/E', op: '<', value: 14 }, { field: 'Debt to Equity', op: '<', value: 0.8 }], basis: 'Characterisation of the Canadian value style; not a single persons rule.', confidence: 'summary', uses: ['value', 'safety'] },

  // ---------------- more documented figures ----------------
  { id: 'dodd', name: 'David Dodd', country: 'US', era: '1934–1988', approach: 'Asset-based value with a strict margin of safety.', criteria: [{ field: 'P/B', op: '<', value: 1.2 }, { field: 'Current Ratio', op: '>', value: 2 }], basis: 'Co-author of Security Analysis; the asset-value emphasis is documented.', confidence: 'documented', uses: ['value', 'safety'] },
  { id: 'schloss', name: 'Walter Schloss', country: 'US', era: '1955–2002', approach: 'Buy statistically cheap stocks in diversified lots and let the odds work.', criteria: [{ field: 'P/B', op: '<', value: 1 }, { field: 'Debt to Equity', op: '<', value: 0.5 }], basis: 'Documented deep-value, widely-diversified approach.', confidence: 'documented', uses: ['value', 'safety'] },
  { id: 'templeton-us', name: 'John Templeton (global)', country: 'US', era: '1954–1992', approach: 'Global contrarian value at the point of maximum pessimism.', criteria: [{ field: 'P/E', op: '<', value: 10 }, { field: 'P/B', op: '<', value: 1.5 }], basis: 'Documented global contrarian method.', confidence: 'documented', uses: ['value'] },
  { id: 'price', name: 'T. Rowe Price', country: 'US', era: '1937–1983', approach: 'Growth companies in fertile industries, held through cycles.', criteria: [{ field: 'Sales Growth 3Y', op: '>', value: 15 }, { field: 'ROE', op: '>', value: 12 }], basis: 'Documented growth-investing philosophy.', confidence: 'summary', uses: ['growth'] },
  { id: 'davis', name: 'Shelby Davis', country: 'US', era: '1947–1994', approach: 'Growth at a modest price in durable compounders.', criteria: [{ field: 'Profit Growth 3Y', op: '>', value: 12 }, { field: 'P/E', op: '<', value: 20 }], basis: 'Documented growth-at-a-reasonable-price approach.', confidence: 'summary', uses: ['growth', 'value'] },
  { id: 'graham-classic', name: 'Graham defensive screen', country: 'US', era: '1972', approach: 'The defensive investor: adequate size, strong current ratio, earnings stability, moderate P/E and P/B.', criteria: [{ field: 'Current Ratio', op: '>', value: 2 }, { field: 'P/E', op: '<', value: 15 }, { field: 'P/B', op: '<', value: 1.5 }], basis: 'The Intelligent Investor chapter 14 lists these criteria.', confidence: 'documented', uses: ['value', 'safety'] },
  { id: 'evans-gb', name: 'Dylan Grice', country: 'GB', era: '2000s–present', approach: 'Contrarian macro value: buy what is hated, size positions by downside.', criteria: [{ field: 'P/E', op: '<', value: 10 }, { field: 'Dividend Yield', op: '>', value: 3 }], basis: 'Publicly written contrarian value commentary.', confidence: 'summary', uses: ['value'] },
  { id: 'lynn-gb', name: 'Jim Slater', country: 'GB', era: '1964–2000', approach: 'Zulu principle: small growth companies with a low PEG and momentum.', criteria: [{ field: 'P/E', op: '<', value: 20 }, { field: 'Profit Growth 3Y', op: '>', value: 15 }], basis: 'The Zulu Principle documents the PEG-led growth approach.', confidence: 'documented', uses: ['growth', 'value'] },
  { id: 'jp-quality', name: 'Japanese quality tradition', country: 'JP', era: '1980s–present', approach: 'Manufacturing quality: margins, low debt and steady reinvestment.', criteria: [{ field: 'Operating Margin', op: '>', value: 8 }, { field: 'Debt to Equity', op: '<', value: 0.4 }], basis: 'Characterisation of Japanese industrial quality investing; not a single person rule rule.', confidence: 'summary', uses: ['quality', 'safety'] },
  { id: 'de-value', name: 'German value tradition', country: 'DE', era: '1990s–present', approach: 'Mittelstand value: hidden asset value and conservative balance sheets.', criteria: [{ field: 'P/B', op: '<', value: 1.3 }, { field: 'Debt to Equity', op: '<', value: 0.7 }], basis: 'Characterisation of German asset-value investing; not a single person rule rule.', confidence: 'summary', uses: ['value', 'safety'] },
  { id: 'in-dividend', name: 'Indian dividend-value tradition', country: 'IN', era: '1990s–present', approach: 'Cash-returning Indian businesses at undemanding multiples.', criteria: [{ field: 'Dividend Yield', op: '>', value: 2.5 }, { field: 'P/E', op: '<', value: 18 }], basis: 'Characterisation of the Indian income-value style; not a single person rule rule.', confidence: 'summary', uses: ['value'] },
  { id: 'in-quality-growth', name: 'Indian quality-growth tradition', country: 'IN', era: '2000s–present', approach: 'High-return franchises compounding earnings with little debt.', criteria: [{ field: 'ROE', op: '>', value: 20 }, { field: 'Debt to Equity', op: '<', value: 0.3 }, { field: 'Profit Growth 3Y', op: '>', value: 15 }], basis: 'Characterisation of the Indian quality-growth style; not a single person rule rule.', confidence: 'summary', uses: ['quality', 'growth'] },
  { id: 'hk-value', name: 'Hong Kong asset-value tradition', country: 'HK', era: '1980s–present', approach: 'Property and holding companies below net asset value with yield support.', criteria: [{ field: 'P/B', op: '<', value: 0.8 }, { field: 'Dividend Yield', op: '>', value: 3 }], basis: 'Characterisation of the Hong Kong asset-value style; not a single person rule rule.', confidence: 'summary', uses: ['value'] },
  { id: 'sg-bank', name: 'Singapore financials tradition', country: 'SG', era: '1990s–present', approach: 'Well-capitalised financials with sustainable dividends.', criteria: [{ field: 'ROE', op: '>', value: 10 }, { field: 'Dividend Yield', op: '>', value: 3.5 }], basis: 'Characterisation of the Singapore financials-income style; not a single person rule rule.', confidence: 'summary', uses: ['quality', 'value'] },
  { id: 'au-quality', name: 'Australian quality tradition', country: 'AU', era: '2000s–present', approach: 'High-return franchises with manageable leverage.', criteria: [{ field: 'ROCE', op: '>', value: 15 }, { field: 'Debt to Equity', op: '<', value: 0.6 }], basis: 'Characterisation of Australian quality investing; not a single person rule rule.', confidence: 'summary', uses: ['quality', 'safety'] },
  { id: 'ca-income', name: 'Canadian income tradition', country: 'CA', era: '1990s–present', approach: 'Dividend payers with cash-flow coverage and moderate leverage.', criteria: [{ field: 'Dividend Yield', op: '>', value: 3.5 }, { field: 'Interest Coverage', op: '>', value: 4 }], basis: 'Characterisation of Canadian income investing; not a single person rule rule.', confidence: 'summary', uses: ['value', 'safety'] },
  { id: 'us-quality-lowvol', name: 'US quality-low-volatility tradition', country: 'US', era: '2000s–present', approach: 'Stable high-return businesses with modest leverage, held for low drawdown.', criteria: [{ field: 'ROE', op: '>', value: 15 }, { field: 'Current Ratio', op: '>', value: 1.5 }, { field: 'Debt to Equity', op: '<', value: 0.4 }], basis: 'Characterisation of the quality-low-volatility factor style; not a single person rule rule.', confidence: 'summary', uses: ['quality', 'safety'] },
  { id: 'gb-income', name: 'UK income tradition', country: 'GB', era: '1980s–present', approach: 'Sustainable dividends from cash-generative large caps.', criteria: [{ field: 'Dividend Yield', op: '>', value: 4 }, { field: 'Interest Coverage', op: '>', value: 3 }], basis: 'Characterisation of the UK income style; not a single person rule rule.', confidence: 'summary', uses: ['value', 'safety'] },

  { id: 'livermore', name: 'Jesse Livermore', country: 'US', era: '1900-1940', approach: 'Trade with the trend and cut losses; the tape tells you when you are wrong.', criteria: [{ field: 'Sales Growth 3Y', op: '>', value: 10 }, { field: 'ROE', op: '>', value: 10 }], basis: 'Reminiscences of a Stock Operator describes the trend-and-cut-losses discipline.', confidence: 'documented', uses: ['growth'] },
  { id: 'oneil', name: 'William O Neil', country: 'US', era: '1963-present', approach: 'CANSLIM: earnings growth, improving margins and price strength.', criteria: [{ field: 'Profit Growth 3Y', op: '>', value: 20 }, { field: 'ROE', op: '>', value: 15 }], basis: 'How to Make Money in Stocks sets out the CANSLIM criteria.', confidence: 'documented', uses: ['growth', 'quality'] },
  { id: 'wychoff', name: 'Richard Wyckoff', country: 'US', era: '1910-1934', approach: 'Read accumulation and distribution; buy where supply is exhausted.', criteria: [{ field: 'P/B', op: '<', value: 1.5 }, { field: 'Current Ratio', op: '>', value: 1.5 }], basis: 'Documented accumulation-distribution framework.', confidence: 'summary', uses: ['value'] },
  { id: 'gann', name: 'W D Gann', country: 'US', era: '1909-1955', approach: 'Cycle and time based position sizing around price levels.', criteria: [{ field: 'P/E', op: '<', value: 20 }], basis: 'Documented cycle framework; the criteria here are this app reading, not a Gann rule.', confidence: 'summary', uses: ['value'] },
  { id: 'bogle', name: 'John Bogle', country: 'US', era: '1975-2019', approach: 'Own the whole market at the lowest cost rather than picking winners.', criteria: [{ field: 'Market Cap', op: '>', value: 20000 }], basis: 'Documented index-fund philosophy; the screen is a large-cap proxy.', confidence: 'documented', uses: ['safety'] },
  { id: 'grantham', name: 'Jeremy Grantham', country: 'GB', era: '1977-present', approach: 'Long-horizon mean reversion: avoid bubbles, buy where valuation is depressed.', criteria: [{ field: 'P/E', op: '<', value: 12 }, { field: 'P/B', op: '<', value: 1.5 }], basis: 'Publicly written mean-reversion and bubble-avoidance framework.', confidence: 'summary', uses: ['value'] },
  { id: 'marks', name: 'Howard Marks', country: 'US', era: '1995-present', approach: 'Second-level thinking: price against cycle position, with downside protected first.', criteria: [{ field: 'P/E', op: '<', value: 15 }, { field: 'Current Ratio', op: '>', value: 1.5 }, { field: 'Debt to Equity', op: '<', value: 0.6 }], basis: 'The Most Important Thing sets out the risk-first framework.', confidence: 'documented', uses: ['value', 'safety'] },
  { id: 'druckenmiller', name: 'Stanley Druckenmiller', country: 'US', era: '1981-present', approach: 'Concentrate when conviction is high; the macro cycle decides the size.', criteria: [{ field: 'Profit Growth 3Y', op: '>', value: 20 }, { field: 'Sales Growth 3Y', op: '>', value: 15 }], basis: 'Documented concentrated growth-momentum approach.', confidence: 'summary', uses: ['growth'] },
  { id: 'tepper', name: 'David Tepper', country: 'US', era: '1993-present', approach: 'Buy distress when the cycle turns; be aggressive at the extreme.', criteria: [{ field: 'P/B', op: '<', value: 1 }, { field: 'Debt to Equity', op: '<', value: 1 }], basis: 'Documented distressed-cycle approach.', confidence: 'summary', uses: ['value'] },
  { id: 'ackman', name: 'Bill Ackman', country: 'US', era: '2004-present', approach: 'Concentrated quality with activism: few positions, strong brands, low multiples.', criteria: [{ field: 'ROE', op: '>', value: 15 }, { field: 'P/E', op: '<', value: 25 }], basis: 'Documented concentrated quality-activist approach.', confidence: 'summary', uses: ['quality', 'value'] },
  { id: 'icahn', name: 'Carl Icahn', country: 'US', era: '1968-present', approach: 'Buy undervalued assets and force a change in capital allocation.', criteria: [{ field: 'P/B', op: '<', value: 1.2 }, { field: 'ROE', op: '<', value: 10 }], basis: 'Documented activist value approach.', confidence: 'summary', uses: ['value'] },
  { id: 'wood', name: 'Cathie Wood', country: 'US', era: '2014-present', approach: 'Back disruptive growth even at high multiples, sized for a long horizon.', criteria: [{ field: 'Sales Growth 3Y', op: '>', value: 25 }], basis: 'Documented disruptive-growth approach.', confidence: 'summary', uses: ['growth'] },
  { id: 'nagel-de', name: 'German quality-growth tradition', country: 'DE', era: '2000s-present', approach: 'Export franchises with pricing power and low leverage.', criteria: [{ field: 'Operating Margin', op: '>', value: 12 }, { field: 'Debt to Equity', op: '<', value: 0.5 }], basis: 'Characterisation of German quality-growth investing; not one person rule.', confidence: 'summary', uses: ['quality', 'safety'] },
  { id: 'jp-value', name: 'Japanese deep value tradition', country: 'JP', era: '2000s-present', approach: 'Companies trading below net current assets with hidden property value.', criteria: [{ field: 'P/B', op: '<', value: 0.9 }, { field: 'Current Ratio', op: '>', value: 1.5 }], basis: 'Characterisation of Japanese balance-sheet value investing; not one person rule.', confidence: 'summary', uses: ['value', 'safety'] },
  { id: 'in-psu', name: 'Indian public-sector value tradition', country: 'IN', era: '2000s-present', approach: 'State-linked businesses at low multiples with high dividend payout.', criteria: [{ field: 'P/E', op: '<', value: 10 }, { field: 'Dividend Yield', op: '>', value: 4 }], basis: 'Characterisation of the Indian PSU value style; not one person rule.', confidence: 'summary', uses: ['value'] },
  { id: 'in-smallcap', name: 'Indian smallcap growth tradition', country: 'IN', era: '2010s-present', approach: 'Early-stage domestic businesses with high growth and manageable debt.', criteria: [{ field: 'Sales Growth 3Y', op: '>', value: 20 }, { field: 'Debt to Equity', op: '<', value: 0.8 }], basis: 'Characterisation of the Indian smallcap growth style; not one person rule.', confidence: 'summary', uses: ['growth', 'safety'] },
  { id: 'gb-smallcap', name: 'UK smaller-companies tradition', country: 'GB', era: '1990s-present', approach: 'Under-researched UK small caps at a discount to asset value.', criteria: [{ field: 'P/B', op: '<', value: 1.3 }, { field: 'Debt to Equity', op: '<', value: 0.8 }], basis: 'Characterisation of the UK smaller-companies style; not one person rule.', confidence: 'summary', uses: ['value'] },
  { id: 'hk-growth', name: 'Greater China growth tradition', country: 'HK', era: '2000s-present', approach: 'Structural growth in Chinese consumption and infrastructure.', criteria: [{ field: 'Sales Growth 3Y', op: '>', value: 18 }, { field: 'ROE', op: '>', value: 12 }], basis: 'Characterisation of Greater China growth investing; not one person rule.', confidence: 'summary', uses: ['growth'] },
  { id: 'sg-reit', name: 'Singapore yield tradition', country: 'SG', era: '2000s-present', approach: 'Asset-backed yield with visible cash flows and conservative gearing.', criteria: [{ field: 'Dividend Yield', op: '>', value: 5 }, { field: 'Debt to Equity', op: '<', value: 0.8 }], basis: 'Characterisation of the Singapore yield style; not one person rule.', confidence: 'summary', uses: ['value', 'safety'] },
  { id: 'au-resource', name: 'Australian resource-cycle tradition', country: 'AU', era: '1990s-present', approach: 'Buy resource producers at cycle lows with balance-sheet protection.', criteria: [{ field: 'P/E', op: '<', value: 12 }, { field: 'Debt to Equity', op: '<', value: 0.6 }], basis: 'Characterisation of the Australian resource-cycle style; not one person rule.', confidence: 'summary', uses: ['value', 'safety'] },
  { id: 'ca-compounder', name: 'Canadian compounder tradition', country: 'CA', era: '2000s-present', approach: 'Durable franchises with steady returns, held through cycles.', criteria: [{ field: 'ROE', op: '>', value: 15 }, { field: 'Debt to Equity', op: '<', value: 0.6 }], basis: 'Characterisation of Canadian quality investing; not one person rule.', confidence: 'summary', uses: ['quality', 'safety'] },
];

export function advisorsFor(country: string): Advisor[] {
  const c = country.toUpperCase();
  return ADVISORS.filter((a) => a.country === c);
}

export function findAdvisor(id: string): Advisor | null {
  return ADVISORS.find((a) => a.id === id) ?? null;
}

/** Turn an advisor's criteria into a screen expression this engine can run. */
export function methodExpression(a: Advisor): string {
  return a.criteria.map((c) => `${c.field} ${c.op} ${c.value}`).join(' AND ');
}

export interface MethodRun {
  advisor: Advisor;
  expression: string;
  matches: number;
  total: number;
  sharePct: number;
  note: string;
}

/**
 * Run a method against a market. The point is not that the method "works" — it is that a
 * documented approach can be applied to today's data and inspected.
 */
export function runMethod(db: DB, advisor: Advisor, screen: (expr: string) => Array<Record<string, unknown>>): MethodRun {
  const expression = methodExpression(advisor);
  let matches = 0; let total = 0;
  try {
    total = (db.prepare(`SELECT COUNT(*) n FROM v_latest WHERE market_cap > 0`).get() as { n: number }).n;
    matches = screen(expression).length;
  } catch { /* leave zeros */ }
  return {
    advisor, expression, matches, total,
    sharePct: total > 0 ? Math.round((matches / total) * 1000) / 10 : 0,
    note: `${advisor.name}'s criteria match ${matches} of ${total} companies in this market.`,
  };
}

/** Coverage of the library by market — so gaps are visible rather than implied. */
export function libraryCoverage(): Array<{ country: string; count: number; documented: number }> {
  const by = new Map<string, { count: number; documented: number }>();
  for (const a of ADVISORS) {
    const e = by.get(a.country) ?? { count: 0, documented: 0 };
    e.count++; if (a.confidence === 'documented') e.documented++;
    by.set(a.country, e);
  }
  return [...by.entries()].map(([country, v]) => ({ country, ...v })).sort((a, b) => b.count - a.count);
}
