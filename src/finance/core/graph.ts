// Company graph and storylines.
//
// Two views AnalyzerX offered, rebuilt from what Atlas actually stores: a map of how a
// business is put together, and the threads running through its disclosures over time.
import type { Database as DB } from 'better-sqlite3';

const r1 = (v: number): number => Math.round(v * 10) / 10;
const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export interface GraphNode { id: string; label: string; kind: string; weight: number | null; note: string }
export interface GraphEdge { from: string; to: string; label: string }
export interface CompanyGraph {
  symbol: string; center: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  summary: { segments: number; geographies: number; subsidiaries: number; products: number; risks: number };
  note: string;
}

/** How the business is put together: revenue mix, geography, ownership and exposure. */
export function companyGraph(db: DB, symbol: string): CompanyGraph | null {
  const c = db.prepare(`SELECT id, symbol, name, sector FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number; symbol: string; name: string; sector: string } | undefined;
  if (!c) return null;

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const center = `co:${c.symbol}`;
  nodes.push({ id: center, label: c.name, kind: 'company', weight: null, note: c.sector });

  const counts = { segments: 0, geographies: 0, subsidiaries: 0, products: 0, risks: 0 };

  const read = <T>(sql: string, fn: (row: T, i: number) => void): void => {
    try { (db.prepare(sql).all(c.id) as T[]).forEach(fn); } catch { /* table absent */ }
  };

  read<{ name: string; revenue_pct: number; margin_pct: number; growth_pct: number }>(
    `SELECT name, revenue_pct, margin_pct, growth_pct FROM segments WHERE company_id=?`,
    (s, i) => {
      const id = `seg:${i}`; counts.segments++;
      nodes.push({ id, label: s.name, kind: 'segment', weight: r1(n(s.revenue_pct)), note: `${r1(n(s.revenue_pct))}% of revenue · ${r1(n(s.margin_pct))}% margin` });
      edges.push({ from: center, to: id, label: 'revenue' });
    });

  read<{ region: string; revenue_pct: number }>(
    `SELECT region, revenue_pct FROM geographies WHERE company_id=?`,
    (g, i) => {
      const id = `geo:${i}`; counts.geographies++;
      nodes.push({ id, label: g.region, kind: 'geography', weight: r1(n(g.revenue_pct)), note: `${r1(n(g.revenue_pct))}% of revenue` });
      edges.push({ from: center, to: id, label: 'exposure' });
    });

  read<{ name: string; stake_pct: number; country: string | null }>(
    `SELECT name, stake_pct, country FROM subsidiaries WHERE company_id=?`,
    (s, i) => {
      const id = `sub:${i}`; counts.subsidiaries++;
      nodes.push({ id, label: s.name, kind: 'subsidiary', weight: r1(n(s.stake_pct)), note: `${r1(n(s.stake_pct))}% owned${s.country ? ` · ${s.country}` : ''}` });
      edges.push({ from: center, to: id, label: 'owns' });
    });

  read<{ name: string; category: string | null }>(
    `SELECT name, category FROM products WHERE company_id=?`,
    (p, i) => {
      const id = `prod:${i}`; counts.products++;
      nodes.push({ id, label: p.name, kind: 'product', weight: null, note: p.category ?? 'product' });
      edges.push({ from: center, to: id, label: 'offers' });
    });

  read<{ code: string; severity: string; description: string | null }>(
    `SELECT code, severity, description FROM risks WHERE company_id=?`,
    (r, i) => {
      const id = `risk:${i}`; counts.risks++;
      nodes.push({ id, label: r.code.replace(/-/g, ' '), kind: 'risk', weight: r.severity === 'high' ? 3 : r.severity === 'medium' ? 2 : 1, note: r.description ?? r.severity });
      edges.push({ from: center, to: id, label: 'exposed to' });
    });

  // Sector siblings give the map a competitive frame.
  try {
    const siblings = db.prepare(`SELECT symbol FROM companies WHERE sector=? AND id<>? LIMIT 6`).all(c.sector, c.id) as Array<{ symbol: string }>;
    siblings.forEach((s, i) => {
      const id = `peer:${i}`;
      nodes.push({ id, label: s.symbol, kind: 'peer', weight: null, note: c.sector });
      edges.push({ from: center, to: id, label: 'competes with' });
    });
  } catch { /* ignore */ }

  return {
    symbol: c.symbol, center, nodes, edges, summary: counts,
    note: 'Built from stored segments, geographies, subsidiaries, products and risks. Sector siblings are the same-sector companies in this market.',
  };
}

export interface Storyline {
  theme: string;
  events: Array<{ date: string; title: string; detail: string }>;
  span: string;
  count: number;
  direction: 'intensifying' | 'quietening' | 'steady';
  note: string;
}

const THEMES: Array<{ name: string; match: RegExp; note: string }> = [
  { name: 'Capacity and capex', match: /capacity|expansion|capex|plant|facility|commission/i, note: 'Spending to grow the asset base.' },
  { name: 'Capital returns', match: /dividend|buyback|bonus|rights|split/i, note: 'Cash or shares returned to owners.' },
  { name: 'Ownership and control', match: /stake|pledge|promoter|open offer|acquisition|merger|demerger/i, note: 'Who owns the business and how that is changing.' },
  { name: 'Leadership', match: /appoint|resign|ceo|cfo|board|director/i, note: 'Changes in who runs it.' },
  { name: 'Results and guidance', match: /result|earnings|guidance|outlook|profit|revenue/i, note: 'What it reported and what it expects.' },
  { name: 'Risk and compliance', match: /default|downgrade|penalty|auditor|notice|investigation|fraud/i, note: 'Things that can damage the business.' },
  { name: 'Orders and contracts', match: /order|contract|win|award|tender|agreement|partnership/i, note: 'Demand for what it sells.' },
];

/** Group a company's disclosures into themes, and say which are intensifying. */
export function storylines(db: DB, symbol: string): { symbol: string; lines: Storyline[]; unthemed: number; note: string } | null {
  const c = db.prepare(`SELECT id, symbol FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { id: number; symbol: string } | undefined;
  if (!c) return null;
  let rows: Array<{ date: string; title: string; summary: string | null }> = [];
  try {
    rows = db.prepare(`SELECT date, title, summary FROM announcements WHERE company_id=? ORDER BY date ASC`).all(c.id) as typeof rows;
  } catch { /* table absent */ }

  const buckets = new Map<string, Array<{ date: string; title: string; detail: string }>>();
  let unthemed = 0;
  for (const r of rows) {
    const text = `${r.title} ${r.summary ?? ''}`;
    const hit = THEMES.find((t) => t.match.test(text));
    if (!hit) { unthemed++; continue; }
    const arr = buckets.get(hit.name) ?? [];
    arr.push({ date: r.date, title: r.title, detail: r.summary ?? '' });
    buckets.set(hit.name, arr);
  }

  const midpoint = rows.length ? rows[Math.floor(rows.length / 2)]!.date : '';
  const lines: Storyline[] = [...buckets.entries()].map(([theme, events]) => {
    const recent = events.filter((e) => e.date >= midpoint).length;
    const older = events.length - recent;
    const direction: Storyline['direction'] = events.length < 2 ? 'steady' : recent > older ? 'intensifying' : recent < older ? 'quietening' : 'steady';
    const note = THEMES.find((t) => t.name === theme)?.note ?? '';
    return {
      theme, events: events.slice().reverse(),
      span: events.length > 1 ? `${events[0]!.date} → ${events[events.length - 1]!.date}` : events[0]!.date,
      count: events.length, direction,
      note: `${note} ${direction === 'intensifying' ? 'Mentioned more in the recent half of the record.' : direction === 'quietening' ? 'Mentioned less recently.' : ''}`.trim(),
    };
  }).sort((a, b) => b.count - a.count);

  return {
    symbol: c.symbol, lines, unthemed,
    note: 'Themes are matched from announcement text, not assigned by an analyst. A theme appearing more often recently is flagged intensifying.',
  };
}
