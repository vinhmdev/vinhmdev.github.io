/**
 * Core Mathematical & AST Types for GraphStudio.
 * Zero UI dependencies — shared across Main Thread and Compute Web Worker.
 */

/** Standard CortexJS / MathJSON prefix S-expression node. */
export type MathJsonExpr =
  | number
  | string
  | { num: string }
  | { sym: string }
  | [string, ...MathJsonExpr[]];

/**
 * 5 Symbol Groups defined in [FR-1.2]:
 * - 'constant'    : Group 1 — Locked constants (e, pi)
 * - 'primitive'   : Group 2 — Built-in math & ML functions (sin, sigmoid, relu, etc.)
 * - 'data_var'    : Group 3 — Data & axis variables (x, y, x_1, x_2)
 * - 'param'       : Group 4 — Tunable model parameters (w, w_1, w_2, b, theta, mu, sigma)
 * - 'hyperparam'  : Group 5 — Hyperparameters (eta, alpha, beta, lambda, gamma, delta, tau, L)
 */
export type SymbolRole = 'constant' | 'primitive' | 'data_var' | 'param' | 'hyperparam';

/**
 * Explicit domain guard mode for a parameter / slider:
 * - 'free'         : ℝ unconstrained (-∞, +∞) — user can freely set min <= 0 (e.g. -1)
 * - 'non_negative' : Non-negative (≥ 0, floor = 0)
 * - 'positive'     : Strictly positive (> 0, floor = 0.01 or custom > 0)
 */
export type ParamDomainMode = 'free' | 'non_negative' | 'positive';

export interface LibraryParamConfig {
  role?: 'param' | 'hyperparam';
  domainMode?: ParamDomainMode;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
}

export interface ClassifiedSymbol {
  name: string;
  latex: string;
  role: SymbolRole;
  defaultMin: number;
  defaultMax: number;
  defaultStep: number;
  defaultValue: number;
  domainMode?: ParamDomainMode;
  domainSource?: string;
}

export interface FunctionSignature {
  /** Canonical function name (e.g. 'f', 'Attention', 'SwiGLU') */
  name: string;
  /** Ordered formal parameter names (e.g. ['Q', 'K', 'V'] or ['t']) */
  formalParams: string[];
  /** Raw left-hand side label (e.g. 'Attention(Q, K, V)') */
  rawHeader: string;
}

export interface UserFunctionDef {
  signature: FunctionSignature;
  /** Stabilized or raw MathJSON AST body of the function */
  bodyExpr: MathJsonExpr;
  /** Default AST values for optional trailing formal parameters when omitted at call site */
  defaultArgs?: Record<string, MathJsonExpr>;
  /** Explicit parameter setup (role, domain constraint, default slider bounds) */
  paramConfigs?: Record<string, LibraryParamConfig>;
  /** Source expression item id or 'library' */
  sourceExprId: string;
  /** Original LaTeX string */
  rawLatex: string;
}

export type UserFunctionRegistry = Record<string, UserFunctionDef>;

export interface LibraryFunctionEntry {
  id: string;
  name: string;
  signature: string;
  /** Pure mathematical formula definition `Name(p1, p2, ...) = ...` */
  definitionLatex: string;
  /** Example expression to insert onto the canvas */
  exampleCallLatex: string;
  /** Default AST expressions for omitted trailing arguments */
  defaultArgs?: Record<string, MathJsonExpr>;
  /** Explicit per-parameter setup (role, domain constraint, default slider bounds) */
  paramConfigs?: Record<string, LibraryParamConfig>;
  category: 'transformer' | 'activation' | 'normalization' | 'custom';
  description: string;
  enabled: boolean;
  isBuiltin?: boolean;
}

export interface ClassifiedAST {
  rawLatex: string;
  valid: boolean;
  errorMessage?: string;
  errorOffset?: number;
  expr: MathJsonExpr;
  stabilizedExpr: MathJsonExpr;
  symbols: ClassifiedSymbol[];
  primaryVar: string;
  isImplicitRelation: boolean;
  /** Extracted formal function signature if defined as `fn(p1, p2, ...) = ...` */
  signature?: FunctionSignature;
  /** Names of user/library functions directly invoked in this expression */
  calledFunctions?: string[];
}

/**
 * Clarke Subdifferential convention at kink u = 0 [FR-2.1]:
 * - 'zero'      : H(0) = 0, sign(0) = 0 (PyTorch/JAX training convention, preserves L1 sparsity)
 * - 'symmetric' : H(0) = 0.5, sign(0) = 0 (Geometric symmetric convention)
 */
export type SubgradConvention = 'zero' | 'symmetric';

/**
 * Order-2 Hyper-Dual Number (Jet2) with Piecewise Branch & Discontinuity Bitmasks [FR-3.2, FR-3.3].
 * Used for zero-heap scalar register codegen and exact kink/asymptote detection.
 */
export interface Jet2Tuple {
  /** Function value f(x) */
  v: number;
  /** First derivative f'(x) */
  d1: number;
  /** Second derivative f''(x) */
  d2: number;
  /** Bitmask flipped on continuous piecewise branches (relu, abs, huber, hinge, max, min) */
  branchMask: number;
  /** Bitmask flipped on jump discontinuities (heaviside, sign, floor, ceil) */
  discMask: number;
}

/**
 * Tupper-style Interval Arithmetic bound (val, def, cont) [FR-3.2].
 */
export interface IntervalBound {
  lo: number;
  hi: number;
  /** True if the expression is defined everywhere or partially on the interval */
  def: boolean;
  /** True if the expression is guaranteed continuous across the interval */
  cont: boolean;
}

/**
 * Point of Interest (POI) categories extracted via Jet2 + Brent's Method (< 10^-12) [FR-3.3].
 */
export type PoiKind = 'root' | 'y_intercept' | 'extremum' | 'inflection' | 'kink';

export interface PointOfInterest {
  kind: PoiKind;
  x: number;
  y: number;
  label: string;
  /** For kinks, the subdifferential slope interval [leftSlope, rightSlope] [FR-2.2] */
  subdiffInterval?: [number, number];
}

