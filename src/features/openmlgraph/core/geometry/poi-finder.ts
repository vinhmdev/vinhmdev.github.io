/**
 * Points of Interest (POI) Extractor via Jet2 Bitmasks & Brent's Method [FR-3.3, AC-01].
 *
 * Automatically detects and pins interactive POIs to < 10^-12 accuracy:
 * 1. Roots (f(x) = 0)
 * 2. Y-Intercept (x = 0)
 * 3. Smooth Local Extrema (f'(x) = 0 where f''(x) != 0)
 * 4. Inflection Points (f''(x) = 0 where concavity changes sign)
 * 5. Piecewise Kinks (branchMask transition, pinning exact vertex such as
 *    (0, 0) for ReLU(x) and (2, 0) for |x - 2| along with subdifferential
 *    slope interval [leftSlope, rightSlope] for the Subdifferential Fan [FR-2.2]).
 */
import type { PointOfInterest, SubgradConvention } from '../../types/math';
import type { Viewport2DBounds } from '../../types/state';
import type { CompiledJet2Kernel } from '../calculus/jit-compiler';

const BRENT_TOL = 1e-13;
const BRENT_MAX_ITER = 64;

/**
 * Brent's root-finding algorithm (1973) combining bisection, secant, and
 * inverse quadratic interpolation for guaranteed superlinear convergence (< 1e-12).
 */
export function brentRoot(
  fn: (x: number) => number,
  x0: number,
  x1: number,
  tol = BRENT_TOL
): number {
  let a = x0;
  let b = x1;
  let fa = fn(a);
  let fb = fn(b);

  if (Math.abs(fa) <= tol) return a;
  if (Math.abs(fb) <= tol) return b;
  if (fa * fb > 0) return 0.5 * (a + b);

  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;

  for (let iter = 0; iter < BRENT_MAX_ITER; iter++) {
    if (fb * fc > 0) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }

    const tol1 = 2.0 * Number.EPSILON * Math.abs(b) + 0.5 * tol;
    const xm = 0.5 * (c - b);

    if (Math.abs(xm) <= tol1 || fb === 0.0) {
      return b;
    }

    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      let s = fb / fa;
      let p: number;
      let q: number;
      if (a === c) {
        p = 2.0 * xm * s;
        q = 1.0 - s;
      } else {
        q = fa / fc;
        const r = fb / fc;
        p = s * (2.0 * xm * q * (q - r) - (b - a) * (r - 1.0));
        q = (q - 1.0) * (r - 1.0) * (s - 1.0);
      }
      if (p > 0) q = -q;
      p = Math.abs(p);

      if (2.0 * p < Math.min(3.0 * xm * q - Math.abs(tol1 * q), Math.abs(e * q))) {
        e = d;
        d = p / q;
      } else {
        d = xm;
        e = d;
      }
    } else {
      d = xm;
      e = d;
    }

    a = b;
    fa = fb;
    if (Math.abs(d) > tol1) {
      b += d;
    } else {
      b += xm >= 0 ? tol1 : -tol1;
    }
    fb = fn(b);
  }

  return b;
}

