/**
 * CortexJS ComputeEngine Singleton & ML MathJSON Parser [FR-1.1, FR-1.2].
 *
 * Combines @cortex-js/compute-engine with a deterministic ML LaTeX/ASCII
 * tokenizer & recursive-descent normalizer so that both standard LaTeX
 * (`\frac{1}{1 + e^{-wx - b}}`, `\sigma(w \cdot x + b)`, `\text{relu}(x)`)
 * and plain ASCII (`1 / (1 + exp(-w * x - b))`, `abs(x - 2)`) always produce
 * canonical, un-evaluated MathJSON S-expressions suitable for symbolic
 * differentiation, stability rewriting, and zero-heap JIT compilation.
 */
import { ComputeEngine } from '@cortex-js/compute-engine';
import { getRegisteredMathFunction } from '../../extensions/contracts';
import {
  expandBigOperatorCall,
  isBigOperatorHead,
  rewriteBigOperators,
} from './big-operators';
import type {
  FunctionSignature,
  LibraryFunctionEntry,
  LibraryParamConfig,
  MathJsonExpr,
  UserFunctionDef,
  UserFunctionRegistry,
} from '../../types/math';

let ceInstance: ComputeEngine | null = null;

export function getComputeEngine(): ComputeEngine {
  if (!ceInstance) {
    ceInstance = new ComputeEngine();
  }
  return ceInstance;
}

/**
 * Canonical mapping from core primitive function names (case-insensitive) to AST heads.
 * Note: Higher-level composite functions like Attention, SwiGLU, GeGLU, LayerNorm, RMSNorm, RoPE
 * are NOT hardcoded syntax here — they live in the pure mathematical Function Library
 * (`DEFAULT_FUNCTION_LIBRARY`) where users can toggle them ON/OFF, inspect their formula, or edit them!
 */
export const ML_FUNCTION_HEADS: Record<string, string> = {
  sin: 'Sin',
  cos: 'Cos',
  tan: 'Tan',
  cot: 'Cot',
  sec: 'Sec',
  csc: 'Csc',
  asin: 'Asin',
  arcsin: 'Asin',
  acos: 'Acos',
  arccos: 'Acos',
  atan: 'Atan',
  arctan: 'Atan',
  sinh: 'Sinh',
  cosh: 'Cosh',
  sinc: 'Sinc',
  exp: 'Exp',
  ln: 'Ln',
  log: 'Ln',
  log10: 'Log10',
  log2: 'Log2',
  sqrt: 'Sqrt',
  cbrt: 'Cbrt',
  abs: 'Abs',
  sign: 'Sign',
  sgn: 'Sign',
  max: 'Max',
  min: 'Min',
  erf: 'Erf',
  gamma: 'Gamma',
  lgamma: 'Lgamma',
  digamma: 'Digamma',
  trigamma: 'Trigamma',
  betapdf: 'BetaPdf',
  beta_pdf: 'BetaPdf',
  sigmoid: 'Sigmoid',
  sigma: 'Sigmoid',
  relu: 'ReLU',
  leaky_relu: 'LeakyReLU',
  leakyrelu: 'LeakyReLU',
  elu: 'ELU',
  tanh: 'Tanh',
  swish: 'Swish',
  silu: 'Swish',
  gelu: 'GELU',
  geluderiv1: 'GELUDeriv1',
  geluderiv2: 'GELUDeriv2',
  softplus: 'Softplus',
  softmax: 'Softmax',
  huber: 'Huber',
  hinge: 'Hinge',
  bce: 'BCE',
  bce_logits: 'BCEWithLogits',
  bcewithlogits: 'BCEWithLogits',
  heaviside: 'Heaviside',
  step: 'Heaviside',
  H: 'Heaviside',
  dirac: 'DiracDelta',
  delta: 'DiracDelta',
  floor: 'Floor',
  ceil: 'Ceil',
  safesigmoid: 'SafeSigmoid',
  safesoftplus: 'SafeSoftplus',
  safesoftmax: 'SafeSoftmax',
  safexlogy: 'SafeXLogY',
  // Finite big operators: unrolled at parse time by expandBigOperatorCall (never reach the JIT).
  sum: 'Sum',
  prod: 'Product',
  product: 'Product',
};

/**
 * Default Library of Pure Mathematical Function Definitions.
 * Each entry is a standard mathematical formula `Name(p1, p2, ...) = ...` that can be
 * toggled ON/OFF by the user in the Function Library Drawer, inspected, or customized.
 */
