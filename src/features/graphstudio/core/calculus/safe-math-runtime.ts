/**
 * IEEE 754 Numerically Stable Runtime Primitives [FR-2.1, FR-2.4, AC-01, AC-02].
 *
 * Pure scalar functions invoked by the JIT compiler and Jet2 evaluator.
 * Guaranteed free of NaN/Infinity overflow across extreme argument domains.
 */

const SQRT_2_OVER_PI = Math.sqrt(2 / Math.PI);

/** Numerically stable Sigmoid across (-Infinity, +Infinity) */
export function safeSigmoid(z: number): number {
  if (Number.isNaN(z)) return NaN;
  if (z >= 0) {
    if (z > 40) return 1.0;
    return 1.0 / (1.0 + Math.exp(-z));
  } else {
    if (z < -40) return 0.0;
    const ez = Math.exp(z);
    return ez / (1.0 + ez);
  }
}

/** First derivative of Sigmoid: s * (1 - s) */
export function safeSigmoidDeriv1(z: number): number {
  if (Math.abs(z) > 40) return 0.0;
  const s = safeSigmoid(z);
  return s * (1.0 - s);
}

/** Second derivative of Sigmoid: s * (1 - s) * (1 - 2s) */
export function safeSigmoidDeriv2(z: number): number {
  if (Math.abs(z) > 40) return 0.0;
  const s = safeSigmoid(z);
  return s * (1.0 - s) * (1.0 - 2.0 * s);
}

/** Numerically stable Softplus: max(0, z) + log1p(exp(-|z|)) */
export function safeSoftplus(z: number): number {
  if (Number.isNaN(z)) return NaN;
  const absZ = Math.abs(z);
  if (absZ > 37) return z > 0 ? z : Math.exp(z);
  return Math.max(0.0, z) + Math.log1p(Math.exp(-absZ));
}

/**
 * Numerically stable Binary Cross-Entropy with Logits [FR-2.4, AC-02]:
 * BCEWithLogits(y, z) = max(z, 0) - y * z + log1p(exp(-|z|))
 * At y = 1, z = 1000: returns exact 0.0 (never NaN or -Infinity).
 */
export function bceWithLogits(y: number, z: number): number {
  if (Number.isNaN(y) || Number.isNaN(z)) return NaN;
  const absZ = Math.abs(z);
  const tail = absZ > 37 ? 0.0 : Math.log1p(Math.exp(-absZ));
  return Math.max(z, 0.0) - y * z + tail;
}

/** Derivative of BCEWithLogits(y, z) with respect to logit z: sigma(z) - y */
export function bceWithLogitsDerivZ(y: number, z: number): number {
  return safeSigmoid(z) - y;
}

/**
 * Numerically stable Temperature Softmax using LogSumExp shift M = max_j(z_j / tau) [FR-2.4].
 * Prevents exp(z/tau) -> Infinity / Infinity = NaN as tau -> 0+.
 */
export function safeSoftmax(
  zi: number,
  z1 = 0.0,
  z2?: number,
  z3?: number,
  tau?: number
): number {
  if (Number.isNaN(zi) || Number.isNaN(z1)) return NaN;
  if (z2 === undefined) {
    // 2-arg call: softmax(zi, z1) -> exp(zi) / (exp(zi) + exp(z1))
    const maxS = Math.max(zi, z1);
    const num = Math.exp(zi - maxS);
    const den = num + Math.exp(z1 - maxS);
    return den > 0 ? num / den : 0.0;
  }
  if (Number.isNaN(z2)) return NaN;
  if (z3 === undefined) {
    // 3-arg call: softmax(zi, z1, z2)
    const maxS = Math.max(zi, z1, z2);
    const num = Math.exp(zi - maxS);
    const den = num + Math.exp(z1 - maxS) + Math.exp(z2 - maxS);
    return den > 0 ? num / den : 0.0;
  }
  if (Number.isNaN(z3) || (tau !== undefined && Number.isNaN(tau))) return NaN;
  const t = Math.max(Math.abs(tau ?? 1.0), 1e-9);
  const s0 = zi / t;
  const s1 = z1 / t;
  const s2 = z2 / t;
  const s3 = z3 / t;
  const maxS = Math.max(s0, s1, s2, s3);
  const num = Math.exp(s0 - maxS);
  const den = Math.exp(s1 - maxS) + Math.exp(s2 - maxS) + Math.exp(s3 - maxS);
  return den > 0 ? num / den : 0.0;
}