export function extractPointsOfInterest(
  kernel: CompiledJet2Kernel,
  params: Record<string, number>,
  viewport: Viewport2DBounds,
  convention: SubgradConvention = 'zero'
): PointOfInterest[] {
  const { xMin, xMax } = viewport;
  const pois: PointOfInterest[] = [];
  const out = new Float64Array(5);
  const NUM_SCAN = 256;
  const dx = (xMax - xMin) / NUM_SCAN;
  const diracTau = 1e-4;

  function addUniquePoi(candidate: PointOfInterest): void {
    if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) return;
    // Snap near-zero values (< 1e-12) to exact 0.0
    const cx = Math.abs(candidate.x) < 1e-12 ? 0.0 : candidate.x;
    const cy = Math.abs(candidate.y) < 1e-12 ? 0.0 : candidate.y;
    const existing = pois.find(
      (p) => p.kind === candidate.kind && Math.abs(p.x - cx) < 1e-6
    );
    if (!existing) {
      pois.push({
        ...candidate,
        x: cx,
        y: cy,
      });
    }
  }

  // 1. Y-Intercept at x = 0 if within viewport
  if (xMin <= 0 && xMax >= 0) {
    kernel.evalInto(0.0, params, out, convention, diracTau);
    if (Number.isFinite(out[0])) {
      addUniquePoi({
        kind: 'y_intercept',
        x: 0.0,
        y: out[0],
        label: `(0, ${formatCoord(out[0])})`,
      });
    }
  }

  let prevX = xMin;
  kernel.evalInto(prevX, params, out, convention, diracTau);
  let prevV = out[0];
  let prevD1 = out[1];
  let prevD2 = out[2];
  let prevBm = out[3];
  let prevDm = out[4];

  for (let i = 1; i <= NUM_SCAN; i++) {
    const currX = xMin + i * dx;
    kernel.evalInto(currX, params, out, convention, diracTau);
    const currV = out[0];
    const currD1 = out[1];
    const currD2 = out[2];
    const currBm = out[3];
    const currDm = out[4];

    if (!Number.isFinite(prevV) || !Number.isFinite(currV) || prevDm !== currDm) {
      prevX = currX;
      prevV = currV;
      prevD1 = currD1;
      prevD2 = currD2;
      prevBm = currBm;
      prevDm = currDm;
      continue;
    }

    // 2. Piecewise Kink Detection (branchMask changed)
    if (prevBm !== currBm) {
      let lo = prevX;
      let hi = currX;
      const startBm = prevBm;
      for (let it = 0; it < 48; it++) {
        const mid = 0.5 * (lo + hi);
        if (mid === lo || mid === hi) break;
        kernel.evalInto(mid, params, out, convention, diracTau);
        if (out[3] === startBm) {
          lo = mid;
        } else {
          hi = mid;
        }
      }
      const kinkX = 0.5 * (lo + hi);
      kernel.evalInto(kinkX, params, out, convention, diracTau);
      const kinkY = out[0];

      // Measure left and right analytical slopes for the Subdifferential Fan [FR-2.2]
      const eps = 1e-7;
      kernel.evalInto(kinkX - eps, params, out, convention, diracTau);
      const leftSlope = out[1];
      kernel.evalInto(kinkX + eps, params, out, convention, diracTau);
      const rightSlope = out[1];

      addUniquePoi({
        kind: 'kink',
        x: kinkX,
        y: kinkY,
        label: `Kink (${formatCoord(kinkX)}, ${formatCoord(kinkY)})`,
        subdiffInterval: [Math.min(leftSlope, rightSlope), Math.max(leftSlope, rightSlope)],
      });

      // If kink is also a root (e.g., ReLU(0)=0 or |x-2| at x=2), record root as well
      if (Math.abs(kinkY) < 1e-9) {
        addUniquePoi({
          kind: 'root',
          x: kinkX,
          y: 0.0,
          label: `Root (${formatCoord(kinkX)}, 0)`,
        });
      }
    } else {
      // 3. Smooth Root Detection (f(x) = 0)
      if ((prevV <= 0 && currV >= 0) || (prevV >= 0 && currV <= 0)) {
        if (Math.abs(prevV - currV) > 1e-14) {
          const rx = brentRoot(
            (x) => {
              kernel.evalInto(x, params, out, convention, diracTau);
              return out[0];
            },
            prevX,
            currX
          );
          kernel.evalInto(rx, params, out, convention, diracTau);
          if (Math.abs(out[0]) < 1e-7) {
            addUniquePoi({
              kind: 'root',
              x: rx,
              y: 0.0,
              label: `Root (${formatCoord(rx)}, 0)`,
            });
          }
        }
      }

      // 4. Smooth Local Extremum Detection (f'(x) = 0 with non-zero curvature)
      if (
        ((prevD1 < 0 && currD1 > 0) || (prevD1 > 0 && currD1 < 0)) &&
        Math.abs(prevD1 - currD1) > 1e-9
      ) {
        const ex = brentRoot(
          (x) => {
            kernel.evalInto(x, params, out, convention, diracTau);
            return out[1];
          },
          prevX,
          currX
        );
        kernel.evalInto(ex, params, out, convention, diracTau);
        if (Math.abs(out[1]) < 1e-6 && Math.abs(out[2]) > 1e-6) {
          addUniquePoi({
            kind: 'extremum',
            x: ex,
            y: out[0],
            label: `${out[2] < 0 ? 'Max' : 'Min'} (${formatCoord(ex)}, ${formatCoord(out[0])})`,
          });
        }
      }

      // 5. Smooth Inflection Point Detection (f''(x) = 0)
      if (
        ((prevD2 < 0 && currD2 > 0) || (prevD2 > 0 && currD2 < 0)) &&
        Math.abs(prevD2 - currD2) > 1e-7
      ) {
        const ix = brentRoot(
          (x) => {
            kernel.evalInto(x, params, out, convention, diracTau);
            return out[2];
          },
          prevX,
          currX
        );
        kernel.evalInto(ix, params, out, convention, diracTau);
        if (Math.abs(out[2]) < 1e-5) {
          addUniquePoi({
            kind: 'inflection',
            x: ix,
            y: out[0],
            label: `Inflection (${formatCoord(ix)}, ${formatCoord(out[0])})`,
          });
        }
      }
    }

    prevX = currX;
    prevV = currV;
    prevD1 = currD1;
    prevD2 = currD2;
    prevBm = currBm;
    prevDm = currDm;
  }

  return pois;
}

function formatCoord(n: number): string {
  const clean = Math.abs(n) < 1e-10 ? 0 : n;
  return Number(clean.toFixed(4)).toString();
}
