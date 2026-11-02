/**
 * Unboxed Scalar Register JIT Compiler with CSE [FR-2.3, FR-2.4, NFR-1].
 *
 * Compiles a stabilized MathJsonExpr AST into:
 * 1. `evaluateJet2(x, params, out)` — computes (v, d1, d2, branchMask, discMask)
 *    using flat local registers (v0, d1_0, d2_0, bm0, dm0) inside a V8 closure
 *    with ZERO heap object allocations per sample.
 * 2. `evaluateScalar(x, params)` — fast scalar closure for 3D surfaces and vector fields.
 */
import type { Jet2Tuple, MathJsonExpr, SubgradConvention } from '../../types/math';
import { applyStabilityPass } from '../parser/stability-pass';
import { SafeMathRuntime } from './safe-math-runtime';

export interface CompiledJet2Kernel {
  /** Evaluates Jet2 at independent variable `x` into a reusable 5-float buffer `out` */
  evalInto: (
    x: number,
    params: Record<string, number>,
    out: Float64Array,
    convention?: SubgradConvention,
    diracTau?: number
  ) => void;
  /** Convenience wrapper returning a Jet2Tuple */
  evalJet2: (
    x: number,
    params: Record<string, number>,
    convention?: SubgradConvention,
    diracTau?: number
  ) => Jet2Tuple;
  /** Ultra-fast scalar-only evaluation */
  evalScalar: (x: number, params: Record<string, number>) => number;
}