export const DEFAULT_FUNCTION_LIBRARY: LibraryFunctionEntry[] = [
  {
    id: 'lib-attention',
    name: 'Attention',
    signature: 'Attention(Q, K, V, d_k)',
    definitionLatex:
      'Attention(Q, K, V, d_k) = \\operatorname{softmax}\\left(\\frac{Q \\cdot K^T}{\\sqrt{d_k}}\\right) \\cdot V',
    exampleCallLatex: 'Attention(x, K, V, d_k)',
    defaultArgs: { d_k: 'd_k' },
    paramConfigs: {
      K: { role: 'param', domainMode: 'free', min: 1, max: 100, step: 1, defaultValue: 3 },
      V: { role: 'param', domainMode: 'free', min: -5, max: 5, step: 0.05, defaultValue: 1 },
      d_k: {
        role: 'hyperparam',
        domainMode: 'positive',
        min: 0.5,
        max: 64,
        step: 0.5,
        defaultValue: 4,
      },
    },
    category: 'transformer',
    description:
      'Scaled Dot-Product Attention (Vaswani et al.): pure mathematical composition of softmax((Q·K)/√d_k)·V',
    enabled: true,
    isBuiltin: true,
  },
  {
    id: 'lib-swiglu',
    name: 'SwiGLU',
    signature: 'SwiGLU(x, w_1, w_2, b, c)',
    definitionLatex:
      'SwiGLU(x, w_1, w_2, b, c) = \\operatorname{swish}(w_1 \\cdot x + b) \\cdot (w_2 \\cdot x + c)',
    exampleCallLatex: 'SwiGLU(x, w_1, w_2)',
    defaultArgs: { w_1: 'w_1', w_2: 'w_2', b: 0, c: 0 },
    paramConfigs: {
      w_1: { role: 'param', domainMode: 'free', min: -5, max: 5, step: 0.05, defaultValue: 1 },
      w_2: { role: 'param', domainMode: 'free', min: -5, max: 5, step: 0.05, defaultValue: 1 },
      b: { role: 'param', domainMode: 'free', min: -5, max: 5, step: 0.05, defaultValue: 0 },
      c: { role: 'param', domainMode: 'free', min: -5, max: 5, step: 0.05, defaultValue: 0 },
    },
    category: 'transformer',
    description:
      'Swish-Gated Linear Unit FFN (Shazeer / LLaMA): product of swish gate and linear projection',
    enabled: true,
    isBuiltin: true,
  },
  {
    id: 'lib-geglu',
    name: 'GeGLU',
    signature: 'GeGLU(x, w_1, w_2, b, c)',
    definitionLatex:
      'GeGLU(x, w_1, w_2, b, c) = \\operatorname{gelu}(w_1 \\cdot x + b) \\cdot (w_2 \\cdot x + c)',
    exampleCallLatex: 'GeGLU(x, w_1, w_2)',
    defaultArgs: { w_1: 'w_1', w_2: 'w_2', b: 0, c: 0 },
    paramConfigs: {
      w_1: { role: 'param', domainMode: 'free', min: -5, max: 5, step: 0.05, defaultValue: 1 },
      w_2: { role: 'param', domainMode: 'free', min: -5, max: 5, step: 0.05, defaultValue: 1 },
      b: { role: 'param', domainMode: 'free', min: -5, max: 5, step: 0.05, defaultValue: 0 },
      c: { role: 'param', domainMode: 'free', min: -5, max: 5, step: 0.05, defaultValue: 0 },
    },
    category: 'transformer',
    description: 'GELU-Gated Linear Unit FFN: product of GELU gate and linear projection',
    enabled: true,
    isBuiltin: true,
  },
  {
    id: 'lib-rmsnorm',
    name: 'RMSNorm',
    signature: 'RMSNorm(x, gamma, epsilon)',
    definitionLatex:
      'RMSNorm(x, \\gamma, \\epsilon) = \\frac{x}{\\sqrt{x^2 + \\epsilon}} \\cdot \\gamma',
    exampleCallLatex: 'RMSNorm(x, \\gamma, \\epsilon)',
    defaultArgs: { gamma: 'gamma', epsilon: 1e-5 },
    paramConfigs: {
      gamma: {
        role: 'hyperparam',
        domainMode: 'free',
        min: -5,
        max: 5,
        step: 0.05,
        defaultValue: 1,
      },
      epsilon: {
        role: 'hyperparam',
        domainMode: 'positive',
        min: 0.0001,
        max: 1,
        step: 0.001,
        defaultValue: 0.01,
      },
    },
    category: 'normalization',
    description: 'Root Mean Square Normalization (Zhang & Sennrich)',
    enabled: true,
    isBuiltin: true,
  },
  {
    id: 'lib-layernorm',
    name: 'LayerNorm',
    signature: 'LayerNorm(x, mu, sigma, gamma, beta, epsilon)',
    definitionLatex:
      'LayerNorm(x, \\mu, \\sigma, \\gamma, \\beta, \\epsilon) = \\gamma \\cdot \\frac{x - \\mu}{\\sqrt{\\sigma^2 + \\epsilon}} + \\beta',
    exampleCallLatex: 'LayerNorm(x, \\mu, \\sigma, \\gamma, \\beta)',
    defaultArgs: { mu: 'mu', sigma: 'sigma', gamma: 'gamma', beta: 'beta', epsilon: 1e-5 },
    paramConfigs: {
      mu: { role: 'param', domainMode: 'free', min: -5, max: 5, step: 0.05, defaultValue: 0 },
      sigma: {
        role: 'param',
        domainMode: 'positive',
        min: 0.1,
        max: 5,
        step: 0.05,
        defaultValue: 1,
      },
      gamma: {
        role: 'hyperparam',
        domainMode: 'free',
        min: -5,
        max: 5,
        step: 0.05,
        defaultValue: 1,
      },
      beta: {
        role: 'hyperparam',
        domainMode: 'free',
        min: -5,
        max: 5,
        step: 0.05,
        defaultValue: 0,
      },
      epsilon: {
        role: 'hyperparam',
        domainMode: 'positive',
        min: 0.0001,
        max: 1,
        step: 0.001,
        defaultValue: 0.01,
      },
    },
    category: 'normalization',
    description: 'Standard affine Layer Normalization with mean μ, std σ, scale γ, shift β',
    enabled: true,
    isBuiltin: true,
  },
  {
    id: 'lib-rope',
    name: 'RoPE',
    signature: 'RoPE(x, m, theta)',
    definitionLatex:
      'RoPE(x, m, \\theta) = x \\cdot \\cos(m \\cdot \\theta) - \\sin(m \\cdot \\theta)',
    exampleCallLatex: 'RoPE(x, m, \\theta)',
    defaultArgs: { m: 'm', theta: 'theta' },
    paramConfigs: {
      m: { role: 'param', domainMode: 'free', min: -5, max: 5, step: 0.05, defaultValue: 1 },
      theta: { role: 'param', domainMode: 'free', min: -5, max: 5, step: 0.05, defaultValue: 1 },
    },
    category: 'transformer',
    description: 'Rotary Position Embedding (Su et al.) 2D rotation formula',
    enabled: true,
    isBuiltin: true,
  },
];

export const KNOWN_SYMBOLS = new Set([
  'x',
  'y',
  'x_1',
  'x_2',
  'a',
  'b',
  'c',
  'd',
  'm',
  'p',
  'q',
  'w',
  'w_1',
  'w_2',
  'w_3',
  'r',
  'z',
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
  'theta',
  'mu',
  'sigma',
  'eta',
  'alpha',
  'beta',
  'lambda',
  'gamma',
  'delta',
  'epsilon',
  'tau',
  'phi',
  'psi',
  'omega',
  'rho',
  'kappa',
  'nu',
  'xi',
  'zeta',
  'chi',
  'Theta',
  'Phi',
  'Psi',
  'Omega',
  'Delta',
  'Lambda',
  'Gamma',
  'L',
  'k',
  'n',
  't',
  'e',
  'pi',
  'ExponentialE',
  'Pi',
]);

interface Token {
  type:
    | 'num'
    | 'id'
    | 'op'
    | 'lparen'
    | 'rparen'
    | 'lbrace'
    | 'rbrace'
    | 'comma'
    | 'colon'
    | 'cmp'
    | 'logic'
    | 'pipe';
  value: string;
  pos: number;
}

/**
 * Finds the index of a top-level assignment `=` (not inside `{...}`, not `\begin{cases}`,
 * and not part of `<=`, `>=`, `!=`, `==`).
 */
function findTopLevelAssignmentEquals(s: string): number {
  let braceDepth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') {
      // Only treat unescaped `{` or `\{` as brace depth if it's not part of \hat{y} or \operatorname{...}
      braceDepth++;
    } else if (ch === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
    } else if (ch === '=' && braceDepth === 0) {
      const prev = s[i - 1] ?? '';
      const next = s[i + 1] ?? '';
      if (prev === '<' || prev === '>' || prev === '!' || prev === '=' || next === '=') {
        continue;
      }
      return i;
    }
  }
  return -1;
}

/**
 * Normalizes a single formal parameter token (e.g. `\theta` -> `theta`, `d_{k}` -> `d_k`).
 */
function normalizeSingleSymbolName(rawSym: string): string {
  let s = rawSym.trim();
  s = s.replace(/\\(?:text|operatorname|mathrm)\s*\{\s*([a-zA-Z0-9_\s-]+)\s*\}/g, '$1');
  s = s.replace(/_\{([a-zA-Z0-9_]+)\}/g, '_$1');
  s = s.replace(/^\\(sigma|theta|mu|eta|alpha|beta|lambda|gamma|delta|epsilon|varepsilon|tau|pi|phi|psi|omega|rho|kappa|nu|xi|zeta|chi|Theta|Phi|Psi|Omega|Delta|Lambda|Gamma)$/, (_, g: string) =>
    g === 'varepsilon' ? 'epsilon' : g === 'pi' ? 'Pi' : g
  );
  return s.replace(/[{}]/g, '').trim();
}

/**
 * Extracts a leading function/variable assignment signature if present, e.g.:
 * - `f(t) = sin(t)` -> `{ name: 'f', formalParams: ['t'], rawHeader: 'f(t)' }`
 * - `\operatorname{Attention}(Q, K, V) = ...` -> `{ name: 'Attention', formalParams: ['Q', 'K', 'V'], rawHeader: 'Attention(Q, K, V)' }`
 * - `y = 2x + 1` -> `{ name: 'y', formalParams: [], rawHeader: 'y' }`
 */
