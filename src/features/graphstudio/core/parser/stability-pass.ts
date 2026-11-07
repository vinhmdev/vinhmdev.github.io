/**
 * IEEE 754 Pre-Differentiation Numerical Stability Pass [FR-2.4, AC-02].
 *
 * Scans and transforms MathJSON S-expressions BEFORE symbolic differentiation
 * and JIT compilation to prevent catastrophic overflow (`Infinity - Infinity = NaN`
 * or `0 * -Infinity = NaN`) across extreme logit domains (|z| up to 1000+):
 *
 * 1. `1 / (1 + exp(-z))` or `Sigmoid(z)` -> `["SafeSigmoid", z]`
 * 2. `ln(1 + exp(z))` or `Softplus(z)`   -> `["SafeSoftplus", z]`
 * 3. `-y * ln(sigmoid(z)) - (1 - y) * ln(1 - sigmoid(z))` or `BCE(y, Sigmoid(z))`
 *    -> `["BCEWithLogits", y, z]`
 * 4. `Softmax(...)`                      -> `["SafeSoftmax", ...]` (LogSumExp shift)
 * 5. `x * ln(y)`                         -> `["SafeXLogY", x, y]` (0 when x === 0)
 */
import type { MathJsonExpr } from '../../types/math';

export function applyStabilityPass(expr: MathJsonExpr): MathJsonExpr {
  if (typeof expr === 'number' || typeof expr === 'string') {
    return expr;
  }
  if (!Array.isArray(expr)) {
    if ('num' in expr) return Number(expr.num);
    if ('sym' in expr) return expr.sym;
    return 0;
  }

  const [head, ...rawArgs] = expr;
  const args = rawArgs.map(applyStabilityPass);

  // Rule 1: Explicit Sigmoid -> SafeSigmoid
  if (head === 'Sigmoid' && args.length === 1) {
    return ['SafeSigmoid', args[0]];
  }

  // Rule 2: Explicit Softplus -> SafeSoftplus
  if (head === 'Softplus' && args.length === 1) {
    return ['SafeSoftplus', args[0]];
  }

  // Rule 3: Explicit Softmax -> SafeSigmoid (when unary 1D attention gate) or SafeSoftmax (multi-arg simplex)
  if (head === 'Softmax') {
    if (args.length === 1) {
      return ['SafeSigmoid', args[0]];
    }
    return ['SafeSoftmax', ...args];
  }

  // Rule 4: Explicit BCE(y, SafeSigmoid(z)) -> BCEWithLogits(y, z)
  if (head === 'BCE' && args.length === 2) {
    const [yArg, pArg] = args;
    const zInner = extractSigmoidArg(pArg);
    if (zInner !== null) {
      return ['BCEWithLogits', yArg, zInner];
    }
  }

  // Rule 1b: Quotient pattern 1 / (1 + exp(-z)) -> SafeSigmoid(z)
  if (head === 'Divide' && args.length === 2 && args[0] === 1) {
    const zFromQuotient = matchOnePlusExpNeg(args[1]);
    if (zFromQuotient !== null) {
      return ['SafeSigmoid', zFromQuotient];
    }
  }

  // Rule 2b: Logarithmic pattern ln(1 + exp(z)) -> SafeSoftplus(z)
  if (head === 'Ln' && args.length === 1) {
    const zFromSoftplus = matchOnePlusExp(args[0]);
    if (zFromSoftplus !== null) {
      return ['SafeSoftplus', zFromSoftplus];
    }
  }

  // Rule 3b: Expanded Binary Cross-Entropy pattern:
  // -y * ln(sigma(z)) - (1 - y) * ln(1 - sigma(z)) -> BCEWithLogits(y, z)
  if (head === 'Subtract' && args.length === 2) {
    const bceMatch = matchExpandedBCE(args[0], args[1]);
    if (bceMatch !== null) {
      return ['BCEWithLogits', bceMatch.y, bceMatch.z];
    }
  }

  // Rule 5: x * ln(y) -> SafeXLogY(x, y)
  if (head === 'Multiply' && args.length === 2) {
    if (Array.isArray(args[1]) && args[1][0] === 'Ln' && args[1].length === 2) {
      return ['SafeXLogY', args[0], args[1][1]];
    }
    if (Array.isArray(args[0]) && args[0][0] === 'Ln' && args[0].length === 2) {
      return ['SafeXLogY', args[1], args[0][1]];
    }
  }

  return [head, ...args];
}