export function compileJet2Kernel(
  rawAst: MathJsonExpr,
  indepVar = 'x'
): CompiledJet2Kernel {
  const ast = applyStabilityPass(rawAst);

  // Common Subexpression Elimination (CSE) table
  const cseMap = new Map<string, number>();
  const statements: string[] = [];
  const scalarStatements: string[] = [];
  let regCounter = 0;
  let bitCounter = 1;

  function emitNode(node: MathJsonExpr): number {
    const key = JSON.stringify(node);
    const cached = cseMap.get(key);
    if (cached !== undefined) return cached;

    const id = regCounter++;

    if (typeof node === 'number') {
      const lit = Number.isFinite(node) ? String(node) : 'NaN';
      statements.push(`const v${id} = ${lit}, d1_${id} = 0.0, d2_${id} = 0.0, bm${id} = 0, dm${id} = 0;`);
      scalarStatements.push(`const v${id} = ${lit};`);
      cseMap.set(key, id);
      return id;
    }

    if (typeof node === 'string') {
      if (node === 'ExponentialE') {
        statements.push(`const v${id} = ${Math.E}, d1_${id} = 0.0, d2_${id} = 0.0, bm${id} = 0, dm${id} = 0;`);
        scalarStatements.push(`const v${id} = ${Math.E};`);
      } else if (node === 'Pi') {
        statements.push(`const v${id} = ${Math.PI}, d1_${id} = 0.0, d2_${id} = 0.0, bm${id} = 0, dm${id} = 0;`);
        scalarStatements.push(`const v${id} = ${Math.PI};`);
      } else if (node === indepVar) {
        statements.push(`const v${id} = x, d1_${id} = 1.0, d2_${id} = 0.0, bm${id} = 0, dm${id} = 0;`);
        scalarStatements.push(`const v${id} = x;`);
      } else {
        statements.push(
          `const v${id} = (params[${JSON.stringify(node)}] ?? 1.0), d1_${id} = 0.0, d2_${id} = 0.0, bm${id} = 0, dm${id} = 0;`
        );
        scalarStatements.push(`const v${id} = (params[${JSON.stringify(node)}] ?? 1.0);`);
      }
      cseMap.set(key, id);
      return id;
    }

    if (!Array.isArray(node)) {
      statements.push(`const v${id} = 0.0, d1_${id} = 0.0, d2_${id} = 0.0, bm${id} = 0, dm${id} = 0;`);
      scalarStatements.push(`const v${id} = 0.0;`);
      return id;
    }

    const [head, ...args] = node;
    const childIds = args.map(emitNode);
    const bit = 1 << ((bitCounter++) & 28);

    switch (head) {
      case 'Negate': {
        const a = childIds[0];
        statements.push(
          `const v${id} = -v${a}, d1_${id} = -d1_${a}, d2_${id} = -d2_${a}, bm${id} = bm${a}, dm${id} = dm${a};`
        );
        scalarStatements.push(`const v${id} = -v${a};`);
        break;
      }

      case 'Add': {
        const [a, b] = childIds;
        statements.push(
          `const v${id} = v${a} + v${b}, d1_${id} = d1_${a} + d1_${b}, d2_${id} = d2_${a} + d2_${b}, bm${id} = bm${a} ^ bm${b}, dm${id} = dm${a} ^ dm${b};`
        );
        scalarStatements.push(`const v${id} = v${a} + v${b};`);
        break;
      }

      case 'Subtract': {
        const [a, b] = childIds;
        statements.push(
          `const v${id} = v${a} - v${b}, d1_${id} = d1_${a} - d1_${b}, d2_${id} = d2_${a} - d2_${b}, bm${id} = bm${a} ^ bm${b}, dm${id} = dm${a} ^ dm${b};`
        );
        scalarStatements.push(`const v${id} = v${a} - v${b};`);
        break;
      }

      case 'Multiply': {
        const [a, b] = childIds;
        statements.push(
          `const v${id} = v${a} * v${b}, ` +
            `d1_${id} = d1_${a} * v${b} + v${a} * d1_${b}, ` +
            `d2_${id} = d2_${a} * v${b} + 2.0 * d1_${a} * d1_${b} + v${a} * d2_${b}, ` +
            `bm${id} = bm${a} ^ bm${b}, dm${id} = dm${a} ^ dm${b};`
        );
        scalarStatements.push(`const v${id} = v${a} * v${b};`);
        break;
      }

      case 'Divide': {
        const [a, b] = childIds;
        // Mark pole discontinuity bit when denominator v_b changes sign!
        statements.push(
          `const inv_${id} = v${b} === 0.0 ? NaN : 1.0 / v${b}; ` +
            `const v${id} = v${a} * inv_${id}; ` +
            `const d1_${id} = (d1_${a} - v${id} * d1_${b}) * inv_${id}; ` +
            `const d2_${id} = (d2_${a} - 2.0 * d1_${id} * d1_${b} - v${id} * d2_${b}) * inv_${id}; ` +
            `const bm${id} = bm${a} ^ bm${b}; ` +
            `const dm${id} = dm${a} ^ dm${b} ^ (v${b} >= 0.0 ? ${bit} : 0);`
        );
        scalarStatements.push(`const v${id} = v${b} === 0.0 ? NaN : v${a} / v${b};`);
        break;
      }

      case 'Power': {
        const [a, b] = childIds;
        statements.push(
          `let v${id}, d1_${id}, d2_${id}, bm${id} = bm${a} ^ bm${b}, dm${id} = dm${a} ^ dm${b}; ` +
            `if (d1_${b} === 0.0 && d2_${b} === 0.0) { ` +
            `  v${id} = Math.pow(v${a}, v${b}); ` +
            `  const p1 = v${b} === 0.0 ? 0.0 : v${b} * Math.pow(v${a}, v${b} - 1.0); ` +
            `  const p2 = (v${b} === 0.0 || v${b} === 1.0) ? 0.0 : v${b} * (v${b} - 1.0) * Math.pow(v${a}, v${b} - 2.0); ` +
            `  d1_${id} = p1 * d1_${a}; ` +
            `  d2_${id} = p1 * d2_${a} + p2 * d1_${a} * d1_${a}; ` +
            `} else { ` +
            `  v${id} = Math.pow(v${a}, v${b}); ` +
            `  const lna = v${a} > 0.0 ? Math.log(v${a}) : NaN; ` +
            `  const u1 = d1_${b} * lna + (v${b} / v${a}) * d1_${a}; ` +
            `  d1_${id} = v${id} * u1; ` +
            `  d2_${id} = v${id} * (u1 * u1 + d2_${b} * lna + 2.0 * d1_${b} * d1_${a} / v${a} + v${b} * (d2_${a} * v${a} - d1_${a} * d1_${a}) / (v${a} * v${a})); ` +
            `}`
        );
        scalarStatements.push(`const v${id} = Math.pow(v${a}, v${b});`);
        break;
      }

      case 'Sin': {
        const a = childIds[0];
        statements.push(
          `const v${id} = Math.sin(v${a}), c_${id} = Math.cos(v${a}); ` +
            `const d1_${id} = c_${id} * d1_${a}, d2_${id} = c_${id} * d2_${a} - v${id} * d1_${a} * d1_${a}, bm${id} = bm${a}, dm${id} = dm${a};`
        );
        scalarStatements.push(`const v${id} = Math.sin(v${a});`);
        break;
      }

      case 'Cos': {
        const a = childIds[0];
        statements.push(
          `const v${id} = Math.cos(v${a}), s_${id} = Math.sin(v${a}); ` +
            `const d1_${id} = -s_${id} * d1_${a}, d2_${id} = -s_${id} * d2_${a} - v${id} * d1_${a} * d1_${a}, bm${id} = bm${a}, dm${id} = dm${a};`
        );
        scalarStatements.push(`const v${id} = Math.cos(v${a});`);
        break;
      }

      case 'Tan': {
        const a = childIds[0];
        statements.push(
          `const c_${id} = Math.cos(v${a}), v${id} = Math.tan(v${a}), sec2_${id} = 1.0 / (c_${id} * c_${id}); ` +
            `const d1_${id} = sec2_${id} * d1_${a}, d2_${id} = sec2_${id} * d2_${a} + 2.0 * sec2_${id} * v${id} * d1_${a} * d1_${a}; ` +
            `const bm${id} = bm${a}, dm${id} = dm${a} ^ (c_${id} >= 0.0 ? ${bit} : 0);`
        );
        scalarStatements.push(`const v${id} = Math.tan(v${a});`);
        break;
      }

      case 'Exp': {
        const a = childIds[0];
        statements.push(
          `const v${id} = Math.exp(v${a}), d1_${id} = v${id} * d1_${a}, d2_${id} = v${id} * (d2_${a} + d1_${a} * d1_${a}), bm${id} = bm${a}, dm${id} = dm${a};`
        );
        scalarStatements.push(`const v${id} = Math.exp(v${a});`);
        break;
      }

      case 'Ln': {
        const a = childIds[0];
        statements.push(
          `const v${id} = v${a} > 0.0 ? Math.log(v${a}) : NaN; ` +
            `const inv_${id} = v${a} > 0.0 ? 1.0 / v${a} : NaN; ` +
            `const d1_${id} = inv_${id} * d1_${a}, d2_${id} = inv_${id} * d2_${a} - inv_${id} * inv_${id} * d1_${a} * d1_${a}; ` +
            `const bm${id} = bm${a}, dm${id} = dm${a} ^ (v${a} > 0.0 ? ${bit} : 0);`
        );
        scalarStatements.push(`const v${id} = v${a} > 0.0 ? Math.log(v${a}) : NaN;`);
        break;
      }

      case 'Sqrt': {
        const a = childIds[0];
        statements.push(
          `const v${id} = v${a} >= 0.0 ? Math.sqrt(v${a}) : NaN; ` +
            `const fp_${id} = v${id} > 1e-15 ? 0.5 / v${id} : 0.0; ` +
            `const fpp_${id} = v${id} > 1e-15 ? -0.25 / (v${a} * v${id}) : 0.0; ` +
            `const d1_${id} = fp_${id} * d1_${a}, d2_${id} = fp_${id} * d2_${a} + fpp_${id} * d1_${a} * d1_${a}; ` +
            `const bm${id} = bm${a} ^ (v${a} >= 0.0 ? ${bit} : 0), dm${id} = dm${a};`
        );
        scalarStatements.push(`const v${id} = v${a} >= 0.0 ? Math.sqrt(v${a}) : NaN;`);
        break;
      }

      case 'Tanh': {
        const a = childIds[0];
        statements.push(
          `const v${id} = Math.tanh(v${a}), sech2_${id} = 1.0 - v${id} * v${id}; ` +
            `const d1_${id} = sech2_${id} * d1_${a}, d2_${id} = sech2_${id} * d2_${a} - 2.0 * v${id} * sech2_${id} * d1_${a} * d1_${a}, bm${id} = bm${a}, dm${id} = dm${a};`
        );
        scalarStatements.push(`const v${id} = Math.tanh(v${a});`);
        break;
      }

      case 'Sigmoid':
      case 'SafeSigmoid': {
        const a = childIds[0];
        statements.push(
          `const v${id} = rt.safeSigmoid(v${a}), fp_${id} = rt.safeSigmoidDeriv1(v${a}), fpp_${id} = rt.safeSigmoidDeriv2(v${a}); ` +
            `const d1_${id} = fp_${id} * d1_${a}, d2_${id} = fp_${id} * d2_${a} + fpp_${id} * d1_${a} * d1_${a}, bm${id} = bm${a}, dm${id} = dm${a};`
        );
        scalarStatements.push(`const v${id} = rt.safeSigmoid(v${a});`);
        break;
      }

      case 'Softplus':
      case 'SafeSoftplus': {
        const a = childIds[0];
        statements.push(
          `const v${id} = rt.safeSoftplus(v${a}), fp_${id} = rt.safeSigmoid(v${a}), fpp_${id} = rt.safeSigmoidDeriv1(v${a}); ` +
            `const d1_${id} = fp_${id} * d1_${a}, d2_${id} = fp_${id} * d2_${a} + fpp_${id} * d1_${a} * d1_${a}, bm${id} = bm${a}, dm${id} = dm${a};`
        );
        scalarStatements.push(`const v${id} = rt.safeSoftplus(v${a});`);
        break;
      }

      case 'ReLU': {
        const a = childIds[0];
        statements.push(
          `const v${id} = v${a} > 0.0 ? v${a} : 0.0; ` +
            `const fp_${id} = v${a} > 0.0 ? 1.0 : (v${a} < 0.0 ? 0.0 : h0); ` +
            `const fpp_${id} = rt.diracMollifier(v${a}, diracTau); ` +
            `const d1_${id} = fp_${id} * d1_${a}, d2_${id} = fp_${id} * d2_${a} + fpp_${id} * d1_${a} * d1_${a}; ` +
            `const bm${id} = bm${a} ^ (v${a} >= 0.0 ? ${bit} : 0), dm${id} = dm${a};`
        );
        scalarStatements.push(`const v${id} = v${a} > 0.0 ? v${a} : 0.0;`);
        break;
      }

      case 'LeakyReLU': {
        const a = childIds[0];
        const alphaId = childIds[1];
        const alphaExpr = alphaId !== undefined ? `v${alphaId}` : '(params["alpha"] ?? 0.1)';
        statements.push(
          `const al_${id} = ${alphaExpr}; ` +
            `const v${id} = v${a} >= 0.0 ? v${a} : al_${id} * v${a}; ` +
            `const fp_${id} = v${a} > 0.0 ? 1.0 : (v${a} < 0.0 ? al_${id} : al_${id} + (1.0 - al_${id}) * h0); ` +
            `const fpp_${id} = (1.0 - al_${id}) * rt.diracMollifier(v${a}, diracTau); ` +
            `const d1_${id} = fp_${id} * d1_${a}, d2_${id} = fp_${id} * d2_${a} + fpp_${id} * d1_${a} * d1_${a}; ` +
            `const bm${id} = bm${a} ^ (v${a} >= 0.0 ? ${bit} : 0), dm${id} = dm${a};`
        );
        scalarStatements.push(`const v${id} = v${a} >= 0.0 ? v${a} : (${alphaExpr}) * v${a};`);
        break;
      }

      case 'ELU': {
        const a = childIds[0];
        const alphaId = childIds[1];
        const alphaExpr = alphaId !== undefined ? `v${alphaId}` : '(params["alpha"] ?? 1.0)';
        statements.push(
          `const al_${id} = ${alphaExpr}; ` +
            `const v${id} = rt.elu(v${a}, al_${id}); ` +
            `const fp_${id} = v${a} >= 0.0 ? 1.0 : al_${id} * Math.exp(v${a}); ` +
            `const fpp_${id} = v${a} >= 0.0 ? 0.0 : al_${id} * Math.exp(v${a}); ` +
            `const d1_${id} = fp_${id} * d1_${a}, d2_${id} = fp_${id} * d2_${a} + fpp_${id} * d1_${a} * d1_${a}; ` +
            `const bm${id} = bm${a} ^ (v${a} >= 0.0 ? ${bit} : 0), dm${id} = dm${a};`
        );
        scalarStatements.push(`const v${id} = rt.elu(v${a}, ${alphaExpr});`);
        break;
      }

      case 'Swish': {
        const a = childIds[0];
        const betaId = childIds[1];
        const betaExpr = betaId !== undefined ? `v${betaId}` : '(params["beta"] ?? 1.0)';
        statements.push(
          `const bt_${id} = ${betaExpr}, z_${id} = bt_${id} * v${a}; ` +
            `const s_${id} = rt.safeSigmoid(z_${id}), sp_${id} = rt.safeSigmoidDeriv1(z_${id}), spp_${id} = rt.safeSigmoidDeriv2(z_${id}); ` +
            `const v${id} = v${a} * s_${id}; ` +
            `const fp_${id} = s_${id} + z_${id} * sp_${id}; ` +
            `const fpp_${id} = bt_${id} * (2.0 * sp_${id} + z_${id} * spp_${id}); ` +
            `const d1_${id} = fp_${id} * d1_${a}, d2_${id} = fp_${id} * d2_${a} + fpp_${id} * d1_${a} * d1_${a}, bm${id} = bm${a}, dm${id} = dm${a};`
        );
        scalarStatements.push(`const v${id} = rt.swish(v${a}, ${betaExpr});`);
        break;
      }

      case 'GELU': {
        const a = childIds[0];
        statements.push(
          `const v${id} = rt.gelu(v${a}), fp_${id} = rt.geluDeriv1(v${a}), fpp_${id} = rt.geluDeriv2(v${a}); ` +
            `const d1_${id} = fp_${id} * d1_${a}, d2_${id} = fp_${id} * d2_${a} + fpp_${id} * d1_${a} * d1_${a}, bm${id} = bm${a}, dm${id} = dm${a};`
        );
        scalarStatements.push(`const v${id} = rt.gelu(v${a});`);
        break;
      }

      case 'Abs': {
        const a = childIds[0];
        statements.push(
          `const v${id} = Math.abs(v${a}); ` +
            `const fp_${id} = v${a} > 0.0 ? 1.0 : (v${a} < 0.0 ? -1.0 : 0.0); ` +
            `const fpp_${id} = 2.0 * rt.diracMollifier(v${a}, diracTau); ` +
            `const d1_${id} = fp_${id} * d1_${a}, d2_${id} = fp_${id} * d2_${a} + fpp_${id} * d1_${a} * d1_${a}; ` +
            `const bm${id} = bm${a} ^ (v${a} >= 0.0 ? ${bit} : 0), dm${id} = dm${a};`
        );
        scalarStatements.push(`const v${id} = Math.abs(v${a});`);
        break;
      }

      case 'Heaviside': {
        const a = childIds[0];
        statements.push(
          `const v${id} = v${a} > 0.0 ? 1.0 : (v${a} < 0.0 ? 0.0 : h0); ` +
            `const fp_${id} = rt.diracMollifier(v${a}, diracTau); ` +
            `const d1_${id} = fp_${id} * d1_${a}, d2_${id} = 0.0; ` +
            `const bm${id} = bm${a}, dm${id} = dm${a} ^ (v${a} >= 0.0 ? ${bit} : 0);`
        );
        scalarStatements.push(`const v${id} = v${a} > 0.0 ? 1.0 : (v${a} < 0.0 ? 0.0 : 0.0);`);
        break;
      }

      case 'Sign': {
        const a = childIds[0];
        statements.push(
          `const v${id} = v${a} > 0.0 ? 1.0 : (v${a} < 0.0 ? -1.0 : 0.0); ` +
            `const fp_${id} = 2.0 * rt.diracMollifier(v${a}, diracTau); ` +
            `const d1_${id} = fp_${id} * d1_${a}, d2_${id} = 0.0; ` +
            `const bm${id} = bm${a}, dm${id} = dm${a} ^ (v${a} >= 0.0 ? ${bit} : 0);`
        );
        scalarStatements.push(`const v${id} = v${a} > 0.0 ? 1.0 : (v${a} < 0.0 ? -1.0 : 0.0);`);
        break;
      }

      case 'DiracDelta': {
        const a = childIds[0];
        statements.push(
          `const v${id} = rt.diracMollifier(v${a}, diracTau); ` +
            `const s_${id} = rt.safeSigmoid(v${a} / diracTau); ` +
            `const fp_${id} = (s_${id} * (1.0 - s_${id}) * (1.0 - 2.0 * s_${id})) / (diracTau * diracTau); ` +
            `const d1_${id} = fp_${id} * d1_${a}, d2_${id} = 0.0, bm${id} = bm${a}, dm${id} = dm${a};`
        );
        scalarStatements.push(`const v${id} = rt.diracMollifier(v${a}, 0.04);`);
        break;
      }

      case 'Huber': {
        const a = childIds[0];
        const dId = childIds[1];
        const dExpr = dId !== undefined ? `Math.max(Math.abs(v${dId}), 1e-6)` : 'Math.max(Math.abs(params["delta"] ?? 1.0), 1e-6)';
        const bit2 = 1 << ((bitCounter++) & 28);
        statements.push(
          `const dl_${id} = ${dExpr}, v${id} = rt.huber(v${a}, dl_${id}); ` +
            `const inQuad_${id} = Math.abs(v${a}) <= dl_${id}; ` +
            `const fp_${id} = inQuad_${id} ? v${a} : (v${a} > 0.0 ? dl_${id} : -dl_${id}); ` +
            `const fpp_${id} = inQuad_${id} ? 1.0 : 0.0; ` +
            `const d1_${id} = fp_${id} * d1_${a}, d2_${id} = fp_${id} * d2_${a} + fpp_${id} * d1_${a} * d1_${a}; ` +
            `const bm${id} = bm${a} ^ (v${a} >= -dl_${id} ? ${bit} : 0) ^ (v${a} >= dl_${id} ? ${bit2} : 0), dm${id} = dm${a};`
        );
        scalarStatements.push(`const v${id} = rt.huber(v${a}, ${dExpr});`);
        break;
      }

      case 'Hinge': {
        const a = childIds[0];
        const yId = childIds[1];
        const yExpr = yId !== undefined ? `v${yId}` : '(params["y"] ?? 1.0)';
        statements.push(
          `const yy_${id} = ${yExpr}, m_${id} = 1.0 - yy_${id} * v${a}; ` +
            `const v${id} = m_${id} > 0.0 ? m_${id} : 0.0; ` +
            `const fp_${id} = m_${id} > 0.0 ? -yy_${id} : (m_${id} < 0.0 ? 0.0 : -yy_${id} * h0); ` +
            `const d1_${id} = fp_${id} * d1_${a}, d2_${id} = fp_${id} * d2_${a}; ` +
            `const bm${id} = bm${a} ^ (m_${id} >= 0.0 ? ${bit} : 0), dm${id} = dm${a};`
        );
        scalarStatements.push(`const v${id} = Math.max(0.0, 1.0 - (${yExpr}) * v${a});`);
        break;
      }

      case 'BCEWithLogits': {
        const [yId, zId] = childIds;
        statements.push(
          `const v${id} = rt.bceWithLogits(v${yId}, v${zId}); ` +
            `const fp_${id} = rt.bceWithLogitsDerivZ(v${yId}, v${zId}); ` +
            `const fpp_${id} = rt.safeSigmoidDeriv1(v${zId}); ` +
            `const d1_${id} = fp_${id} * d1_${zId} - v${zId} * d1_${yId}; ` +
            `const d2_${id} = fp_${id} * d2_${zId} + fpp_${id} * d1_${zId} * d1_${zId}; ` +
            `const bm${id} = bm${yId} ^ bm${zId}, dm${id} = dm${yId} ^ dm${zId};`
        );
        scalarStatements.push(`const v${id} = rt.bceWithLogits(v${yId}, v${zId});`);
        break;
      }

      case 'SafeSoftmax': {
        const zi = childIds[0];
        const z1 = childIds[1] ?? zi;
        const z2 = childIds[2] ?? zi;
        const z3 = childIds[3] ?? zi;
        const tauId = childIds[4];
        const tauExpr = tauId !== undefined ? `v${tauId}` : '(params["tau"] ?? 0.5)';
        statements.push(
          `const t_${id} = Math.max(Math.abs(${tauExpr}), 1e-9); ` +
            `const v${id} = rt.safeSoftmax(v${zi}, v${z1}, v${z2}, v${z3}, t_${id}); ` +
            `const fp_${id} = (v${id} * (1.0 - v${id})) / t_${id}; ` +
            `const fpp_${id} = (fp_${id} * (1.0 - 2.0 * v${id})) / t_${id}; ` +
            `const d1_${id} = fp_${id} * d1_${zi}, d2_${id} = fp_${id} * d2_${zi} + fpp_${id} * d1_${zi} * d1_${zi}; ` +
            `const bm${id} = bm${zi}, dm${id} = dm${zi};`
        );
        scalarStatements.push(
          `const v${id} = rt.safeSoftmax(v${zi}, v${z1}, v${z2}, v${z3}, ${tauExpr});`
        );
        break;
      }

      case 'SafeXLogY': {
        const [xId, yId] = childIds;
        statements.push(
          `const v${id} = rt.safeXLogY(v${xId}, v${yId}); ` +
            `const sy_${id} = Math.max(v${yId}, 1e-15); ` +
            `const d1_${id} = (v${xId} === 0.0 && d1_${xId} === 0.0) ? 0.0 : (d1_${xId} * Math.log(sy_${id}) + (v${xId} / sy_${id}) * d1_${yId}); ` +
            `const d2_${id} = 0.0, bm${id} = bm${xId} ^ bm${yId}, dm${id} = dm${xId} ^ dm${yId};`
        );
        scalarStatements.push(`const v${id} = rt.safeXLogY(v${xId}, v${yId});`);
        break;
      }

      case 'BetaPdf': {
        const [thId, aId, bId] = childIds;
        statements.push(
          `const v${id} = rt.betaPdf(v${thId}, v${aId}, v${bId}); ` +
            `const th_${id} = Math.min(Math.max(v${thId}, 1e-6), 1.0 - 1e-6); ` +
            `const lp1_${id} = (v${aId} - 1.0) / th_${id} - (v${bId} - 1.0) / (1.0 - th_${id}); ` +
            `const lp2_${id} = -(v${aId} - 1.0) / (th_${id} * th_${id}) - (v${bId} - 1.0) / ((1.0 - th_${id}) * (1.0 - th_${id})); ` +
            `const d1_${id} = v${id} * lp1_${id} * d1_${thId}; ` +
            `const d2_${id} = v${id} * (lp1_${id} * d2_${thId} + (lp1_${id} * lp1_${id} + lp2_${id}) * d1_${thId} * d1_${thId}); ` +
            `const bm${id} = bm${thId}, dm${id} = dm${thId};`
        );
        scalarStatements.push(`const v${id} = rt.betaPdf(v${thId}, v${aId}, v${bId});`);
        break;
      }

      case 'Max': {
        const [a, b] = childIds;
        statements.push(
          `const aGtB_${id} = v${a} >= v${b}; ` +
            `const v${id} = aGtB_${id} ? v${a} : v${b}; ` +
            `const d1_${id} = v${a} > v${b} ? d1_${a} : (v${a} < v${b} ? d1_${b} : h0 * d1_${a} + (1.0 - h0) * d1_${b}); ` +
            `const d2_${id} = (aGtB_${id} ? d2_${a} : d2_${b}) + Math.abs(d1_${a} - d1_${b}) * rt.diracMollifier(v${a} - v${b}, diracTau); ` +
            `const bm${id} = bm${a} ^ bm${b} ^ (aGtB_${id} ? ${bit} : 0), dm${id} = dm${a} ^ dm${b};`
        );
        scalarStatements.push(`const v${id} = v${a} >= v${b} ? v${a} : v${b};`);
        break;
      }

      case 'Min': {
        const [a, b] = childIds;
        statements.push(
          `const aLtB_${id} = v${a} <= v${b}; ` +
            `const v${id} = aLtB_${id} ? v${a} : v${b}; ` +
            `const d1_${id} = v${a} < v${b} ? d1_${a} : (v${a} > v${b} ? d1_${b} : h0 * d1_${a} + (1.0 - h0) * d1_${b}); ` +
            `const d2_${id} = (aLtB_${id} ? d2_${a} : d2_${b}) - Math.abs(d1_${a} - d1_${b}) * rt.diracMollifier(v${a} - v${b}, diracTau); ` +
            `const bm${id} = bm${a} ^ bm${b} ^ (aLtB_${id} ? ${bit} : 0), dm${id} = dm${a} ^ dm${b};`
        );
        scalarStatements.push(`const v${id} = v${a} <= v${b} ? v${a} : v${b};`);
        break;
      }

      case 'Erf': {
        const a = childIds[0];
        statements.push(
          `const v${id} = rt.erf(v${a}); ` +
            `const fp_${id} = (2.0 / Math.sqrt(Math.PI)) * Math.exp(-v${a} * v${a}); ` +
            `const fpp_${id} = -2.0 * v${a} * fp_${id}; ` +
            `const d1_${id} = fp_${id} * d1_${a}, d2_${id} = fp_${id} * d2_${a} + fpp_${id} * d1_${a} * d1_${a}, bm${id} = bm${a}, dm${id} = dm${a};`
        );
        scalarStatements.push(`const v${id} = rt.erf(v${a});`);
        break;
      }

      case 'Floor': {
        const a = childIds[0];
        statements.push(
          `const v${id} = Math.floor(v${a}), d1_${id} = 0.0, d2_${id} = 0.0, bm${id} = bm${a}, dm${id} = dm${a} ^ ((Math.floor(v${a}) & 1) !== 0 ? ${bit} : 0);`
        );
        scalarStatements.push(`const v${id} = Math.floor(v${a});`);
        break;
      }

      case 'Ceil': {
        const a = childIds[0];
        statements.push(
          `const v${id} = Math.ceil(v${a}), d1_${id} = 0.0, d2_${id} = 0.0, bm${id} = bm${a}, dm${id} = dm${a} ^ ((Math.ceil(v${a}) & 1) !== 0 ? ${bit} : 0);`
        );
        scalarStatements.push(`const v${id} = Math.ceil(v${a});`);
        break;
      }

      case 'Lgamma': {
        const a = childIds[0];
        statements.push(
          `const v${id} = rt.lgamma(v${a}); ` +
            `const fp_${id} = v${a} > 1e-4 ? (rt.lgamma(v${a} + 1e-5) - rt.lgamma(v${a} - 1e-5)) / 2e-5 : NaN; ` +
            `const fpp_${id} = v${a} > 1e-4 ? (rt.lgamma(v${a} + 1e-4) - 2.0 * v${id} + rt.lgamma(v${a} - 1e-4)) / 1e-8 : NaN; ` +
            `const d1_${id} = fp_${id} * d1_${a}, d2_${id} = fp_${id} * d2_${a} + fpp_${id} * d1_${a} * d1_${a}; ` +
            `const bm${id} = bm${a}, dm${id} = dm${a} ^ (v${a} > 0.0 ? ${bit} : 0);`
        );
        scalarStatements.push(`const v${id} = rt.lgamma(v${a});`);
        break;
      }

      case 'Gamma': {
        const a = childIds[0];
        statements.push(
          `const v${id} = rt.gamma(v${a}); ` +
            `const psi_${id} = v${a} > 1e-4 ? (rt.lgamma(v${a} + 1e-5) - rt.lgamma(v${a} - 1e-5)) / 2e-5 : NaN; ` +
            `const fp_${id} = v${id} * psi_${id}; ` +
            `const d1_${id} = fp_${id} * d1_${a}, d2_${id} = fp_${id} * d2_${a}; ` +
            `const bm${id} = bm${a}, dm${id} = dm${a} ^ (v${a} > 0.0 ? ${bit} : 0);`
        );
        scalarStatements.push(`const v${id} = rt.gamma(v${a});`);
        break;
      }

      case 'BCE': {
        const [yId, pId] = childIds;
        statements.push(
          `const v${id} = rt.bce(v${yId}, v${pId}); ` +
            `const cp_${id} = Math.min(Math.max(v${pId}, 1e-9), 1.0 - 1e-9); ` +
            `const fp_${id} = -v${yId} / cp_${id} + (1.0 - v${yId}) / (1.0 - cp_${id}); ` +
            `const fpp_${id} = v${yId} / (cp_${id} * cp_${id}) + (1.0 - v${yId}) / ((1.0 - cp_${id}) * (1.0 - cp_${id})); ` +
            `const d1_${id} = fp_${id} * d1_${pId}; ` +
            `const d2_${id} = fp_${id} * d2_${pId} + fpp_${id} * d1_${pId} * d1_${pId}; ` +
            `const bm${id} = bm${yId} ^ bm${pId}, dm${id} = dm${yId} ^ dm${pId};`
        );
        scalarStatements.push(`const v${id} = rt.bce(v${yId}, v${pId});`);
        break;
      }

      case 'GELUDeriv1': {
        const a = childIds[0];
        statements.push(
          `const v${id} = rt.geluDeriv1(v${a}), fp_${id} = rt.geluDeriv2(v${a}); ` +
            `const d1_${id} = fp_${id} * d1_${a}, d2_${id} = fp_${id} * d2_${a}, bm${id} = bm${a}, dm${id} = dm${a};`
        );
        scalarStatements.push(`const v${id} = rt.geluDeriv1(v${a});`);
        break;
      }

      case 'GELUDeriv2': {
        const a = childIds[0];
        statements.push(
          `const v${id} = rt.geluDeriv2(v${a}), d1_${id} = 0.0, d2_${id} = 0.0, bm${id} = bm${a}, dm${id} = dm${a};`
        );
        scalarStatements.push(`const v${id} = rt.geluDeriv2(v${a});`);
        break;
      }

      default: {
        const a = childIds[0] ?? 0;
        const argList = childIds.map((cid) => `v${cid}`).join(', ');
        const fnNameLit = JSON.stringify(head);
        statements.push(
          `const v${id} = rt.evalPluginFn(${fnNameLit}, ${argList}); ` +
            `const fp_${id} = rt.evalPluginDeriv1(${fnNameLit}, v${a}); ` +
            `const fpp_${id} = rt.evalPluginDeriv2(${fnNameLit}, v${a}); ` +
            `const d1_${id} = fp_${id} * d1_${a}, d2_${id} = fp_${id} * d2_${a} + fpp_${id} * d1_${a} * d1_${a}, bm${id} = bm${a}, dm${id} = dm${a};`
        );
        scalarStatements.push(`const v${id} = rt.evalPluginFn(${fnNameLit}, ${argList});`);
        break;
      }
    }

    cseMap.set(key, id);
    return id;
  }

  const rootId = emitNode(ast);
  statements.push(
    `out[0] = v${rootId}; out[1] = d1_${rootId}; out[2] = d2_${rootId}; out[3] = bm${rootId}; out[4] = dm${rootId};`
  );
  scalarStatements.push(`return v${rootId};`);

  const rawJetFn = new Function(
    'rt',
    'x',
    'params',
    'h0',
    'diracTau',
    'out',
    `"use strict";\n${statements.join('\n')}`
  ) as (
    rt: typeof SafeMathRuntime,
    x: number,
    params: Record<string, number>,
    h0: number,
    diracTau: number,
    out: Float64Array
  ) => void;

  const rawScalarFn = new Function(
    'rt',
    'x',
    'params',
    `"use strict";\n${scalarStatements.join('\n')}`
  ) as (rt: typeof SafeMathRuntime, x: number, params: Record<string, number>) => number;

  const scratch = new Float64Array(5);

  return {
    evalInto(x, params, out, convention = 'zero', diracTau = 0.04) {
      const h0 = convention === 'symmetric' ? 0.5 : 0.0;
      rawJetFn(SafeMathRuntime, x, params, h0, diracTau, out);
    },
    evalJet2(x, params, convention = 'zero', diracTau = 0.04) {
      const h0 = convention === 'symmetric' ? 0.5 : 0.0;
      rawJetFn(SafeMathRuntime, x, params, h0, diracTau, scratch);
      return {
        v: scratch[0],
        d1: scratch[1],
        d2: scratch[2],
        branchMask: scratch[3],
        discMask: scratch[4],
      };
    },
    evalScalar(x, params) {
      return rawScalarFn(SafeMathRuntime, x, params);
    },
  };
}
