/**
 * Adaptive Screen-Space Recursive Curve Sampler [FR-3.1, FR-3.2, AC-01, AC-03].
 *
 * Replaces uniform x-grids with recursive binary subdivision starting from
 * 64 golden-ratio phase-jittered seed segments (preventing Nyquist aliasing
 * on oscillatory functions like `sin(1/x)`).
 *
 * Subdivision stopping criteria in screen pixels:
 * - Perpendicular midpoint deviation squared: d_perp^2 <= 0.45^2 px^2
 * - Segment bend angle cosine squared: cos^2(theta) >= cos^2(5.5 deg)
 * - Exact Kink Pinning: if `branchMask` differs between endpoints, subdivides
 *   down to 1e-12 to pin the exact piecewise vertex (e.g. `(0,0)` of `relu(x)`,
 *   `(2,0)` of `abs(x-2)`) with zero corner rounding.
 * - Asymptote / Jump Break: if `discMask` differs between endpoints, narrows down
 *   to sub-pixel width and inserts a `NaN, NaN` break so no false vertical wall
 *   is drawn across `1/(x-1)` or `sign(x)`.
 */
import type { SubgradConvention } from '../../types/math';
import type { Viewport2DBounds } from '../../types/state';
import type { CompiledJet2Kernel } from '../calculus/jit-compiler';
import { shouldBreakSegment } from './interval-guard';

const GOLDEN_RATIO_CONJ = 0.6180339887498949;
const NUM_SEED_SEGMENTS = 64;
const MAX_DEPTH = 14;
const KINK_REFINE_ITERS = 42; // 2^-42 ~ 2.2e-13 precision for kinks & jumps
const D_PERP_TOL_SQ = 0.45 * 0.45;
const COS_THETA_TOL_SQ = Math.cos((5.5 * Math.PI) / 180) ** 2;

export interface AdaptiveSampleOptions {
  viewport: Viewport2DBounds;
  screenWidth?: number;
  screenHeight?: number;
  convention?: SubgradConvention;
  /** Which derivative order to sample: 0 = f(x), 1 = f'(x), 2 = f''(x) */
  derivativeOrder?: 0 | 1 | 2;
}

