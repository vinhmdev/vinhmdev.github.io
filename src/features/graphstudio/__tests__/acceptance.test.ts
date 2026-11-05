/**
 * Comprehensive Quantitative Acceptance Test Suite (AC-01 through AC-06)
 * for GraphStudio v2.0.0.
 */
import { describe, expect, it } from 'vitest';
import { classifyLatexExpression } from '../core/parser/ast-classifier';
import { parseLatexToMathJson } from '../core/parser/cortex-setup';
import { applyStabilityPass } from '../core/parser/stability-pass';
import {
  bceWithLogits,
  bceWithLogitsDerivZ,
  betaPdf,
  safeSigmoid,
  safeSoftmax,
  safeSoftplus,
  safeXLogY,
} from '../core/calculus/safe-math-runtime';
import { compileJet2Kernel } from '../core/calculus/jit-compiler';
import {
  mathJsonToLatex,
  symbolicDiff,
  symbolicSecondDiff,
} from '../core/calculus/symbolic-diff';
import { computeBimodalKL, integrateG7K15 } from '../core/calculus/quadrature';
import { sampleAdaptiveCurve } from '../core/geometry/adaptive-sampler';
import { extractPointsOfInterest } from '../core/geometry/poi-finder';
import {
  computeLossSurfaceAndVectorField,
  evaluateEmpiricalLossAndGrad,
  packDataset,
  resolveSurfaceParamPair,
} from '../core/simulation/loss-evaluator';
import { runOptimizerRace } from '../core/simulation/optimizers';
import {
  computeRocAndConfusionMatrix,
  computeSoftmaxSimplexPoint,
  warpMlpHomotopyPoint,
} from '../core/simulation/special-kernels';
import { getRegisteredMathFunction } from '../extensions/contracts';
import {
  ALL_EXPLORE_TEMPLATES,
  ALL_ML_TEMPLATES,
  isMathTemplateId,
  MATH_TEMPLATES,
  QUICK_FORMULA_GROUPS,
} from '../extensions/templates';
import {
  getDefaultCustomOptimizerCode,
  runCustomOptimizerInWasmSandbox,
  runCustomOptimizerTrajectoryInWasm,
} from '../extensions/quickjs-sandbox';
import { classifyUrlHash } from '../state/hash-router';
import { createInitialGraphState, graphStore } from '../state/store';
import {
  decodeStateFromUrlHashAsync,
  decodeStateFromUrlHashSync,
  encodeStateToUrlHashAsync,
  encodeStateToUrlHashSync,
} from '../state/url-codec';
import { executeComputeJob } from '../worker/compute.worker';
import type { DataPoint2D } from '../types/state';

describe('GraphStudio Core Parser & 5-Group AST Classifier [FR-1.1, FR-1.2]', () => {
  it('disambiguates \\sigma(w*x+b) (Group 2 Sigmoid) vs scalar \\sigma (Group 4 Param)', () => {
    const sigFn = classifyLatexExpression('\\sigma(w \\cdot x + b)');
    expect(sigFn.valid).toBe(true);
    // sigma at call site is a function, so symbols should only contain w, x, b
    expect(sigFn.symbols.map((s) => s.name)).toEqual(['w', 'x', 'b']);

    const gaussPdf = classifyLatexExpression(
      '(1 / (\\sigma * \\sqrt{2 * \\pi})) * \\exp(-((x - \\mu)^2) / (2 * \\sigma^2))'
    );
    expect(gaussPdf.valid).toBe(true);
    const sigmaSym = gaussPdf.symbols.find((s) => s.name === 'sigma');
    expect(sigmaSym).toBeDefined();
    expect(sigmaSym?.role).toBe('param');
    expect(sigmaSym?.defaultMin).toBe(0.1);
  });

  it('disambiguates \\delta(x) (Group 2 DiracDelta) vs scalar \\delta (Group 5 Hyperparam)', () => {
    const diracFn = classifyLatexExpression('\\delta(x)');
    expect(diracFn.valid).toBe(true);
    expect(diracFn.symbols.map((s) => s.name)).toEqual(['x']);

    const huberFn = classifyLatexExpression('\\operatorname{huber}(x, \\delta)');
    expect(huberFn.valid).toBe(true);
    const deltaSym = huberFn.symbols.find((s) => s.name === 'delta');
    expect(deltaSym?.role).toBe('hyperparam');
  });
});

describe('[AC-01] Non-Smooth Piecewise Calculus, Exact Kink Pinning & Subdifferential Fan', () => {
  const viewport = { xMin: -5, xMax: 5, yMin: -3, yMax: 5 };

  it('pins exact kink of relu(x) at (0, 0) with error < 1e-10 and zero NaN derivatives', () => {
    const parsed = parseLatexToMathJson('relu(x)');
    expect(parsed.valid).toBe(true);
    const kernel = compileJet2Kernel(parsed.expr, 'x');

    // Check Clarke subgradient conventions at x = 0
    const jetZero = kernel.evalJet2(0, {}, 'zero');
    expect(jetZero.v).toBe(0);
    expect(jetZero.d1).toBe(0);
    expect(Number.isNaN(jetZero.d2)).toBe(false);

    const jetSym = kernel.evalJet2(0, {}, 'symmetric');
    expect(jetSym.d1).toBe(0.5);

    // Check symbolic derivatives f'(x) = H(x) and f''(x) = \delta(x)
    const d1 = symbolicDiff(parsed.expr, 'x');
    const d2 = symbolicSecondDiff(parsed.expr, 'x');
    expect(mathJsonToLatex(d1)).toBe('H(x)');
    expect(mathJsonToLatex(d2)).toBe('\\delta(x)');

    // Check POI kink extraction accuracy < 1e-10
    const pois = extractPointsOfInterest(kernel, {}, viewport, 'zero');
    const kink = pois.find((p) => p.kind === 'kink');
    expect(kink).toBeDefined();
    expect(Math.abs(kink!.x - 0)).toBeLessThan(1e-10);
    expect(Math.abs(kink!.y - 0)).toBeLessThan(1e-10);
    expect(kink!.subdiffInterval).toEqual([0, 1]);
  });

  it('pins exact kink of abs(x - 2) at (2, 0) with error < 1e-10 and samples sharp vertex', () => {
    const parsed = parseLatexToMathJson('abs(x - 2)');
    expect(parsed.valid).toBe(true);
    const kernel = compileJet2Kernel(parsed.expr, 'x');

    const pois = extractPointsOfInterest(kernel, {}, viewport, 'zero');
    const kink = pois.find((p) => p.kind === 'kink');
    expect(kink).toBeDefined();
    expect(Math.abs(kink!.x - 2.0)).toBeLessThan(1e-10);
    expect(Math.abs(kink!.y - 0.0)).toBeLessThan(1e-10);
    expect(kink!.subdiffInterval).toEqual([-1, 1]);

    // Verify adaptive curve contains exact vertex near (2, 0) without corner rounding
    const curve = sampleAdaptiveCurve(kernel, {}, { viewport });
    let minVertexDist = Infinity;
    for (let i = 0; i + 1 < curve.length; i += 2) {
      const dist = Math.hypot(curve[i] - 2.0, curve[i + 1] - 0.0);
      if (dist < minVertexDist) minVertexDist = dist;
    }
    expect(minVertexDist).toBeLessThan(1e-10);
  });
});

