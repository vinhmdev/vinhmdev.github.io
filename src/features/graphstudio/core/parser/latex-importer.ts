/**
 * Paper LaTeX Importer: turns an arbitrary pasted LaTeX block (display math, align environments,
 * prose connectors like "where" / "với") into rows GraphStudio can show.
 *
 * Contract: every segment ends up either plottable (`ok` / `fixed`) or as a display-only `note`
 * with a stated reason. Every automatic rewrite is reported in `fixes`, and every place where
 * plotting simplifies the math (e.g. matrix → scalar) is reported in `warnings`. Nothing is
 * silently changed.
 *
 * All notice codes are i18n keys (`imp_*`) so the UI can translate them.
 */
import type { ClassifiedAST, LibraryFunctionEntry, MathJsonExpr, SymbolRole } from '../../types/math';
import { buildUserFunctionRegistry, classifyLatexExpression } from './ast-classifier';
import { substituteSymbolicBounds } from './big-operators';

export type ImportStatus = 'ok' | 'fixed' | 'note';

export interface ImportNotice {
  /** i18n key */
  code: string;
  /** Untranslated specifics (a command name, `L → 8`, a parser message) */
  detail?: string;
}

export interface ImportSegment {
  /** Segment text after pre-cleaning, before any fix */
  original: string;
  /** Text to store: fixed LaTeX for plottable rows, `original` for notes */
  latex: string;
  status: ImportStatus;
  fixes: ImportNotice[];
  warnings: ImportNotice[];
  /** Why the segment is a note (only for `status === 'note'`) */
  reason?: ImportNotice;
}

export interface ImportContext {
  symbolOverrides?: Record<string, SymbolRole>;
  /** Plottable rows already in the graph, so pasted calls to user functions resolve */
  existingExpressions?: ReadonlyArray<{ id?: string; latex: string }>;
  functionLibrary?: ReadonlyArray<LibraryFunctionEntry>;
}

/** Numeric bounds substituted for symbolic `\sum` / `\prod` limits (reported as a fix). */
export const IMPORT_DEFAULT_BOUNDS = { lower: 1, upper: 8 } as const;

// ---------------------------------------------------------------------------------------------
// 1. Pre-clean (meaning-preserving)
// ---------------------------------------------------------------------------------------------

const DISPLAY_ENVS =
  'equation|align|alignat|flalign|gather|multline|eqnarray|split|aligned|alignedat|gathered|displaymath|math';
const ENV_BEGIN = new RegExp(`\\\\begin\\{(?:${DISPLAY_ENVS})\\*?\\}(?:\\{\\d+\\})?`, 'g');
const ENV_END = new RegExp(`\\\\end\\{(?:${DISPLAY_ENVS})\\*?\\}`, 'g');
/** Segment separator inserted for display delimiters and environment boundaries. */
const HARD_BREAK = '\n\n';

function findMatchingBrace(s: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `\cmd{X}` → `X` (balanced), and bare `\cmd\theta` → `\theta`. */
function unwrapCommand(s: string, cmd: string): string {
  let out = s;
  const re = new RegExp(`\\\\${cmd}(?![a-zA-Z])\\s*`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(out)) !== null) {
    const start = m.index;
    const argStart = start + m[0].length;
    if (out[argStart] === '{') {
      const close = findMatchingBrace(out, argStart);
      if (close === -1) break;
      out = `${out.slice(0, start)}${out.slice(argStart + 1, close)}${out.slice(close + 1)}`;
    } else {
      out = `${out.slice(0, start)}${out.slice(argStart)}`;
    }
    re.lastIndex = start;
  }
  return out;
}

/** Removes alignment `&` outside of `cases` / matrix-like environments (where `&` is meaningful). */
function stripAlignmentAmpersands(s: string): string {
  let out = '';
  let envDepth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith('\\begin{', i)) envDepth++;
    else if (s.startsWith('\\end{', i)) envDepth = Math.max(0, envDepth - 1);
    if (s[i] === '&' && s[i - 1] !== '\\' && envDepth === 0) continue;
    out += s[i];
  }
  return out;
}

