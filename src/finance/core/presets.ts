// Curated screens. Each is a plain expression, so it runs through the same safe
// compiler as a user's query — presets are not a privileged code path.

export interface Preset {
  id: string;
  name: string;
  description: string;
  expression: string;
  /** What the screen is trying to capture. */
  idea: string;
}

export const PRESETS: Preset[] = [
  {
    id: 'quality-compounder',
    name: 'Quality compounder',
    description: 'High returns on capital, low debt, growing.',
    expression: 'ROE > 18 AND ROCE > 18 AND Debt to Equity < 0.5 AND Sales Growth 3Y > 10',
    idea: 'Businesses that earn well on capital and are not levered.',
  },
  {
    id: 'graham-value',
    name: 'Graham value',
    description: 'Cheap on earnings and book, with a margin of safety.',
    expression: 'P/E < 15 AND P/B < 1.5 AND Debt to Equity < 1 AND Current Ratio > 1.5',
    idea: 'Deep value with a balance-sheet cushion.',
  },
  {
    id: 'magic-formula',
    name: 'Magic formula (proxy)',
    description: 'Good returns on capital at a cheap price.',
    expression: 'ROCE > 15 AND P/E < 20 AND Market Cap > 500',
    idea: 'Greenblatt-style: quality plus cheapness, using ROCE and P/E.',
  },
  {
    id: 'coffee-can',
    name: 'Coffee-can candidate',
    description: 'Long-run compounders with clean balance sheets.',
    expression: 'ROE > 15 AND Sales Growth 3Y > 12 AND Profit Growth 3Y > 12 AND Debt to Equity < 0.3',
    idea: 'Ten-year ownership candidates: growth without leverage.',
  },
  {
    id: 'dividend-durable',
    name: 'Durable dividend',
    description: 'Pays a real yield and covers it.',
    expression: 'Dividend Yield > 2 AND ROE > 12 AND Debt to Equity < 1',
    idea: 'Income where the payout is supported by returns.',
  },
  {
    id: 'debt-free',
    name: 'Debt-free compounders',
    description: 'No leverage at all.',
    expression: 'Debt to Equity < 0.1 AND ROE > 15 AND Sales Growth 3Y > 8',
    idea: 'Zero-debt businesses that still compound.',
  },
  {
    id: 'garp',
    name: 'Growth at a reasonable price',
    description: 'Growth with a P/E that does not price it all in.',
    expression: 'Sales Growth 3Y > 15 AND Profit Growth 3Y > 15 AND P/E < 25',
    idea: 'GARP: earnings growth faster than the multiple.',
  },
  {
    id: 'turnaround-watch',
    name: 'Turnaround watch',
    description: 'Cheap, improving, but still risky — a watchlist, not a buy list.',
    expression: 'P/E < 12 AND Sales Growth 3Y > 10 AND Debt to Equity < 2',
    idea: 'Cheap names with top-line momentum; pair with the red-flag panel.',
  },
  {
    id: 'promoter-conviction',
    name: 'Promoter conviction',
    description: 'Owners with real skin in the game and no pledge.',
    expression: 'Promoter Holding > 50 AND Pledged < 1 AND ROE > 12',
    idea: 'Alignment between management and minority shareholders.',
  },
  {
    id: 'high-margin',
    name: 'High-margin businesses',
    description: 'Structurally profitable operations.',
    expression: 'OPM > 20 AND NPM > 10 AND Debt to Equity < 1',
    idea: 'Pricing power visible in the margin line.',
  },
];

export function presetById(id: string): Preset | null { return PRESETS.find((p) => p.id === id) ?? null; }
