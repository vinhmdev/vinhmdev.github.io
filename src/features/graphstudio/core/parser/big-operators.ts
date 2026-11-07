/**
 * Finite big operators (`\sum`, `\prod`) for the scalar plotting pipeline.
 *
 * Strategy: unroll at parse time. `\sum_{j=1}^{3} f(j)` is rewritten textually into the call
 * `Sum((f(j)), j, 1, 3)`, and the parser expands that call into nested binary
 * `['Add', ['Add', f(1), f(2)], f(3)]`.
 * Downstream stages (stability pass, JIT kernel, symbolic differentiation) therefore only ever
 * see ordinary `Add` / `Multiply` nodes and need no changes.
 */
import type { MathJsonExpr } from '../../types/math';

/** Upper bound on unrolled terms; keeps the generated JIT kernel small. */
export const MAX_BIG_OPERATOR_TERMS = 64;

const BIG_OPERATORS: Record<string, string> = {
  '\\sum': 'Sum',
  '\\prod': 'Product',
};

/** Characters that terminate an operand at bracket depth 0 (standard LaTeX summand scope). */
const BODY_TERMINATORS = new Set(['+', '-', '=', '<', '>', ',', ';', ':', '&', '|']);

interface ScriptPart {
  content: string;
  end: number;
}

function skipSpaces(s: string, p: number): number {
  let i = p;
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
}

