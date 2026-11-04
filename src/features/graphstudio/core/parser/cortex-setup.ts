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
import type { MathJsonExpr } from '../../types/math';

let ceInstance: ComputeEngine | null = null;

export function getComputeEngine(): ComputeEngine {
  if (!ceInstance) {
    ceInstance = new ComputeEngine();
  }
  return ceInstance;
}

/** Canonical mapping from input function names (case-insensitive) to AST heads. */
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
};

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
  'r',
  'z',
  'z_1',
  'z_2',
  'z_3',
  'theta',
  'mu',
  'sigma',
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
  'e',
  'pi',
  'ExponentialE',
  'Pi',
]);

interface Token {
  type: 'num' | 'id' | 'op' | 'lparen' | 'rparen' | 'comma' | 'pipe';
  value: string;
  pos: number;
}

/**
 * Pre-normalizes LaTeX macros (\frac, \sqrt, \left|, \text{...}, Greek letters)
 * into clean mathematical notation before tokenization.
 */
export function normalizeLatexToAscii(raw: string): string {
  let s = raw.trim();
  if (!s) return '';

  // Strip leading f(x) = or y = or \hat{y} = or \mathcal{L}(w,b) =
  s = s.replace(
    /^(?:\\hat\{[a-zA-Z]+\}|\\mathcal\{[A-Z]\}|[a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\([^=]*\))?\s*=\s*/,
    ''
  );

  // Replace \left and \right and unescape \_
  s = s.replace(/\\left\s*/g, '').replace(/\\right\s*/g, '').replace(/\\_/g, '_');

  // Replace \text{...} and \operatorname{...} with surrounding spaces so adjacent identifiers do not fuse
  s = s.replace(/\\(?:text|operatorname|mathrm)\s*\{\s*([a-zA-Z0-9_\\]+)\s*\}/g, ' $1 ');

  // Recursively expand \frac{A}{B} -> ((A)/(B))
  let prev = '';
  while (prev !== s) {
    prev = s;
    s = replaceFrac(s);
    s = replaceCmd1(s, '\\sqrt', 'sqrt');
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
    [/\\tau\b/g, ' tau'],
    [/\\pi\b/g, ' Pi'],
    [/\\cdot\b/g, '*'],
    [/\\times\b/g, '*'],
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

  // Subscripts like x_{1} -> x_1
  s = s.replace(/_\{([a-zA-Z0-9]+)\}/g, '_$1');
  // Remaining curly braces { ... } -> ( ... )
  s = s.replace(/\{/g, '(').replace(/\}/g, ')');

  return s.trim();
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

function isKnownFunctionName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower in ML_FUNCTION_HEADS || name in ML_FUNCTION_HEADS || getRegisteredMathFunction(lower) !== undefined;
}

function splitImplicitIdentifier(ident: string, nextChar: string): string[] {
  if (nextChar === '(' && isKnownFunctionName(ident)) return [ident];
  if (KNOWN_SYMBOLS.has(ident)) return [ident];
  // e.g. "wx" -> ["w", "x"]
  if (ident.length === 2 && KNOWN_SYMBOLS.has(ident[0]) && KNOWN_SYMBOLS.has(ident[1])) {
    return [ident[0], ident[1]];
  }
  return [ident];
}

function tokenize(input: string): Token[] {
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
      let lookahead = i;
      while (lookahead < input.length && /\s/.test(input[lookahead])) lookahead++;
      const parts = splitImplicitIdentifier(rawId, input[lookahead] ?? '');
      for (const part of parts) {
        tokens.push({ type: 'id', value: part, pos: start });
      }
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
        tokens.push({ type: 'rparen', value: ')', pos: i });
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

  // Insert implicit multiplication tokens where appropriate:
  // e.g., 2x -> 2 * x, (x+1)(x-1) -> (x+1) * (x-1), w x -> w * x
  const out: Token[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const curr = tokens[k];
    out.push(curr);
    const next = tokens[k + 1];
    if (!next) continue;

    const currIsValue = curr.type === 'num' || curr.type === 'id' || curr.type === 'rparen';
    const nextIsStart = next.type === 'num' || next.type === 'id' || next.type === 'lparen';

    if (currIsValue && nextIsStart) {
      // Do NOT insert '*' if curr is a function identifier followed by '('
      // or an unknown multi-letter identifier followed by '(' (so parsePrimary reports 'Unknown function')
      const isValidVar =
        KNOWN_SYMBOLS.has(curr.value) || /^[a-zA-Z](?:_[0-9]+)?$/.test(curr.value);
      const isFnCallOrUnknownFn =
        curr.type === 'id' &&
        next.type === 'lparen' &&
        (isKnownFunctionName(curr.value) || !isValidVar);
      if (!isFnCallOrUnknownFn) {
        out.push({ type: 'op', value: '*', pos: curr.pos });
      }
    }
  }
  return out;
}

export interface ParseResult {
  valid: boolean;
  expr: MathJsonExpr;
  errorMessage?: string;
  errorOffset?: number;
}

/**
 * Parses LaTeX or ASCII mathematical input into a canonical MathJsonExpr AST.
 */
export function parseLatexToMathJson(rawInput: string): ParseResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { valid: false, expr: 0, errorMessage: 'Empty expression' };
  }

  try {
    const normalized = normalizeLatexToAscii(trimmed);
    const tokens = tokenize(normalized);
    if (tokens.length === 0) {
      return { valid: false, expr: 0, errorMessage: 'Empty expression' };
    }

    let pos = 0;
    const peek = (): Token | undefined => tokens[pos];
    const consume = (): Token => tokens[pos++];

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
        const inner = parseExpr();
        if (peek()?.type !== 'rparen') {
          throw new Error(`Missing closing parenthesis ')' near position ${tok.pos}`);
        }
        consume();
        return inner;
      }
      if (tok.type === 'id') {
        consume();
        const name = tok.value;
        // Function call check
        if (peek()?.type === 'lparen') {
          if (!isKnownFunctionName(name)) {
            throw new Error(`Unknown function '${name}'`);
          }
          consume(); // '('
          const args: MathJsonExpr[] = [];
          if (peek()?.type !== 'rparen') {
            args.push(parseExpr());
            while (peek()?.type === 'comma') {
              consume();
              args.push(parseExpr());
            }
          }
          if (peek()?.type !== 'rparen') {
            throw new Error(`Missing closing ')' for function '${name}'`);
          }
          consume(); // ')'
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
        if (!KNOWN_SYMBOLS.has(name) && !/^[a-zA-Z](?:_[0-9]+)?$/.test(name)) {
          throw new Error(`Unknown symbol '${name}'`);
        }
        return name;
      }
      throw new Error(`Unexpected token '${tok.value}' at position ${tok.pos}`);
    }

    const ast = parseExpr();
    if (pos < tokens.length) {
      const rem = tokens[pos];
      throw new Error(`Unexpected token '${rem.value}' at position ${rem.pos}`);
    }

    // Touch ComputeEngine singleton to ensure Cortex dictionary compatibility
    getComputeEngine();
    return { valid: true, expr: ast };
  } catch (err) {
    return {
      valid: false,
      expr: 0,
      errorMessage: err instanceof Error ? err.message : 'Syntax error',
    };
  }
}
