/**
 * Symbolic Differentiation Engine with Clarke Subdifferential & Dirac Rules [FR-2.1, FR-2.3].
 *
 * Computes exact symbolic 1st and 2nd derivatives on MathJSON S-expressions
 * with O(1) Symbolic Kernel Lifting, algebraic simplification, and LaTeX formatting:
 * - ReLU(u) -> Heaviside(u) * u'  ;  d^2/dx^2 ReLU(x) = DiracDelta(x)
 * - Abs(u)  -> Sign(u) * u'       ;  d^2/dx^2 Abs(x)  = 2 * DiracDelta(x)
 * - SafeSigmoid(u) -> SafeSigmoid(u) * (1 - SafeSigmoid(u)) * u'
 * - BCEWithLogits(y, z) -> (SafeSigmoid(z) - y) * z'
 */
import type { MathJsonExpr } from '../../types/math';

export function symbolicDiff(expr: MathJsonExpr, variable: string): MathJsonExpr {
  const raw = diffNode(expr, variable);
  return simplifyAst(raw);
}

export function symbolicSecondDiff(expr: MathJsonExpr, variable: string): MathJsonExpr {
  const first = symbolicDiff(expr, variable);
  return symbolicDiff(first, variable);
}

function diffNode(expr: MathJsonExpr, v: string): MathJsonExpr {
  if (typeof expr === 'number') return 0;
  if (typeof expr === 'string') return expr === v ? 1 : 0;
  if (!Array.isArray(expr)) return 0;

  const [head, ...args] = expr;

  switch (head) {
    case 'Negate':
      return ['Negate', diffNode(args[0], v)];

    case 'Add':
      return ['Add', diffNode(args[0], v), diffNode(args[1], v)];

    case 'Subtract':
      return ['Subtract', diffNode(args[0], v), diffNode(args[1], v)];

    case 'Multiply': {
      const [u, w] = args;
      // Domain restriction guard: d/dv (u * {cond}) = {cond : u'} (preserves NaN outside domain even when u' = 0)
      if (Array.isArray(w) && w[0] === 'Piecewise' && w.length === 3 && w[2] === 1) {
        return ['Piecewise', w[1], diffNode(u, v)];
      }
      if (Array.isArray(u) && u[0] === 'Piecewise' && u.length === 3 && u[2] === 1) {
        return ['Piecewise', u[1], diffNode(w, v)];
      }
      const du = diffNode(u, v);
      const dw = diffNode(w, v);
      return ['Add', ['Multiply', du, w], ['Multiply', u, dw]];
    }

    case 'Divide': {
      const [u, w] = args;
      const du = diffNode(u, v);
      const dw = diffNode(w, v);
      return [
        'Divide',
        ['Subtract', ['Multiply', du, w], ['Multiply', u, dw]],
        ['Power', w, 2],
      ];
    }

    case 'Power': {
      const [base, exp] = args;
      const dBase = diffNode(base, v);
      const dExp = diffNode(exp, v);
      if (typeof exp === 'number') {
        if (exp === 0) return 0;
        if (exp === 1) return dBase;
        return ['Multiply', ['Multiply', exp, ['Power', base, exp - 1]], dBase];
      }
      if (dExp === 0) {
        return ['Multiply', ['Multiply', exp, ['Power', base, ['Subtract', exp, 1]]], dBase];
      }
      return [
        'Multiply',
        expr,
        ['Add', ['Multiply', dExp, ['Ln', base]], ['Divide', ['Multiply', exp, dBase], base]],
      ];
    }

    case 'Exp': {
      const u = args[0];
      return ['Multiply', ['Exp', u], diffNode(u, v)];
    }

    case 'Ln': {
      const u = args[0];
      return ['Divide', diffNode(u, v), u];
    }

    case 'Log10': {
      const u = args[0];
      return ['Divide', diffNode(u, v), ['Multiply', ['Ln', 10], u]];
    }

    case 'Log2': {
      const u = args[0];
      return ['Divide', diffNode(u, v), ['Multiply', ['Ln', 2], u]];
    }

    case 'Sqrt': {
      const u = args[0];
      return ['Divide', diffNode(u, v), ['Multiply', 2, ['Sqrt', u]]];
    }

    case 'Cbrt': {
      const u = args[0];
      return ['Divide', diffNode(u, v), ['Multiply', 3, ['Power', ['Cbrt', u], 2]]];
    }

    case 'Sin': {
      const u = args[0];
      return ['Multiply', ['Cos', u], diffNode(u, v)];
    }

    case 'Cos': {
      const u = args[0];
      return ['Multiply', ['Negate', ['Sin', u]], diffNode(u, v)];
    }

    case 'Tan': {
      const u = args[0];
      return ['Divide', diffNode(u, v), ['Power', ['Cos', u], 2]];
    }

    case 'Cot': {
      const u = args[0];
      return ['Negate', ['Divide', diffNode(u, v), ['Power', ['Sin', u], 2]]];
    }

    case 'Sec': {
      const u = args[0];
      return ['Multiply', ['Multiply', ['Sec', u], ['Tan', u]], diffNode(u, v)];
    }

    case 'Csc': {
      const u = args[0];
      return ['Negate', ['Multiply', ['Multiply', ['Csc', u], ['Cot', u]], diffNode(u, v)]];
    }

    case 'Asin': {
      const u = args[0];
      return ['Divide', diffNode(u, v), ['Sqrt', ['Subtract', 1, ['Power', u, 2]]]];
    }

    case 'Acos': {
      const u = args[0];
      return ['Negate', ['Divide', diffNode(u, v), ['Sqrt', ['Subtract', 1, ['Power', u, 2]]]]];
    }

    case 'Atan': {
      const u = args[0];
      return ['Divide', diffNode(u, v), ['Add', 1, ['Power', u, 2]]];
    }

    case 'Sinh': {
      const u = args[0];
      return ['Multiply', ['Cosh', u], diffNode(u, v)];
    }

    case 'Cosh': {
      const u = args[0];
      return ['Multiply', ['Sinh', u], diffNode(u, v)];
    }

    case 'Sinc': {
      const u = args[0];
      return [
        'Multiply',
        ['Divide', ['Subtract', ['Multiply', u, ['Cos', u]], ['Sin', u]], ['Power', u, 2]],
        diffNode(u, v),
      ];
    }

    case 'Tanh': {
      const u = args[0];
      return [
        'Multiply',
        ['Subtract', 1, ['Power', ['Tanh', u], 2]],
        diffNode(u, v),
      ];
    }

    case 'Sigmoid':
    case 'SafeSigmoid': {
      const u = args[0];
      const s: MathJsonExpr = ['SafeSigmoid', u];
      return ['Multiply', ['Multiply', s, ['Subtract', 1, s]], diffNode(u, v)];
    }

    case 'Softplus':
    case 'SafeSoftplus': {
      const u = args[0];
      return ['Multiply', ['SafeSigmoid', u], diffNode(u, v)];
    }

    case 'ReLU': {
      const u = args[0];
      return ['Multiply', ['Heaviside', u], diffNode(u, v)];
    }

    case 'LeakyReLU': {
      const u = args[0];
      const alpha = args[1] ?? 0.1;
      // alpha + (1 - alpha) * H(u)
      return [
        'Multiply',
        ['Add', alpha, ['Multiply', ['Subtract', 1, alpha], ['Heaviside', u]]],
        diffNode(u, v),
      ];
    }

    case 'ELU': {
      const u = args[0];
      const alpha = args[1] ?? 1.0;
      return [
        'Multiply',
        ['Add', ['Heaviside', u], ['Multiply', ['Subtract', 1, ['Heaviside', u]], ['Multiply', alpha, ['Exp', u]]]],
        diffNode(u, v),
      ];
    }

    case 'Swish': {
      const u = args[0];
      const s: MathJsonExpr = ['SafeSigmoid', u];
      return [
        'Multiply',
        ['Add', s, ['Multiply', u, ['Multiply', s, ['Subtract', 1, s]]]],
        diffNode(u, v),
      ];
    }

    case 'GELU': {
      const u = args[0];
      return ['Multiply', ['GELUDeriv1', u], diffNode(u, v)];
    }

    case 'GELUDeriv1': {
      const u = args[0];
      return ['Multiply', ['GELUDeriv2', u], diffNode(u, v)];
    }

    case 'GELUDeriv2': {
      const u = args[0];
      const du = diffNode(u, v);
      if (du === 0) return 0;
      const expTerm: MathJsonExpr = [
        'Divide',
        ['Exp', ['Negate', ['Divide', ['Power', u, 2], 2]]],
        ['Sqrt', ['Multiply', 2, 'Pi']],
      ];
      return ['Multiply', ['Multiply', ['Subtract', ['Power', u, 2], 3], expTerm], du];
    }

    case 'Gamma': {
      const u = args[0];
      return ['Multiply', ['Multiply', ['Gamma', u], ['Digamma', u]], diffNode(u, v)];
    }

    case 'Lgamma': {
      const u = args[0];
      return ['Multiply', ['Digamma', u], diffNode(u, v)];
    }

    case 'Digamma': {
      const u = args[0];
      return ['Multiply', ['Trigamma', u], diffNode(u, v)];
    }

    case 'Trigamma':
      return 0;

    case 'BetaPdf': {
      const [th, a, b] = args;
      const dth = diffNode(th, v);
      if (dth === 0) return 0;
      return [
        'Multiply',
        [
          'Multiply',
          ['BetaPdf', th, a, b],
          [
            'Subtract',
            ['Divide', ['Subtract', a, 1], th],
            ['Divide', ['Subtract', b, 1], ['Subtract', 1, th]],
          ],
        ],
        dth,
      ];
    }

    case 'Abs': {
      const u = args[0];
      return ['Multiply', ['Sign', u], diffNode(u, v)];
    }

    case 'Heaviside': {
      const u = args[0];
      return ['Multiply', ['DiracDelta', u], diffNode(u, v)];
    }

    case 'Sign': {
      const u = args[0];
      return ['Multiply', ['Multiply', 2, ['DiracDelta', u]], diffNode(u, v)];
    }

    case 'DiracDelta':
      return 0;

    case 'Huber': {
      const r = args[0];
      const delta = args[1] ?? 1.0;
      const dr = diffNode(r, v);
      // derivative wrt r is clamp(r, -delta, delta)
      return ['Multiply', ['Max', ['Negate', delta], ['Min', delta, r]], dr];
    }

    case 'Hinge': {
      const u = args[0];
      const y = args[1] ?? 1.0;
      const du = diffNode(u, v);
      return [
        'Multiply',
        ['Negate', ['Multiply', y, ['Heaviside', ['Subtract', 1, ['Multiply', y, u]]]]],
        du,
      ];
    }

    case 'BCEWithLogits': {
      const [y, z] = args;
      const dz = diffNode(z, v);
      return ['Multiply', ['Subtract', ['SafeSigmoid', z], y], dz];
    }

    case 'Softmax':
    case 'SafeSoftmax': {
      const zi = args[0];
      const dzi = diffNode(zi, v);
      if (args.length === 1) {
        const s: MathJsonExpr = ['SafeSigmoid', zi];
        return ['Multiply', ['Multiply', s, ['Subtract', 1, s]], dzi];
      }
      const sm: MathJsonExpr = ['SafeSoftmax', ...args];
      if (args.length === 2) {
        const dz1 = diffNode(args[1], v);
        return [
          'Multiply',
          ['Multiply', sm, ['Subtract', 1, sm]],
          ['Subtract', dzi, dz1],
        ];
      }
      const tau = args[4];
      const baseDeriv: MathJsonExpr = ['Multiply', ['Multiply', sm, ['Subtract', 1, sm]], dzi];
      return tau !== undefined ? ['Divide', baseDeriv, tau] : baseDeriv;
    }

    case 'SafeXLogY': {
      const [xArg, yArg] = args;
      const dx = diffNode(xArg, v);
      const dy = diffNode(yArg, v);
      return ['Add', ['Multiply', dx, ['Ln', yArg]], ['Divide', ['Multiply', xArg, dy], yArg]];
    }

    case 'Max': {
      const [a, b] = args;
      const da = diffNode(a, v);
      const db = diffNode(b, v);
      const h: MathJsonExpr = ['Heaviside', ['Subtract', a, b]];
      return ['Add', ['Multiply', h, da], ['Multiply', ['Subtract', 1, h], db]];
    }

    case 'Min': {
      const [a, b] = args;
      const da = diffNode(a, v);
      const db = diffNode(b, v);
      const h: MathJsonExpr = ['Heaviside', ['Subtract', b, a]];
      return ['Add', ['Multiply', h, da], ['Multiply', ['Subtract', 1, h], db]];
    }

    case 'Erf': {
      const u = args[0];
      const du = diffNode(u, v);
      return [
        'Multiply',
        ['Multiply', ['Divide', 2, ['Sqrt', 'Pi']], ['Exp', ['Negate', ['Power', u, 2]]]],
        du,
      ];
    }

    case 'BCE': {
      const [y, p] = args;
      const dp = diffNode(p, v);
      return [
        'Multiply',
        ['Subtract', ['Divide', ['Subtract', 1, y], ['Subtract', 1, p]], ['Divide', y, p]],
        dp,
      ];
    }

    case 'Floor':
    case 'Ceil':
    case 'Less':
    case 'LessEqual':
    case 'Greater':
    case 'GreaterEqual':
    case 'Equal':
    case 'NotEqual':
    case 'And':
    case 'Or':
      return 0;

    case 'Piecewise': {
      const outArgs: MathJsonExpr[] = [];
      const numPairs = Math.floor(args.length / 2);
      for (let k = 0; k < numPairs; k++) {
        outArgs.push(args[2 * k], diffNode(args[2 * k + 1], v));
      }
      if (args.length % 2 === 1) {
        outArgs.push(diffNode(args[args.length - 1], v));
      }
      return ['Piecewise', ...outArgs];
    }

    default: {
      const u = args[0];
      if (u === undefined) return 0;
      const du = diffNode(u, v);
      if (du === 0) return 0;
      return ['Multiply', [`${head}'`, u], du];
    }
  }
}