describe('[AC-02] IEEE 754 Numerical Stability Pass & Extreme Logit Protection', () => {
  it('returns exact 0.0 for BCEWithLogits and its gradient at w=100, x=10, y=1 (z=1000)', () => {
    const w = 100;
    const x = 10;
    const y = 1;
    const z = w * x; // 1000

    const lossVal = bceWithLogits(y, z);
    const gradVal = bceWithLogitsDerivZ(y, z);
    expect(lossVal).toBe(0.0);
    expect(gradVal).toBe(0.0);
    expect(Number.isNaN(lossVal)).toBe(false);
    expect(Number.isFinite(lossVal)).toBe(true);
  });

  it('rewrites unstable quotient Sigmoid, Softplus, and expanded BCE into stable AST nodes', () => {
    const sigAst = parseLatexToMathJson('1 / (1 + exp(-w * x - b))');
    const stableSig = applyStabilityPass(sigAst.expr);
    expect(Array.isArray(stableSig) && stableSig[0]).toBe('SafeSigmoid');

    const spAst = parseLatexToMathJson('ln(1 + exp(x))');
    const stableSp = applyStabilityPass(spAst.expr);
    expect(Array.isArray(stableSp) && stableSp[0]).toBe('SafeSoftplus');

    const bceAst = parseLatexToMathJson(
      '-y * ln(sigmoid(z)) - (1 - y) * ln(1 - sigmoid(z))'
    );
    const stableBce = applyStabilityPass(bceAst.expr);
    expect(stableBce).toEqual(['BCEWithLogits', 'y', 'z']);

    // Verify extreme values never produce NaN
    expect(safeSigmoid(1000)).toBe(1.0);
    expect(safeSigmoid(-1000)).toBe(0.0);
    expect(safeSoftplus(1000)).toBe(1000);
    expect(safeSoftplus(-1000)).toBe(0.0);
    expect(safeSoftmax(2.0, 2.0, 1.0, 0.0, 1e-9)).toBe(1.0);
    expect(safeXLogY(0, 0)).toBe(0.0);
    expect(betaPdf(0.6, 62, 42)).toBeGreaterThan(0);
  });
});

describe('[AC-03] Singularity, Asymptote & Jump Discontinuity NaN Breaks', () => {
  const viewport = { xMin: -5, xMax: 5, yMin: -10, yMax: 10 };

  it('inserts a NaN polyline break at the vertical asymptote x = 1 of 1 / (x - 1)', () => {
    const parsed = parseLatexToMathJson('1 / (x - 1)');
    const kernel = compileJet2Kernel(parsed.expr, 'x');
    const pts = sampleAdaptiveCurve(kernel, {}, { viewport });

    let foundNaNBreakBetweenNegAndPos = false;
    for (let i = 2; i + 3 < pts.length; i += 2) {
      if (Number.isNaN(pts[i]) && Number.isNaN(pts[i + 1])) {
        const prevX = pts[i - 2];
        const nextX = pts[i + 2];
        if (prevX <= 1.001 && nextX >= 0.999) {
          foundNaNBreakBetweenNegAndPos = true;
        }
      }
    }
    expect(foundNaNBreakBetweenNegAndPos).toBe(true);
  });

  it('inserts a NaN polyline break at the jump discontinuity x = 0 of sign(x)', () => {
    const parsed = parseLatexToMathJson('sign(x)');
    const kernel = compileJet2Kernel(parsed.expr, 'x');
    const pts = sampleAdaptiveCurve(kernel, {}, { viewport });

    let foundJumpBreakAtZero = false;
    for (let i = 2; i + 3 < pts.length; i += 2) {
      if (Number.isNaN(pts[i]) && Number.isNaN(pts[i + 1])) {
        const prevY = pts[i - 1];
        const nextY = pts[i + 3];
        if (prevY === -1 && nextY === 1) {
          foundJumpBreakAtZero = true;
        }
      }
    }
    expect(foundJumpBreakAtZero).toBe(true);
  });
});

describe('[AC-04] Dual-Space Worker Performance Budget (< 4.0ms for 200 pts + 128x128 grid + 4 Optimizers)', () => {
  it('computes 200 data points, adaptive curves, 128x128 loss surface, 50x50 vector field, and 4 optimizer trajectories in < 4.0ms', () => {
    const baseState = createInitialGraphState('T-04');
    const pts200: DataPoint2D[] = [];
    for (let i = 0; i < 200; i++) {
      const x = -4 + (8 * i) / 199;
      pts200.push({
        id: `p-${i}`,
        x,
        y: 0.8 * x + 0.3 + Math.sin(i) * 0.2,
        split: i % 5 === 0 ? 'test' : 'train',
      });
    }

    const req = {
      type: 'EVALUATE_FRAME' as const,
      seq: 1,
      expressions: baseState.expressions,
      paramValues: { w: 0.9, b: 0.2, delta: 1.0, lambda: 0.1, eta: 0.08, beta: 0.9 },
      subgradConvention: 'zero' as const,
      leftViewport: baseState.leftViewport,
      rightViewport: baseState.rightViewport,
      screenWidth: 720,
      screenHeight: 520,
      dataPoints: pts200,
      lossKind: 'huber' as const,
      regularizationKind: 'l2' as const,
      regularizationRadius: 1.5,
      batchNormEnabled: true,
      optimizerRace: baseState.optimizerRace,
      hoveredDataPointId: 'p-10',
    };

    // Warm up V8 JIT once
    executeComputeJob(req);

    // Measure median across 5 runs to avoid CI jitter
    const times: number[] = [];
    for (let run = 0; run < 5; run++) {
      const res = executeComputeJob(req);
      times.push(res.computeDurationMs);
      expect(res.lossGrid.length).toBe(128 * 128);
      expect(res.vectorField.length).toBe(50 * 50 * 4);
      expect(res.trajectories.adam.length).toBe(61);
      expect(res.linkedBrushPull?.pointId).toBe('p-10');
    }
    times.sort((a, b) => a - b);
    const medianMs = times[2];
    expect(medianMs).toBeLessThan(4.0);

    // Also test Divergence Guard when learning rate eta is extreme (eta = 500)
    const packed = packDataset(pts200, false);
    const divRace = runOptimizerRace(
      packed,
      baseState.optimizerRace,
      { eta: 500, beta1: 0.9, beta2: 0.99, epsilon: 1e-8, delta: 1.0, lambda: 2.0 },
      'mse',
      'none',
      'zero'
    );
    expect(divRace.sgd.some((s) => s.diverged)).toBe(true);
  });
});

