/**
 * Specialized Multivariate ML Kernels for Phase 5 Templates [FR-4.4]:
 * - T-03: 3-Class Temperature Softmax & Barycentric 2-Simplex Projection
 * - T-12: Batch Normalization Pre-Pass & Condition Number Estimation
 * - T-13: 2D Logistic Regression Decision Boundary, Confusion Matrix & ROC-AUC
 * - T-14: SVM Kernel Trick (2D Concentric Rings -> 3D RBF Feature Lift)
 * - T-15: 2-Layer MLP Space Folding Homotopy (XOR Continuous Grid Morphing)
 */
import type { DataPoint2D } from '../../types/state';
import { safeSigmoid, safeSoftmax } from '../calculus/safe-math-runtime';

/** T-03: Computes 3-class probabilities and 2-Simplex barycentric 2D coordinates */
export function computeSoftmaxSimplexPoint(
  z1: number,
  z2: number,
  z3: number,
  tau: number
): {
  p1: number;
  p2: number;
  p3: number;
  entropy: number;
  simplexX: number;
  simplexY: number;
} {
  const p1 = safeSoftmax(z1, z1, z2, z3, tau);
  const p2 = safeSoftmax(z2, z1, z2, z3, tau);
  const p3 = Math.max(0.0, 1.0 - p1 - p2);

  const hTerm = (p: number): number => (p > 1e-12 ? -p * Math.log(p) : 0.0);
  const entropy = hTerm(p1) + hTerm(p2) + hTerm(p3);

  // Equilateral triangle vertices in normalized [-1, 1] canvas coordinates:
  // V1 (top): (0, 0.85), V2 (bottom-left): (-0.85, -0.65), V3 (bottom-right): (0.85, -0.65)
  const simplexX = p2 * -0.85 + p3 * 0.85;
  const simplexY = p1 * 0.85 + (p2 + p3) * -0.65;

  return { p1, p2, p3, entropy, simplexX, simplexY };
}

export interface RocCurveResult {
  /** Interleaved [fpr0, tpr0, fpr1, tpr1, ...] for 101 thresholds */
  curvePoints: Float64Array;
  auc: number;
  activeFpr: number;
  activeTpr: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
}

/** T-13: Computes 2D Logistic Regression ROC Curve, AUC, and Confusion Matrix at threshold tau */
export function computeRocAndConfusionMatrix(
  points: DataPoint2D[],
  w1: number,
  w2: number,
  b: number,
  thresholdTau: number
): RocCurveResult {
  const n = points.length;
  const scores = new Float64Array(n);
  const labels = new Uint8Array(n);
  let posCount = 0;
  let negCount = 0;

  for (let i = 0; i < n; i++) {
    const pt = points[i];
    const x2 = pt.x2 ?? pt.y;
    const lbl = (pt.label ?? (pt.y > 0 ? 1 : 0)) > 0 ? 1 : 0;
    scores[i] = safeSigmoid(w1 * pt.x + w2 * x2 + b);
    labels[i] = lbl;
    if (lbl === 1) posCount++;
    else negCount++;
  }

  const numSteps = 101;
  const curvePoints = new Float64Array(numSteps * 2);
  const fprs = new Float64Array(numSteps);
  const tprs = new Float64Array(numSteps);

  for (let s = 0; s < numSteps; s++) {
    // Threshold from 1.0 down to 0.0 so FPR increases monotonically from 0 to 1
    const th = 1.0 - s / (numSteps - 1);
    let tp = 0;
    let fp = 0;
    for (let i = 0; i < n; i++) {
      const pred = scores[i] >= th ? 1 : 0;
      if (pred === 1) {
        if (labels[i] === 1) tp++;
        else fp++;
      }
    }
    const fpr = negCount > 0 ? fp / negCount : 0;
    const tpr = posCount > 0 ? tp / posCount : 0;
    fprs[s] = fpr;
    tprs[s] = tpr;
    curvePoints[s * 2] = fpr;
    curvePoints[s * 2 + 1] = tpr;
  }

  // Trapezoidal integration for AUC
  let auc = 0.0;
  for (let s = 1; s < numSteps; s++) {
    const dfpr = Math.max(0.0, fprs[s] - fprs[s - 1]);
    auc += 0.5 * (tprs[s] + tprs[s - 1]) * dfpr;
  }

  // Evaluate active threshold tau
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  const tau = Math.min(Math.max(thresholdTau, 0.0), 1.0);
  for (let i = 0; i < n; i++) {
    const pred = scores[i] >= tau ? 1 : 0;
    if (pred === 1 && labels[i] === 1) tp++;
    else if (pred === 1 && labels[i] === 0) fp++;
    else if (pred === 0 && labels[i] === 0) tn++;
    else fn++;
  }

  return {
    curvePoints,
    auc: Math.min(Math.max(auc, 0.0), 1.0),
    activeFpr: negCount > 0 ? fp / negCount : 0,
    activeTpr: posCount > 0 ? tp / posCount : 0,
    tp,
    fp,
    tn,
    fn,
  };
}

/** T-14: Computes 3D Radial Basis Function (RBF) lift z = exp(-gamma * (x1^2 + x2^2)) */
export function computeRbfLift3D(
  x1: number,
  x2: number,
  gamma: number
): number {
  const g = Math.max(gamma, 0.05);
  return Math.exp(-g * (x1 * x1 + x2 * x2));
}

/**
 * T-15: 2-Layer MLP Space Folding Homotopy [FR-4.4]:
 * Smoothly warps any 2D coordinate (x1, x2) via h(t) = (1 - t) * x + t * tanh(W1 * x + b1)
 * so the non-linearly-separable XOR quadrants fold into a linearly separable line.
 */
export function warpMlpHomotopyPoint(
  x1: number,
  x2: number,
  t: number,
  w11 = 2.4,
  w12 = 2.4,
  b1 = -1.2,
  w21 = -2.4,
  w22 = -2.4,
  b2 = -1.2
): { wx: number; wy: number } {
  const alpha = Math.min(Math.max(t, 0.0), 1.0);
  const h1 = Math.tanh(w11 * x1 + w12 * x2 + b1);
  const h2 = Math.tanh(w21 * x1 + w22 * x2 + b2);
  return {
    wx: (1.0 - alpha) * x1 + alpha * h1,
    wy: (1.0 - alpha) * x2 + alpha * h2,
  };
}
