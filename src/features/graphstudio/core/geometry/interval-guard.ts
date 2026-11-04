/**
 * Tupper-Style Interval Arithmetic & Singularity/Asymptote Guard [FR-3.2, AC-03].
 *
 * Detects vertical asymptotes (e.g., `1 / (x - 1)`, `tan(x)`) and jump
 * discontinuities (e.g., `sign(x)`, `heaviside(x)`, `floor(x)`) by combining:
 * 1. Interval evaluation `(lo, hi, def, cont)` over `[x0, x1]`
 * 2. Jet2 discontinuity bitmask `discMask` transitions (`dm0 !== dm1`)
 * 3. Monotonicity / slope-sign divergence check across narrow sub-pixel intervals
 */
import type { IntervalBound, MathJsonExpr } from '../../types/math';

export function evalInterval(
  expr: MathJsonExpr,
  indepVar: string,
  xLo: number,
  xHi: number,
  params: Record<string, number>
): IntervalBound {
  if (typeof expr === 'number') {
    return { lo: expr, hi: expr, def: Number.isFinite(expr), cont: true };
  }
  if (typeof expr === 'string') {
    if (expr === 'ExponentialE') return { lo: Math.E, hi: Math.E, def: true, cont: true };
    if (expr === 'Pi') return { lo: Math.PI, hi: Math.PI, def: true, cont: true };
    if (expr === indepVar) return { lo: Math.min(xLo, xHi), hi: Math.max(xLo, xHi), def: true, cont: true };
    const val = params[expr] ?? 1.0;
    return { lo: val, hi: val, def: true, cont: true };
  }
  if (!Array.isArray(expr)) {
    return { lo: 0, hi: 0, def: true, cont: true };
  }

  const [head, ...args] = expr;
  const ch = args.map((a) => evalInterval(a, indepVar, xLo, xHi, params));

  switch (head) {
    case 'Negate': {
      const a = ch[0];
      return { lo: -a.hi, hi: -a.lo, def: a.def, cont: a.cont };
    }
    case 'Add': {
      const [a, b] = ch;
      return { lo: a.lo + b.lo, hi: a.hi + b.hi, def: a.def && b.def, cont: a.cont && b.cont };
    }
    case 'Subtract': {
      const [a, b] = ch;
      return { lo: a.lo - b.hi, hi: a.hi - b.lo, def: a.def && b.def, cont: a.cont && b.cont };
    }
    case 'Multiply': {
      const [a, b] = ch;
      const p1 = a.lo * b.lo;
      const p2 = a.lo * b.hi;
      const p3 = a.hi * b.lo;
      const p4 = a.hi * b.hi;
      return {
        lo: Math.min(p1, p2, p3, p4),
        hi: Math.max(p1, p2, p3, p4),
        def: a.def && b.def,
        cont: a.cont && b.cont,
      };
    }
    case 'Divide': {
      const [a, b] = ch;
      // If denominator interval straddles 0, continuity is broken (pole/asymptote)!
      if (b.lo <= 0 && b.hi >= 0) {
        return { lo: -Infinity, hi: Infinity, def: true, cont: false };
      }
      const q1 = a.lo / b.lo;
      const q2 = a.lo / b.hi;
      const q3 = a.hi / b.lo;
      const q4 = a.hi / b.hi;
      return {
        lo: Math.min(q1, q2, q3, q4),
        hi: Math.max(q1, q2, q3, q4),
        def: a.def && b.def,
        cont: a.cont && b.cont,
      };
    }
    case 'Heaviside':
    case 'Sign': {
      const a = ch[0];
      const straddlesZero = a.lo <= 0 && a.hi >= 0;
      return {
        lo: head === 'Sign' ? -1 : 0,
        hi: 1,
        def: a.def,
        cont: a.cont && !straddlesZero,
      };
    }
    case 'Tan': {
      const a = ch[0];
      const k0 = Math.floor((a.lo + 0.5 * Math.PI) / Math.PI);
      const k1 = Math.floor((a.hi + 0.5 * Math.PI) / Math.PI);
      if (k0 !== k1) {
        return { lo: -Infinity, hi: Infinity, def: a.def, cont: false };
      }
      const t0 = Math.tan(a.lo);
      const t1 = Math.tan(a.hi);
      return { lo: Math.min(t0, t1), hi: Math.max(t0, t1), def: a.def, cont: a.cont };
    }
    case 'Ln': {
      const a = ch[0];
      if (a.hi <= 0) return { lo: NaN, hi: NaN, def: false, cont: false };
      if (a.lo <= 0) return { lo: -Infinity, hi: Math.log(a.hi), def: true, cont: false };
      return { lo: Math.log(a.lo), hi: Math.log(a.hi), def: a.def, cont: a.cont };
    }
    case 'Sqrt': {
      const a = ch[0];
      if (a.hi < 0) return { lo: NaN, hi: NaN, def: false, cont: false };
      return {
        lo: Math.sqrt(Math.max(0, a.lo)),
        hi: Math.sqrt(a.hi),
        def: a.def,
        cont: a.cont && a.lo >= 0,
      };
    }
    default: {
      const a = ch[0] ?? { lo: -Infinity, hi: Infinity, def: true, cont: true };
      return { lo: -Infinity, hi: Infinity, def: a.def, cont: a.cont };
    }
  }
}

/**
 * Determines whether a tiny refined segment `[x0, x1]` crosses a vertical asymptote
 * or jump discontinuity and therefore requires a `NaN, NaN` polyline break [FR-3.2, AC-03].
 */
export function shouldBreakSegment(
  x0: number,
  y0: number,
  d1_0: number,
  dm0: number,
  x1: number,
  y1: number,
  d1_1: number,
  dm1: number,
  ySpan: number
): boolean {
  if (!Number.isFinite(y0) || !Number.isFinite(y1)) {
    return true;
  }

  // If Jet2 discontinuity bitmask changed across the refined micro-segment,
  // it is either a jump discontinuity (sign, heaviside, floor) or a zero-crossing pole (1/(x-1), tan(x))!
  if (dm0 !== dm1) {
    return true;
  }

  // Additional safety guard: if y jumps by more than 4x the viewport height while
  // the secant slope opposes the analytical derivatives at both ends (classic pole straddle)
  const dy = y1 - y0;
  const dx = x1 - x0;
  if (Math.abs(dy) > 4.0 * ySpan && dx > 0) {
    const secant = dy / dx;
    if (secant * d1_0 < 0 && secant * d1_1 < 0) {
      return true;
    }
  }

  return false;
}
