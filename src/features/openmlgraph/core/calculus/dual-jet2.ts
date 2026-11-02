/**
 * Order-2 Hyper-Dual Number (Jet2) Algebra & Piecewise Bitmask Rules [FR-2.1, FR-3.2, FR-3.3].
 *
 * A Jet2 value represents the truncated Taylor series at x0:
 *   f(x0 + eps) = v + d1 * eps + 0.5 * d2 * eps^2
 * augmented with two 32-bit integer bitmasks:
 *   - branchMask : flips a dedicated bit whenever a C^0 piecewise kink is crossed
 *                  (relu, leaky_relu, elu, abs, huber, hinge, max, min).
 *   - discMask   : flips a dedicated bit whenever a jump discontinuity or pole is crossed
 *                  (heaviside, sign, floor, ceil).
 */
import type { Jet2Tuple, SubgradConvention } from '../../types/math';
import {
  SafeMathRuntime,
  safeSigmoid,
  safeSigmoidDeriv1,
  safeSigmoidDeriv2,
  diracMollifier,
} from './safe-math-runtime';

export function createConstantJet2(c: number): Jet2Tuple {
  return { v: c, d1: 0, d2: 0, branchMask: 0, discMask: 0 };
}

export function createVariableJet2(x: number): Jet2Tuple {
  return { v: x, d1: 1, d2: 0, branchMask: 0, discMask: 0 };
}

/**
 * Evaluates a unary smooth or piecewise primitive on a Jet2 tuple
 * without allocating nested objects when written into an output tuple.
 */