/** Algebraic constant-folding and identity simplification pass */
export function simplifyAst(expr: MathJsonExpr): MathJsonExpr {
  if (typeof expr === 'number' || typeof expr === 'string') return expr;
  if (!Array.isArray(expr)) return 0;

  const [head, ...rawArgs] = expr;
  const args = rawArgs.map(simplifyAst);

  if (head === 'Negate') {
    const a = args[0];
    if (a === 0) return 0;
    if (typeof a === 'number') return -a;
    if (Array.isArray(a) && a[0] === 'Negate') return a[1];
    return ['Negate', a];
  }

  if (head === 'Add') {
    const [a, b] = args;
    if (a === 0) return b;
    if (b === 0) return a;
    if (typeof a === 'number' && typeof b === 'number') return a + b;
    return ['Add', a, b];
  }

  if (head === 'Subtract') {
    const [a, b] = args;
    if (b === 0) return a;
    if (a === 0) return simplifyAst(['Negate', b]);
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (JSON.stringify(a) === JSON.stringify(b)) return 0;
    return ['Subtract', a, b];
  }

  if (head === 'Multiply') {
    const [a, b] = args;
    if (a === 0 || b === 0) return 0;
    if (a === 1) return b;
    if (b === 1) return a;
    if (a === -1) return simplifyAst(['Negate', b]);
    if (b === -1) return simplifyAst(['Negate', a]);
    if (typeof a === 'number' && typeof b === 'number') return a * b;
    return ['Multiply', a, b];
  }

  if (head === 'Divide') {
    const [a, b] = args;
    if (a === 0) return 0;
    if (b === 1) return a;
    if (typeof a === 'number' && typeof b === 'number' && b !== 0) return a / b;
    return ['Divide', a, b];
  }

  if (head === 'Power') {
    const [a, b] = args;
    if (b === 0) return 1;
    if (b === 1) return a;
    if (a === 0) return 0;
    if (a === 1) return 1;
    return ['Power', a, b];
  }

  return [head, ...args];
}