export function sampleAdaptiveCurve(
  kernel: CompiledJet2Kernel,
  params: Record<string, number>,
  opts: AdaptiveSampleOptions
): Float64Array {
  const {
    viewport,
    screenWidth = 800,
    screenHeight = 600,
    convention = 'zero',
    derivativeOrder = 0,
  } = opts;

  const { xMin, xMax, yMin, yMax } = viewport;
  const xSpan = Math.max(xMax - xMin, 1e-9);
  const ySpan = Math.max(yMax - yMin, 1e-9);
  const pxPerX = screenWidth / xSpan;
  const pxPerY = screenHeight / ySpan;
  const diracTau = 2.0 * (xSpan / screenWidth);

  const outBuf = new Float64Array(5);

  function evalAt(x: number): {
    y: number;
    d1: number;
    bm: number;
    dm: number;
  } {
    kernel.evalInto(x, params, outBuf, convention, diracTau);
    const y =
      derivativeOrder === 0 ? outBuf[0] : derivativeOrder === 1 ? outBuf[1] : outBuf[2];
    const d1 =
      derivativeOrder === 0 ? outBuf[1] : derivativeOrder === 1 ? outBuf[2] : 0.0;
    // Notice: for f'(x) of a C^0 piecewise function (like ReLU -> Heaviside),
    // any branchMask flip in f(x) becomes a jump discontinuity in f'(x)!
    const bm = derivativeOrder === 0 ? outBuf[3] : 0;
    const dm = derivativeOrder === 0 ? outBuf[4] : outBuf[4] ^ outBuf[3];
    return { y, d1, bm, dm };
  }

  // Generate 64 golden-ratio phase-jittered seed x coordinates
  const seeds = new Float64Array(NUM_SEED_SEGMENTS + 1);
  seeds[0] = xMin;
  seeds[NUM_SEED_SEGMENTS] = xMax;
  const step = xSpan / NUM_SEED_SEGMENTS;
  for (let i = 1; i < NUM_SEED_SEGMENTS; i++) {
    const jitter = (((i * GOLDEN_RATIO_CONJ) % 1) - 0.5) * 0.18 * step;
    seeds[i] = xMin + i * step + jitter;
  }
  seeds.sort();

  const coords: number[] = [];
  let lastWasNaN = true;

  function pushPoint(x: number, y: number): void {
    if (!Number.isFinite(y) || Math.abs(y) > 1e12) {
      pushBreak();
      return;
    }
    coords.push(x, y);
    lastWasNaN = false;
  }

  function pushBreak(): void {
    if (!lastWasNaN) {
      coords.push(NaN, NaN);
      lastWasNaN = true;
    }
  }

  function subdivide(
    x0: number,
    s0: { y: number; d1: number; bm: number; dm: number },
    x1: number,
    s1: { y: number; d1: number; bm: number; dm: number },
    depth: number
  ): void {
    // 1. Discontinuity / Pole / Domain boundary handling
    const valid0 = Number.isFinite(s0.y) && Math.abs(s0.y) <= 1e12;
    const valid1 = Number.isFinite(s1.y) && Math.abs(s1.y) <= 1e12;

    if (!valid0 && !valid1) {
      pushBreak();
      return;
    }

    if (s0.dm !== s1.dm || valid0 !== valid1) {
      // Narrow down discontinuity / pole via binary search (18 iterations -> ~1e-5 width)
      let loX = x0;
      let loS = s0;
      let hiX = x1;
      let hiS = s1;
      for (let it = 0; it < 18; it++) {
        const midX = 0.5 * (loX + hiX);
        if (midX === loX || midX === hiX) break;
        const midS = evalAt(midX);
        const midValid = Number.isFinite(midS.y) && Math.abs(midS.y) <= 1e12;
        const loValid = Number.isFinite(loS.y) && Math.abs(loS.y) <= 1e12;
        if (midS.dm === loS.dm && midValid === loValid) {
          loX = midX;
          loS = midS;
        } else {
          hiX = midX;
          hiS = midS;
        }
      }
      if (Number.isFinite(loS.y) && Math.abs(loS.y) <= 1e12) {
        pushPoint(loX, loS.y);
      }
      if (
        shouldBreakSegment(loX, loS.y, loS.d1, loS.dm, hiX, hiS.y, hiS.d1, hiS.dm, ySpan)
      ) {
        pushBreak();
      }
      if (Number.isFinite(hiS.y) && Math.abs(hiS.y) <= 1e12) {
        pushPoint(hiX, hiS.y);
      }
      return;
    }

    // 2. Piecewise Kink Exact Vertex Pinning or Jump Discontinuity Break (branchMask changed)
    if (s0.bm !== s1.bm) {
      let loX = x0;
      let loS = s0;
      let hiX = x1;
      let hiS = s1;
      for (let it = 0; it < KINK_REFINE_ITERS; it++) {
        const midX = 0.5 * (loX + hiX);
        if (midX === loX || midX === hiX) break;
        const midS = evalAt(midX);
        if (midS.bm === loS.bm) {
          loX = midX;
          loS = midS;
        } else {
          hiX = midX;
          hiS = midS;
        }
      }
      // If left and right limits at the 2^-42 refined boundary disagree, it is a jump discontinuity!
      if (
        !Number.isFinite(loS.y) ||
        !Number.isFinite(hiS.y) ||
        Math.abs(hiS.y - loS.y) > 1e-3 * Math.max(1.0, Math.abs(loS.y), Math.abs(hiS.y))
      ) {
        if (Number.isFinite(loS.y)) pushPoint(loX, loS.y);
        pushBreak();
        if (Number.isFinite(hiS.y)) pushPoint(hiX, hiS.y);
        return;
      }
      const kinkX = 0.5 * (loX + hiX);
      const kinkS = evalAt(kinkX);
      // Sample left half up to kink, emit exact kink vertex, then sample right half
      if (depth < MAX_DEPTH && (kinkX - x0) * pxPerX > 1.0) {
        subdivide(x0, s0, kinkX, kinkS, depth + 1);
      } else {
        pushPoint(kinkX, kinkS.y);
      }
      if (depth < MAX_DEPTH && (x1 - kinkX) * pxPerX > 1.0) {
        subdivide(kinkX, kinkS, x1, s1, depth + 1);
      } else {
        pushPoint(x1, s1.y);
      }
      return;
    }

    // 3. Smooth Screen-Space Collinearity Check
    const xm = 0.5 * (x0 + x1);
    const sm = evalAt(xm);

    if (!Number.isFinite(sm.y) || sm.dm !== s0.dm || sm.bm !== s0.bm) {
      if (depth < MAX_DEPTH) {
        subdivide(x0, s0, xm, sm, depth + 1);
        subdivide(xm, sm, x1, s1, depth + 1);
      } else {
        pushBreak();
      }
      return;
    }

    // Screen-space coordinates
    const sx0 = (x0 - xMin) * pxPerX;
    const sy0 = (s0.y - yMin) * pxPerY;
    const sxm = (xm - xMin) * pxPerX;
    const sym = (sm.y - yMin) * pxPerY;
    const sx1 = (x1 - xMin) * pxPerX;
    const sy1 = (s1.y - yMin) * pxPerY;

    const dx = sx1 - sx0;
    const dy = sy1 - sy0;
    const lenSq = dx * dx + dy * dy;

    // Perpendicular distance squared from midpoint (sxm, sym) to chord (sx0, sy0)->(sx1, sy1)
    const cross = (sxm - sx0) * dy - (sym - sy0) * dx;
    const dPerpSq = lenSq > 1e-9 ? (cross * cross) / lenSq : 0.0;

    // Bend angle cosine squared between (P0->Pm) and (Pm->P1)
    const ux = sxm - sx0;
    const uy = sym - sy0;
    const vx = sx1 - sxm;
    const vy = sy1 - sym;
    const uLenSq = ux * ux + uy * uy;
    const vLenSq = vx * vx + vy * vy;
    const dot = ux * vx + uy * vy;
    const cosSq =
      uLenSq > 1e-9 && vLenSq > 1e-9
        ? dot > 0
          ? (dot * dot) / (uLenSq * vLenSq)
          : 0.0
        : 1.0;

    if (
      depth < MAX_DEPTH &&
      (dPerpSq > D_PERP_TOL_SQ || cosSq < COS_THETA_TOL_SQ) &&
      dx > 0.35
    ) {
      subdivide(x0, s0, xm, sm, depth + 1);
      subdivide(xm, sm, x1, s1, depth + 1);
    } else {
      pushPoint(xm, sm.y);
      pushPoint(x1, s1.y);
    }
  }

  let prevX = seeds[0];
  let prevS = evalAt(prevX);
  pushPoint(prevX, prevS.y);

  for (let i = 1; i <= NUM_SEED_SEGMENTS; i++) {
    const nextX = seeds[i];
    const nextS = evalAt(nextX);
    subdivide(prevX, prevS, nextX, nextS, 0);
    prevX = nextX;
    prevS = nextS;
  }

  return new Float64Array(coords);
}
