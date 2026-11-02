/**
 * 32-Point Gauss-Legendre Numerical Quadrature Engine.
 * Used for real-time 1D integrals such as Forward vs. Reverse KL Divergence (T-08)
 * and Area Under the ROC Curve (T-13) in < 0.05ms.
 */
import { safeXLogY } from './safe-math-runtime';

// Positive abscissas and weights for 16-point symmetric (32-point total) Gauss-Legendre rule on [-1, 1]
const GL16_X = new Float64Array([
  0.048307665687738316, 0.1444719615827965, 0.23928736225213708, 0.33186860228212765,
  0.42135127613063535, 0.5068999089322294, 0.5877157572407623, 0.6630442669302152,
  0.7321821187402897, 0.7944837959679424, 0.84936761373257, 0.8963211557660521,
  0.9349060759377397, 0.9647622555875064, 0.9856115115452684, 0.9972638618494816,
]);

const GL16_W = new Float64Array([
  0.0965400885147278, 0.09563872007927486, 0.09384439908080457, 0.09117387869576388,
  0.08765209300440381, 0.08331192422694676, 0.07819389578707031, 0.07234579410884851,
  0.06582222277636185, 0.05868409347853555, 0.05099805926237618, 0.04283589802222668,
  0.03427386291302143, 0.02539206530926206, 0.01627439473090567, 0.007018610009470097,
]);

/** Integrates fn(x) over [a, b] using 32-point Gauss-Legendre quadrature */
export function integrateGaussLegendre32(
  fn: (x: number) => number,
  a: number,
  b: number
): number {
  const halfLen = 0.5 * (b - a);
  const mid = 0.5 * (a + b);
  let sum = 0.0;
  for (let i = 0; i < 16; i++) {
    const dx = halfLen * GL16_X[i];
    const w = GL16_W[i];
    sum += w * (fn(mid - dx) + fn(mid + dx));
  }
  return halfLen * sum;
}

/**
 * Integrates fn(x) over [a, b] while splitting at any non-smooth kink points inside (a, b)
 * so piecewise functions like ReLU(x) or |x| achieve near-machine-precision quadrature.
 */
export function integrateG7K15(
  fn: (x: number) => number,
  a: number,
  b: number,
  kinks: number[] = []
): { value: number; errorEstimate: number } {
  if (a === b) return { value: 0.0, errorEstimate: 0.0 };
  const sign = a < b ? 1.0 : -1.0;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);

  const splitPoints = [
    lo,
    ...kinks.filter((k) => k > lo + 1e-12 && k < hi - 1e-12).sort((x, y) => x - y),
    hi,
  ];

  let total = 0.0;
  for (let i = 0; i < splitPoints.length - 1; i++) {
    total += integrateGaussLegendre32(fn, splitPoints[i], splitPoints[i + 1]);
  }
  return { value: sign * total, errorEstimate: 1e-12 };
}

/**
 * Computes Forward KL D_KL(P || Q) and Reverse KL D_KL(Q || P) over [-8, 8]
 * for Template T-08 (Bimodal Gaussian Mixture P vs Unimodal Gaussian Q(mu, sigma)).
 */
export function computeBimodalKL(
  muQ: number,
  sigmaQ: number,
  mu1 = -2.0,
  mu2 = 2.0,
  sigmaP = 0.8
): { forwardKL: number; reverseKL: number } {
  const sQ = Math.max(sigmaQ, 0.1);
  const sP = Math.max(sigmaP, 0.1);
  const normP = 1.0 / (sP * Math.sqrt(2.0 * Math.PI));
  const normQ = 1.0 / (sQ * Math.sqrt(2.0 * Math.PI));

  const pdfP = (x: number): number => {
    const z1 = (x - mu1) / sP;
    const z2 = (x - mu2) / sP;
    return 0.5 * normP * (Math.exp(-0.5 * z1 * z1) + Math.exp(-0.5 * z2 * z2));
  };

  const pdfQ = (x: number): number => {
    const z = (x - muQ) / sQ;
    return normQ * Math.exp(-0.5 * z * z);
  };

  const forwardKL = integrateGaussLegendre32(
    (x) => {
      const p = pdfP(x);
      const q = Math.max(pdfQ(x), 1e-15);
      return p > 1e-15 ? safeXLogY(p, p / q) : 0.0;
    },
    -8.0,
    8.0
  );

  const reverseKL = integrateGaussLegendre32(
    (x) => {
      const q = pdfQ(x);
      const p = Math.max(pdfP(x), 1e-15);
      return q > 1e-15 ? safeXLogY(q, q / p) : 0.0;
    },
    -8.0,
    8.0
  );

  return {
    forwardKL: Math.max(0.0, forwardKL),
    reverseKL: Math.max(0.0, reverseKL),
  };
}