export function extractFunctionSignature(raw: string): FunctionSignature | null {
  const s = raw.trim();
  if (!s) return null;
  // Unwrap \operatorname{Name}, \text{Name}, \mathrm{Name}, \hat{y}, \mathcal{L} before finding top-level =
  const preUnwrapped = s
    .replace(/\\(?:text|operatorname|mathrm)\s*\{\s*([a-zA-Z0-9_\s-]+)\s*\}/g, '$1')
    .replace(/_\{([a-zA-Z0-9_]+)\}/g, '_$1');
  const eqIdx = findTopLevelAssignmentEquals(preUnwrapped);
  if (eqIdx <= 0) return null;
  const lhs = preUnwrapped.slice(0, eqIdx).trim();
  const rhs = preUnwrapped.slice(eqIdx + 1).trim();
  if (!lhs || !rhs) return null;

  const match =
    /^(\\hat\{[a-zA-Z]+\}'*|\\mathcal\{[A-Z]\}(?:_[a-zA-Z0-9_]+)?'*|[a-zA-Z_][a-zA-Z0-9_]*'*)\s*(?:\(([^()]*)\))?$/.exec(
      lhs
    );
  if (!match) return null;

  const fnName = match[1].trim();
  const rawParams = match[2];
  const formalParams =
    rawParams !== undefined && rawParams.trim().length > 0
      ? rawParams
          .split(',')
          .map((p) => normalizeSingleSymbolName(p))
          .filter((p) => p.length > 0)
      : [];

  const rawHeader =
    formalParams.length > 0 ? `${fnName}(${formalParams.join(', ')})` : fnName;

  return {
    name: fnName,
    formalParams,
    rawHeader,
  };
}

/**
 * Extracts a leading function/variable assignment label such as `g(x) = ...`, `h_1(t) = ...`,
 * `\operatorname{Attention}(Q, K, V) = ...`, or `\hat{y} = ...` if present.
 */
export function extractLeadingFunctionLabel(raw: string): string | null {
  const sig = extractFunctionSignature(raw);
  return sig ? sig.rawHeader : null;
}

export interface PreservedSymbolInfo {
  tokenToLatex: Record<string, string>;
  tokenSet: Set<string>;
}

/**
 * Extracts and maps complex LaTeX macro identifiers (e.g. \text{TSS}, \mathcal{L}_{1,\text{global}},
 * N_{\text{ref}}, N_{\text{train}}, \sigma_{\text{init}}) to safe alphanumeric tokens for AST/JIT.
 */
export function extractPreservedSymbols(raw: string): PreservedSymbolInfo {
  const tokenToLatex: Record<string, string> = {};
  const tokenSet = new Set<string>();

  // 1. Base + subscript: \mathcal{L}_{1,\text{global}}, N_{\text{ref}}, N_{\text{train}}, \sigma_{\text{init}}, L_c
  // Exclude big operators (\sum, \prod, \lim, \int) and equations in limits (k=1)
  const subRegex =
    /(\\mathcal\{[A-Za-z]\}|\\(?:text|mathrm|operatorname)\{[^{}]+\}|\\(?:sigma|theta|mu|eta|alpha|beta|lambda|gamma|delta|epsilon|varepsilon|tau|pi|phi|psi|omega|rho|kappa|nu|xi|zeta|chi)|(?<![a-zA-Z\\])[a-zA-Z])\s*_\s*(?:\{((?:[^{}]|\\(?:text|mathrm|operatorname)\{[^{}]+\})+)\}|([a-zA-Z0-9]))/g;
  let m: RegExpExecArray | null;
  while ((m = subRegex.exec(raw)) !== null) {
    const full = m[0];
    const basePart = m[1];
    const subPart = m[2] ?? m[3];
    if (subPart.includes('=')) continue;
    const cleanBase = basePart
      .replace(/\\mathcal\{([A-Za-z])\}/, '$1')
      .replace(/\\(?:text|mathrm|operatorname)\{([^{}]+)\}/, '$1')
      .replace(/^\\/, '');
    const lowerBase = cleanBase.toLowerCase();
    if (lowerBase === 'sum' || lowerBase === 'prod' || lowerBase === 'int' || lowerBase === 'lim') {
      continue;
    }
    const cleanSub = subPart
      .replace(/\\(?:text|mathrm|operatorname)\{([^{}]+)\}/g, '$1')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (cleanBase && cleanSub) {
      const token = `${cleanBase}_${cleanSub}`;
      if (!(token.toLowerCase() in ML_FUNCTION_HEADS)) {
        tokenToLatex[token] = full;
        tokenSet.add(token);
      }
    }
  }

  // 2. Standalone \text{...}, \mathrm{...} multi-letter constants (e.g. \text{TSS}, \mathrm{WCSS})
  const textRegex = /\\(?:text|mathrm|operatorname)\s*\{\s*([a-zA-Z][a-zA-Z0-9_\s-]*)\s*\}/g;
  while ((m = textRegex.exec(raw)) !== null) {
    const full = m[0];
    const inner = m[1].replace(/[\s-]+/g, '_').replace(/^_+|_+$/g, '');
    if (inner && /^[a-zA-Z][a-zA-Z0-9_]*$/.test(inner)) {
      if (!(inner.toLowerCase() in ML_FUNCTION_HEADS)) {
        tokenToLatex[inner] = full;
        tokenSet.add(inner);
      }
    }
  }

  // 3. Standalone \mathcal{L}
  const calRegex = /\\mathcal\s*\{\s*([A-Za-z])\s*\}/g;
  while ((m = calRegex.exec(raw)) !== null) {
    const full = m[0];
    const letter = m[1];
    tokenToLatex[letter] = full;
    tokenSet.add(letter);
  }

  return { tokenToLatex, tokenSet };
}

/**
 * Pre-normalizes LaTeX macros (\frac, \sqrt, \left|, \text{...}, Greek letters, matrix transpose ^T,
 * \begin{cases}...\end{cases}, and piecewise/conditional braces {...}) into clean mathematical notation.
 */
