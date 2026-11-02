/**
 * 5-Group AST Symbol Classifier & Call-Site Disambiguator [FR-1.2, FR-1.3, FR-1.4].
 *
 * Classifies all symbols in a MathJSON AST into the 5 semantic groups:
 * 1. 'constant'   : ExponentialE (e), Pi (\pi)
 * 2. 'primitive'  : Built-in functions at call head [fnName, ...args]
 * 3. 'data_var'   : Data/Axis variables (x, y, x_1, x_2)
 * 4. 'param'      : Tunable model parameters (w, w_1, w_2, b, theta, mu, sigma, z_1..z_3)
 * 5. 'hyperparam' : Hyperparameters (eta, alpha, beta, lambda, gamma, delta, tau, L)
 *
 * Includes Call-Site Arity Disambiguation:
 * - `\sigma(u)` at head of S-expression -> Group 2 ('primitive', Sigmoid)
 * - `\sigma` as scalar operand          -> Group 4 ('param', domain [0.1, 5.0])
 * - `\delta(u)` at head of S-expression -> Group 2 ('primitive', DiracDelta)
 * - `\delta` as scalar operand          -> Group 5 ('hyperparam', domain [0.05, 5.0])
 */
import type {
  ClassifiedAST,
  ClassifiedSymbol,
  MathJsonExpr,
  SymbolRole,
} from '../../types/math';
import { parseLatexToMathJson } from './cortex-setup';
import { applyStabilityPass } from './stability-pass';

const LOCKED_CONSTANTS = new Set(['ExponentialE', 'Pi', 'e', 'pi']);

const DATA_VARS = new Set(['x', 'y', 'x_1', 'x_2', 'r']);

const MODEL_PARAMS = new Set(['w', 'w_1', 'w_2', 'b', 'theta', 'mu', 'sigma', 'z_1', 'z_2', 'z_3']);

const HYPERPARAMS = new Set([
  'eta',
  'alpha',
  'beta',
  'lambda',
  'gamma',
  'delta',
  'tau',
  'L',
  'k',
  'n',
  't',
]);

const SYMBOL_LATEX_MAP: Record<string, string> = {
  ExponentialE: 'e',
  Pi: '\\pi',
  theta: '\\theta',
  mu: '\\mu',
  sigma: '\\sigma',
  eta: '\\eta',
  alpha: '\\alpha',
  beta: '\\beta',
  lambda: '\\lambda',
  gamma: '\\gamma',
  delta: '\\delta',
  tau: '\\tau',
  x_1: 'x_1',
  x_2: 'x_2',
  w_1: 'w_1',
  w_2: 'w_2',
  z_1: 'z_1',
  z_2: 'z_2',
  z_3: 'z_3',
};

export function getDefaultSliderBounds(
  name: string,
  role: SymbolRole
): { min: number; max: number; step: number; defaultValue: number } {
  if (name === 'sigma') {
    return { min: 0.1, max: 5.0, step: 0.05, defaultValue: 1.0 };
  }
  if (name === 'eta' || name === 'lambda' || name === 'tau') {
    return { min: 0.001, max: 2.0, step: 0.01, defaultValue: name === 'tau' ? 0.5 : 0.1 };
  }
  if (name === 'delta') {
    return { min: 0.05, max: 5.0, step: 0.05, defaultValue: 1.0 };
  }
  if (name === 'L') {
    return { min: 1, max: 10, step: 1, defaultValue: 4 };
  }
  if (name === 'alpha' || name === 'beta') {
    return { min: 0.01, max: 5.0, step: 0.05, defaultValue: name === 'alpha' ? 0.2 : 1.0 };
  }
  if (name === 't') {
    return { min: 0, max: 1, step: 0.01, defaultValue: 1.0 };
  }
  if (role === 'hyperparam') {
    return { min: 0.01, max: 5.0, step: 0.05, defaultValue: 0.5 };
  }
  return {
    min: -5.0,
    max: 5.0,
    step: 0.05,
    defaultValue: name === 'b' ? 0.0 : 1.0,
  };
}

export function classifySymbolRole(
  name: string,
  overrides: Record<string, SymbolRole> = {}
): SymbolRole {
  if (LOCKED_CONSTANTS.has(name)) return 'constant';
  if (overrides[name]) return overrides[name];
  if (DATA_VARS.has(name)) return 'data_var';
  if (MODEL_PARAMS.has(name)) return 'param';
  if (HYPERPARAMS.has(name)) return 'hyperparam';
  // Default unknown single letters to tunable parameter
  return 'param';
}

export function classifyLatexExpression(
  rawLatex: string,
  overrides: Record<string, SymbolRole> = {}
): ClassifiedAST {
  const parsed = parseLatexToMathJson(rawLatex);
  if (!parsed.valid) {
    return {
      rawLatex,
      valid: false,
      errorMessage: parsed.errorMessage,
      errorOffset: parsed.errorOffset,
      expr: 0,
      stabilizedExpr: 0,
      symbols: [],
      primaryVar: 'x',
      isImplicitRelation: false,
    };
  }

  const stabilizedExpr = applyStabilityPass(parsed.expr);
  const symbolMap = new Map<string, ClassifiedSymbol>();

  function walk(node: MathJsonExpr): void {
    if (typeof node === 'number') return;
    if (typeof node === 'string') {
      const role = classifySymbolRole(node, overrides);
      if (role !== 'constant' && !symbolMap.has(node)) {
        const bounds = getDefaultSliderBounds(node, role);
        symbolMap.set(node, {
          name: node,
          latex: SYMBOL_LATEX_MAP[node] ?? node,
          role,
          defaultMin: bounds.min,
          defaultMax: bounds.max,
          defaultStep: bounds.step,
          defaultValue: bounds.defaultValue,
        });
      }
      return;
    }
    if (Array.isArray(node)) {
      // node[0] is a Group 2 function primitive head — only walk arguments node.slice(1)
      for (let i = 1; i < node.length; i++) {
        walk(node[i]);
      }
    }
  }

  walk(stabilizedExpr);

  const symbols = Array.from(symbolMap.values());
  const dataVars = symbols.filter((s) => s.role === 'data_var');
  const overriddenDataVar = dataVars.find((s) => overrides[s.name] === 'data_var');
  const primaryVar =
    overriddenDataVar?.name ??
    dataVars.find((s) => s.name === 'x')?.name ??
    dataVars[0]?.name ??
    'x';

  return {
    rawLatex,
    valid: true,
    expr: parsed.expr,
    stabilizedExpr,
    symbols,
    primaryVar,
    isImplicitRelation: false,
  };
}
