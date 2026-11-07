/**
 * Finite \sum / \prod: parse-time unrolling must be numerically identical to the hand-expanded
 * expression, including first and second derivatives from the Jet2 kernel.
 */
import { describe, expect, it } from 'vitest';
import { compileJet2Kernel } from '../core/calculus/jit-compiler';
import { rewriteBigOperators, MAX_BIG_OPERATOR_TERMS } from '../core/parser/big-operators';
import { parseLatexToMathJson } from '../core/parser/cortex-setup';

const SAMPLE_X = [-2, 0, 1.5];

function expectSameJet(latex: string, reference: string): void {
  const a = parseLatexToMathJson(latex);
  const b = parseLatexToMathJson(reference);
  expect(a.errorMessage).toBeUndefined();
  expect(a.valid).toBe(true);
  expect(b.valid).toBe(true);
  const ka = compileJet2Kernel(a.expr, 'x');
  const kb = compileJet2Kernel(b.expr, 'x');
  for (const x of SAMPLE_X) {
    const ja = ka.evalJet2(x, {});
    const jb = kb.evalJet2(x, {});
    expect(Math.abs(ja.v - jb.v)).toBeLessThan(1e-12);
    expect(Math.abs(ja.d1 - jb.d1)).toBeLessThan(1e-12);
    expect(Math.abs(ja.d2 - jb.d2)).toBeLessThan(1e-12);
  }
}

describe('rewriteBigOperators (text stage)', () => {
  it('rewrites braced and bare scripts, with \\limits and either script order', () => {
    expect(rewriteBigOperators('\\sum_{k=1}^{3} k x')).toContain('Sum((k x), k, 1, 3)');
    expect(rewriteBigOperators('\\sum\\limits^3_{k=1} k x')).toContain('Sum((k x), k, 1, 3)');
    expect(rewriteBigOperators('\\prod_{k=1}^3 (x+k)')).toContain('Product(((x+k)), k, 1, 3)');
  });

  it('stops the summand at the next top-level + or -', () => {
    const out = rewriteBigOperators('\\sum_{k=1}^{2} k x + 1');
    expect(out).toContain('Sum((k x), k, 1, 2)');
    expect(out.trim().endsWith('+ 1')).toBe(true);
  });
});

describe('\\sum / \\prod plotting', () => {
  it('\\sum_{k=1}^{3} k x equals 6x (value, f\', f\'\')', () => {
    expectSameJet('\\sum_{k=1}^{3} k x', '6 x');
  });

  it('\\prod_{k=1}^{3} (x+k) equals (x+1)(x+2)(x+3)', () => {
    expectSameJet('\\prod_{k=1}^{3} (x+k)', '(x+1)(x+2)(x+3)');
  });

  it('supports nested sums and powers of the index', () => {
    expectSameJet('\\sum_{i=1}^{2}\\sum_{j=1}^{2} x^{i+j}', 'x^2 + 2 x^3 + x^4');
  });

  it('substitutes the index inside subscripted names', () => {
    const parsed = parseLatexToMathJson('\\sum_{j=1}^{2} w_j x');
    expect(parsed.valid).toBe(true);
    expect(JSON.stringify(parsed.expr)).toContain('"w_1"');
    expect(JSON.stringify(parsed.expr)).toContain('"w_2"');
  });

  it('treats an empty range as the identity element', () => {
    expectSameJet('x + \\sum_{k=3}^{1} k', 'x');
    expectSameJet('x \\cdot \\prod_{k=3}^{1} k', 'x');
  });

  it(`rejects more than ${MAX_BIG_OPERATOR_TERMS} terms with a clear message`, () => {
    const res = parseLatexToMathJson(`\\sum_{k=1}^{${MAX_BIG_OPERATOR_TERMS + 1}} k x`);
    expect(res.valid).toBe(false);
    expect(res.errorMessage).toMatch(/at most 64 terms/);
  });

  it('rejects symbolic bounds and missing bounds with a clear message', () => {
    const symbolic = parseLatexToMathJson('\\sum_{j=1}^{L} j x');
    expect(symbolic.valid).toBe(false);
    expect(symbolic.errorMessage).toMatch(/upper bound 'L' must be an integer literal/);

    const missing = parseLatexToMathJson('\\sum_{j} j x');
    expect(missing.valid).toBe(false);
    expect(missing.errorMessage).toMatch(/missing a bound/);
  });
});