export function normalizeLatexToAscii(raw: string): string {
  let s = raw.trim();
  if (!s) return '';

  // Strip leading f(x) = or \operatorname{Attention}(Q, K, V) = or \hat{y} = or \mathcal{L}(w,b) =
  const sig = extractFunctionSignature(s);
  if (sig) {
    // Strip up to the first standalone =
    const eqMatch = /(?<![<>!=])=(?!=)/.exec(s);
    if (eqMatch && eqMatch.index > 0) {
      s = s.slice(eqMatch.index + 1).trim();
    }
  }

  // Substitute preserved multi-letter and subscript macros into safe tokens first
  const preserved = extractPreservedSymbols(s);
  for (const [token, latex] of Object.entries(preserved.tokenToLatex)) {
    s = s.split(latex).join(` ${token} `);
  }

  // Convert \begin{cases} ... \end{cases} into Desmos-style piecewise { cond1 : val1, cond2 : val2, defaultVal }
  s = s.replace(/\\begin\{cases\}([\s\S]*?)\\end\{cases\}/g, (_m, body: string) => {
    const rows = body
      .split(/\\\\/)
      .map((r) => r.trim())
      .filter((r) => r.length > 0)
      .map((row) => {
        const parts = row.split('&').map((p) => p.trim());
        if (parts.length >= 2) {
          const valPart = parts[0];
          const condPart = parts
            .slice(1)
            .join(' ')
            .replace(
              /\\(?:text|mathrm|operatorname)\s*\{\s*(?:otherwise|else|if|for|when|khi|với|nếu)\s*\}/gi,
              ''
            )
            .replace(/\b(?:otherwise|else|if|for|when)\b/gi, '')
            .replace(/^,\s*/, '')
            .trim();
          return condPart ? `${condPart} : ${valPart}` : valPart;
        }
        return row;
      });
    return `{ ${rows.join(', ')} }`;
  });

  // Unescape \{ and \} into { and } for piecewise/domain conditions
  s = s.replace(/\\\{/g, '{').replace(/\\\}/g, '}');

  // Replace \left and \right, \left. and \right., spacing macros (\!, \,, \;, \quad), and unescape \_
  s = s
    .replace(/\\(?:left|right)\s*\./g, '')
    .replace(/\\left\s*/g, '')
    .replace(/\\right\s*/g, '')
    .replace(/\\[,;!:]|\\quad\b|\\qquad\b/g, ' ')
    .replace(/\\_/g, '_');

  // Strip typesetting / font wrappers
  s = s.replace(/\\(?:displaystyle|textstyle|scriptstyle|scriptscriptstyle)(?![a-zA-Z])/g, '');
  for (const cmd of ['mathbf', 'boldsymbol', 'bm', 'mathit', 'mathsf', 'mathbfit', 'vec', 'pmb']) {
    s = s.replace(new RegExp(`\\\\${cmd}\\s*\\{([^{}]+)\\}`, 'g'), '$1');
  }

  // Normalize transpose superscripts: K^T, K^\top, K^{\top}, K^{T} -> K (scalar/1D dot-product projection)
  s = s
    .replace(/\^\s*\{\s*(?:\\top|\\intercal|T)\s*\}/g, '')
    .replace(/\^\s*(?:\\top|\\intercal)\b/g, '')
    .replace(/\^\s*T\b/g, '');

  // Replace remaining \text{...} and \operatorname{...} with surrounding spaces so adjacent identifiers do not fuse
  s = s.replace(/\\(?:text|operatorname|mathrm)\s*\{\s*([a-zA-Z0-9_\\]+)\s*\}/g, ' $1 ');
  s = s
    .replace(/\bGELU\s*''/gi, ' geluderiv2')
    .replace(/\bGELU\s*'/gi, ' geluderiv1');

  // Recursively expand \frac{A}{B} -> ((A)/(B)) and \sqrt{A} -> sqrt(A)
  let prev = '';
  while (prev !== s) {
    prev = s;
    s = replaceFrac(s);
    s = replaceCmd1(s, '\\sqrt', 'sqrt');
  }

  // \sum_{j=a}^{b} body / \prod_{j=a}^{b} body -> Sum((body), j, a, b) / Product(...)
  s = rewriteBigOperators(s);

  // Normalize LaTeX relational & logical operators
  const relMap: [RegExp, string][] = [
    [/\\(?:le|leq|leqslant)\b/g, ' <= '],
    [/\\(?:ge|geq|geqslant)\b/g, ' >= '],
    [/\\(?:ne|neq)\b/g, ' != '],
    [/≤/g, ' <= '],
    [/≥/g, ' >= '],
    [/≠/g, ' != '],
    [/\\(?:land|wedge)\b/g, ' && '],
    [/\\(?:lor|vee)\b/g, ' || '],
  ];
  for (const [re, rep] of relMap) {
    s = s.replace(re, rep);
  }

  // Greek & math commands (leading space prevents fusing with preceding variables like a\cos(x) or x\ln(x))
  const greekMap: [RegExp, string][] = [
    [/\\sigma\b/g, ' sigma'],
    [/\\theta\b/g, ' theta'],
    [/\\mu\b/g, ' mu'],
    [/\\eta\b/g, ' eta'],
    [/\\alpha\b/g, ' alpha'],
    [/\\beta\b/g, ' beta'],
    [/\\lambda\b/g, ' lambda'],
    [/\\gamma\b/g, ' gamma'],
    [/\\delta\b/g, ' delta'],
    [/\\(?:epsilon|varepsilon)\b/g, ' epsilon'],
    [/\\tau\b/g, ' tau'],
    [/\\pi\b/g, ' Pi'],
    [/\\phi\b/g, ' phi'],
    [/\\varphi\b/g, ' phi'],
    [/\\psi\b/g, ' psi'],
    [/\\omega\b/g, ' omega'],
    [/\\rho\b/g, ' rho'],
    [/\\kappa\b/g, ' kappa'],
    [/\\nu\b/g, ' nu'],
    [/\\xi\b/g, ' xi'],
    [/\\zeta\b/g, ' zeta'],
    [/\\chi\b/g, ' chi'],
    [/\\Theta\b/g, ' Theta'],
    [/\\Phi\b/g, ' Phi'],
    [/\\Psi\b/g, ' Psi'],
    [/\\Omega\b/g, ' Omega'],
    [/\\Delta\b/g, ' Delta'],
    [/\\Lambda\b/g, ' Lambda'],
    [/\\Gamma\b/g, ' Gamma'],
    [/\\(?:cdot|times|odot|otimes)(?![a-zA-Z])/g, '*'],
    [/\\div\b/g, '/'],
    [/\\ln\b/g, ' ln'],
    [/\\log\b/g, ' log'],
    [/\\exp\b/g, ' exp'],
    [/\\arcsin\b/g, ' arcsin'],
    [/\\arccos\b/g, ' arccos'],
    [/\\arctan\b/g, ' arctan'],
    [/\\sinh\b/g, ' sinh'],
    [/\\cosh\b/g, ' cosh'],
    [/\\tanh\b/g, ' tanh'],
    [/\\sinc\b/g, ' sinc'],
    [/\\sin\b/g, ' sin'],
    [/\\cos\b/g, ' cos'],
    [/\\tan\b/g, ' tan'],
    [/\\cot\b/g, ' cot'],
    [/\\sec\b/g, ' sec'],
    [/\\csc\b/g, ' csc'],
    [/\\max\b/g, ' max'],
    [/\\min\b/g, ' min'],
    [/\\operatorname\b/g, ' '],
  ];
  for (const [re, rep] of greekMap) {
    s = s.replace(re, rep);
  }

  // Subscripts like x_{1} -> x_1, d_{k} -> d_k, d_{model} -> d_model
  s = s.replace(/_\{([a-zA-Z0-9_]+)\}/g, '_$1');
  // Clean up any space introduced before subscript e.g. `sigma _1` -> `sigma_1`
  s = s.replace(/\b([a-zA-Z]+)\s+_([a-zA-Z0-9_]+)/g, '$1_$2');

  // Convert superscript grouping braces `^{...}` into `^(...)` while preserving piecewise/conditional `{...}`
  s = replaceSuperscriptBraces(s);

  return s.trim();
}

function replaceSuperscriptBraces(str: string): string {
  let out = str;
  let searchFrom = 0;
  while (searchFrom < out.length) {
    const caretIdx = out.indexOf('^', searchFrom);
    if (caretIdx === -1) break;
    let p = caretIdx + 1;
    while (p < out.length && /\s/.test(out[p])) p++;
    if (out[p] === '{') {
      const closeIdx = findBalancedBrace(out, p);
      if (closeIdx !== -1) {
        const inner = replaceSuperscriptBraces(out.slice(p + 1, closeIdx));
        out = `${out.slice(0, p)}(${inner})${out.slice(closeIdx + 1)}`;
        searchFrom = p + inner.length + 2;
        continue;
      }
    }
    searchFrom = p + 1;
  }
  return out;
}

function findBalancedBrace(str: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < str.length; i++) {
    if (str[i] === '{') depth++;
    else if (str[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function replaceFrac(str: string): string {
  const idx = str.indexOf('\\frac');
  if (idx === -1) return str;
  let p = idx + 5;
  while (p < str.length && /\s/.test(str[p])) p++;
  if (str[p] !== '{') return str;
  const endNum = findBalancedBrace(str, p);
  if (endNum === -1) return str;
  let q = endNum + 1;
  while (q < str.length && /\s/.test(str[q])) q++;
  if (str[q] !== '{') return str;
  const endDen = findBalancedBrace(str, q);
  if (endDen === -1) return str;
  const num = str.slice(p + 1, endNum);
  const den = str.slice(q + 1, endDen);
  return `${str.slice(0, idx)}((${num})/(${den}))${str.slice(endDen + 1)}`;
}

function replaceCmd1(str: string, cmd: string, fnName: string): string {
  const idx = str.indexOf(cmd);
  if (idx === -1) return str;
  let p = idx + cmd.length;
  while (p < str.length && /\s/.test(str[p])) p++;
  if (str[p] !== '{') return str;
  const endArg = findBalancedBrace(str, p);
  if (endArg === -1) return str;
  const arg = str.slice(p + 1, endArg);
  return `${str.slice(0, idx)} ${fnName}(${arg})${str.slice(endArg + 1)}`;
}

function resolveUserFunction(
  name: string,
  userFunctions?: UserFunctionRegistry
): UserFunctionDef | undefined {
  if (!userFunctions) return undefined;
  const direct = userFunctions[name] ?? userFunctions[name.toLowerCase()];
  if (direct) return direct;
  const lower = name.toLowerCase();
  for (const key of Object.keys(userFunctions)) {
    if (key.toLowerCase() === lower) {
      return userFunctions[key];
    }
  }
  return undefined;
}

function isKnownFunctionName(name: string, userFunctions?: UserFunctionRegistry): boolean {
  const lower = name.toLowerCase();
  return (
    lower in ML_FUNCTION_HEADS ||
    name in ML_FUNCTION_HEADS ||
    getRegisteredMathFunction(lower) !== undefined ||
    resolveUserFunction(name, userFunctions) !== undefined
  );
}

function isValidSymbolToken(name: string, extraAllowed?: Set<string>): boolean {
  if (extraAllowed?.has(name)) return true;
  if (KNOWN_SYMBOLS.has(name)) return true;
  // Single letter (e.g. x, a, b) or identifier with subscript (e.g., x_1, d_k, w_q, L_1_global, N_ref)
  if (/^[a-zA-Z](?:_[a-zA-Z0-9_]+)+$/.test(name)) return true;
  if (/^[a-zA-Z]$/.test(name)) return true;
  return false;
}

function splitImplicitIdentifier(
  ident: string,
  nextChar: string,
  userFunctions?: UserFunctionRegistry,
  extraAllowed?: Set<string>
): string[] {
  if (nextChar === '(' && isKnownFunctionName(ident, userFunctions)) return [ident];
  if (isValidSymbolToken(ident, extraAllowed)) return [ident];
  // e.g. "wx" -> ["w", "x"], "QK" -> ["Q", "K"], "xW" -> ["x", "W"]
  if (
    ident.length === 2 &&
    isValidSymbolToken(ident[0], extraAllowed) &&
    isValidSymbolToken(ident[1], extraAllowed)
  ) {
    return [ident[0], ident[1]];
  }
  // e.g. "ax_1" or "QK_1"
  if (ident.length >= 3 && !ident.startsWith('_')) {
    const first = ident[0];
    const rest = ident.slice(1);
    if (isValidSymbolToken(first, extraAllowed) && isValidSymbolToken(rest, extraAllowed)) {
      return [first, rest];
    }
  }
  return [ident];
}

function tokenize(
  input: string,
  userFunctions?: UserFunctionRegistry,
  extraAllowed?: Set<string>
): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let pipeDepth = 0;

  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(input[i + 1] ?? ''))) {
      const start = i;
      while (i < input.length && /[0-9.]/.test(input[i])) i++;
      if (input[i] === 'e' || input[i] === 'E') {
        if (/[0-9+-]/.test(input[i + 1] ?? '')) {
          i++;
          if (input[i] === '+' || input[i] === '-') i++;
          while (i < input.length && /[0-9]/.test(input[i])) i++;
        }
      }
      tokens.push({ type: 'num', value: input.slice(start, i), pos: start });
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      const start = i;
      while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) i++;
      const rawId = input.slice(start, i);
      const lowerId = rawId.toLowerCase();
      if (lowerId === 'and') {
        tokens.push({ type: 'logic', value: '&&', pos: start });
        continue;
      }
      if (lowerId === 'or') {
        tokens.push({ type: 'logic', value: '||', pos: start });
        continue;
      }
      let lookahead = i;
      while (lookahead < input.length && /\s/.test(input[lookahead])) lookahead++;
      const parts = splitImplicitIdentifier(
        rawId,
        input[lookahead] ?? '',
        userFunctions,
        extraAllowed
      );
      for (const part of parts) {
        tokens.push({ type: 'id', value: part, pos: start });
      }
      continue;
    }
    // Two-character relational & logical operators
    const twoChar = input.slice(i, i + 2);
    if (twoChar === '<=' || twoChar === '>=' || twoChar === '!=' || twoChar === '==') {
      tokens.push({ type: 'cmp', value: twoChar, pos: i });
      i += 2;
      continue;
    }
    if (twoChar === '&&' || twoChar === '||') {
      tokens.push({ type: 'logic', value: twoChar, pos: i });
      i += 2;
      continue;
    }
    if (ch === '<' || ch === '>' || ch === '=') {
      tokens.push({ type: 'cmp', value: ch === '=' ? '==' : ch, pos: i });
      i++;
      continue;
    }
    if (ch === ':') {
      tokens.push({ type: 'colon', value: ':', pos: i });
      i++;
      continue;
    }
    if (ch === '{') {
      tokens.push({ type: 'lbrace', value: '{', pos: i });
      i++;
      continue;
    }
    if (ch === '}') {
      tokens.push({ type: 'rbrace', value: '}', pos: i });
      i++;
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '^') {
      tokens.push({ type: 'op', value: ch, pos: i });
      i++;
      continue;
    }
    if (ch === '(' || ch === '[') {
      tokens.push({ type: 'lparen', value: '(', pos: i });
      i++;
      continue;
    }
    if (ch === ')' || ch === ']') {
      tokens.push({ type: 'rparen', value: ')', pos: i });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'comma', value: ',', pos: i });
      i++;
      continue;
    }
    if (ch === '|') {
      // Convert balanced |expr| into Abs(expr)
      if (pipeDepth % 2 === 0) {
        tokens.push({ type: 'id', value: 'abs', pos: i });
        tokens.push({ type: 'lparen', value: '(', pos: i });
      } else {
        tokens.push({ type: 'rparen', value: ')' , pos: i });
      }
      pipeDepth++;
      i++;
      continue;
    }
    throw new Error(`Unexpected character '${ch}' at position ${i}`);
  }

  if (pipeDepth % 2 !== 0) {
    throw new Error('Unbalanced absolute value bars |...|');
  }

  // Convert top-level `, {` (e.g. `x^2, {x < 3, x > 5}`) into implicit multiplication `* {`
  let pDepth = 0;
  let bDepth = 0;
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type === 'lparen') pDepth++;
    else if (t.type === 'rparen') pDepth = Math.max(0, pDepth - 1);
    else if (t.type === 'lbrace') bDepth++;
    else if (t.type === 'rbrace') bDepth = Math.max(0, bDepth - 1);
    else if (
      t.type === 'comma' &&
      pDepth === 0 &&
      bDepth === 0 &&
      tokens[k + 1]?.type === 'lbrace'
    ) {
      tokens[k] = { type: 'op', value: '*', pos: t.pos };
    }
  }

  // Insert implicit multiplication tokens where appropriate:
  // e.g., 2x -> 2 * x, (x+1)(x-1) -> (x+1) * (x-1), x^2 {x < 3} -> x^2 * {x < 3}, softmax(...)V -> softmax(...) * V
  const out: Token[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const curr = tokens[k];
    out.push(curr);
    const next = tokens[k + 1];
    if (!next) continue;

    const currIsValue =
      curr.type === 'num' ||
      curr.type === 'id' ||
      curr.type === 'rparen' ||
      curr.type === 'rbrace';
    const nextIsStart =
      next.type === 'num' ||
      next.type === 'id' ||
      next.type === 'lparen' ||
      next.type === 'lbrace';

    if (currIsValue && nextIsStart) {
      // Do NOT insert '*' if curr is an identifier followed by '(' UNLESS it is a known data variable (x, y, r, x_1, x_2)
      // e.g. x(x+1) -> x * (x+1), but W(x) -> function call W(x)
      const isDataVar =
        curr.type === 'id' &&
        (curr.value === 'x' ||
          curr.value === 'y' ||
          curr.value === 'r' ||
          curr.value === 'x_1' ||
          curr.value === 'x_2');
      const isFnCall = curr.type === 'id' && next.type === 'lparen' && !isDataVar;
      if (!isFnCall) {
        out.push({ type: 'op', value: '*', pos: curr.pos });
      }
    }
  }
  return out;
}