function matchingClose(s: string, openIdx: number): number {
  const open = s[openIdx];
  const close = open === '{' ? '}' : open === '(' ? ')' : ']';
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === open) depth++;
    else if (s[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Reads a `_x` / `^{...}` script argument: a braced group, a digit run, or a single token. */
function readScriptArg(s: string, p: number): ScriptPart | null {
  const i = skipSpaces(s, p);
  if (i >= s.length) return null;
  if (s[i] === '{') {
    const close = matchingClose(s, i);
    if (close === -1) return null;
    return { content: s.slice(i + 1, close).trim(), end: close + 1 };
  }
  const run = /^(?:\d+|\\[a-zA-Z]+|[a-zA-Z])/.exec(s.slice(i));
  if (!run) return null;
  return { content: run[0], end: i + run[0].length };
}

/** Finds where the summand ends: next depth-0 binary +/-/relation/comma, unmatched close, or end. */
function findBodyEnd(s: string, start: number): number {
  let depth = 0;
  let sawOperand = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(' || ch === '{' || ch === '[') {
      depth++;
      sawOperand = true;
      continue;
    }
    if (ch === ')' || ch === '}' || ch === ']') {
      if (depth === 0) return i;
      depth--;
      continue;
    }
    if (depth === 0 && BODY_TERMINATORS.has(ch)) {
      // A leading sign belongs to the summand; a sign right after ^ or _ is part of a script.
      const prev = s.slice(start, i).trimEnd();
      const prevCh = prev[prev.length - 1];
      if ((ch === '+' || ch === '-') && (!sawOperand || prevCh === '^' || prevCh === '_')) continue;
      return i;
    }
    if (!/\s/.test(ch)) sawOperand = true;
  }
  return s.length;
}

/**
 * Rewrites every `\sum` / `\prod` (with optional `\limits`) into `Sum((body), j, lo, hi)` /
 * `Product(...)`. Nested operators are rewritten recursively. Malformed scripts are left untouched
 * so the parser reports an error instead of silently changing meaning.
 */
export function rewriteBigOperators(input: string): string {
  const match = /\\(sum|prod)(?![a-zA-Z])/.exec(input);
  if (!match) return input;

  const head = BIG_OPERATORS[`\\${match[1]}`];
  const before = input.slice(0, match.index);
  let p = match.index + match[0].length;
  p = skipSpaces(input, p);
  const limits = /^\\(?:no)?limits(?![a-zA-Z])/.exec(input.slice(p));
  if (limits) p += limits[0].length;

  let sub: ScriptPart | null = null;
  let sup: ScriptPart | null = null;
  for (let k = 0; k < 2; k++) {
    const q = skipSpaces(input, p);
    if (input[q] === '_' && !sub) {
      sub = readScriptArg(input, q + 1);
      if (!sub) break;
      p = sub.end;
    } else if (input[q] === '^' && !sup) {
      sup = readScriptArg(input, q + 1);
      if (!sup) break;
      p = sup.end;
    }
  }

  const bodyStart = skipSpaces(input, p);
  const bodyEnd = findBodyEnd(input, bodyStart);
  let body = input.slice(bodyStart, bodyEnd).trim();
  // A summand wrapped in a single LaTeX group `{...}` is a grouping, not a piecewise block.
  if (body.startsWith('{') && matchingClose(body, 0) === body.length - 1) {
    body = body.slice(1, -1);
  }
  const rest = input.slice(bodyEnd);

  const eq = sub ? sub.content.indexOf('=') : -1;
  const indexVar = (eq >= 0 ? sub!.content.slice(0, eq) : sub?.content ?? '').trim();
  const lower = eq >= 0 ? sub!.content.slice(eq + 1).trim() : '';
  const upper = sup?.content.trim() ?? '';

  // Emit only the parts that exist; expandBigOperatorCall reports which part is missing.
  const args = [`(${rewriteBigOperators(body)})`];
  if (indexVar) {
    args.push(indexVar);
    if (lower && upper) args.push(lower, upper);
  }
  return `${before} ${head}(${args.join(', ')})${rewriteBigOperators(rest)}`;
}

function readIntegerBound(node: MathJsonExpr, which: 'lower' | 'upper'): number {
  if (typeof node === 'number' && Number.isInteger(node)) return node;
  if (Array.isArray(node) && node[0] === 'Negate' && typeof node[1] === 'number') {
    const v = -node[1];
    if (Number.isInteger(v)) return v;
  }
  const shown = typeof node === 'string' ? `'${node}'` : 'expression';
  throw new Error(
    `Big operator ${which} bound ${shown} must be an integer literal (e.g. \\sum_{j=1}^{8})`
  );
}

/** Replaces the index variable, including inside subscripted names (`x_j` → `x_3`, `A_ij` → `A_i3`). */
function substituteIndex(node: MathJsonExpr, indexVar: string, value: number): MathJsonExpr {
  if (typeof node === 'string') {
    if (node === indexVar) return value;
    const us = node.indexOf('_');
    if (us > 0) {
      const base = node.slice(0, us);
      const script = node.slice(us + 1);
      if (script === indexVar) return `${base}_${value}`;
      if (indexVar.length === 1 && /^[a-zA-Z0-9]+$/.test(script) && script.includes(indexVar)) {
        return `${base}_${script.split(indexVar).join(String(value))}`;
      }
    }
    return node;
  }
  if (!Array.isArray(node)) return node;
  const [head, ...args] = node;
  return [head, ...args.map((a) => substituteIndex(a, indexVar, value))];
}

export function isBigOperatorHead(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === 'sum' || lower === 'product' || lower === 'prod';
}

/** Expands a parsed `Sum(body, j, lo, hi)` / `Product(...)` call into explicit Add / Multiply. */
export function expandBigOperatorCall(name: string, args: MathJsonExpr[]): MathJsonExpr {
  const isSum = name.toLowerCase() === 'sum';
  const label = isSum ? '\\sum' : '\\prod';
  const [body, indexNode, lowerNode, upperNode] = args;
  if (args.length < 2 || typeof indexNode !== 'string') {
    throw new Error(`${label} is missing its index variable, e.g. ${label}_{j=1}^{8}`);
  }
  if (args.length !== 4) {
    throw new Error(`${label} is missing a bound, e.g. ${label}_{${indexNode}=1}^{8}`);
  }
  const lo = readIntegerBound(lowerNode, 'lower');
  const hi = readIntegerBound(upperNode, 'upper');
  const count = hi - lo + 1;
  if (count > MAX_BIG_OPERATOR_TERMS) {
    throw new Error(
      `${label} has ${count} terms; at most ${MAX_BIG_OPERATOR_TERMS} terms can be plotted`
    );
  }
  if (count <= 0) return isSum ? 0 : 1;

  // Fold into a left-nested binary tree: Add / Multiply are strictly binary in the JIT and in
  // symbolic differentiation.
  const op = isSum ? 'Add' : 'Multiply';
  let acc = substituteIndex(body, indexNode, lo);
  for (let k = lo + 1; k <= hi; k++) acc = [op, acc, substituteIndex(body, indexNode, k)];
  return acc;
}

export interface BoundReplacement {
  from: string;
  to: string;
}

const INTEGER_LITERAL = /^-?\d+$/;

/**
 * Replaces non-literal `\sum` / `\prod` bounds (e.g. `^{L}`, `^{n-1}`, `_{j=k}`) with numeric
 * defaults so the operator can be unrolled. Used by the paste importer as an explicit, reported fix.
 */
export function substituteSymbolicBounds(
  input: string,
  defaults: { lower: number; upper: number }
): { latex: string; replaced: BoundReplacement[] } {
  const replaced: BoundReplacement[] = [];
  let out = '';
  let cursor = 0;
  const re = /\\(?:sum|prod)(?![a-zA-Z])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    let p = skipSpaces(input, m.index + m[0].length);
    const limits = /^\\(?:no)?limits(?![a-zA-Z])/.exec(input.slice(p));
    if (limits) p += limits[0].length;
    for (let k = 0; k < 2; k++) {
      const q = skipSpaces(input, p);
      const kind = input[q];
      if (kind !== '_' && kind !== '^') break;
      const arg = readScriptArg(input, q + 1);
      if (!arg) break;
      let next = arg.content;
      if (kind === '^' && !INTEGER_LITERAL.test(next)) {
        next = String(defaults.upper);
      } else if (kind === '_') {
        const eq = next.indexOf('=');
        const lower = eq >= 0 ? next.slice(eq + 1).trim() : '';
        if (eq >= 0 && !INTEGER_LITERAL.test(lower)) {
          next = `${next.slice(0, eq).trim()}=${defaults.lower}`;
        }
      }
      if (next !== arg.content) {
        const from = kind === '^' ? arg.content : arg.content.slice(arg.content.indexOf('=') + 1).trim();
        const to = kind === '^' ? next : String(defaults.lower);
        replaced.push({ from, to });
        out += `${input.slice(cursor, q + 1)}{${next}}`;
        cursor = arg.end;
      }
      p = arg.end;
    }
    re.lastIndex = Math.max(re.lastIndex, p);
  }
  return { latex: out + input.slice(cursor), replaced };
}