function extractSigmoidArg(node: MathJsonExpr): MathJsonExpr | null {
  if (Array.isArray(node) && (node[0] === 'SafeSigmoid' || node[0] === 'Sigmoid') && node.length === 2) {
    return node[1];
  }
  return null;
}

/** Matches `1 + exp(-z)` and returns `z` */
function matchOnePlusExpNeg(node: MathJsonExpr): MathJsonExpr | null {
  if (!Array.isArray(node) || node[0] !== 'Add' || node.length !== 3) return null;
  const expPart = node[1] === 1 ? node[2] : node[2] === 1 ? node[1] : null;
  if (!expPart || !Array.isArray(expPart) || expPart[0] !== 'Exp' || expPart.length !== 2) {
    return null;
  }
  return negateExpr(expPart[1]);
}

/** Matches `1 + exp(z)` and returns `z` */
function matchOnePlusExp(node: MathJsonExpr): MathJsonExpr | null {
  if (!Array.isArray(node) || node[0] !== 'Add' || node.length !== 3) return null;
  const expPart = node[1] === 1 ? node[2] : node[2] === 1 ? node[1] : null;
  if (!expPart || !Array.isArray(expPart) || expPart[0] !== 'Exp' || expPart.length !== 2) {
    return null;
  }
  return expPart[1];
}

function negateExpr(e: MathJsonExpr): MathJsonExpr {
  if (typeof e === 'number') return -e;
  if (Array.isArray(e) && e[0] === 'Negate' && e.length === 2) return e[1];
  if (Array.isArray(e) && e[0] === 'Subtract' && e.length === 3) {
    // -( -a - b ) -> a + b
    if (Array.isArray(e[1]) && e[1][0] === 'Negate' && e[1].length === 2) {
      return ['Add', e[1][1], e[2]];
    }
    return ['Subtract', e[2], e[1]];
  }
  return ['Negate', e];
}

function matchExpandedBCE(
  left: MathJsonExpr,
  right: MathJsonExpr
): { y: MathJsonExpr; z: MathJsonExpr } | null {
  // Check if left is Negate(Multiply(y, Ln(SafeSigmoid(z)))) or SafeXLogY(-y, SafeSigmoid(z))
  const leftTerm = extractNegYLogSig(left);
  if (!leftTerm) return null;

  // Check if right is (1 - y) * ln(1 - SafeSigmoid(z)) or SafeXLogY(1 - y, 1 - SafeSigmoid(z))
  const rightTerm = extractOneMinusYLogOneMinusSig(right);
  if (!rightTerm) return null;

  if ( JSON.stringify(leftTerm.y) === JSON.stringify(rightTerm.y) &&
       JSON.stringify(leftTerm.z) === JSON.stringify(rightTerm.z) ) {
    return leftTerm;
  }
  return null;
}

function extractNegYLogSig(node: MathJsonExpr): { y: MathJsonExpr; z: MathJsonExpr } | null {
  if (!Array.isArray(node)) return null;
  if (node[0] === 'Negate' && node.length === 2 && Array.isArray(node[1])) {
    const inner = node[1];
    if (inner[0] === 'SafeXLogY' && inner.length === 3) {
      const z = extractSigmoidArg(inner[2]);
      if (z !== null) return { y: inner[1], z };
    }
  }
  if (node[0] === 'SafeXLogY' && node.length === 3) {
    if (Array.isArray(node[1]) && node[1][0] === 'Negate' && node[1].length === 2) {
      const z = extractSigmoidArg(node[2]);
      if (z !== null) return { y: node[1][1], z };
    }
  }
  return null;
}

function extractOneMinusYLogOneMinusSig(
  node: MathJsonExpr
): { y: MathJsonExpr; z: MathJsonExpr } | null {
  if (!Array.isArray(node)) return null;
  if (node[0] === 'SafeXLogY' && node.length === 3) {
    const [, oneMinusY, oneMinusSig] = node;
    if (
      Array.isArray(oneMinusY) &&
      oneMinusY[0] === 'Subtract' &&
      oneMinusY[1] === 1 &&
      Array.isArray(oneMinusSig) &&
      oneMinusSig[0] === 'Subtract' &&
      oneMinusSig[1] === 1
    ) {
      const z = extractSigmoidArg(oneMinusSig[2]);
      if (z !== null) return { y: oneMinusY[2], z };
    }
  }
  return null;
}