const CONDITION_HEADS = new Set([
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
  'Equal',
  'NotEqual',
  'And',
  'Or',
]);

function isConditionAst(node: MathJsonExpr): boolean {
  return Array.isArray(node) && CONDITION_HEADS.has(node[0]);
}

function collectConditionSymbols(node: MathJsonExpr, out: Set<string>): void {
  if (typeof node === 'string') {
    if (node !== 'ExponentialE' && node !== 'Pi') out.add(node);
    return;
  }
  if (Array.isArray(node)) {
    for (let i = 1; i < node.length; i++) {
      collectConditionSymbols(node[i], out);
    }
  }
}

function evalSimpleScalar(node: MathJsonExpr, xVal: number, varSym: string): number {
  if (typeof node === 'number') return node;
  if (typeof node === 'string') {
    if (node === 'ExponentialE') return Math.E;
    if (node === 'Pi') return Math.PI;
    if (node === varSym || node === 'x' || node === 't' || node === 'Q') return xVal;
    return 1.0;
  }
  if (!Array.isArray(node)) return 0;
  const [h, ...args] = node;
  const v = args.map((a) => evalSimpleScalar(a, xVal, varSym));
  switch (h) {
    case 'Negate':
      return -v[0];
    case 'Add':
      return v[0] + v[1];
    case 'Subtract':
      return v[0] - v[1];
    case 'Multiply':
      return v[0] * v[1];
    case 'Divide':
      return v[1] === 0 ? NaN : v[0] / v[1];
    case 'Power':
      return Math.pow(v[0], v[1]);
    case 'Abs':
      return Math.abs(v[0]);
    case 'Less':
      return v[0] < v[1] ? 1 : 0;
    case 'LessEqual':
      return v[0] <= v[1] ? 1 : 0;
    case 'Greater':
      return v[0] > v[1] ? 1 : 0;
    case 'GreaterEqual':
      return v[0] >= v[1] ? 1 : 0;
    case 'Equal':
      return Math.abs(v[0] - v[1]) <= 1e-9 ? 1 : 0;
    case 'NotEqual':
      return Math.abs(v[0] - v[1]) > 1e-9 ? 1 : 0;
    case 'And':
      return v.every((c) => c > 0.5) ? 1 : 0;
    case 'Or':
      return v.some((c) => c > 0.5) ? 1 : 0;
    default:
      return 0;
  }
}