describe('[AC-05] Stateless URL Compression Budget (<= 2,000 chars) & 3-Tier Hash Router', () => {
  it('compresses 3 LaTeX expressions, 5 sliders, and 200 data points into #v2.dr.* <= 2,000 chars with 100% lossless round-trip', () => {
    const state = createInitialGraphState('T-04');
    const pts200: DataPoint2D[] = [];
    for (let i = 0; i < 200; i++) {
      const x = Number((-4 + (8 * i) / 199).toFixed(4));
      const y = Number((0.75 * x - 0.25 + ((i % 7) - 3) * 0.12).toFixed(4));
      pts200.push({
        id: `p${i + 1}`,
        x,
        y,
        x2: y,
        split: i % 4 === 0 ? 'test' : 'train',
      });
    }
    state.dataPoints = pts200;

    const hash = encodeStateToUrlHashSync(state);
    expect(hash.startsWith('#v2.dr.')).toBe(true);
    expect(hash.length).toBeLessThanOrEqual(2000);

    const restored = decodeStateFromUrlHashSync(hash, createInitialGraphState('T-01'));
    expect(restored).not.toBeNull();
    expect(restored!.expressions.length).toBe(3);
    expect(restored!.expressions[0].latex).toBe(state.expressions[0].latex);
    expect(restored!.dataPoints.length).toBe(200);
    expect(restored!.dataPoints[0].x).toBe(pts200[0].x);
    expect(restored!.dataPoints[199].y).toBe(pts200[199].y);
    expect(restored!.dataPoints[4].split).toBe('test');
  });

  it('distinguishes #v2.dr.*, #<pasteId>.<aesKey>, and #g.<graphId> without collision', () => {
    expect(classifyUrlHash('#v2.dr.abc123XYZ').mode).toBe('local_url');
    expect(classifyUrlHash('#g.doc987654').mode).toBe('public_gallery');
    const fakeKey43 = 'A'.repeat(43);
    expect(classifyUrlHash(`#paste123456789012345.${fakeKey43}`).mode).toBe('cloud_e2ee');
  });
});

describe('[AC-06] 15 ML Templates, Multivariate Kernels & QuickJS WASM Sandbox', () => {
  it('validates all 15 canonical ML templates (T-01 through T-15) and specialized kernels', () => {
    expect(ALL_ML_TEMPLATES.length).toBe(15);
    for (const tpl of ALL_ML_TEMPLATES) {
      const st = createInitialGraphState(tpl.id);
      expect(st.activeTemplateId).toBe(tpl.id);
      expect(st.expressions.length).toBeGreaterThan(0);
      for (const expr of st.expressions) {
        const classified = classifyLatexExpression(expr.latex);
        expect(classified.valid).toBe(true);
      }
    }

    // Check Softmax Simplex (T-03), Bimodal KL (T-08), ROC-AUC (T-13), and MLP Folding (T-15)
    const simplex = computeSoftmaxSimplexPoint(1.5, 0.2, -0.8, 0.5);
    expect(simplex.p1 + simplex.p2 + simplex.p3).toBeCloseTo(1.0, 6);

    const kl = computeBimodalKL(0.0, 2.0);
    expect(kl.forwardKL).toBeGreaterThan(0);
    expect(kl.reverseKL).toBeGreaterThan(0);

    const t13State = createInitialGraphState('T-13');
    const roc = computeRocAndConfusionMatrix(t13State.dataPoints, 1.4, 1.1, -0.2, 0.5);
    expect(roc.auc).toBeGreaterThan(0.8);

    const warped = warpMlpHomotopyPoint(-1.0, 1.0, 1.0);
    expect(Number.isFinite(warped.wx)).toBe(true);
    expect(Number.isFinite(warped.wy)).toBe(true);
  });

  it('executes valid custom optimizer in QuickJS WASM and interrupts infinite loops <= 50ms', async () => {
    const validRes = await runCustomOptimizerInWasmSandbox(
      `function step(ctx) { return { w1: ctx.w1 - ctx.eta * ctx.gradW1, w2: ctx.w2 - ctx.eta * ctx.gradW2, state: { ok: 1 } }; }`,
      {
        w1: 2.0,
        w2: -1.0,
        gradW1: 0.5,
        gradW2: -0.5,
        eta: 0.1,
        beta1: 0.9,
        beta2: 0.99,
        epsilon: 1e-8,
        step: 1,
        state: {},
      },
      50
    );
    expect(validRes.ok).toBe(true);
    expect(validRes.w1).toBeCloseTo(1.95, 5);
    expect(validRes.w2).toBeCloseTo(-0.95, 5);

    const infiniteLoopRes = await runCustomOptimizerInWasmSandbox(
      `function step(ctx) { while (true) {} return ctx; }`,
      {
        w1: 1,
        w2: 1,
        gradW1: 0.1,
        gradW2: 0.1,
        eta: 0.1,
        beta1: 0.9,
        beta2: 0.99,
        epsilon: 1e-8,
        step: 1,
        state: {},
      },
      40
    );
    expect(infiniteLoopRes.ok).toBe(false);
    expect(infiniteLoopRes.error).toBeDefined();
  });
});