export function preCleanLatex(raw: string): string {
  let s = raw.replace(/\r\n?/g, '\n');
  s = s.replace(/(?<!\\)%[^\n]*/g, '');
  // `\\[2pt]` is a line break with spacing — normalize before treating `\[` as a delimiter.
  s = s.replace(/\\\\\s*\[[^\]\n]*\]/g, '\\\\');
  s = s.replace(/\$\$/g, HARD_BREAK);
  s = s.replace(/(?<!\\)\\[[\]()]/g, HARD_BREAK);
  s = s.replace(/(?<!\\)\$/g, HARD_BREAK);
  s = s.replace(ENV_BEGIN, HARD_BREAK).replace(ENV_END, HARD_BREAK);
  s = s.replace(/\\(?:label|tag\*?|eqref|ref)\s*\{[^{}]*\}/g, '');
  s = s.replace(/\\(?:nonumber|notag|displaystyle|textstyle|scriptstyle|scriptscriptstyle)(?![a-zA-Z])/g, '');
  for (const cmd of ['mathbf', 'boldsymbol', 'bm', 'mathit', 'mathsf', 'mathbfit', 'vec', 'pmb']) {
    s = unwrapCommand(s, cmd);
  }
  s = stripAlignmentAmpersands(s);
  return s;
}

// ---------------------------------------------------------------------------------------------
// 2. Split into segments
// ---------------------------------------------------------------------------------------------

const CONNECTOR_WORDS =
  'where|with|for|and|s\\.t\\.|subject to|such that|in which|with respect to|' +
  'với|trong đó|và|khi|cho|thỏa mãn|sao cho';
