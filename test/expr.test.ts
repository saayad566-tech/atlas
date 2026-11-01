import { describe, it, expect } from 'vitest';
import { compileExpression, parseExpression, describeAst, ExprError, FIELDS, resolveField } from '../src/finance/core/expr';

describe('expression → SQL compiler', () => {
  it('compiles a simple screener query with bound parameters', () => {
    const c = compileExpression('Market Cap > 500 AND ROE > 15');
    expect(c.sql).toBe('((market_cap > ?) AND (roe > ?))');
    expect(c.params).toEqual([500, 15]);
    expect(c.fields.sort()).toEqual(['market_cap', 'roe']);
  });

  it('accepts snake_case and alias spellings', () => {
    expect(compileExpression('debt_to_equity < 0.5').sql).toContain('debt_to_equity');
    expect(compileExpression('P/E < 20').sql).toContain('pe');
    expect(compileExpression('revenue > 1000').sql).toContain('sales');
    expect(compileExpression('return on equity > 15').sql).toContain('roe');
  });

  it('honours precedence: AND binds tighter than OR', () => {
    const c = compileExpression('ROE > 20 AND P/E < 20 OR P/B < 2');
    expect(c.sql).toBe('(((roe > ?) AND (pe < ?)) OR (pb < ?))');
    expect(c.params).toEqual([20, 20, 2]);
  });

  it('respects explicit parentheses', () => {
    const c = compileExpression('ROE > 20 AND (P/E < 20 OR P/B < 2)');
    expect(c.sql).toBe('((roe > ?) AND ((pe < ?) OR (pb < ?)))');
  });

  it('supports arithmetic inside a condition', () => {
    const c = compileExpression('(Sales - Expenses) > 100');
    expect(c.sql).toContain('(sales - expenses)');
    expect(c.params).toEqual([100]);
  });

  it('guards division by zero with NULLIF', () => {
    const c = compileExpression('Sales / 0 > 1');
    expect(c.sql).toContain('NULLIF');
  });

  it('supports NOT and quoted text comparisons', () => {
    const c = compileExpression('NOT Sector = "Telecom"');
    expect(c.sql).toContain('NOT');
    expect(c.params).toEqual(['Telecom']);
  });

  it('understands crore / lakh crore / percent suffixes', () => {
    expect(compileExpression('Market Cap > 500 Cr').params).toEqual([500]);
    expect(compileExpression('Market Cap > 1 lakh crore').params).toEqual([100000]);
    expect(compileExpression('ROE > 20%').params).toEqual([20]);
  });

  it('rejects an injection attempt instead of passing it through', () => {
    expect(() => compileExpression('ROE > 15; DROP TABLE companies')).toThrow(ExprError);
    expect(() => compileExpression("ROE > 15 OR 1=1 --")).toThrow(ExprError);
    expect(() => compileExpression('ROE > (SELECT 1)')).toThrow(ExprError);
  });

  it('names an unknown field and suggests real ones', () => {
    try { compileExpression('Magic Ratio > 5'); expect.unreachable(); }
    catch (e) { expect((e as Error).message).toMatch(/Unknown field "Magic Ratio"/); expect((e as Error).message).toMatch(/Market Cap/); }
  });

  it('rejects comparing a text field with a number', () => {
    expect(() => compileExpression('Sector > 5')).toThrow(/text/);
  });

  it('requires a condition, not a bare value', () => {
    expect(() => compileExpression('ROE')).toThrow(/condition/);
    expect(() => compileExpression('')).toThrow(/empty/);
  });

  it('reports unbalanced parentheses', () => {
    expect(() => compileExpression('(ROE > 5')).toThrow(/closing parenthesis/);
  });

  it('describes an AST back to readable text', () => {
    expect(describeAst(parseExpression('ROE > 15 AND P/E < 20'))).toBe('(ROE > 15 AND P/E < 20)');
  });

  it('exposes a stable field vocabulary with units', () => {
    expect(FIELDS.length).toBeGreaterThanOrEqual(20);
    expect(resolveField('market cap')?.unit).toBe('₹ Cr');
    expect(resolveField('nonsense')).toBeNull();
  });
});