export function evalUnaryJet2(
  head: string,
  u: Jet2Tuple,
  bitId: number,
  convention: SubgradConvention = 'zero',
  diracTau = 0.04
): Jet2Tuple {
  const uv = u.v;
  const ud1 = u.d1;
  const ud2 = u.d2;
  const ud1Sq = ud1 * ud1;
  const h0 = convention === 'symmetric' ? 0.5 : 0.0;
  const bit = 1 << (bitId & 29);

  switch (head) {
    case 'Negate':
      return { v: -uv, d1: -ud1, d2: -ud2, branchMask: u.branchMask, discMask: u.discMask };

    case 'Sin': {
      const s = Math.sin(uv);
      const c = Math.cos(uv);
      return {
        v: s,
        d1: c * ud1,
        d2: c * ud2 - s * ud1Sq,
        branchMask: u.branchMask,
        discMask: u.discMask,
      };
    }

    case 'Cos': {
      const s = Math.sin(uv);
      const c = Math.cos(uv);
      return {
        v: c,
        d1: -s * ud1,
        d2: -s * ud2 - c * ud1Sq,
        branchMask: u.branchMask,
        discMask: u.discMask,
      };
    }

    case 'Tan': {
      const c = Math.cos(uv);
      const t = Math.tan(uv);
      const sec2 = 1.0 / (c * c);
      // Flag discontinuity bit according to cos(u) sign so odd multiples of pi/2 split
      const poleBit = c >= 0 ? bit : 0;
      return {
        v: t,
        d1: sec2 * ud1,
        d2: sec2 * ud2 + 2.0 * sec2 * t * ud1Sq,
        branchMask: u.branchMask,
        discMask: u.discMask ^ poleBit,
      };
    }

    case 'Exp': {
      const e = Math.exp(uv);
      return {
        v: e,
        d1: e * ud1,
        d2: e * (ud2 + ud1Sq),
        branchMask: u.branchMask,
        discMask: u.discMask,
      };
    }

    case 'Ln': {
      if (uv <= 0) {
        return { v: NaN, d1: NaN, d2: NaN, branchMask: u.branchMask, discMask: u.discMask ^ bit };
      }
      const inv = 1.0 / uv;
      return {
        v: Math.log(uv),
        d1: inv * ud1,
        d2: inv * ud2 - inv * inv * ud1Sq,
        branchMask: u.branchMask,
        discMask: u.discMask,
      };
    }

    case 'Sqrt': {
      if (uv < 0) {
        return { v: NaN, d1: NaN, d2: NaN, branchMask: u.branchMask, discMask: u.discMask ^ bit };
      }
      const sq = Math.sqrt(uv);
      const fp = sq > 1e-15 ? 0.5 / sq : 0;
      const fpp = sq > 1e-15 ? -0.25 / (uv * sq) : 0;
      return {
        v: sq,
        d1: fp * ud1,
        d2: fp * ud2 + fpp * ud1Sq,
        branchMask: u.branchMask ^ (uv >= 0 ? bit : 0),
        discMask: u.discMask,
      };
    }

    case 'Tanh': {
      const th = Math.tanh(uv);
      const sech2 = 1.0 - th * th;
      const fpp = -2.0 * th * sech2;
      return {
        v: th,
        d1: sech2 * ud1,
        d2: sech2 * ud2 + fpp * ud1Sq,
        branchMask: u.branchMask,
        discMask: u.discMask,
      };
    }

    case 'Sigmoid':
    case 'SafeSigmoid': {
      const s = safeSigmoid(uv);
      const fp = safeSigmoidDeriv1(uv);
      const fpp = safeSigmoidDeriv2(uv);
      return {
        v: s,
        d1: fp * ud1,
        d2: fp * ud2 + fpp * ud1Sq,
        branchMask: u.branchMask,
        discMask: u.discMask,
      };
    }

    case 'Softplus':
    case 'SafeSoftplus': {
      const v = SafeMathRuntime.safeSoftplus(uv);
      const fp = safeSigmoid(uv);
      const fpp = safeSigmoidDeriv1(uv);
      return {
        v,
        d1: fp * ud1,
        d2: fp * ud2 + fpp * ud1Sq,
        branchMask: u.branchMask,
        discMask: u.discMask,
      };
    }

    case 'ReLU': {
      const isPos = uv > 0;
      const fp = uv > 0 ? 1.0 : uv < 0 ? 0.0 : h0;
      const fpp = diracMollifier(uv, diracTau);
      return {
        v: isPos ? uv : 0.0,
        d1: fp * ud1,
        d2: fp * ud2 + fpp * ud1Sq,
        branchMask: u.branchMask ^ (uv >= 0 ? bit : 0),
        discMask: u.discMask,
      };
    }

    case 'Abs': {
      const fp = uv > 0 ? 1.0 : uv < 0 ? -1.0 : 0.0;
      const fpp = 2.0 * diracMollifier(uv, diracTau);
      return {
        v: Math.abs(uv),
        d1: fp * ud1,
        d2: fp * ud2 + fpp * ud1Sq,
        branchMask: u.branchMask ^ (uv >= 0 ? bit : 0),
        discMask: u.discMask,
      };
    }

    case 'Heaviside': {
      const v = uv > 0 ? 1.0 : uv < 0 ? 0.0 : h0;
      const fp = diracMollifier(uv, diracTau);
      return {
        v,
        d1: fp * ud1,
        d2: 0.0,
        branchMask: u.branchMask,
        discMask: u.discMask ^ (uv >= 0 ? bit : 0),
      };
    }

    case 'Sign': {
      const v = uv > 0 ? 1.0 : uv < 0 ? -1.0 : 0.0;
      const fp = 2.0 * diracMollifier(uv, diracTau);
      return {
        v,
        d1: fp * ud1,
        d2: 0.0,
        branchMask: u.branchMask,
        discMask: u.discMask ^ (uv >= 0 ? bit : 0),
      };
    }

    case 'DiracDelta': {
      const v = diracMollifier(uv, diracTau);
      const t = Math.max(Math.abs(diracTau), 1e-4);
      const s = safeSigmoid(uv / t);
      const fp = (s * (1.0 - s) * (1.0 - 2.0 * s)) / (t * t);
      return {
        v,
        d1: fp * ud1,
        d2: 0.0,
        branchMask: u.branchMask,
        discMask: u.discMask,
      };
    }

    case 'GELU': {
      const v = SafeMathRuntime.gelu(uv);
      const fp = SafeMathRuntime.geluDeriv1(uv);
      const fpp = SafeMathRuntime.geluDeriv2(uv);
      return {
        v,
        d1: fp * ud1,
        d2: fp * ud2 + fpp * ud1Sq,
        branchMask: u.branchMask,
        discMask: u.discMask,
      };
    }

    case 'Swish': {
      const s = safeSigmoid(uv);
      const sp = safeSigmoidDeriv1(uv);
      const spp = safeSigmoidDeriv2(uv);
      const v = uv * s;
      const fp = s + uv * sp;
      const fpp = 2.0 * sp + uv * spp;
      return {
        v,
        d1: fp * ud1,
        d2: fp * ud2 + fpp * ud1Sq,
        branchMask: u.branchMask,
        discMask: u.discMask,
      };
    }

    case 'Erf': {
      const v = SafeMathRuntime.erf(uv);
      const fp = (2.0 / Math.sqrt(Math.PI)) * Math.exp(-uv * uv);
      const fpp = -2.0 * uv * fp;
      return {
        v,
        d1: fp * ud1,
        d2: fp * ud2 + fpp * ud1Sq,
        branchMask: u.branchMask,
        discMask: u.discMask,
      };
    }

    case 'Floor':
      return {
        v: Math.floor(uv),
        d1: 0,
        d2: 0,
        branchMask: u.branchMask,
        discMask: u.discMask ^ ((Math.floor(uv) & 1) !== 0 ? bit : 0),
      };

    case 'Ceil':
      return {
        v: Math.ceil(uv),
        d1: 0,
        d2: 0,
        branchMask: u.branchMask,
        discMask: u.discMask ^ ((Math.ceil(uv) & 1) !== 0 ? bit : 0),
      };

    default:
      return u;
  }
}
