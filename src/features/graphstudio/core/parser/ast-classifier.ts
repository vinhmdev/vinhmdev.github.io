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
  LibraryFunctionEntry,
  MathJsonExpr,
  SymbolRole,
  UserFunctionRegistry,
} from '../../types/math';
import {
  DEFAULT_FUNCTION_LIBRARY,
  extractFunctionSignature,
  parseLatexToMathJson,
} from './cortex-setup';
import { applyStabilityPass } from './stability-pass';

const LOCKED_CONSTANTS = new Set(['ExponentialE', 'Pi', 'e', 'pi']);

const DATA_VARS = new Set(['x', 'y', 'x_1', 'x_2', 'r']);

const MODEL_PARAMS = new Set([
  'w',
  'w_1',
  'w_2',
  'w_3',
  'b',
  'theta',
  'mu',
  'sigma',
  'z_1',
  'z_2',
  'z_3',
  'Q',
  'K',
  'V',
  'W',
  'd_k',
  'd_v',
  'd_model',
]);

const HYPERPARAMS = new Set([
  'eta',
  'alpha',
  'beta',
  'lambda',
  'gamma',
  'delta',
  'tau',
  'epsilon',
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
  epsilon: '\\epsilon',
  x_1: 'x_1',
  x_2: 'x_2',
  w_1: 'w_1',
  w_2: 'w_2',
  w_3: 'w_3',
  z_1: 'z_1',
  z_2: 'z_2',
  z_3: 'z_3',
  d_k: 'd_k',
  d_v: 'd_v',
  d_model: 'd_{model}',
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
  if (name === 'epsilon') {
    return { min: 0.0001, max: 1.0, step: 0.001, defaultValue: 0.01 };
  }
  if (name === 'd_k' || name === 'd_v' || name === 'd_model') {
    return { min: 0.5, max: 64.0, step: 0.5, defaultValue: 4.0 };
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
    defaultValue: name === 'b' || name === 'c' ? 0.0 : 1.0,
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

function deleteFnCaseInsensitive(
  reg: UserFunctionRegistry,
  targetName: string
): void {
  const lower = targetName.toLowerCase();
  for (const k of Object.keys(reg)) {
    if (k.toLowerCase() === lower) {
      delete reg[k];
    }
  }
}

function rhsReferencesFunction(rawLatex: string, targetFnLower: string): boolean {
  const eqIdx = rawLatex.indexOf('=');
  const rhs = eqIdx >= 0 ? rawLatex.slice(eqIdx + 1) : rawLatex;
  const re = new RegExp(`\\b${targetFnLower}\\s*\\(`, 'i');
  return re.test(rhs);
}

/**
 * Builds a UserFunctionRegistry from enabled Function Library entries
 * followed by any formal function definitions (`fn(p1, p2, ...) = body`) in expressions.
 * Supports multi-pass forward references (e.g. `f(x) = g(x) + 1` above `g(x) = 2x`)
 * and rejects direct or mutual recursion cycles (`f(x) = g(x)`, `g(x) = f(x)`).
 */
export function buildUserFunctionRegistry(
  expressions?: ReadonlyArray<{ id?: string; latex: string }>,
  functionLibrary?: ReadonlyArray<LibraryFunctionEntry>
): UserFunctionRegistry {
  const registry: UserFunctionRegistry = {};
  const libraryEntries = functionLibrary ?? DEFAULT_FUNCTION_LIBRARY;

  for (const entry of libraryEntries) {
    if (!entry.enabled || !entry.definitionLatex.trim()) continue;
    const sigCheck = extractFunctionSignature(entry.definitionLatex);
    if (!sigCheck || sigCheck.formalParams.length === 0) continue;
    const fnName = sigCheck.name;
    const registryWithoutSelf = { ...registry };
    deleteFnCaseInsensitive(registryWithoutSelf, fnName);
    const parsed = parseLatexToMathJson(entry.definitionLatex, {
      userFunctions: registryWithoutSelf,
      extraAllowedSymbols: sigCheck.formalParams,
    });
    if (parsed.valid) {
      registry[fnName] = {
        signature: sigCheck,
        bodyExpr: parsed.expr,
        rawLatex: entry.definitionLatex,
        defaultArgs: entry.defaultArgs,
        sourceExprId: entry.id,
      };
    }
  }

  if (expressions && expressions.length > 0) {
    const candidates: {
      id: string;
      latex: string;
      sig: NonNullable<ReturnType<typeof extractFunctionSignature>>;
      lowerName: string;
    }[] = [];

    for (const item of expressions) {
      if (!item.latex || !item.latex.trim()) continue;
      const sigCheck = extractFunctionSignature(item.latex);
      if (!sigCheck || sigCheck.formalParams.length === 0) continue;
      candidates.push({
        id: item.id ?? 'expr',
        latex: item.latex,
        sig: sigCheck,
        lowerName: sigCheck.name.toLowerCase(),
      });
    }

    // Build direct dependency graph among candidate worksheet functions to detect mutual recursion cycles
    const directDeps = new Map<string, Set<string>>();
    for (const c of candidates) {
      const deps = new Set<string>();
      for (const other of candidates) {
        if (rhsReferencesFunction(c.latex, other.lowerName)) {
          deps.add(other.lowerName);
        }
      }
      directDeps.set(c.lowerName, deps);
    }

    const canReach = (fromLower: string, targetLower: string): boolean => {
      const visited = new Set<string>();
      const stack = [...(directDeps.get(fromLower) ?? [])];
      while (stack.length > 0) {
        const curr = stack.pop()!;
        if (curr === targetLower) return true;
        if (visited.has(curr)) continue;
        visited.add(curr);
        const nexts = directDeps.get(curr);
        if (nexts) {
          for (const n of nexts) stack.push(n);
        }
      }
      return false;
    };

    const cyclicNames = new Set<string>();
    for (const c of candidates) {
      if (canReach(c.lowerName, c.lowerName)) {
        cyclicNames.add(c.lowerName);
      }
    }
    if (cyclicNames.size > 0) {
      Object.defineProperty(registry, '__cyclicNames', {
        value: cyclicNames,
        enumerable: false,
        configurable: true,
      });
    }

    const maxPasses = Math.min(Math.max(candidates.length, 1), 8);
    for (let pass = 0; pass < maxPasses; pass++) {
      let changed = false;
      for (const c of candidates) {
        // Reject any function involved in a direct or multi-hop recursion cycle
        if (cyclicNames.has(c.lowerName)) {
          deleteFnCaseInsensitive(registry, c.sig.name);
          continue;
        }
        const registryForFn = { ...registry };
        deleteFnCaseInsensitive(registryForFn, c.sig.name);
        // Also exclude any function that transitively depends on c
        for (const other of candidates) {
          if (canReach(other.lowerName, c.lowerName)) {
            deleteFnCaseInsensitive(registryForFn, other.sig.name);
          }
        }
        const parsed = parseLatexToMathJson(c.latex, {
          userFunctions: registryForFn,
          extraAllowedSymbols: c.sig.formalParams,
        });
        if (parsed.valid) {
          const prevJson = registry[c.sig.name]
            ? JSON.stringify(registry[c.sig.name].bodyExpr)
            : '';
          const nextJson = JSON.stringify(parsed.expr);
          if (prevJson !== nextJson) {
            changed = true;
          }
          deleteFnCaseInsensitive(registry, c.sig.name);
          registry[c.sig.name] = {
            signature: c.sig,
            bodyExpr: parsed.expr,
            rawLatex: c.latex,
            sourceExprId: c.id,
          };
        }
      }
      if (!changed) break;
    }
  }

  return registry;
}

let cachedDefaultRegistry: UserFunctionRegistry | null = null;
function getDefaultUserFunctionRegistry(): UserFunctionRegistry {
  if (!cachedDefaultRegistry) {
    cachedDefaultRegistry = buildUserFunctionRegistry(undefined, DEFAULT_FUNCTION_LIBRARY);
  }
  return cachedDefaultRegistry;
}

export function classifyLatexExpression(
  rawLatex: string,
  overrides: Record<string, SymbolRole> = {},
  userFunctions?: UserFunctionRegistry
): ClassifiedAST {
  const resolvedUserFunctions = userFunctions ?? getDefaultUserFunctionRegistry();
  const sigPreview = extractFunctionSignature(rawLatex);
  const cyclicSet = (resolvedUserFunctions as unknown as { __cyclicNames?: Set<string> })
    .__cyclicNames;

  if (
    sigPreview &&
    (rhsReferencesFunction(rawLatex, sigPreview.name.toLowerCase()) ||
      cyclicSet?.has(sigPreview.name.toLowerCase()))
  ) {
    return {
      rawLatex,
      valid: false,
      errorMessage: `Recursive or cyclic function definition: '${sigPreview.name}'`,
      expr: 0,
      stabilizedExpr: 0,
      symbols: [],
      primaryVar: 'x',
      isImplicitRelation: false,
      signature: sigPreview,
    };
  }

  let parseFunctions = resolvedUserFunctions;
  if (sigPreview) {
    parseFunctions = { ...resolvedUserFunctions };
    deleteFnCaseInsensitive(parseFunctions, sigPreview.name);
  }

  const parsed = parseLatexToMathJson(rawLatex, {
    userFunctions: parseFunctions,
  });
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
      signature: parsed.signature,
    };
  }

  const stabilizedExpr = applyStabilityPass(parsed.expr);
  const symbolMap = new Map<string, ClassifiedSymbol>();
  const formalParams = parsed.signature?.formalParams ?? [];
  const leadingFormalParam = formalParams[0];

  function walk(node: MathJsonExpr): void {
    if (typeof node === 'number') return;
    if (typeof node === 'string') {
      let role = classifySymbolRole(node, overrides);
      // If the expression defines a formal function f(t) = ... or Attention(Q, K, V) = ...,
      // the first formal parameter acts as the primary independent axis variable unless overridden
      if (!overrides[node] && leadingFormalParam && node === leadingFormalParam) {
        role = 'data_var';
      }
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
  const formalDataVar = leadingFormalParam
    ? dataVars.find((s) => s.name === leadingFormalParam)
    : undefined;
  const primaryVar =
    overriddenDataVar?.name ??
    formalDataVar?.name ??
    dataVars.find((s) => s.name === 'x')?.name ??
    dataVars[0]?.name ??
    leadingFormalParam ??
    'x';

  // Any secondary data_var that is NOT the primary plot variable (e.g. y in f(x, y) = x + y)
  // is demoted to 'param' (unless explicitly overridden as 'data_var') so it receives a slider
  for (const sym of symbols) {
    if (
      sym.role === 'data_var' &&
      sym.name !== primaryVar &&
      overrides[sym.name] !== 'data_var'
    ) {
      sym.role = 'param';
      const bounds = getDefaultSliderBounds(sym.name, 'param');
      sym.defaultMin = bounds.min;
      sym.defaultMax = bounds.max;
      sym.defaultStep = bounds.step;
      sym.defaultValue = bounds.defaultValue;
    }
  }

  return {
    rawLatex,
    valid: true,
    expr: parsed.expr,
    stabilizedExpr,
    symbols,
    primaryVar,
    isImplicitRelation: false,
    signature: parsed.signature,
  };
}

