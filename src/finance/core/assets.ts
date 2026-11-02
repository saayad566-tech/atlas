// The four asset classes Atlas understands, and what each can actually do.
//
// A capability map rather than a type switch scattered through the codebase: a panel
// asks "does this class have fundamentals?" and gets an answer, so a stock-only panel
// can never be shown for crypto.

export type AssetClass = 'stock' | 'etf' | 'forex' | 'crypto';

export interface AssetDef {
  id: AssetClass;
  name: string;
  plural: string;
  /** Which analyses apply. A panel is shown only when its flag is true. */
  capabilities: {
    fundamentals: boolean;
    valuation: boolean;
    scores: boolean;
    peers: boolean;
    briefing: boolean;
    holdings: boolean;
    cost: boolean;
    tracking: boolean;
    carry: boolean;
    supply: boolean;
    liquidity: boolean;
  };
  /** 24/7 markets ignore session hours entirely. */
  continuous: boolean;
  /** Volatility is judged on a different scale per class. */
  volatilityBand: { calm: number; normal: number; wild: number };
  note: string;
}

export const ASSETS: AssetDef[] = [
  {
    id: 'stock', name: 'Stock', plural: 'Stocks',
    capabilities: { fundamentals: true, valuation: true, scores: true, peers: true, briefing: true,
      holdings: false, cost: false, tracking: false, carry: false, supply: false, liquidity: false },
    continuous: false,
    volatilityBand: { calm: 20, normal: 35, wild: 60 },
    note: 'A share of a business. Fundamentals, valuation and peer comparison apply.',
  },
  {
    id: 'etf', name: 'ETF', plural: 'ETFs',
    capabilities: { fundamentals: false, valuation: false, scores: false, peers: false, briefing: true,
      holdings: true, cost: true, tracking: true, carry: false, supply: false, liquidity: true },
    continuous: false,
    volatilityBand: { calm: 12, normal: 22, wild: 40 },
    note: 'A basket. Cost, holdings and tracking matter more than any single ratio.',
  },
  {
    id: 'forex', name: 'Forex', plural: 'Forex',
    capabilities: { fundamentals: false, valuation: false, scores: false, peers: false, briefing: true,
      holdings: false, cost: false, tracking: false, carry: true, supply: false, liquidity: true },
    continuous: false,
    volatilityBand: { calm: 6, normal: 10, wild: 18 },
    note: 'A currency pair. Rate, carry and session overlap are the analysis.',
  },
  {
    id: 'crypto', name: 'Crypto', plural: 'Crypto',
    capabilities: { fundamentals: false, valuation: false, scores: false, peers: false, briefing: true,
      holdings: false, cost: false, tracking: false, carry: false, supply: true, liquidity: true },
    continuous: true,
    volatilityBand: { calm: 45, normal: 80, wild: 140 },
    note: 'A digital asset trading around the clock. Supply and liquidity replace fundamentals.',
  },
];

export function assetDef(id: AssetClass): AssetDef {
  return ASSETS.find((a) => a.id === id) ?? ASSETS[0]!;
}

export function isAssetClass(v: string): v is AssetClass {
  return ASSETS.some((a) => a.id === v);
}

/** Does this class support the named analysis? Unknown capabilities are false, never true. */
export function supports(id: AssetClass, cap: keyof AssetDef['capabilities']): boolean {
  return assetDef(id).capabilities[cap] === true;
}

/** Judge volatility against the class's own scale, not a global one. */
export function volatilityVerdict(id: AssetClass, annualVolPct: number | null): 'unknown' | 'calm' | 'normal' | 'wild' {
  if (annualVolPct === null || !Number.isFinite(annualVolPct)) return 'unknown';
  const b = assetDef(id).volatilityBand;
  if (annualVolPct < b.calm) return 'calm';
  if (annualVolPct < b.normal) return 'normal';
  return 'wild';
}