describe('Edge Cases, Quadrature, Undo/Redo, and Error Paths', () => {
  it('handles empty/whitespace LaTeX and corrupted URL hashes gracefully', () => {
    const empty = classifyLatexExpression('   ');
    expect(empty.valid).toBe(false);
    expect(empty.symbols.length).toBe(0);

    expect(decodeStateFromUrlHashSync('', createInitialGraphState())).toBeNull();
    expect(decodeStateFromUrlHashSync('#not-a-v2-hash', createInitialGraphState())).toBeNull();
    expect(decodeStateFromUrlHashSync('#v2.dr.!!!corrupted_base64!!!', createInitialGraphState())).toBeNull();
  });

  it('integrates smooth and kinked functions via Gauss-Kronrod G7-K15 with exact kink splitting', () => {
    const quadSmooth = integrateG7K15((x) => x * x, 0, 1);
    expect(quadSmooth.value).toBeCloseTo(1 / 3, 10);

    const quadRelu = integrateG7K15((x) => (x > 0 ? x : 0), -1, 1, [0]);
    expect(quadRelu.value).toBeCloseTo(0.5, 10);
  });

  it('rejects syntax errors and non-finite outputs in QuickJS WASM sandbox', async () => {
    const syntaxErr = await runCustomOptimizerInWasmSandbox(
      `function step(ctx) { return { w1: ; }; }`,
      { w1: 1, w2: 1, gradW1: 0, gradW2: 0, eta: 0.1, beta1: 0.9, beta2: 0.99, epsilon: 1e-8, step: 1, state: {} }
    );
    expect(syntaxErr.ok).toBe(false);

    const nanErr = await runCustomOptimizerInWasmSandbox(
      `function step(ctx) { return { w1: NaN, w2: Infinity, state: {} }; }`,
      { w1: 1, w2: 1, gradW1: 0, gradW2: 0, eta: 0.1, beta1: 0.9, beta2: 0.99, epsilon: 1e-8, step: 1, state: {} }
    );
    expect(nanErr.ok).toBe(false);
  });

  it('enforces 50-step Undo/Redo cap and auto-creates sliders for newly typed parameters', () => {
    graphStore.getState().selectTemplate('T-01');
    const exprId = graphStore.getState().graph.expressions[0].id;
    graphStore.getState().updateExpressionLatex(exprId, 'a \\cdot x + c');
    const sliders = Object.keys(graphStore.getState().graph.sliders);
    expect(sliders).toContain('a');
    expect(sliders).toContain('c');

    for (let i = 0; i < 60; i++) {
      graphStore.getState().addExpression();
    }
    expect(graphStore.getState().undoStack.length).toBeLessThanOrEqual(50);
    graphStore.getState().undo();
    expect(graphStore.getState().redoStack.length).toBe(1);
    graphStore.getState().redo();
    expect(graphStore.getState().redoStack.length).toBe(0);
  });

  it('compiles and differentiates Floor, Ceil, Lgamma, Gamma, BCE, Erf, and auto-discovered Mish plugin [FR-1.2, FR-2.1, FR-5.3]', () => {
    // Floor & Ceil jump discontinuity bitmasks and values
    const floorKernel = compileJet2Kernel(parseLatexToMathJson('floor(x)').expr, 'x');
    expect(floorKernel.evalJet2(2.7, {}).v).toBe(2);
    expect(floorKernel.evalJet2(2.7, {}).d1).toBe(0);
    expect(
      floorKernel.evalJet2(0.9, {}).discMask !== floorKernel.evalJet2(1.1, {}).discMask
    ).toBe(true);

    const ceilKernel = compileJet2Kernel(parseLatexToMathJson('ceil(x)').expr, 'x');
    expect(ceilKernel.evalJet2(2.1, {}).v).toBe(3);

    // Lgamma & Gamma
    const gammaKernel = compileJet2Kernel(parseLatexToMathJson('gamma(x)').expr, 'x');
    expect(gammaKernel.evalJet2(5, {}).v).toBeCloseTo(24, 5); // 4! = 24
    const lgammaKernel = compileJet2Kernel(parseLatexToMathJson('lgamma(x)').expr, 'x');
    expect(lgammaKernel.evalJet2(5, {}).v).toBeCloseTo(Math.log(24), 5);

    // BCE(y, p)
    const bceKernel = compileJet2Kernel(parseLatexToMathJson('bce(1, x)').expr, 'x');
    expect(bceKernel.evalJet2(0.5, {}).v).toBeCloseTo(Math.log(2), 6);
    expect(bceKernel.evalJet2(0.5, {}).d1).toBeCloseTo(-2.0, 5);

    // Symbolic derivative of erf(x) -> (2 / sqrt(Pi)) * exp(-x^2)
    const erfDiff = symbolicDiff(parseLatexToMathJson('erf(x)').expr, 'x');
    const erfDiffKernel = compileJet2Kernel(erfDiff, 'x');
    expect(erfDiffKernel.evalScalar(0, {})).toBeCloseTo(2 / Math.sqrt(Math.PI), 6);

    // Auto-discovered Mish plugin via import.meta.glob('./plugins/*.ts')
    const mishPlugin = getRegisteredMathFunction('mish');
    expect(mishPlugin).toBeDefined();
    const mishParsed = parseLatexToMathJson('mish(x)');
    expect(mishParsed.valid).toBe(true);
    const mishKernel = compileJet2Kernel(mishParsed.expr, 'x');
    const expectedMish1 = 1.0 * Math.tanh(Math.log1p(Math.exp(1.0)));
    expect(mishKernel.evalJet2(1.0, {}).v).toBeCloseTo(expectedMish1, 6);
    expect(mishKernel.evalJet2(1.0, {}).d1).toBeGreaterThan(0.8);
  });

  it('swaps symbol roles [Param: w] <-> [Data: x] and updates sliders + Worker differentiation variable [FR-1.4]', () => {
    graphStore.getState().selectTemplate('T-01');
    // T-01 has expression \sigma(w \cdot x + b)
    expect(graphStore.getState().graph.sliders['w']).toBeDefined();
    expect(graphStore.getState().graph.sliders['x']).toBeUndefined();

    // Click [Param: w] badge -> w becomes 'data_var', x becomes 'param' slider
    graphStore.getState().cycleSymbolRole('w');
    const afterSwap = graphStore.getState().graph;
    expect(afterSwap.symbolOverrides['w']).toBe('data_var');
    expect(afterSwap.symbolOverrides['x']).toBe('param');
    expect(afterSwap.sliders['w']).toBeUndefined();
    expect(afterSwap.sliders['x']).toBeDefined();

    // Verify Compute Worker differentiates wrt 'w' when symbolOverrides are passed
    const jobRes = executeComputeJob({
      type: 'EVALUATE_FRAME',
      seq: 99,
      expressions: [
        {
          id: 'e1',
          latex: 'w^2 * x',
          color: '#f97316',
          visible: true,
          showFirstDerivative: true,
          showSecondDerivative: false,
        },
      ],
      paramValues: { x: 3.0 },
      symbolOverrides: afterSwap.symbolOverrides,
      subgradConvention: 'zero',
      leftViewport: afterSwap.leftViewport,
      rightViewport: afterSwap.rightViewport,
      screenWidth: 720,
      screenHeight: 520,
      dataPoints: [],
      lossKind: 'mse',
      regularizationKind: 'none',
      regularizationRadius: 1.5,
      batchNormEnabled: false,
      optimizerRace: afterSwap.optimizerRace,
      hoveredDataPointId: null,
    });
    // d/dw (w^2 * x) = 2 * w * x
    expect(jobRes.curves[0].firstDerivFormulaLatex).toContain('w');
  });

  it('executes multi-step Custom JS Optimizer trajectory in QuickJS WASM and supports Reverse KL, Rastrigin & async CompressionStream [FR-4.4, FR-5.2, FR-5.3]', async () => {
    // 1. Multi-step QuickJS WASM trajectory
    const trajRes = await runCustomOptimizerTrajectoryInWasm(
      getDefaultCustomOptimizerCode(),
      {
        startW1: -2.0,
        startW2: 1.5,
        steps: 15,
        eta: 0.15,
        beta1: 0.9,
        beta2: 0.99,
        epsilon: 1e-8,
      },
      (w1, w2) => ({
        loss: 0.5 * (w1 * w1 + w2 * w2),
        gradW1: w1,
        gradW2: w2,
      }),
      50
    );
    expect(trajRes.ok).toBe(true);
    expect(trajRes.trajectory.length).toBe(16);
    expect(trajRes.trajectory[15].loss).toBeLessThan(trajRes.trajectory[0].loss);

    // 2. Reverse KL vs Forward KL (T-08) and Rastrigin + Cosine Warm Restart (T-11)
    const emptyArr = new Float64Array(0);
    const fkl = evaluateEmpiricalLossAndGrad(2.0, 0.8, emptyArr, emptyArr, 'kl_div');
    const rkl = evaluateEmpiricalLossAndGrad(2.0, 0.8, emptyArr, emptyArr, 'reverse_kl_div');
    expect(fkl.loss).not.toBeCloseTo(rkl.loss, 2);

    // T-10 lambda sensitivity below 1.0
    const lLow = evaluateEmpiricalLossAndGrad(2.0, 0.0, emptyArr, emptyArr, 'mse', 1.0, 'none', 0.25);
    const lHigh = evaluateEmpiricalLossAndGrad(2.0, 0.0, emptyArr, emptyArr, 'mse', 1.0, 'none', 2.0);
    expect(lLow.loss).toBeCloseTo(0.5 * 0.25 * 4.0, 5);
    expect(lHigh.loss).toBeCloseTo(0.5 * 2.0 * 4.0, 5);

    // T-11 Rastrigin & cosine_warm_restart
    const t11 = createInitialGraphState('T-11');
    expect(t11.lossKind).toBe('rastrigin');
    expect(t11.optimizerRace.lrSchedule).toBe('cosine_warm_restart');
    const rastSurf = computeLossSurfaceAndVectorField(
      packDataset([]),
      t11.rightViewport,
      'rastrigin',
      1.0,
      'none',
      0.0
    );
    expect(rastSurf.maxLoss).toBeGreaterThan(rastSurf.minLoss);

    // 3. Async CompressionStream('deflate-raw') / DecompressionStream('deflate-raw') round-trip
    const asyncHash = await encodeStateToUrlHashAsync(t11);
    expect(asyncHash.startsWith('#v2.dr.')).toBe(true);
    const asyncRestored = await decodeStateFromUrlHashAsync(
      asyncHash,
      createInitialGraphState('T-01')
    );
    expect(asyncRestored?.activeTemplateId).toBe('T-11');
    expect(asyncRestored?.lossKind).toBe('rastrigin');
  });

  it('supports T-00 Bảng trắng (Blank Graph) mode, mainstream algebra implicit multiplication (ax^2 + bx + c), slider auto-pruning, and Whiteboard annotations', () => {
    const store = graphStore.getState();
    store.resetToBlankCanvas();

    const blankGraph = graphStore.getState().graph;
    expect(blankGraph.activeTemplateId).toBe('T-00');
    expect(blankGraph.viewMode).toBe('inference');
    expect(blankGraph.dataPoints.length).toBe(0);
    expect(Object.keys(blankGraph.sliders).sort()).toEqual(['a', 'b', 'c']);

    // Mainstream implicit multiplication: ax^2 + bx + c and mx + d, plus LaTeX macros without spaces (a\sqrt{x}, x\ln(x), a\cos(x), a\pi)
    const quadClassified = classifyLatexExpression('ax^2 + bx + c');
    expect(quadClassified.valid).toBe(true);
    expect(quadClassified.symbols.map((s) => s.name)).toEqual(['a', 'x', 'b', 'c']);

    const macroImplicit = classifyLatexExpression('a\\sqrt{x} + x\\ln(x) + b\\cos(x) + c\\pi');
    expect(macroImplicit.valid).toBe(true);
    expect(macroImplicit.symbols.map((s) => s.name)).toEqual(['a', 'x', 'b', 'c']);

    // Standard graphing calculator functions: sinc(x), asin(x), acos(x), atan(x), sinh(x), cosh(x), cot(x), sec(x), csc(x), cbrt(x), log10(x), log2(x)
    const sincKernel = compileJet2Kernel(parseLatexToMathJson('sinc(x)').expr, 'x');
    expect(sincKernel.evalJet2(0, {}).v).toBeCloseTo(1.0, 10);
    expect(sincKernel.evalJet2(0, {}).d1).toBeCloseTo(0.0, 10);
    expect(sincKernel.evalJet2(0, {}).d2).toBeCloseTo(-1 / 3, 6);

    const trigHypKernel = compileJet2Kernel(
      parseLatexToMathJson('asin(x) + acos(x) + atan(x) + sinh(x) + cosh(x) + cbrt(x)').expr,
      'x'
    );
    expect(Number.isFinite(trigHypKernel.evalJet2(0.5, {}).v)).toBe(true);
    expect(Number.isFinite(trigHypKernel.evalJet2(0.5, {}).d1)).toBe(true);

    const logRecipKernel = compileJet2Kernel(
      parseLatexToMathJson('cot(x) + sec(x) + csc(x) + log10(x) + log2(x)').expr,
      'x'
    );
    expect(Number.isFinite(logRecipKernel.evalJet2(1.0, {}).v)).toBe(true);

    // Unknown function names (e.g. sinn(x)) and unknown multi-letter identifiers fail validation instead of silently plotting y = x
    expect(classifyLatexExpression('sinn(x)').valid).toBe(false);
    expect(classifyLatexExpression('foobar + 1').valid).toBe(false);

    // Remove second expression and update first expression to m*x + d -> old sliders a,b,c pruned in T-00
    const secondId = blankGraph.expressions[1].id;
    const firstId = blankGraph.expressions[0].id;
    graphStore.getState().removeExpression(secondId);
    graphStore.getState().updateExpressionLatex(firstId, 'mx + d');
    expect(Object.keys(graphStore.getState().graph.sliders).sort()).toEqual(['d', 'm']);

    // Temporary syntax error mid-typing preserves existing sliders
    graphStore.getState().updateExpressionLatex(firstId, 'm * sin(');
    expect(Object.keys(graphStore.getState().graph.sliders).sort()).toEqual(['d', 'm']);

    // Removing the last remaining expression clears its latex to '' AND prunes orphaned sliders
    graphStore.getState().removeExpression(firstId);
    expect(graphStore.getState().graph.expressions.length).toBe(1);
    expect(graphStore.getState().graph.expressions[0].latex).toBe('');
    expect(Object.keys(graphStore.getState().graph.sliders)).toEqual([]);

    // Whiteboard Pen, Highlighter, Eraser (including segment interior hit-testing) & Clear actions
    graphStore.getState().setWhiteboardTool('pen');
    graphStore.getState().setWhiteboardColor('#3b82f6');
    expect(graphStore.getState().whiteboardTool).toBe('pen');
    expect(graphStore.getState().whiteboardColor).toBe('#3b82f6');

    graphStore.getState().addWhiteboardStroke({
      id: 'wb-1',
      tool: 'pen',
      color: '#3b82f6',
      width: 2.8,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    });
    graphStore.getState().addWhiteboardStroke({
      id: 'wb-2',
      tool: 'highlighter',
      color: '#f97316',
      width: 14,
      points: [
        { x: 5, y: 5 },
        { x: 6, y: 5 },
      ],
    });
    expect(graphStore.getState().whiteboardStrokes.length).toBe(2);

    // Erase at midpoint (5, 0) of long segment [(0, 0), (10, 0)] removes wb-1 and keeps wb-2
    graphStore.getState().eraseWhiteboardAt(5.0, 0.1, 0.5);
    expect(graphStore.getState().whiteboardStrokes.length).toBe(1);
    expect(graphStore.getState().whiteboardStrokes[0].id).toBe('wb-2');

    // Clear all whiteboard annotations
    graphStore.getState().clearWhiteboard();
    expect(graphStore.getState().whiteboardStrokes.length).toBe(0);
  });

  it('defaults createInitialGraphState() to T-00 Blank template and animates parameter sliders + Drop-Ring Launch playback across consecutive ticks', () => {
    // 1. Default template is T-00 (Blank Canvas)
    const defaultInit = createInitialGraphState();
    expect(defaultInit.activeTemplateId).toBe('T-00');
    expect(defaultInit.viewMode).toBe('inference');

    // 2. Parameter & Hyperparameter slider Play animation advances continuously across ticks
    graphStore.getState().resetToBlankCanvas();
    const initialA = graphStore.getState().graph.sliders['a'].value;
    graphStore.getState().updateSliderBounds('a', { playing: true, speed: 2, direction: 1 });

    expect(graphStore.getState().stepPlayingSliders(0.05)).toBe(true);
    const afterTick1 = graphStore.getState().graph.sliders['a'].value;
    expect(afterTick1).toBeGreaterThan(initialA);

    expect(graphStore.getState().stepPlayingSliders(0.05)).toBe(true);
    const afterTick2 = graphStore.getState().graph.sliders['a'].value;
    expect(afterTick2).toBeGreaterThan(afterTick1);

    // Bounce at upper bound
    graphStore.getState().updateSliderBounds('a', {
      value: 4.95,
      max: 5,
      min: -5,
      direction: 1,
      loopMode: 'bounce',
    });
    graphStore.getState().stepPlayingSliders(0.1);
    expect(graphStore.getState().graph.sliders['a'].value).toBe(5);
    expect(graphStore.getState().graph.sliders['a'].direction).toBe(-1);

    // 3. Drop-Ring Launch playback advances currentStep from 0 -> steps and syncs (w, b) sliders
    graphStore.getState().selectTemplate('T-04');
    const g4 = graphStore.getState().graph;
    const jobRes = executeComputeJob({
      type: 'EVALUATE_FRAME',
      seq: 1,
      expressions: g4.expressions,
      paramValues: { w: 1.0, b: 0.0, delta: 1.0, lambda: 0.1, eta: 0.08, beta: 0.9 },
      symbolOverrides: g4.symbolOverrides,
      subgradConvention: g4.subgradConvention,
      leftViewport: g4.leftViewport,
      rightViewport: g4.rightViewport,
      screenWidth: 720,
      screenHeight: 520,
      dataPoints: g4.dataPoints,
      lossKind: g4.lossKind,
      regularizationKind: g4.regularizationKind,
      regularizationRadius: g4.regularizationRadius,
      batchNormEnabled: g4.batchNormEnabled,
      optimizerRace: { ...g4.optimizerRace, steps: 5 },
      hoveredDataPointId: null,
    });
    graphStore.getState().applyWorkerResult(jobRes);
    graphStore.getState().updateOptimizerRace({ steps: 5, currentStep: 0, playing: true });

    for (let step = 1; step <= 5; step++) {
      const keepPlaying = graphStore.getState().stepOptimizerRace();
      expect(graphStore.getState().graph.optimizerRace.currentStep).toBe(step);
      expect(keepPlaying).toBe(step < 5);
    }
    expect(graphStore.getState().graph.optimizerRace.playing).toBe(false);
    expect(graphStore.getState().graph.sliders['w'].value).toBeCloseTo(
      jobRes.trajectories.adam[5].w1,
      4
    );

    // 4. Direct setSymbolRole(name, role) switches Param <-> Hyper without hijacking Data role
    graphStore.getState().resetToBlankCanvas();
    graphStore.getState().setSymbolRole('c', 'data_var');
    expect(graphStore.getState().graph.symbolOverrides['c']).toBe('data_var');
    // Switching 'a' directly from Param -> Hyper must NOT steal 'data_var' from 'c'
    graphStore.getState().setSymbolRole('a', 'hyperparam');
    expect(graphStore.getState().graph.symbolOverrides['a']).toBe('hyperparam');
    expect(graphStore.getState().graph.symbolOverrides['c']).toBe('data_var');
    expect(graphStore.getState().graph.sliders['a'].role).toBe('hyperparam');
  });

  it('validates General Math templates (M-01..M-08), Explore Gallery, and Quick Formula Groups with unified ML symbol role capabilities', () => {
    expect(MATH_TEMPLATES.length).toBe(8);
    expect(ALL_EXPLORE_TEMPLATES.length).toBe(23);
    expect(QUICK_FORMULA_GROUPS.length).toBe(5);
    for (const grp of QUICK_FORMULA_GROUPS) {
      expect(grp.items.length).toBeGreaterThanOrEqual(5);
      for (const item of grp.items) {
        expect(classifyLatexExpression(item.latex).valid).toBe(true);
      }
    }

    for (const tpl of MATH_TEMPLATES) {
      expect(isMathTemplateId(tpl.id)).toBe(true);
      graphStore.getState().selectTemplate(tpl.id);
      const st = graphStore.getState();
      expect(st.workspaceMode).toBe('ml');
      expect(st.graph.activeTemplateId).toBe(tpl.id);
      expect(st.graph.viewMode).toBe('inference');
      for (const expr of st.graph.expressions) {
        expect(classifyLatexExpression(expr.latex).valid).toBe(true);
      }
    }

    // Selecting an ML template opens Dual-Space view
    graphStore.getState().selectTemplate('T-04');
    expect(graphStore.getState().workspaceMode).toBe('ml');
    expect(graphStore.getState().graph.viewMode).toBe('dual');

    // Selecting a non-'x' plot axis (e.g. 'a') on T-00 keeps viewMode === 'inference' while allowing full role assignments
    graphStore.getState().resetToBlankCanvas();
    expect(graphStore.getState().workspaceMode).toBe('ml');
    graphStore.getState().setSymbolRole('a', 'data_var');
    expect(graphStore.getState().graph.symbolOverrides['a']).toBe('data_var');
    expect(graphStore.getState().graph.viewMode).toBe('inference');

    // Undo / Redo across template transitions keeps unified 'ml' workspaceMode
    graphStore.getState().resetToBlankCanvas();
    expect(graphStore.getState().workspaceMode).toBe('ml');
    graphStore.getState().selectTemplate('T-04');
    expect(graphStore.getState().workspaceMode).toBe('ml');
    graphStore.getState().undo();
    expect(graphStore.getState().graph.activeTemplateId).toBe('T-00');
    expect(graphStore.getState().workspaceMode).toBe('ml');
    graphStore.getState().redo();
    expect(graphStore.getState().graph.activeTemplateId).toBe('T-04');
    expect(graphStore.getState().workspaceMode).toBe('ml');

    // resolveSurfaceParamPair maps both ML (w/b, mu/sigma) and Math (a/b, a/k, m/d) sliders to 3D surface axes
    graphStore.getState().resetToBlankCanvas();
    const blankPair = resolveSurfaceParamPair(graphStore.getState().graph.sliders);
    expect(blankPair.w1Key).toBe('a');
    expect(blankPair.w2Key).toBe('b');

    graphStore.getState().selectTemplate('M-04');
    const m04Pair = resolveSurfaceParamPair(graphStore.getState().graph.sliders);
    expect(m04Pair.w1Key).toBe('a');
    expect(m04Pair.w2Key).toBe('k');

    // Drop-Ring Launch on T-00 in Dual-Space animates sliders (a, b)
    graphStore.getState().resetToBlankCanvas();
    graphStore.getState().setViewMode('dual');
    const g0 = graphStore.getState().graph;
    const res0 = executeComputeJob({
      type: 'EVALUATE_FRAME',
      seq: 2,
      expressions: g0.expressions,
      paramValues: { a: 2.0, b: 1.0, c: 0.0 },
      symbolOverrides: g0.symbolOverrides,
      subgradConvention: g0.subgradConvention,
      leftViewport: g0.leftViewport,
      rightViewport: g0.rightViewport,
      screenWidth: 720,
      screenHeight: 520,
      dataPoints: g0.dataPoints,
      lossKind: g0.lossKind,
      regularizationKind: g0.regularizationKind,
      regularizationRadius: g0.regularizationRadius,
      batchNormEnabled: g0.batchNormEnabled,
      optimizerRace: { ...g0.optimizerRace, steps: 3 },
      hoveredDataPointId: null,
    });
    graphStore.getState().applyWorkerResult(res0);
    graphStore.getState().updateOptimizerRace({ steps: 3, currentStep: 0, playing: true });
    graphStore.getState().stepOptimizerRace();
    expect(graphStore.getState().graph.sliders['a'].value).toBeCloseTo(
      res0.trajectories.adam[1].w1,
      4
    );
    expect(graphStore.getState().graph.sliders['b'].value).toBeCloseTo(
      res0.trajectories.adam[1].w2,
      4
    );
  });

  it('supports commercial Slider Play modes (bounce, wrap, wrap_reverse, once), Play All, step nudge, min/max auto-repair, and custom t/T Optimizer Race transport', () => {
    const store = graphStore.getState();
    store.resetToBlankCanvas();

    // 1. Slider 'wrap' (→↻ forward loop) wraps from max -> min
    store.updateSliderBounds('a', {
      min: -5,
      max: 5,
      value: 4.95,
      loopMode: 'wrap',
      playing: true,
      speed: 2,
    });
    expect(graphStore.getState().graph.sliders['a'].direction).toBe(1);
    expect(graphStore.getState().stepPlayingSliders(0.1)).toBe(true);
    expect(graphStore.getState().graph.sliders['a'].value).toBe(-5);

    // 2. Slider 'wrap' with direction = -1 (or legacy 'wrap_reverse') moves left and wraps from min -> max
    store.updateSliderBounds('a', {
      min: -5,
      max: 5,
      value: -4.95,
      loopMode: 'wrap',
      direction: -1,
      playing: true,
      speed: 2,
    });
    expect(graphStore.getState().graph.sliders['a'].direction).toBe(-1);
    expect(graphStore.getState().stepPlayingSliders(0.1)).toBe(true);
    expect(graphStore.getState().graph.sliders['a'].value).toBe(5);

    store.updateSliderBounds('a', {
      min: -5,
      max: 5,
      value: -4.95,
      loopMode: 'wrap_reverse',
      playing: true,
      speed: 2,
    });
    expect(graphStore.getState().graph.sliders['a'].direction).toBe(-1);
    expect(graphStore.getState().stepPlayingSliders(0.1)).toBe(true);
    expect(graphStore.getState().graph.sliders['a'].value).toBe(5);

    // 3. Slider 'once' (→| play once) stops at max and auto-rewinds to min when Play is clicked again
    store.updateSliderBounds('a', {
      min: -5,
      max: 5,
      value: 4.95,
      direction: 1,
      loopMode: 'once',
      playing: true,
      speed: 2,
    });
    expect(graphStore.getState().stepPlayingSliders(0.1)).toBe(false);
    expect(graphStore.getState().graph.sliders['a'].value).toBe(5);
    expect(graphStore.getState().graph.sliders['a'].playing).toBe(false);

    // Clicking Play again at max in 'once' mode auto-rewinds to min (-5) and plays
    store.updateSliderBounds('a', { playing: true });
    expect(graphStore.getState().graph.sliders['a'].value).toBe(-5);
    expect(graphStore.getState().graph.sliders['a'].playing).toBe(true);

    // 4. stepSliderByDelta nudges by ±step and pauses playing slider
    store.updateSliderBounds('a', { value: 1.0, step: 0.25, playing: true });
    store.stepSliderByDelta('a', 1);
    expect(graphStore.getState().graph.sliders['a'].value).toBe(1.25);
    expect(graphStore.getState().graph.sliders['a'].playing).toBe(false);
    store.stepSliderByDelta('a', -1);
    expect(graphStore.getState().graph.sliders['a'].value).toBe(1.0);

    // 5. Play All / Pause All toggles all sliders simultaneously
    store.toggleAllSlidersPlay();
    expect(Object.values(graphStore.getState().graph.sliders).every((s) => s.playing)).toBe(true);
    store.toggleAllSlidersPlay();
    expect(Object.values(graphStore.getState().graph.sliders).every((s) => !s.playing)).toBe(true);

    // 6. Editing min > max automatically repairs bounds and clamps value
    store.updateSliderBounds('a', { min: 10 });
    expect(graphStore.getState().graph.sliders['a'].min).toBe(10);
    expect(graphStore.getState().graph.sliders['a'].max).toBeGreaterThanOrEqual(10);
    expect(graphStore.getState().graph.sliders['a'].value).toBe(10);

    // 7. Optimizer Race custom T (steps), scrubbing sync, auto-rewind on Play, loop & bounce modes
    store.selectTemplate('T-04');
    // Customizing steps when at T/T (60/60) keeps currentStep at new T (120/120)
    store.updateOptimizerRace({ steps: 120 });
    expect(graphStore.getState().graph.optimizerRace.steps).toBe(120);
    expect(graphStore.getState().graph.optimizerRace.currentStep).toBe(120);

    // Clamps steps into [1, 1000]
    store.updateOptimizerRace({ steps: 5000 });
    expect(graphStore.getState().graph.optimizerRace.steps).toBe(1000);
    store.updateOptimizerRace({ steps: 0 });
    expect(graphStore.getState().graph.optimizerRace.steps).toBe(1);

    // Compute 4-step trajectory and verify scrubbing t syncs sliders (w, b)
    const g4 = graphStore.getState().graph;
    const jobRes = executeComputeJob({
      type: 'EVALUATE_FRAME',
      seq: 10,
      expressions: g4.expressions,
      paramValues: { w: 1.0, b: 0.0, delta: 1.0, lambda: 0.1, eta: 0.08, beta: 0.9 },
      symbolOverrides: g4.symbolOverrides,
      subgradConvention: g4.subgradConvention,
      leftViewport: g4.leftViewport,
      rightViewport: g4.rightViewport,
      screenWidth: 720,
      screenHeight: 520,
      dataPoints: g4.dataPoints,
      lossKind: g4.lossKind,
      regularizationKind: g4.regularizationKind,
      regularizationRadius: g4.regularizationRadius,
      batchNormEnabled: g4.batchNormEnabled,
      optimizerRace: { ...g4.optimizerRace, steps: 4, currentStep: 4 },
      hoveredDataPointId: null,
    });
    store.applyWorkerResult(jobRes);
    store.updateOptimizerRace({ steps: 4, currentStep: 4, playing: false });

    // Scrubbing to t = 2 syncs w and b sliders to step 2
    store.updateOptimizerRace({ currentStep: 2 });
    expect(graphStore.getState().graph.sliders['w'].value).toBeCloseTo(
      jobRes.trajectories.adam[2].w1,
      4
    );

    // Clicking Play when at t = 4/4 auto-rewinds to t = 0 and starts playing
    store.updateOptimizerRace({ currentStep: 4 });
    store.updateOptimizerRace({ playing: true });
    expect(graphStore.getState().graph.optimizerRace.currentStep).toBe(0);
    expect(graphStore.getState().graph.optimizerRace.playing).toBe(true);

    // Optimizer Race 'loop' mode wraps from 4 -> 0 and keeps playing
    store.updateOptimizerRace({
      steps: 2,
      currentStep: 2,
      loopMode: 'loop',
      direction: 1,
      playing: true,
    });
    expect(store.stepOptimizerRace()).toBe(true);
    expect(graphStore.getState().graph.optimizerRace.currentStep).toBe(0);
    expect(graphStore.getState().graph.optimizerRace.playing).toBe(true);

    // Optimizer Race 'bounce' mode reverses direction at upper and lower bounds
    store.updateOptimizerRace({
      steps: 2,
      currentStep: 1,
      loopMode: 'bounce',
      direction: 1,
      playing: true,
    });
    expect(store.stepOptimizerRace()).toBe(true);
    expect(graphStore.getState().graph.optimizerRace.currentStep).toBe(2);
    expect(graphStore.getState().graph.optimizerRace.direction).toBe(-1);
    expect(store.stepOptimizerRace()).toBe(true);
    expect(graphStore.getState().graph.optimizerRace.currentStep).toBe(1);

    // 8. Trajectory step beyond initial slider [min, max] auto-expands slider bounds instead of clamping
    store.updateSliderBounds('w', { min: -2, max: 2, value: 0 });
    store.applyWorkerResult({
      ...jobRes,
      trajectories: {
        ...jobRes.trajectories,
        adam: [
          { step: 0, w1: -3.5, w2: 1.0, loss: 5, gradW1: 1, gradW2: 1, velW1: 0, velW2: 0, cacheW1: 0, cacheW2: 0, diverged: false },
          { step: 1, w1: 4.2, w2: -0.5, loss: 2, gradW1: 0.5, gradW2: 0.5, velW1: 0, velW2: 0, cacheW1: 0, cacheW2: 0, diverged: false },
        ],
      },
    });
    store.updateOptimizerRace({ steps: 1, currentStep: 0, playing: false });
    expect(graphStore.getState().graph.sliders['w'].value).toBe(-3.5);
    expect(graphStore.getState().graph.sliders['w'].min).toBeLessThanOrEqual(-3.5);
    store.updateOptimizerRace({ currentStep: 1 });
    expect(graphStore.getState().graph.sliders['w'].value).toBe(4.2);
    expect(graphStore.getState().graph.sliders['w'].max).toBeGreaterThanOrEqual(4.2);

    // 9. applyWorkerResult preserves active custom_js WASM trajectory across synchronous worker frame updates
    const customTraj = [
      { step: 0, w1: -1.0, w2: 1.0, loss: 2, gradW1: 1, gradW2: 1, velW1: 0, velW2: 0, cacheW1: 0, cacheW2: 0, diverged: false },
      { step: 1, w1: -0.5, w2: 0.5, loss: 0.5, gradW1: 0.5, gradW2: 0.5, velW1: 0, velW2: 0, cacheW1: 0, cacheW2: 0, diverged: false },
    ];
    store.updateOptimizerRace({
      enabledOptimizers: {
        ...graphStore.getState().graph.optimizerRace.enabledOptimizers,
        custom_js: true,
      },
    });
    store.applyWorkerResult({
      ...jobRes,
      trajectories: { ...jobRes.trajectories, custom_js: customTraj },
    });
    // Subsequent worker frame with empty custom_js must not wipe out the WASM trajectory
    store.applyWorkerResult({
      ...jobRes,
      trajectories: { ...jobRes.trajectories, custom_js: [] },
    });
    expect(graphStore.getState().trajectories.custom_js.length).toBe(2);

    // 10. URL hash codec round-trips custom slider loopMode/speed/direction and Optimizer Race loopMode/speed/direction
    store.updateSliderBounds('w', { loopMode: 'wrap_reverse', speed: 4, direction: -1 });
    store.updateOptimizerRace({ steps: 150, currentStep: 45, loopMode: 'bounce', speed: 2, direction: -1 });
    const encodedHash = encodeStateToUrlHashSync(graphStore.getState().graph);
    const decodedGraph = decodeStateFromUrlHashSync(encodedHash, createInitialGraphState('T-04'));
    expect(decodedGraph).not.toBeNull();
    expect(decodedGraph!.sliders['w'].loopMode).toBe('wrap_reverse');
    expect(decodedGraph!.sliders['w'].speed).toBe(4);
    expect(decodedGraph!.sliders['w'].direction).toBe(-1);
    expect(decodedGraph!.optimizerRace.steps).toBe(150);
    expect(decodedGraph!.optimizerRace.currentStep).toBe(45);
    expect(decodedGraph!.optimizerRace.loopMode).toBe('bounce');
    expect(decodedGraph!.optimizerRace.speed).toBe(2);
    expect(decodedGraph!.optimizerRace.direction).toBe(-1);

    // 11. Unlocked studio actions: setRightViewportMode, setShowResiduals, setShowVectorField, setGalleryDrawerOpen(true, 'examples'), and flipBayesianCoins on Blank Canvas
    store.resetToBlankCanvas();
    store.setRightViewportMode('roc_curve');
    expect(graphStore.getState().graph.rightViewportMode).toBe('roc_curve');
    expect(graphStore.getState().graph.viewMode).toBe('dual');
    store.setShowResiduals(true);
    expect(graphStore.getState().graph.showResiduals).toBe(true);
    store.setShowVectorField(false);
    expect(graphStore.getState().graph.showVectorField).toBe(false);
    store.setGalleryDrawerOpen(true, 'examples');
    expect(graphStore.getState().galleryDrawerOpen).toBe(true);
    expect(graphStore.getState().galleryInitialTab).toBe('examples');
    store.setGalleryDrawerOpen(false);
    store.flipBayesianCoins(10, 1.0);
    expect(graphStore.getState().graph.sliders['n'].value).toBe(10);
    expect(graphStore.getState().graph.sliders['k'].value).toBe(10);
  });
});

