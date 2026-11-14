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
  ParamDomainMode,
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
  'd_k',
  'd_v',
  'd_model',
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
  role: SymbolRole,
  restrictedBounds?: { min: number; max: number; step: number; defaultValue: number } | boolean
): { min: number; max: number; step: number; defaultValue: number } {
  const resolvedRestricted =
    typeof restrictedBounds === 'object' && restrictedBounds !== null
      ? restrictedBounds
      : restrictedBounds === true
        ? { min: 0.01, max: 10.0, step: 0.05, defaultValue: 1.0 }
        : undefined;

  const mergeWithRestricted = (base: {
    min: number;
    max: number;
    step: number;
    defaultValue: number;
  }): { min: number; max: number; step: number; defaultValue: number } => {
    if (!resolvedRestricted) return base;
    // If base heuristic range (e.g. L in [1, 10]) is completely above a unit domain [-1, 1],
    // fall back to the restricted domain instead of collapsing to a degenerate [1, 1] point.
    if (resolvedRestricted.max <= base.min) {
      return { ...resolvedRestricted };
    }
    const min = Math.max(base.min, resolvedRestricted.min);
    const max =
      resolvedRestricted.max <= 1.0 || resolvedRestricted.min < 0
        ? Math.max(min, Math.min(base.max, resolvedRestricted.max))
        : Math.max(min, base.max);
    const step =
      max - min <= 2.0 ? Math.min(base.step, resolvedRestricted.step) : base.step;
    let defaultValue = Math.min(Math.max(base.defaultValue, min), max);
    if (
      resolvedRestricted.max <= 1.0 &&
      (defaultValue <= min || defaultValue >= max) &&
      max > min
    ) {
      const mid = Math.round(((min + max) * 0.5) / step) * step;
      defaultValue = Math.min(Math.max(Number(mid.toFixed(4)), min), max);
    }
    return { min, max, step, defaultValue };
  };

  if (name === 'sigma') {
    return mergeWithRestricted({ min: 0.1, max: 5.0, step: 0.05, defaultValue: 1.0 });
  }
  if (name === 'eta' || name === 'lambda' || name === 'tau') {
    return mergeWithRestricted({
      min: 0.001,
      max: 2.0,
      step: 0.01,
      defaultValue: name === 'tau' ? 0.5 : 0.1,
    });
  }
  if (name === 'epsilon') {
    return mergeWithRestricted({ min: 0.0001, max: 1.0, step: 0.001, defaultValue: 0.01 });
  }
  if (name === 'd_k' || name === 'd_v' || name === 'd_model') {
    return mergeWithRestricted({ min: 0.5, max: 64.0, step: 0.5, defaultValue: 4.0 });
  }
  if (name === 'delta') {
    return mergeWithRestricted({ min: 0.05, max: 5.0, step: 0.05, defaultValue: 1.0 });
  }
  if (name === 'L') {
    return mergeWithRestricted({ min: 1, max: 10, step: 1, defaultValue: 4 });
  }
  if (name === 'alpha' || name === 'beta') {
    return mergeWithRestricted({
      min: 0.01,
      max: 5.0,
      step: 0.05,
      defaultValue: name === 'alpha' ? 0.2 : 1.0,
    });
  }
  if (name === 't') {
    return mergeWithRestricted({ min: 0, max: 1, step: 0.01, defaultValue: 1.0 });
  }
  if (name.startsWith('N_') || name === 'N' || name.startsWith('K_') || name === 'K') {
    return mergeWithRestricted({
      min: 1,
      max: 100,
      step: 1,
      defaultValue: name === 'K' || name.startsWith('K_') ? 3 : 10,
    });
  }
  if (name === 'TSS' || name.includes('ref') || name.includes('train') || name.includes('global')) {
    return mergeWithRestricted({ min: 0.1, max: 50.0, step: 0.1, defaultValue: 1.0 });
  }
  if (resolvedRestricted) {
    return resolvedRestricted;
  }
  if (role === 'hyperparam') {
    return { min: 0.01, max: 5.0, step: 0.05, defaultValue: 0.5 };
  }
  if (name.length > 1 && /^[A-Z]/.test(name)) {
    return { min: 0.01, max: 10.0, step: 0.05, defaultValue: 1.0 };
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
        paramConfigs: entry.paramConfigs,
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

const DEFAULT_POSITIVE_SCALAR_SYMBOLS = new Set([
  'sigma',
  'tau',
  'epsilon',
  'delta',
]);

export function classifyLatexExpression(
  rawLatex: string,
  overrides: Record<string, SymbolRole> = {},
  userFunctions?: UserFunctionRegistry,
  unlockedSymbols?: ReadonlySet<string>
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

  const sigMatchingFnDef = sigPreview
    ? Object.values(resolvedUserFunctions).find(
        (fn) =>
          fn.signature.name.toLowerCase() === sigPreview.name.toLowerCase() &&
          fn.paramConfigs !== undefined
      )
    : undefined;

  const effectiveUnlocked = new Set<string>(unlockedSymbols ?? []);
  for (const dimSym of ['d_k', 'd_v', 'd_model']) {
    const boundCfg =
      parsed.boundParamConfigs?.[dimSym]?.config ??
      sigMatchingFnDef?.paramConfigs?.[dimSym];
    if (boundCfg?.domainMode === 'free' || (!boundCfg && !effectiveUnlocked.has(dimSym))) {
      if (boundCfg?.domainMode !== 'positive') {
        effectiveUnlocked.add(dimSym);
      }
    }
  }
  if (parsed.boundParamConfigs) {
    for (const [symKey, info] of Object.entries(parsed.boundParamConfigs)) {
      if (info.config.domainMode === 'free') {
        effectiveUnlocked.add(symKey);
      }
    }
  }

  const stabilizedExpr = applyStabilityPass(parsed.expr, {
    unlockedSymbols: effectiveUnlocked,
  });
  const symbolMap = new Map<string, ClassifiedSymbol>();
  const formalParams = parsed.signature?.formalParams ?? [];
  const leadingFormalParam = formalParams[0];

  const domainRestrictedSymbols = new Map<
    string,
    { min: number; max: number; step: number; defaultValue: number }
  >();
  const POSITIVE_RESTRICTION = {
    min: 0.01,
    max: 10.0,
    step: 0.05,
    defaultValue: 1.0,
  };
  const UNIT_RESTRICTION = {
    min: -1.0,
    max: 1.0,
    step: 0.01,
    defaultValue: 0.0,
  };

  function mergeDomainRestriction(
    symbolName: string,
    incoming: { min: number; max: number; step: number; defaultValue: number }
  ): void {
    const existing = domainRestrictedSymbols.get(symbolName);
    if (!existing) {
      domainRestrictedSymbols.set(symbolName, { ...incoming });
      return;
    }
    const min = Math.max(existing.min, incoming.min);
    const max = Math.max(min, Math.min(existing.max, incoming.max));
    const step = Math.min(existing.step, incoming.step);
    let defaultValue = existing.defaultValue;
    if (
      defaultValue <= min ||
      defaultValue >= max ||
      incoming.defaultValue <= min ||
      incoming.defaultValue >= max
    ) {
      defaultValue = Math.round(((min + max) * 0.5) / step) * step;
      defaultValue = Math.min(Math.max(Number(defaultValue.toFixed(4)), min), max);
    }
    domainRestrictedSymbols.set(symbolName, { min, max, step, defaultValue });
  }

  function scanDomainRestrictions(node: MathJsonExpr): void {
    if (typeof node === 'number' || typeof node === 'string') return;
    if (Array.isArray(node)) {
      const head = node[0];
      if (head === 'Divide' && node.length >= 3) {
        const denLeaves = new Set<string>();
        collectLeafSymbols(node[2], denLeaves);
        for (const s of denLeaves) {
          mergeDomainRestriction(s, POSITIVE_RESTRICTION);
        }
      } else if (
        (head === 'Sqrt' ||
          head === 'Root' ||
          head === 'Ln' ||
          head === 'Log' ||
          head === 'Log2' ||
          head === 'Log10') &&
        node.length >= 2
      ) {
        const argLeaves = new Set<string>();
        collectLeafSymbols(node[1], argLeaves);
        for (const s of argLeaves) {
          mergeDomainRestriction(s, POSITIVE_RESTRICTION);
        }
      } else if (head === 'SafeXLogY' && node.length >= 3) {
        const argLeaves = new Set<string>();
        collectLeafSymbols(node[2], argLeaves);
        for (const s of argLeaves) {
          mergeDomainRestriction(s, POSITIVE_RESTRICTION);
        }
      } else if (head === 'Power' && node.length >= 3) {
        const exponent = node[2];
        const isNonIntegerExp =
          (typeof exponent === 'number' && !Number.isInteger(exponent)) ||
          (Array.isArray(exponent) && exponent[0] === 'Divide');
        if (isNonIntegerExp) {
          const baseLeaves = new Set<string>();
          collectLeafSymbols(node[1], baseLeaves);
          for (const s of baseLeaves) {
            mergeDomainRestriction(s, POSITIVE_RESTRICTION);
          }
        }
      } else if (
        (head === 'Arcsin' || head === 'Arccos' || head === 'Asin' || head === 'Acos') &&
        node.length >= 2
      ) {
        const argLeaves = new Set<string>();
        collectLeafSymbols(node[1], argLeaves);
        for (const s of argLeaves) {
          if (!DATA_VARS.has(s) && s !== leadingFormalParam && s !== 'x' && s !== 'y') {
            mergeDomainRestriction(s, UNIT_RESTRICTION);
          }
        }
      }
      for (let i = 1; i < node.length; i++) {
        scanDomainRestrictions(node[i]);
      }
    }
  }
  function collectLeafSymbols(node: MathJsonExpr, out: Set<string>): void {
    if (typeof node === 'string') {
      out.add(node);
      return;
    }
    if (Array.isArray(node)) {
      for (let i = 1; i < node.length; i++) {
        collectLeafSymbols(node[i], out);
      }
    }
  }
  scanDomainRestrictions(stabilizedExpr);

  function resolveBoundConfig(symName: string) {
    if (parsed.boundParamConfigs?.[symName]) {
      return parsed.boundParamConfigs[symName];
    }
    if (sigMatchingFnDef?.paramConfigs?.[symName]) {
      return {
        config: sigMatchingFnDef.paramConfigs[symName],
        sourceFn: sigMatchingFnDef.signature.name,
        formalParam: symName,
      };
    }
    return undefined;
  }

  function resolveDomainMeta(
    symName: string,
    boundInfo: ReturnType<typeof resolveBoundConfig>
  ): { domainMode: ParamDomainMode; domainSource?: string } {
    if (unlockedSymbols?.has(symName)) {
      return { domainMode: 'free' };
    }
    if (boundInfo?.config.domainMode !== undefined) {
      return {
        domainMode: boundInfo.config.domainMode,
        domainSource:
          boundInfo.config.domainMode !== 'free' ? boundInfo.sourceFn : undefined,
      };
    }
    if (DEFAULT_POSITIVE_SCALAR_SYMBOLS.has(symName)) {
      return {
        domainMode: 'positive',
        domainSource: SYMBOL_LATEX_MAP[symName] ?? symName,
      };
    }
    return { domainMode: 'free' };
  }

  function walk(node: MathJsonExpr): void {
    if (typeof node === 'number') return;
    if (typeof node === 'string') {
      const boundInfo = resolveBoundConfig(node);
      let role = classifySymbolRole(node, overrides);
      // If the expression defines a formal function f(t) = ... or Attention(Q, K, V) = ...,
      // the first formal parameter acts as the primary independent axis variable unless overridden
      if (!overrides[node] && leadingFormalParam && node === leadingFormalParam) {
        role = 'data_var';
      } else if (
        !overrides[node] &&
        role !== 'data_var' &&
        role !== 'constant' &&
        boundInfo?.config.role
      ) {
        role = boundInfo.config.role;
      }
      if (role !== 'constant' && !symbolMap.has(node)) {
        const bounds = getDefaultSliderBounds(
          node,
          role,
          domainRestrictedSymbols.get(node)
        );
        const cfg = boundInfo?.config;
        const defaultMin = cfg?.min ?? bounds.min;
        const defaultMax = cfg?.max ?? bounds.max;
        const defaultStep = cfg?.step ?? bounds.step;
        const defaultValue = cfg?.defaultValue ?? bounds.defaultValue;
        const { domainMode, domainSource } = resolveDomainMeta(node, boundInfo);
        const latexDisplay =
          parsed.tokenToLatexMap?.[node] ?? SYMBOL_LATEX_MAP[node] ?? node;
        symbolMap.set(node, {
          name: node,
          latex: latexDisplay,
          role,
          defaultMin,
          defaultMax,
          defaultStep,
          defaultValue,
          domainMode,
          domainSource,
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
      const boundInfo = resolveBoundConfig(sym.name);
      sym.role = boundInfo?.config.role ?? 'param';
      const bounds = getDefaultSliderBounds(
        sym.name,
        sym.role,
        domainRestrictedSymbols.get(sym.name)
      );
      const cfg = boundInfo?.config;
      sym.defaultMin = cfg?.min ?? bounds.min;
      sym.defaultMax = cfg?.max ?? bounds.max;
      sym.defaultStep = cfg?.step ?? bounds.step;
      sym.defaultValue = cfg?.defaultValue ?? bounds.defaultValue;
      const domainMeta = resolveDomainMeta(sym.name, boundInfo);
      sym.domainMode = domainMeta.domainMode;
      sym.domainSource = domainMeta.domainSource;
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
    calledFunctions: parsed.calledFunctions,
  };
}