const CONNECTOR_RE = new RegExp(
  `^\\\\(?:text|textrm|textit|mathrm|mbox|operatorname)\\s*\\{\\s*(?:${CONNECTOR_WORDS})\\s*[:,]?\\s*\\}`,
  'iu'
);
const QUAD_RE = /^\\q?quad(?![a-zA-Z])/;
/** A piece that begins or ends with a binary operator continues the neighbouring piece. */
const LEADING_OP = /^(?:[+\-*/^_]|\\(?:cdot|times|pm|mp)(?![a-zA-Z]))/;
const TRAILING_OP = /(?:[+\-*/^_=({,]|\\(?:cdot|times|pm|mp|left)(?![a-zA-Z]))$/;

function trimSegment(s: string): string {
  return s.replace(/^[\s,.;]+|[\s,.;]+$/g, '');
}

/**
 * How a piece was terminated: `soft` = bare newline (often just source wrapping), `row` = `\\`
 * inside an align block, `block` = an explicit separator (display delimiter, `;`, `\quad`, "where").
 */
type BreakKind = 'soft' | 'row' | 'block';

export function splitLatexSegments(clean: string): string[] {
  const pieces: { text: string; brk: BreakKind }[] = [];
  let current = '';
  let depth = 0;
  let envDepth = 0;

  const flush = (brk: BreakKind): void => {
    pieces.push({ text: current, brk });
    current = '';
  };

  for (let i = 0; i < clean.length; ) {
    const rest = clean.slice(i);
    if (rest.startsWith('\\begin{')) envDepth++;
    if (rest.startsWith('\\end{')) envDepth = Math.max(0, envDepth - 1);
    const ch = clean[i];
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    if (ch === '}' || ch === ')' || ch === ']') depth = Math.max(0, depth - 1);

    if (depth === 0 && envDepth === 0) {
      if (rest.startsWith('\\\\')) {
        flush('row');
        i += 2;
        continue;
      }
      if (rest.startsWith(HARD_BREAK)) {
        flush('block');
        i += HARD_BREAK.length;
        continue;
      }
      if (ch === '\n') {
        flush('soft');
        i += 1;
        continue;
      }
      if (ch === ';') {
        flush('block');
        i += 1;
        continue;
      }
      const quad = QUAD_RE.exec(rest);
      if (quad) {
        flush('block');
        i += quad[0].length;
        continue;
      }
      const connector = CONNECTOR_RE.exec(rest);
      if (connector) {
        flush('block');
        i += connector[0].length;
        continue;
      }
    }
    current += ch;
    i += 1;
  }
  flush('block');

  // Merge soft (single-newline) breaks that sit inside one expression, then align-chain rows.
  const strength: Record<BreakKind, number> = { soft: 0, row: 1, block: 2 };
  const merged: string[] = [];
  // Strongest break seen since the last emitted segment (empty pieces still count as breaks).
  let pending: BreakKind = 'block';
  for (const piece of pieces) {
    const text = trimSegment(piece.text);
    if (!text) {
      if (strength[piece.brk] > strength[pending]) pending = piece.brk;
      continue;
    }
    const last = merged[merged.length - 1];
    if (last !== undefined && pending !== 'block') {
      const continues =
        LEADING_OP.test(text) || (pending === 'soft' && TRAILING_OP.test(last));
      if (continues) {
        merged[merged.length - 1] = `${last} ${text}`;
        pending = piece.brk;
        continue;
      }
      // `f(x) = a \\ = b` (align chains): the later row inherits the first row's left-hand side.
      if (text.startsWith('=')) {
        const eq = topLevelEqualsIndex(last);
        if (eq > 0) {
          merged.push(`${last.slice(0, eq).trim()} ${text}`);
          pending = piece.brk;
          continue;
        }
      }
    }
    merged.push(text);
    pending = piece.brk;
  }
  return merged;
}

/** Indices of assignment-style `=` at bracket depth 0 (excludes `<=`, `>=`, `!=`, `==`). */
function topLevelEqualsIndices(s: string): number[] {
  const found: number[] = [];
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') depth--;
    else if (
      ch === '=' &&
      depth === 0 &&
      !['<', '>', '!', '='].includes(s[i - 1] ?? '') &&
      s[i + 1] !== '='
    ) {
      found.push(i);
    }
  }
  return found;
}

function topLevelEqualsIndex(s: string): number {
  return topLevelEqualsIndices(s)[0] ?? -1;
}

// ---------------------------------------------------------------------------------------------
// 3. Notation that has no scalar plot → note immediately, with a specific reason
// ---------------------------------------------------------------------------------------------

const NON_SCALAR_NOTATION: { re: RegExp; code: string }[] = [
  { re: /\\(?:in|notin|subset|subseteq|supset|forall|exists|mathbb\s*\{\s*[RNZQC]\s*\})(?![a-zA-Z])/, code: 'imp_reason_set_notation' },
  { re: /\\(?:nabla|partial|int|iint|oint|lim|limsup|liminf)(?![a-zA-Z])/, code: 'imp_reason_calculus_operator' },
  { re: /\\(?:arg|sup|inf)(?![a-zA-Z])|\\(?:max|min)\s*_|\\operatorname\*/, code: 'imp_reason_optimization' },
  { re: /\\mathbb\s*\{\s*(?:E|P)\s*\}|\\(?:Pr|sim)(?![a-zA-Z])|\\mathcal\s*\{\s*N\s*\}|\\(?:mathrm|text|operatorname)\s*\{\s*(?:KL|Var|Cov)\s*\}/, code: 'imp_reason_probability' },
  { re: /\\begin\s*\{\s*(?:pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|matrix|array|smallmatrix)\s*\}|\\(?:dots|cdots|ldots|vdots|ddots|langle|rangle|det)(?![a-zA-Z])|\\(?:mathrm|operatorname)\s*\{\s*(?:tr|diag|rank)\s*\}/, code: 'imp_reason_matrix' },
  { re: /\\(?:to|rightarrow|Rightarrow|leftarrow|Leftarrow|gets|mapsto|propto|approx|equiv|iff|implies)(?![a-zA-Z])/, code: 'imp_reason_relation' },
];

/** `x_{t+1}`, `m_{t-1}`, `W^{(t-1)}`: a step-to-step update rule, not a function of one variable. */
const RECURRENCE_RE = /[_^]\s*\{\s*\(?\s*[a-zA-Z]\s*[+-]\s*1\s*\)?\s*\}/;

function detectNonScalarNotation(seg: string): ImportNotice | null {
  if (RECURRENCE_RE.test(seg)) return { code: 'imp_reason_recurrence' };
  for (const { re, code } of NON_SCALAR_NOTATION) {
    const m = re.exec(seg);
    if (m) return { code, detail: m[0].replace(/\s+/g, '') };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// 4. Fix rules
// ---------------------------------------------------------------------------------------------

interface FixResult {
  latex: string;
  notice: ImportNotice;
}

type FixRule = (latex: string, errorMessage: string) => FixResult | null;

const ACCENT_SUFFIX: Record<string, string> = { hat: 'h', bar: 'b', tilde: 't', dot: 'd', ddot: 'dd' };

/** Replaces `\Phi(arg)` (standard normal CDF) with its erf form. */
function rewriteNormalCdf(latex: string): string {
  let out = latex;
  for (let guard = 0; guard < 16; guard++) {
    const m = /\\Phi\s*(?:\\left\s*)?\(/.exec(out);
    if (!m) break;
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let i = open; i < out.length; i++) {
      if (out[i] === '(') depth++;
      else if (out[i] === ')') {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close === -1) break;
    const arg = out.slice(open + 1, close).replace(/\\right\s*$/, '');
    out =
      `${out.slice(0, m.index)}\\frac{1}{2}\\left(1 + \\operatorname{erf}\\left(\\frac{${arg}}{\\sqrt{2}}\\right)\\right)` +
      out.slice(close + 1);
  }
  return out;
}

/** Rules applied (in order) only while the segment still fails to parse. */
const FIX_LADDER: FixRule[] = [
  // A^{(l,h)}, W^{(t)}: parenthesized superscripts are indices (layer / head / step), not powers.
  (latex) => {
    const next = latex.replace(/\^\s*\{\s*\(\s*[a-zA-Z0-9]+(?:\s*,\s*[a-zA-Z0-9]+)*\s*\)\s*\}/g, '');
    return next !== latex ? { latex: next, notice: { code: 'imp_fix_index_superscript' } } : null;
  },
  // _{i,j} → _{ij}
  (latex) => {
    const next = latex.replace(/_\s*\{\s*([a-zA-Z0-9]+(?:\s*,\s*[a-zA-Z0-9]+)+)\s*\}/g, (_m, inner: string) =>
      `_{${inner.replace(/[\s,]/g, '')}}`
    );
    return next !== latex ? { latex: next, notice: { code: 'imp_fix_merge_subscript' } } : null;
  },
  // \hat{m}_t → m_{ht}, \bar{x} → x_{b}
  (latex) => {
    const mapped: string[] = [];
    const next = latex.replace(
      /\\(hat|bar|tilde|dot|ddot|widehat|widetilde|overline)\s*\{\s*([a-zA-Z])\s*\}(?:\s*_\s*(?:\{\s*([a-zA-Z0-9]+)\s*\}|([a-zA-Z0-9])))?/g,
      (_m, accent: string, base: string, subA?: string, subB?: string) => {
        const key = accent.replace(/^wide/, '').replace(/^overline$/, 'bar');
        const suffix = `${ACCENT_SUFFIX[key] ?? key[0]}${subA ?? subB ?? ''}`;
        const repl = `${base}_{${suffix}}`;
        mapped.push(`\\${accent}{${base}}${subA || subB ? `_${subA ?? subB}` : ''} → ${base}_${suffix}`);
        return repl;
      }
    );
    return next !== latex
      ? { latex: next, notice: { code: 'imp_fix_accent', detail: mapped.join(', ') } }
      : null;
  },
  // ‖w‖ → |w| (scalar norm = absolute value)
  (latex) => {
    const next = latex.replace(/\\left\s*\\\|/g, '\\left|').replace(/\\right\s*\\\|/g, '\\right|').replace(/\\\||\\Vert|\\lVert|\\rVert/g, '|');
    return next !== latex ? { latex: next, notice: { code: 'imp_fix_norm_abs' } } : null;
  },
  // Φ(x) → ½(1 + erf(x/√2))
  (latex) => {
    const next = rewriteNormalCdf(latex);
    return next !== latex ? { latex: next, notice: { code: 'imp_fix_normal_cdf' } } : null;
  },
  // \sum_{j=1}^{L} → \sum_{j=1}^{8}
  (latex, err) => {
    if (!/bound/.test(err)) return null;
    const { latex: bounded, replaced } = substituteSymbolicBounds(latex, IMPORT_DEFAULT_BOUNDS);
    if (replaced.length === 0) return null;
    // Keep the rest of the formula consistent: the `n` in `\frac{1}{n}\sum_{i=1}^{n}` is the same n.
    let next = bounded;
    for (const { from, to } of replaced) {
      if (/^[a-zA-Z]$/.test(from)) {
        next = next.replace(new RegExp(`(?<![a-zA-Z\\\\])${from}(?![a-zA-Z])`, 'g'), to);
      }
    }
    return {
      latex: next,
      notice: {
        code: 'imp_fix_symbolic_bound',
        detail: replaced.map((r) => `${r.from} → ${r.to}`).join(', '),
      },
    };
  },
  // `\sigma(z)_i = RHS`: keep the plottable right-hand side when the left-hand side is not a
  // function signature the parser understands. Last because it discards text.
  (latex) => {
    const eq = topLevelEqualsIndex(latex);
    if (eq <= 0) return null;
    const lhs = latex.slice(0, eq).trim();
    const rhs = latex.slice(eq + 1).trim();
    if (!rhs || topLevelEqualsIndex(rhs) >= 0) return null;
    return { latex: rhs, notice: { code: 'imp_fix_drop_lhs', detail: lhs } };
  },
];

/**
 * Rules applied even when the segment already parses, because the parse is semantically wrong.
 * `\gamma \frac{…}{…}` / `\gamma(…)` would otherwise be read as the Gamma function.
 */
const SEMANTIC_PREFIXES: FixRule[] = [
  // `f(x) = \mathrm{GELU}(x) = x\Phi(x)`: an equality chain would otherwise parse as the
  // comparison `GELU(x) = …` (a 0/1 function). Keep the first left side and the last right side.
  (latex) => {
    const eqs = topLevelEqualsIndices(latex);
    if (eqs.length < 2) return null;
    const first = eqs[0];
    const last = eqs[eqs.length - 1];
    const middle = latex.slice(first + 1, last).trim();
    return {
      latex: `${latex.slice(0, first).trim()} = ${latex.slice(last + 1).trim()}`,
      notice: { code: 'imp_fix_equality_chain', detail: middle },
    };
  },
  (latex) => {
    const next = latex.replace(/\\gamma(?![a-zA-Z])(\s*)(?=\\frac|\\left\s*\(|\()/g, '\\gamma \\cdot$1');
    return next !== latex ? { latex: next, notice: { code: 'imp_fix_gamma_product' } } : null;
  },
];

// ---------------------------------------------------------------------------------------------
// 5. Classification helpers
// ---------------------------------------------------------------------------------------------

function hasUnarySoftmax(node: MathJsonExpr): boolean {
  if (!Array.isArray(node)) return false;
  if (node[0] === 'Softmax' && node.length === 2) return true;
  return node.slice(1).some((child) => hasUnarySoftmax(child as MathJsonExpr));
}

function isConstraint(cls: ClassifiedAST): boolean {
  const top = Array.isArray(cls.expr) ? cls.expr[0] : null;
  const isRelation = top === 'Equal' || top === 'NotEqual';
  return isRelation && !cls.symbols.some((s) => s.role === 'data_var');
}

function collectWarnings(latex: string, cls: ClassifiedAST): ImportNotice[] {
  const warnings: ImportNotice[] = [];
  if (/\^\s*(?:\{\s*(?:T|\\top|\\intercal)\s*\}|T(?![a-zA-Z])|\\top|\\intercal)/.test(latex)) {
    warnings.push({ code: 'imp_warn_transpose' });
  }
  if (hasUnarySoftmax(cls.expr)) {
    warnings.push({ code: 'imp_warn_softmax_scalar' });
  }
  if (/\\(?:sum|prod)(?![a-zA-Z])/.test(latex)) {
    warnings.push({ code: 'imp_warn_unrolled' });
  }
  return warnings;
}

function reasonFromError(errorMessage: string): ImportNotice {
  const unknownFn = /Unknown function '([^']+)'/.exec(errorMessage);
  if (unknownFn) return { code: 'imp_reason_unknown_function', detail: unknownFn[1] };
  const terms = /has (\d+) terms/.exec(errorMessage);
  if (terms) return { code: 'imp_reason_too_many_terms', detail: terms[1] };
  return { code: 'imp_reason_parse_failed', detail: errorMessage };
}

// ---------------------------------------------------------------------------------------------
// 6. Public API
// ---------------------------------------------------------------------------------------------

function classify(
  latex: string,
  ctx: ImportContext,
  plottableSoFar: ReadonlyArray<{ id?: string; latex: string }>
): ClassifiedAST {
  const registry = buildUserFunctionRegistry(plottableSoFar, ctx.functionLibrary);
  return classifyLatexExpression(latex, ctx.symbolOverrides ?? {}, registry);
}

function asNote(original: string, reason: ImportNotice): ImportSegment {
  return { original, latex: original, status: 'note', fixes: [], warnings: [], reason };
}

export function analyzeSegment(
  original: string,
  ctx: ImportContext,
  plottableSoFar: ReadonlyArray<{ id?: string; latex: string }> = ctx.existingExpressions ?? []
): ImportSegment {
  const notation = detectNonScalarNotation(original);
  if (notation) return asNote(original, notation);

  const fixes: ImportNotice[] = [];
  let latex = original;
  for (const rule of SEMANTIC_PREFIXES) {
    const res = rule(latex, '');
    if (res) {
      latex = res.latex;
      fixes.push(res.notice);
    }
  }

  // Run the ladder to a fixed point: one fix can expose an error another rule handles
  // (e.g. dropping `\sigma(z)_i =` reveals a symbolic `\sum` bound). Each rule fires at most once.
  let cls = classify(latex, ctx, plottableSoFar);
  const applied = new Set<number>();
  let progressed = true;
  while (!cls.valid && progressed) {
    progressed = false;
    for (let r = 0; r < FIX_LADDER.length && !cls.valid; r++) {
      if (applied.has(r)) continue;
      const res = FIX_LADDER[r](latex, cls.errorMessage ?? '');
      if (!res) continue;
      applied.add(r);
      progressed = true;
      latex = res.latex;
      fixes.push(res.notice);
      cls = classify(latex, ctx, plottableSoFar);
    }
  }

  if (!cls.valid) return asNote(original, reasonFromError(cls.errorMessage ?? ''));
  if (isConstraint(cls)) return asNote(original, { code: 'imp_reason_constraint' });

  return {
    original,
    latex,
    status: fixes.length > 0 ? 'fixed' : 'ok',
    fixes,
    warnings: collectWarnings(latex, cls),
  };
}

/** Full pipeline: pre-clean → split → analyze each segment (earlier definitions are visible later). */
export function analyzePastedLatex(raw: string, ctx: ImportContext = {}): ImportSegment[] {
  const segments = splitLatexSegments(preCleanLatex(raw));
  const plottable: { id?: string; latex: string }[] = [...(ctx.existingExpressions ?? [])];
  return segments.map((seg, idx) => {
    const result = analyzeSegment(seg, ctx, plottable);
    if (result.status !== 'note') plottable.push({ id: `import-${idx}`, latex: result.latex });
    return result;
  });
}

/** True when a paste can go straight into the input without the review dialog. */
export function isTrivialPaste(segments: ImportSegment[]): boolean {
  return segments.length === 1 && segments[0].status === 'ok' && segments[0].warnings.length === 0;
}

/** Signals that a paste is a whole formula block from a paper, not a fragment being typed in. */
const BLOCK_PASTE_RE = /\n|\$|\\\\|\\begin\s*\{|\\quad|\\label|\\tag|\\\[|\\text\s*\{\s*(?:where|with|với|trong đó)/i;

/**
 * Decides whether pasting `text` into an expression input should open the import review.
 * Into an empty row: whenever the paste is not a single clean formula. Into a row that already
 * has content: only for block-like pastes, so pasting a fragment mid-formula stays native.
 */
export function shouldInterceptPaste(
  text: string,
  inputIsEmpty: boolean,
  ctx: ImportContext = {}
): boolean {
  if (!text.trim()) return false;
  if (!inputIsEmpty && !BLOCK_PASTE_RE.test(text)) return false;
  return !isTrivialPaste(analyzePastedLatex(text, ctx));
}