function collectNumberLiterals(node: MathJsonExpr, out: number[]): void {
  if (typeof node === 'number') {
    if (Number.isFinite(node)) out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (let i = 1; i < node.length; i++) {
      collectNumberLiterals(node[i], out);
    }
  }
}

/**
 * Intelligently combines comma-separated conditions inside `{c1, c2, ...}`:
 * - Disjoint interval unions like `{x < 3, x > 5}` or `{-3 < x < -1, 1 < x < 3}`
 *   have empty intersection (`AND` is never true), so they combine as `['Or', ...conds]`.
 * - Overlapping constraints like `{x > 0, x < 5}` have non-empty intersection,
 *   so they combine as `['And', ...conds]`.
 */
function combineCommaConditions(
  conds: MathJsonExpr[],
  leadingParam?: string
): MathJsonExpr {
  if (conds.length === 1) return conds[0];
  const syms = new Set<string>();
  for (const c of conds) collectConditionSymbols(c, syms);
  const varSym =
    (leadingParam && syms.has(leadingParam) ? leadingParam : undefined) ??
    (syms.has('x') ? 'x' : undefined) ??
    (syms.has('t') ? 't' : undefined) ??
    Array.from(syms)[0] ??
    'x';
  const lits: number[] = [-100, -10, -5, -2, -1, 0, 1, 2, 5, 10, 100];
  for (const c of conds) collectNumberLiterals(c, lits);
  lits.sort((a, b) => a - b);
  const probes = new Set<number>(lits);
  for (let i = 0; i < lits.length; i++) {
    probes.add(lits[i] - 0.5);
    probes.add(lits[i] + 0.5);
    if (i + 1 < lits.length) {
      probes.add(0.5 * (lits[i] + lits[i + 1]));
    }
  }
  let anyAndTrue = false;
  for (const px of probes) {
    if (conds.every((c) => evalSimpleScalar(c, px, varSym) > 0.5)) {
      anyAndTrue = true;
      break;
    }
  }
  return anyAndTrue ? ['And', ...conds] : ['Or', ...conds];
}

/**
 * Beta-reduces (substitutes) formal parameters in `body` with actual argument ASTs.
 */
export function substituteAstParams(
  body: MathJsonExpr,
  paramBindings: Record<string, MathJsonExpr>
): MathJsonExpr {
  if (typeof body === 'number') return body;
  if (typeof body === 'string') {
    return body in paramBindings ? paramBindings[body] : body;
  }
  if (!Array.isArray(body)) return body;
  const [head, ...args] = body;
  return [head, ...args.map((arg) => substituteAstParams(arg, paramBindings))];
}

export interface BoundParamConfigInfo {
  config: LibraryParamConfig;
  sourceFn: string;
  formalParam: string;
}

export interface ParseOptions {
  userFunctions?: UserFunctionRegistry;
  extraAllowedSymbols?: Iterable<string>;
}