/** Converts a MathJSON AST back to clean display LaTeX (including H(x), \delta(x), and \{...\}) */
export function mathJsonToLatex(expr: MathJsonExpr): string {
  if (typeof expr === 'number') {
    return Number.isInteger(expr) ? String(expr) : Number(expr.toFixed(4)).toString();
  }
  if (typeof expr === 'string') {
    if (expr === 'ExponentialE') return 'e';
    if (expr === 'Pi') return '\\pi';
    const greek = [
      'sigma',
      'theta',
      'mu',
      'eta',
      'alpha',
      'beta',
      'lambda',
      'gamma',
      'delta',
      'tau',
      'epsilon',
      'rho',
      'phi',
      'psi',
      'omega',
      'kappa',
      'zeta',
      'nu',
      'xi',
      'chi',
    ];
    if (greek.includes(expr)) return `\\${expr}`;
    const uIdx = expr.indexOf('_');
    if (uIdx > 0) {
      const base = expr.slice(0, uIdx);
      const sub = expr.slice(uIdx + 1);
      const formattedBase = greek.includes(base) ? `\\${base}` : base;
      if (sub.length === 1) {
        return `${formattedBase}_${sub}`;
      }
      return `${formattedBase}_{${sub.replace(/_/g, ',')}}`;
    }
    if (expr.length > 1 && /^[a-zA-Z0-9]+$/.test(expr)) {
      return `\\text{${expr}}`;
    }
    return expr;
  }
  if (!Array.isArray(expr)) return '0';

  const [head, ...args] = expr;
  const s = args.map(mathJsonToLatex);

  switch (head) {
    case 'Negate':
      return `-${wrapIfCompound(expr[1], s[0])}`;
    case 'Add':
      return `${s[0]} + ${s[1]}`;
    case 'Subtract':
      return `${s[0]} - ${wrapIfCompound(expr[2], s[1])}`;
    case 'Multiply':
      return `${wrapIfAddSub(expr[1], s[0])} \\cdot ${wrapIfAddSub(expr[2], s[1])}`;
    case 'Divide':
      return `\\frac{${s[0]}}{${s[1]}}`;
    case 'Power':
      return `${wrapIfCompound(expr[1], s[0])}^{${s[1]}}`;
    case 'Sqrt':
      return `\\sqrt{${s[0]}}`;
    case 'Cbrt':
      return `\\operatorname{cbrt}(${s[0]})`;
    case 'Exp':
      return `e^{${s[0]}}`;
    case 'Ln':
      return `\\ln(${s[0]})`;
    case 'Log10':
      return `\\log_{10}(${s[0]})`;
    case 'Log2':
      return `\\log_2(${s[0]})`;
    case 'Sin':
      return `\\sin(${s[0]})`;
    case 'Cos':
      return `\\cos(${s[0]})`;
    case 'Tan':
      return `\\tan(${s[0]})`;
    case 'Tanh':
      return `\\tanh(${s[0]})`;
    case 'Sinh':
      return `\\sinh(${s[0]})`;
    case 'Cosh':
      return `\\cosh(${s[0]})`;
    case 'Sec':
      return `\\sec(${s[0]})`;
    case 'Csc':
      return `\\csc(${s[0]})`;
    case 'Cot':
      return `\\cot(${s[0]})`;
    case 'Arcsin':
    case 'Asin':
      return `\\arcsin(${s[0]})`;
    case 'Arccos':
    case 'Acos':
      return `\\arccos(${s[0]})`;
    case 'Arctan':
    case 'Atan':
      return `\\arctan(${s[0]})`;
    case 'Sinc':
      return `\\operatorname{sinc}(${s[0]})`;
    case 'Abs':
      return `\\left|${s[0]}\\right|`;
    case 'SafeSigmoid':
    case 'Sigmoid':
      return `\\sigma(${s[0]})`;
    case 'SafeSoftplus':
    case 'Softplus':
      return `\\operatorname{softplus}(${s[0]})`;
    case 'SafeSoftmax':
      return `\\operatorname{softmax}(${s.join(', ')})`;
    case 'ReLU':
      return `\\operatorname{ReLU}(${s[0]})`;
    case 'LeakyReLU':
      return `\\operatorname{leaky\\_relu}(${s.join(', ')})`;
    case 'ELU':
      return `\\operatorname{elu}(${s.join(', ')})`;
    case 'Swish':
      return `\\operatorname{swish}(${s.join(', ')})`;
    case 'Heaviside':
      return `H(${s[0]})`;
    case 'DiracDelta':
      return `\\delta(${s[0]})`;
    case 'Sign':
      return `\\operatorname{sign}(${s[0]})`;
    case 'GELU':
      return `\\operatorname{GELU}(${s[0]})`;
    case 'GELUDeriv1':
      return `\\operatorname{GELU}'(${s[0]})`;
    case 'GELUDeriv2':
      return `\\operatorname{GELU}''(${s[0]})`;
    case 'Gamma':
      return `\\operatorname{gamma}(${s[0]})`;
    case 'Lgamma':
      return `\\operatorname{lgamma}(${s[0]})`;
    case 'Digamma':
      return `\\operatorname{digamma}(${s[0]})`;
    case 'Trigamma':
      return `\\operatorname{trigamma}(${s[0]})`;
    case 'BetaPdf':
      return `\\operatorname{beta\\_pdf}(${s.join(', ')})`;
    case 'Max':
      return `\\max(${s.join(', ')})`;
    case 'Min':
      return `\\min(${s.join(', ')})`;
    case 'Erf':
      return `\\operatorname{erf}(${s[0]})`;
    case 'Huber':
      return `\\operatorname{huber}(${s.join(', ')})`;
    case 'Hinge':
      return `\\operatorname{hinge}(${s.join(', ')})`;
    case 'BCE':
      return `\\operatorname{bce}(${s.join(', ')})`;
    case 'BCEWithLogits':
      return `\\operatorname{bce\\_with\\_logits}(${s.join(', ')})`;
    case 'SafeXLogY':
      return `\\operatorname{xlogy}(${s.join(', ')})`;
    case 'Less':
      return `${s[0]} < ${s[1]}`;
    case 'LessEqual':
      return `${s[0]} \\le ${s[1]}`;
    case 'Greater':
      return `${s[0]} > ${s[1]}`;
    case 'GreaterEqual':
      return `${s[0]} \\ge ${s[1]}`;
    case 'Equal':
      return `${s[0]} = ${s[1]}`;
    case 'NotEqual':
      return `${s[0]} \\ne ${s[1]}`;
    case 'And':
      return s.join(' \\land ');
    case 'Or':
      return s.join(' \\lor ');
    case 'Piecewise': {
      if (args.length === 2 && args[1] === 1) {
        return `\\left\\{${s[0]}\\right\\}`;
      }
      const parts: string[] = [];
      const numPairs = Math.floor(s.length / 2);
      for (let k = 0; k < numPairs; k++) {
        parts.push(`${s[2 * k]}: ${s[2 * k + 1]}`);
      }
      if (s.length % 2 === 1) {
        parts.push(s[s.length - 1]);
      }
      return `\\left\\{${parts.join(', ')}\\right\\}`;
    }
    default:
      return `\\operatorname{${head}}(${s.join(', ')})`;
  }
}

function wrapIfAddSub(raw: MathJsonExpr, rendered: string): string {
  if (Array.isArray(raw) && (raw[0] === 'Add' || raw[0] === 'Subtract')) {
    return `(${rendered})`;
  }
  return rendered;
}

function wrapIfCompound(raw: MathJsonExpr, rendered: string): string {
  if (
    Array.isArray(raw) &&
    (raw[0] === 'Add' || raw[0] === 'Subtract' || raw[0] === 'Multiply' || raw[0] === 'Divide')
  ) {
    return `(${rendered})`;
  }
  return rendered;
}
