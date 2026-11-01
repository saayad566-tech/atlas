import { describe, it, expect } from 'vitest';
import { parseQuery, parseQueryWithLlm, buildLlmPrompt } from '../src/finance/core/nl';
import { compileExpression } from '../src/finance/core/expr';

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

describe('natural language → expression (rules, offline)', () => {
  it('understands "zero debt and ROE greater than 20"', () => {
    const r = parseQuery('companies with zero debt and ROE greater than 20');
    expect(r.expression).toContain('Debt to Equity < 0.1');
    expect(r.expression).toContain('ROE > 20');
    expect(r.clauses.length).toBe(2);
    expect(() => compileExpression(r.expression)).not.toThrow();
  });

  it('understands comparators: under, below, above, at least', () => {
    expect(parseQuery('pe under 20').expression).toContain('P/E < 20');
    expect(parseQuery('price to earnings below 25').expression).toContain('P/E < 25');
    expect(parseQuery('market cap above 500').expression).toContain('Market Cap > 500');
    expect(parseQuery('promoter holding at least 50').expression).toContain('Promoter Holding > 50');
  });

  it('applies cap-size and dividend shortcuts', () => {
    expect(parseQuery('large cap stocks').expression).toContain('Market Cap > 20000');
    expect(parseQuery('mid cap').expression).toContain('Market Cap > 5000');
    expect(parseQuery('small cap').expression).toContain('Market Cap < 5000');
    expect(parseQuery('dividend paying stocks').expression).toContain('Dividend Yield');
  });

  it('handles sector inclusion with shorthands', () => {
    expect(parseQuery('companies in IT sector').expression).toBe('(Sector = "Information Technology")');
    expect(parseQuery('stocks in pharma sector').expression).toBe('(Sector = "Pharmaceuticals")');
  });

  it('handles sector exclusion', () => {
    expect(parseQuery('excluding telecom').expression).toBe('(Sector != "Telecom")');
  });

  it('parses "no pledge" as a pledge threshold', () => {
    expect(parseQuery('companies with no pledge').expression).toContain('Pledged < 0.5');
  });

  it('combines many clauses and still compiles', () => {
    const r = parseQuery('zero debt and ROE greater than 20 and pe under 20 and market cap above 1000');
    expect(r.clauses.length).toBe(4);
    expect(() => compileExpression(r.expression)).not.toThrow();
    expect(r.expression.match(/AND/g)?.length).toBe(3);
  });

  it('reports clauses it could not understand instead of guessing', () => {
    const r = parseQuery('companies that are simply amazing');
    expect(r.expression).toBe('');
    expect(r.unresolved.length).toBe(1);
    expect(r.notes.join(' ')).toMatch(/No rule matched/);
  });

  it('handles an empty query', () => {
    const r = parseQuery('   ');
    expect(r.expression).toBe('');
    expect(r.notes.join(' ')).toMatch(/Empty/);
  });

  it('supports crore suffixes in natural language', () => {
    expect(parseQuery('market cap above 1 lakh crore').expression).toContain('Market Cap > 100000');
    expect(parseQuery('sales above 500 cr').expression).toContain('Sales > 500');
  });
});

describe('natural language via a local model (opt-in), with safe fallback', () => {
  const ok = (async () => ({ ok: true, status: 200, json: async () => ({ response: JSON.stringify({ expression: 'ROE > 10 AND P/E < 15' }) }) })) as unknown as typeof fetch;
  const bad = (async () => ({ ok: true, status: 200, json: async () => ({ response: JSON.stringify({ expression: 'Made Up Field > 3' }) }) })) as unknown as typeof fetch;
  const down = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;

  it('uses the model answer when it validates', async () => {
    const r = await parseQueryWithLlm('profitable and cheap', { fetchImpl: ok });
    expect(r.source).toBe('llm');
    expect(r.expression).toBe('ROE > 10 AND P/E < 15');
  });

  it('falls back to the rules when the model hallucinates a field', async () => {
    const r = await parseQueryWithLlm('zero debt', { fetchImpl: bad });
    expect(r.source).toBe('rules');
    expect(r.expression).toContain('Debt to Equity < 0.1');
    expect(r.notes.join(' ')).toMatch(/rules/i);
  });

  it('falls back to the rules when no local model is running', async () => {
    const r = await parseQueryWithLlm('ROE above 15', { fetchImpl: down });
    expect(r.source).toBe('rules');
    expect(r.expression).toContain('ROE > 15');
  });

  it('builds a prompt that names the allowed fields', () => {
    const p = buildLlmPrompt('cheap and profitable');
    expect(p).toContain('Market Cap');
    expect(p).toContain('{"expression"');
    expect(p).toContain('cheap and profitable');
  });
});