export interface ParseResult {
  valid: boolean;
  expr: MathJsonExpr;
  signature?: FunctionSignature;
  tokenToLatexMap?: Record<string, string>;
  calledFunctions?: string[];
  boundParamConfigs?: Record<string, BoundParamConfigInfo>;
  errorMessage?: string;
  errorOffset?: number;
}

const CMP_HEAD_MAP: Record<string, string> = {
  '<': 'Less',
  '<=': 'LessEqual',
  '>': 'Greater',
  '>=': 'GreaterEqual',
  '==': 'Equal',
  '=': 'Equal',
  '!=': 'NotEqual',
};

/**
 * Parses LaTeX or ASCII mathematical input into a canonical MathJsonExpr AST.
 * Supports formal function signatures (`f(t) = ...`, `Attention(Q, K, V) = ...`),
 * user-defined function composition (`Attention(x, 1, 2)`), and piecewise/conditional
 * blocks (`{x < 3, x > 5}`, `{x < 0: -x, x >= 0: x^2}`, `\begin{cases}...\end{cases}`).
 */
export function parseLatexToMathJson(
  rawInput: string,
  options?: ParseOptions
): ParseResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { valid: false, expr: 0, errorMessage: 'Empty expression' };
  }

  try {
    const preserved = extractPreservedSymbols(trimmed);
    const signature = extractFunctionSignature(trimmed) ?? undefined;
    const allowedSet = new Set<string>(options?.extraAllowedSymbols ?? []);
    for (const tok of preserved.tokenSet) {
      allowedSet.add(tok);
    }
    if (signature) {
      for (const p of signature.formalParams) {
        allowedSet.add(p);
      }
    }

    const normalized = normalizeLatexToAscii(trimmed);
    const tokens = tokenize(normalized, options?.userFunctions, allowedSet);
    if (tokens.length === 0) {
      return { valid: false, expr: 0, errorMessage: 'Empty expression' };
    }

    let pos = 0;
    const calledFunctionsSet = new Set<string>();
    const boundParamConfigs: Record<string, BoundParamConfigInfo> = {};
    const peek = (): Token | undefined => tokens[pos];
    const consume = (): Token => tokens[pos++];

    function parseLogicOr(): MathJsonExpr {
      let left = parseLogicAnd();
      while (peek()?.type === 'logic' && peek()!.value === '||') {
        consume();
        const right = parseLogicAnd();
        left = ['Or', left, right];
      }
      return left;
    }

    function parseLogicAnd(): MathJsonExpr {
      let left = parseComparison();
      while (peek()?.type === 'logic' && peek()!.value === '&&') {
        consume();
        const right = parseComparison();
        left = ['And', left, right];
      }
      return left;
    }

    function parseComparison(): MathJsonExpr {
      const first = parseExpr();
      if (peek()?.type !== 'cmp') {
        return first;
      }
      const chainConds: MathJsonExpr[] = [];
      let prevOperand = first;
      while (peek()?.type === 'cmp') {
        const opTok = consume();
        const nextOperand = parseExpr();
        const head = CMP_HEAD_MAP[opTok.value] ?? 'Less';
        chainConds.push([head, prevOperand, nextOperand]);
        prevOperand = nextOperand;
      }
      return chainConds.length === 1 ? chainConds[0] : ['And', ...chainConds];
    }

    function parseExpr(): MathJsonExpr {
      let left = parseTerm();
      while (peek()?.type === 'op' && (peek()!.value === '+' || peek()!.value === '-')) {
        const op = consume().value;
        const right = parseTerm();
        left = op === '+' ? ['Add', left, right] : ['Subtract', left, right];
      }
      return left;
    }

    function parseTerm(): MathJsonExpr {
      let left = parsePower();
      while (peek()?.type === 'op' && (peek()!.value === '*' || peek()!.value === '/')) {
        const op = consume().value;
        const right = parsePower();
        left = op === '*' ? ['Multiply', left, right] : ['Divide', left, right];
      }
      return left;
    }

    function parsePower(): MathJsonExpr {
      const base = parseUnary();
      if (peek()?.type === 'op' && peek()!.value === '^') {
        consume();
        const exp = parsePower(); // right-associative
        if (base === 'ExponentialE' || base === 'e') {
          return ['Exp', exp];
        }
        return ['Power', base, exp];
      }
      return base;
    }

    function parseUnary(): MathJsonExpr {
      if (peek()?.type === 'op' && (peek()!.value === '+' || peek()!.value === '-')) {
        const op = consume().value;
        const operand = parseUnary();
        if (op === '-') {
          return typeof operand === 'number' ? -operand : ['Negate', operand];
        }
        return operand;
      }
      return parsePrimary();
    }

    function parseBraceBlock(openPos: number): MathJsonExpr {
      const items: { first: MathJsonExpr; second?: MathJsonExpr }[] = [];
      let hasColon = false;

      if (peek()?.type !== 'rbrace') {
        while (true) {
          const first = parseLogicOr();
          let second: MathJsonExpr | undefined;
          if (peek()?.type === 'colon') {
            consume();
            hasColon = true;
            second = parseLogicOr();
          }
          items.push({ first, second });
          if (peek()?.type === 'comma') {
            consume();
            if (peek()?.type === 'rbrace') break;
            continue;
          }
          break;
        }
      }

      if (peek()?.type !== 'rbrace') {
        throw new Error(`Missing closing brace '}' near position ${openPos}`);
      }
      consume(); // '}'

      if (items.length === 0) {
        throw new Error('Empty brace expression {}');
      }

      if (!hasColon) {
        // Plain LaTeX grouping `{ expr }` if single non-condition item
        if (items.length === 1 && !isConditionAst(items[0].first)) {
          return items[0].first;
        }
        // Condition list `{x < 3}` or `{x < 3, x > 5}` -> evaluates to 1 where satisfied, NaN otherwise
        const conds = items.map((it) => it.first);
        const combined = combineCommaConditions(conds);
        return ['Piecewise', combined, 1];
      }

      // Multi-branch piecewise `{cond1: val1, cond2: val2, defaultVal}` (supports both cond:val and val:cond)
      const pwArgs: MathJsonExpr[] = [];
      for (const item of items) {
        if (item.second !== undefined) {
          if (isConditionAst(item.first)) {
            pwArgs.push(item.first, item.second);
          } else if (isConditionAst(item.second)) {
            pwArgs.push(item.second, item.first);
          } else {
            pwArgs.push(item.first, item.second);
          }
        } else if (isConditionAst(item.first)) {
          pwArgs.push(item.first, 1);
        } else {
          pwArgs.push(item.first);
        }
      }
      return ['Piecewise', ...pwArgs];
    }

    function parsePrimary(): MathJsonExpr {
      const tok = peek();
      if (!tok) {
        throw new Error('Unexpected end of expression');
      }
      if (tok.type === 'num') {
        consume();
        const val = Number(tok.value);
        if (!Number.isFinite(val)) throw new Error(`Invalid number '${tok.value}'`);
        return val;
      }
      if (tok.type === 'lparen') {
        consume();
        const inner = parseLogicOr();
        if (peek()?.type !== 'rparen') {
          throw new Error(`Missing closing parenthesis ')' near position ${tok.pos}`);
        }
        consume();
        return inner;
      }
      if (tok.type === 'lbrace') {
        consume();
        return parseBraceBlock(tok.pos);
      }
      if (tok.type === 'id') {
        consume();
        const name = tok.value;
        // Function call check
        if (peek()?.type === 'lparen') {
          if (!isKnownFunctionName(name, options?.userFunctions)) {
            throw new Error(`Unknown function '${name}'`);
          }
          consume(); // '('
          const args: MathJsonExpr[] = [];
          if (peek()?.type !== 'rparen') {
            args.push(parseLogicOr());
            while (peek()?.type === 'comma') {
              consume();
              args.push(parseLogicOr());
            }
          }
          if (peek()?.type !== 'rparen') {
            throw new Error(`Missing closing ')' for function '${name}'`);
          }
          consume(); // ')'

          // 0. Finite big operators are unrolled into plain Add / Multiply trees.
          if (isBigOperatorHead(name)) {
            return expandBigOperatorCall(name, args);
          }

          // 1. User-defined or Library function takes highest precedence (pure mathematical beta-reduction)
          const userDef = resolveUserFunction(name, options?.userFunctions);
          if (userDef && userDef.signature.name.toLowerCase() !== signature?.name.toLowerCase()) {
            calledFunctionsSet.add(userDef.signature.name);
            const putBoundParamCfg = (
              symName: string,
              incoming: BoundParamConfigInfo
            ): void => {
              const rank = (m?: string): number =>
                m === 'positive' ? 2 : m === 'non_negative' ? 1 : 0;
              const prev = boundParamConfigs[symName];
              if (!prev) {
                boundParamConfigs[symName] = incoming;
                return;
              }
              const prevRank = rank(prev.config.domainMode);
              const incRank = rank(incoming.config.domainMode);
              if (incRank > prevRank) {
                boundParamConfigs[symName] = {
                  ...incoming,
                  config: {
                    ...prev.config,
                    ...incoming.config,
                    min:
                      prev.config.min !== undefined && incoming.config.min !== undefined
                        ? Math.max(prev.config.min, incoming.config.min)
                        : (incoming.config.min ?? prev.config.min),
                  },
                };
              } else if (incRank === prevRank && incRank > 0) {
                boundParamConfigs[symName] = {
                  ...prev,
                  config: {
                    ...prev.config,
                    min:
                      prev.config.min !== undefined && incoming.config.min !== undefined
                        ? Math.max(prev.config.min, incoming.config.min)
                        : (prev.config.min ?? incoming.config.min),
                  },
                };
              }
            };
            const formal = userDef.signature.formalParams;
            if (formal.length > 0) {
              const bindings: Record<string, MathJsonExpr> = {};
              for (let idx = 0; idx < formal.length; idx++) {
                const paramName = formal[idx];
                const actualExpr =
                  args[idx] ?? userDef.defaultArgs?.[paramName] ?? paramName;
                bindings[paramName] = actualExpr;
                const paramCfg = userDef.paramConfigs?.[paramName];
                if (paramCfg && typeof actualExpr === 'string' && idx > 0) {
                  putBoundParamCfg(actualExpr, {
                    config: paramCfg,
                    sourceFn: userDef.signature.name,
                    formalParam: paramName,
                  });
                }
              }
              if (userDef.paramConfigs) {
                for (const [cfgKey, paramCfg] of Object.entries(userDef.paramConfigs)) {
                  if (!(cfgKey in bindings)) {
                    putBoundParamCfg(cfgKey, {
                      config: paramCfg,
                      sourceFn: userDef.signature.name,
                      formalParam: cfgKey,
                    });
                  }
                }
              }
              return substituteAstParams(userDef.bodyExpr, bindings);
            }
            return userDef.bodyExpr;
          }

          const pluginFn = getRegisteredMathFunction(name);
          const head =
            ML_FUNCTION_HEADS[name.toLowerCase()] ??
            ML_FUNCTION_HEADS[name] ??
            pluginFn?.name ??
            name;
          return [head, ...args];
        }
        if (name === 'e') return 'ExponentialE';
        if (name === 'pi') return 'Pi';
        if (!isValidSymbolToken(name, allowedSet)) {
          throw new Error(`Unknown symbol '${name}'`);
        }
        return name;
      }
      throw new Error(`Unexpected token '${tok.value}' at position ${tok.pos}`);
    }

    const ast = parseLogicOr();
    if (pos < tokens.length) {
      const rem = tokens[pos];
      throw new Error(`Unexpected token '${rem.value}' at position ${rem.pos}`);
    }

    // Touch ComputeEngine singleton to ensure Cortex dictionary compatibility
    getComputeEngine();
    return {
      valid: true,
      expr: ast,
      signature,
      tokenToLatexMap: preserved.tokenToLatex,
      calledFunctions:
        calledFunctionsSet.size > 0 ? Array.from(calledFunctionsSet) : undefined,
      boundParamConfigs:
        Object.keys(boundParamConfigs).length > 0 ? boundParamConfigs : undefined,
    };
  } catch (err) {
    return {
      valid: false,
      expr: 0,
      errorMessage: err instanceof Error ? err.message : 'Syntax error',
    };
  }
}