/** Safe x * ln(y) that returns 0 when x === 0 (for KL Divergence & Entropy) */
export function safeXLogY(x: number, y: number): number {
  if (x === 0) return 0.0;
  return x * Math.log(Math.max(y, 1e-15));
}

/** Abramowitz & Stegun 7.1.26 error function approximation (max error 1.5e-7) */
export function erf(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const sign = x >= 0 ? 1 : -1;
  const ax = Math.abs(x);
  const t = 1.0 / (1.0 + 0.3275911 * ax);
  const y =
    1.0 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/** Lanczos approximation for ln(Gamma(z)) for z > 0 */
const LANCZOS_COEFFS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

export function lgamma(z: number): number {
  if (z <= 0) return NaN;
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1.0 - z);
  }
  const zm1 = z - 1.0;
  let x = LANCZOS_COEFFS[0];
  for (let i = 1; i < LANCZOS_COEFFS.length; i++) {
    x += LANCZOS_COEFFS[i] / (zm1 + i);
  }
  const t = zm1 + 7.5;
  return 0.5 * Math.log(2.0 * Math.PI) + (zm1 + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Numerically stable Beta PDF using lgamma (prevents overflow in T-09 when n >= 15) */
export function betaPdf(theta: number, alpha: number, beta: number): number {
  if (theta <= 0 || theta >= 1 || alpha <= 0 || beta <= 0) return 0.0;
  const logNorm = lgamma(alpha + beta) - lgamma(alpha) - lgamma(beta);
  const logKernel = (alpha - 1.0) * Math.log(theta) + (beta - 1.0) * Math.log(1.0 - theta);
  return Math.exp(logNorm + logKernel);
}

/** Gaussian Error Linear Unit (GELU) and its analytic derivatives */
export function gelu(x: number): number {
  const inner = SQRT_2_OVER_PI * (x + 0.044715 * x * x * x);
  return 0.5 * x * (1.0 + Math.tanh(inner));
}

export function geluDeriv1(x: number): number {
  const x2 = x * x;
  const u = SQRT_2_OVER_PI * (x + 0.044715 * x * x2);
  const th = Math.tanh(u);
  const sech2 = 1.0 - th * th;
  const du = SQRT_2_OVER_PI * (1.0 + 3.0 * 0.044715 * x2);
  return 0.5 * (1.0 + th) + 0.5 * x * sech2 * du;
}

export function geluDeriv2(x: number): number {
  const x2 = x * x;
  const u = SQRT_2_OVER_PI * (x + 0.044715 * x * x2);
  const th = Math.tanh(u);
  const sech2 = 1.0 - th * th;
  const du = SQRT_2_OVER_PI * (1.0 + 3.0 * 0.044715 * x2);
  const d2u = SQRT_2_OVER_PI * (6.0 * 0.044715 * x);
  return sech2 * du + 0.5 * x * sech2 * (d2u - 2.0 * th * du * du);
}

/** Swish / SiLU: x * sigmoid(beta * x) */
export function swish(x: number, beta = 1.0): number {
  return x * safeSigmoid(beta * x);
}

/** ELU: x >= 0 ? x : alpha * (exp(x) - 1) */
export function elu(x: number, alpha = 1.0): number {
  return x >= 0 ? x : alpha * Math.expm1(x);
}

/** LeakyReLU: x >= 0 ? x : alpha * x */
export function leakyRelu(x: number, alpha = 0.1): number {
  return x >= 0 ? x : alpha * x;
}

/** Huber Loss: |r| <= delta ? 0.5 * r^2 : delta * (|r| - 0.5 * delta) */
export function huber(r: number, delta = 1.0): number {
  const d = Math.max(Math.abs(delta), 1e-6);
  const ar = Math.abs(r);
  return ar <= d ? 0.5 * r * r : d * (ar - 0.5 * d);
}

/** Hinge Loss: max(0, 1 - u) or max(0, 1 - y * z) */
export function hinge(u: number, y = 1.0): number {
  return Math.max(0.0, 1.0 - u * y);
}

/** Clarke Heaviside step function with configurable H(0) = 0 vs 0.5 [FR-2.1] */
export function heaviside(u: number, h0 = 0.0): number {
  if (Number.isNaN(u)) return NaN;
  if (u > 0) return 1.0;
  if (u < 0) return 0.0;
  return h0;
}

/** Clarke Signum with configurable sign(0) = 0 [FR-2.1] */
export function clarkeSign(u: number): number {
  if (Number.isNaN(u)) return NaN;
  if (u > 0) return 1.0;
  if (u < 0) return -1.0;
  return 0.0;
}

/**
 * Pixel-adaptive Dirac delta mollifier [FR-2.1]:
 * delta_tau(u) = (1 / tau) * sigma(u / tau) * (1 - sigma(u / tau))
 */
export function diracMollifier(u: number, tau = 0.04): number {
  const t = Math.max(Math.abs(tau), 1e-4);
  const s = safeSigmoid(u / t);
  return (s * (1.0 - s)) / t;
}

import { getRegisteredMathFunction } from '../../extensions/contracts';

/** Gamma(z) = exp(lgamma(z)) for z > 0 */
export function gamma(z: number): number {
  if (z <= 0) return NaN;
  return Math.exp(lgamma(z));
}

/** Numerically stable probability-space Binary Cross-Entropy: -(y*ln(p) + (1-y)*ln(1-p)) */
export function bce(y: number, p: number): number {
  const cp = Math.min(Math.max(p, 1e-15), 1.0 - 1e-15);
  return -(safeXLogY(y, cp) + safeXLogY(1.0 - y, 1.0 - cp));
}

/** Numerically stable unnormalized sinc(x) = sin(x) / x with Taylor expansion near 0 */
export function sinc(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const ax = Math.abs(x);
  if (ax < 1e-4) {
    const x2 = x * x;
    return 1.0 - x2 / 6.0 + (x2 * x2) / 120.0;
  }
  return Math.sin(x) / x;
}

export function sincDeriv1(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const ax = Math.abs(x);
  if (ax < 1e-4) {
    return -x / 3.0 + (x * x * x) / 30.0;
  }
  return (x * Math.cos(x) - Math.sin(x)) / (x * x);
}

export function sincDeriv2(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const ax = Math.abs(x);
  if (ax < 1e-3) {
    const x2 = x * x;
    return -1.0 / 3.0 + x2 / 10.0 - (x2 * x2) / 168.0;
  }
  return ((2.0 - x * x) * Math.sin(x) - 2.0 * x * Math.cos(x)) / (x * x * x);
}

/** Evaluates a registered MathFunctionPlugin by name */
export function evalPluginFn(name: string, ...args: number[]): number {
  const plugin = getRegisteredMathFunction(name);
  if (!plugin) return NaN;
  return plugin.evaluateScalar(...args);
}

/** Central finite-difference 1st derivative of a unary MathFunctionPlugin */
export function evalPluginDeriv1(name: string, x: number): number {
  const plugin = getRegisteredMathFunction(name);
  if (!plugin) return NaN;
  const h = 1e-5;
  return (plugin.evaluateScalar(x + h) - plugin.evaluateScalar(x - h)) / (2.0 * h);
}

/** Central finite-difference 2nd derivative of a unary MathFunctionPlugin */
export function evalPluginDeriv2(name: string, x: number): number {
  const plugin = getRegisteredMathFunction(name);
  if (!plugin) return NaN;
  const h = 1e-4;
  return (
    (plugin.evaluateScalar(x + h) - 2.0 * plugin.evaluateScalar(x) + plugin.evaluateScalar(x - h)) /
    (h * h)
  );
}

export const SafeMathRuntime = {
  safeSigmoid,
  safeSigmoidDeriv1,
  safeSigmoidDeriv2,
  safeSoftplus,
  bce,
  bceWithLogits,
  bceWithLogitsDerivZ,
  safeSoftmax,
  safeXLogY,
  erf,
  gamma,
  lgamma,
  betaPdf,
  gelu,
  geluDeriv1,
  geluDeriv2,
  swish,
  elu,
  leakyRelu,
  huber,
  hinge,
  heaviside,
  clarkeSign,
  diracMollifier,
  sinc,
  sincDeriv1,
  sincDeriv2,
  evalPluginFn,
  evalPluginDeriv1,
  evalPluginDeriv2,
} as const;