/**
 * Extracts a concise function symbol (e.g. `f`, `g`, `Attention`, `SwiGLU`) from an expression's
 * custom label or leading `fn(args) = ...` definition for derivative badges (`f'(x)`, `Attention'(Q)`).
 */
export function resolveDerivSymbol(
  label: string | undefined,
  latex?: string,
  idx = 0
): string {
  if (latex) {
    const sig = extractFunctionSignature(latex);
    if (sig?.name) return sig.name;
  }
  if (!label || !label.trim()) return `f${idx > 0 ? idx + 1 : ''}`;
  const trimmed = label.trim();
  const fnMatch = trimmed.match(/^([a-zA-Z\u0370-\u03FF][a-zA-Z0-9_]*'*)\s*\(/);
  if (fnMatch) return fnMatch[1];
  if (trimmed.length <= 14 && !/\s/.test(trimmed)) return trimmed;
  return `f${idx > 0 ? idx + 1 : ''}`;
}

/**
 * Formats a user-entered LaTeX or ASCII mathematical expression for KaTeX display when confirmed/blurred:
 * - Escapes standalone piecewise/conditional `{...}` blocks into `\left\{ ... \right\}`
 * - Converts ASCII `<=`, `>=`, `!=`, `*` into `\le`, `\ge`, `\ne`, `\cdot`
 * - Wraps bare multi-letter function identifiers like `Attention(`, `SwiGLU(`, `softmax(` in `\operatorname{...}`
 */
export function formatExpressionForKatex(rawLatex: string): string {
  let s = rawLatex.trim();
  if (!s) return '';

  // Escape unescaped piecewise/conditional `{ ... }` blocks (containing <, >, \le, \ge, <=, >=, :, or !=)
  s = s.replace(/(?<![\\^_a-zA-Z])\{([^{}]*(?:<=|>=|!=|<|>|:|\\le|\\ge|\\leq|\\geq|\\ne|\\neq)[^{}]*)\}/g, '\\left\\{$1\\right\\}');

  // Convert ASCII relational & multiplication operators for clean mathematical typography
  s = s
    .replace(/<=/g, ' \\le ')
    .replace(/>=/g, ' \\ge ')
    .replace(/!=/g, ' \\ne ')
    .replace(/\*/g, ' \\cdot ');

  // Wrap bare multi-letter functions (not already preceded by `\`, `{`, or `_`) in \operatorname{...}
  s = s.replace(
    /(?<![\\{a-zA-Z_])([a-zA-Z]{2,}[a-zA-Z0-9_]*)\s*\(/g,
    (_m, fnName: string) => `\\operatorname{${fnName.replace(/_/g, '\\_')}}(`
  );

  return s;
}



