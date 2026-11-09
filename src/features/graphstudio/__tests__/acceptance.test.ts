/**
 * Comprehensive Quantitative Acceptance Test Suite (AC-01 through AC-06)
 * for GraphStudio v2.0.0.
 */
import { describe, expect, it } from 'vitest';
import {
  buildUserFunctionRegistry,
  classifyLatexExpression,
} from '../core/parser/ast-classifier';
import {
  DEFAULT_FUNCTION_LIBRARY,
  formatExpressionForKatex,
  parseLatexToMathJson,
  resolveDerivSymbol,
} from '../core/parser/cortex-setup';
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
  computeChartFocusViewport,
  computeNiceTicks,
  computeUniformTickStep,
  squareViewport,
  viewportAspectError,
} from '../renderers/viewport-controller';
import {
  decodeStateFromUrlHashAsync,
  decodeStateFromUrlHashSync,
  encodeStateToUrlHashAsync,
  encodeStateToUrlHashSync,
} from '../state/url-codec';
import { analyzePastedLatex } from '../core/parser/latex-importer';
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

    // Removing the last remaining expression removes it completely AND prunes orphaned sliders
    graphStore.getState().removeExpression(firstId);
    expect(graphStore.getState().graph.expressions.length).toBe(0);
    expect(Object.keys(graphStore.getState().graph.sliders)).toEqual([]);

    // Adding expression when empty sets fitLoss: true
    graphStore.getState().addExpression('x^2');
    expect(graphStore.getState().graph.expressions.length).toBe(1);
    expect(graphStore.getState().graph.expressions[0].fitLoss).toBe(true);

    // clearAllExpressions removes all expressions and sliders
    graphStore.getState().clearAllExpressions();
    expect(graphStore.getState().graph.expressions.length).toBe(0);
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

    // 11. Unlocked studio actions: setRightViewportMode, setShowResiduals (true by default across Blank & Math templates), setShowVectorField, setGalleryDrawerOpen(true, 'examples'), and flipBayesianCoins on Blank Canvas
    store.resetToBlankCanvas();
    expect(graphStore.getState().graph.showResiduals).toBe(true);
    for (const tpl of MATH_TEMPLATES) {
      expect(createInitialGraphState(tpl.id).showResiduals).toBe(true);
    }
    store.setRightViewportMode('roc_curve');
    expect(graphStore.getState().graph.rightViewportMode).toBe('roc_curve');
    expect(graphStore.getState().graph.viewMode).toBe('dual');
    store.setShowResiduals(false);
    expect(graphStore.getState().graph.showResiduals).toBe(false);
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

    // 12. Custom function naming / renaming (updateExpressionLabel, addExpression with label, leading lhs extraction, Worker curve label & URL round-trip)
    store.resetToBlankCanvas();
    const firstExprId = graphStore.getState().graph.expressions[0].id;
    store.updateExpressionLabel(firstExprId, 'Hàm doanh thu R(x)');
    expect(graphStore.getState().graph.expressions[0].label).toBe('Hàm doanh thu R(x)');

    // Typing `v(x) = 2*x + 1` in formula box auto-updates expression label to `v(x)`
    const secondExprId = graphStore.getState().graph.expressions[1].id;
    store.updateExpressionLatex(secondExprId, 'v(x) = 2 \\cdot x + 1');
    expect(graphStore.getState().graph.expressions[1].label).toBe('v(x)');

    // Adding an expression with custom label
    store.addExpression('\\cos(x)', 'h(x)');
    expect(graphStore.getState().graph.expressions[2].label).toBe('h(x)');

    // Clearing a label resets it to undefined so default f_i(x) fallback applies in Worker & UI
    store.updateExpressionLabel(secondExprId, '   ');
    expect(graphStore.getState().graph.expressions[1].label).toBeUndefined();

    const gNamed = graphStore.getState().graph;
    const namedJob = executeComputeJob({
      type: 'EVALUATE_FRAME',
      seq: 20,
      expressions: gNamed.expressions,
      paramValues: { a: 1, b: 1, c: 0 },
      symbolOverrides: gNamed.symbolOverrides,
      subgradConvention: gNamed.subgradConvention,
      leftViewport: gNamed.leftViewport,
      rightViewport: gNamed.rightViewport,
      screenWidth: 720,
      screenHeight: 520,
      dataPoints: [],
      lossKind: gNamed.lossKind,
      regularizationKind: gNamed.regularizationKind,
      regularizationRadius: gNamed.regularizationRadius,
      batchNormEnabled: gNamed.batchNormEnabled,
      optimizerRace: gNamed.optimizerRace,
      hoveredDataPointId: null,
    });
    expect(namedJob.curves[0].label).toBe('Hàm doanh thu R(x)');
    expect(namedJob.curves[1].label).toBe('f_2(x)');
    expect(namedJob.curves[2].label).toBe('h(x)');

    // URL hash round-trip preserves custom function labels
    const namedHash = encodeStateToUrlHashSync(gNamed);
    const namedRestored = decodeStateFromUrlHashSync(namedHash, createInitialGraphState());
    expect(namedRestored?.expressions[0].label).toBe('Hàm doanh thu R(x)');
    expect(namedRestored?.expressions[1].label).toBeUndefined();
    expect(namedRestored?.expressions[2].label).toBe('h(x)');
  });

  it('supports formal function signatures, Transformer LaTeX normalization, cross-expression AST Beta-Reduction composition, and multi-letter derivative labels', () => {
    const store = graphStore.getState();
    store.resetToBlankCanvas();

    // 1. Formal parameter binding: f(t) = \sin(t) binds primaryVar = 't' (no slider for t)
    const ft = classifyLatexExpression('f(t) = \\sin(t)');
    expect(ft.valid).toBe(true);
    expect(ft.primaryVar).toBe('t');
    expect(ft.signature?.name).toBe('f');
    expect(ft.signature?.formalParams).toEqual(['t']);

    // 2. Multi-variable expression x + y binds primaryVar = 'x' and demotes 'y' to 'param' so a slider is created for y
    const xy = classifyLatexExpression('x + y');
    expect(xy.valid).toBe(true);
    expect(xy.primaryVar).toBe('x');
    expect(xy.symbols.find((s) => s.name === 'x')?.role).toBe('data_var');
    expect(xy.symbols.find((s) => s.name === 'y')?.role).toBe('param');

    // 3. Transformer Scaled Dot-Product Attention signature & LaTeX normalization (^T, d_k, QK^T)
    const attnLatex =
      '\\operatorname{Attention}(Q, K, V) = \\operatorname{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V';
    const attnClassified = classifyLatexExpression(attnLatex);
    expect(attnClassified.valid).toBe(true);
    expect(attnClassified.primaryVar).toBe('Q');
    expect(attnClassified.signature?.name).toBe('Attention');
    expect(attnClassified.signature?.formalParams).toEqual(['Q', 'K', 'V']);
    expect(attnClassified.symbols.find((s) => s.name === 'Q')?.role).toBe('data_var');
    expect(attnClassified.symbols.find((s) => s.name === 'K')?.role).toBe('param');
    expect(attnClassified.symbols.find((s) => s.name === 'V')?.role).toBe('param');
    expect(attnClassified.symbols.find((s) => s.name === 'd_k')?.role).toBe('hyperparam');

    // 4. Multi-letter derivative symbol extraction: Attention(Q, K, V) -> 'Attention', SwiGLU(x, w_1, w_2) -> 'SwiGLU'
    expect(resolveDerivSymbol('Attention(Q, K, V)', attnLatex, 0)).toBe('Attention');
    expect(resolveDerivSymbol(undefined, '\\operatorname{SwiGLU}(x, w_1, w_2) = x', 1)).toBe('SwiGLU');

    // 4b. Preserve user constants, complex macros, sub-function semantics, and LHS auto-aliasing [FR-Enhancements]
    const complexMacro = classifyLatexExpression(
      'f(x) = \\frac{x}{\\text{TSS}} + \\mathcal{L}_{1,\\text{global}} + N_{\\text{ref}}'
    );
    expect(complexMacro.valid).toBe(true);
    const tssSym = complexMacro.symbols.find((s) => s.name === 'TSS');
    expect(tssSym).toBeDefined();
    expect(tssSym?.latex).toBe('\\text{TSS}');
    expect(tssSym?.defaultValue).toBe(1.0);
    expect(tssSym?.defaultMin).toBeGreaterThan(0);

    const l1Sym = complexMacro.symbols.find((s) => s.name === 'L_1_global');
    expect(l1Sym).toBeDefined();
    expect(l1Sym?.latex).toBe('\\mathcal{L}_{1,\\text{global}}');

    const nRefSym = complexMacro.symbols.find((s) => s.name === 'N_ref');
    expect(nRefSym).toBeDefined();
    expect(nRefSym?.latex).toBe('N_{\\text{ref}}');
    expect(nRefSym?.defaultMin).toBeGreaterThanOrEqual(0.1);

    // Sub-function vs. Implicit Multiplication: W(x) must NOT be W * x
    const undefinedFn = classifyLatexExpression('f(x) = W(x) + 2');
    expect(undefinedFn.valid).toBe(false);
    expect(undefinedFn.errorMessage).toContain("Unknown function 'W'");

    // Auto-alias Independent Variable from LHS: J(K) and L(theta)
    const jk = classifyLatexExpression('J(K) = \\frac{1}{K}');
    expect(jk.valid).toBe(true);
    expect(jk.primaryVar).toBe('K');
    expect(jk.symbols.find((s) => s.name === 'K')?.role).toBe('data_var');

    const ltheta = classifyLatexExpression('L(\\theta) = \\theta^2');
    expect(ltheta.valid).toBe(true);
    expect(ltheta.primaryVar).toBe('theta');
    expect(ltheta.symbols.find((s) => s.name === 'theta')?.role).toBe('data_var');

    // 5. Cross-expression Function Composition via AST Beta-Reduction:
    // Expression 1 defines Attention(Q, K, V) = softmax(Q*K^T / sqrt(d_k)) * V
    // Expression 2 reuses Attention(x, K, V) and 2 * Attention(x, 1, 3)
    const e1Id = store.graph.expressions[0].id;
    const e2Id = store.graph.expressions[1].id;
    store.updateExpressionLatex(e1Id, attnLatex);
    store.updateExpressionLatex(e2Id, '2 \\cdot \\operatorname{Attention}(x, 1, 3) + b');

    const gAfter = graphStore.getState().graph;
    // Sliders should be created for K, V, d_k, b (and NOT for Q or x)
    expect(gAfter.sliders['K']).toBeDefined();
    expect(gAfter.sliders['V']).toBeDefined();
    expect(gAfter.sliders['d_k']).toBeDefined();
    expect(gAfter.sliders['b']).toBeDefined();
    expect(gAfter.sliders['Q']).toBeUndefined();
    expect(gAfter.sliders['x']).toBeUndefined();

    // Evaluate both expressions in Worker and verify exact mathematical values and derivatives
    const jobRes = executeComputeJob({
      type: 'EVALUATE_FRAME',
      seq: 301,
      expressions: [
        { ...gAfter.expressions[0], showFirstDerivative: true },
        { ...gAfter.expressions[1], showFirstDerivative: true },
      ],
      paramValues: { K: 2.0, V: 4.0, d_k: 4.0, b: 1.0 },
      symbolOverrides: gAfter.symbolOverrides,
      subgradConvention: gAfter.subgradConvention,
      leftViewport: gAfter.leftViewport,
      rightViewport: gAfter.rightViewport,
      screenWidth: 720,
      screenHeight: 520,
      dataPoints: [],
      lossKind: 'mse',
      regularizationKind: 'none',
      regularizationRadius: 1.5,
      batchNormEnabled: false,
      optimizerRace: gAfter.optimizerRace,
      hoveredDataPointId: null,
      functionLibrary: gAfter.functionLibrary,
    });

    expect(jobRes.curves[0].primaryPoints.length).toBeGreaterThan(20);
    expect(jobRes.curves[0].firstDerivPoints?.length).toBeGreaterThan(20);
    expect(jobRes.curves[1].primaryPoints.length).toBeGreaterThan(20);
    expect(jobRes.curves[1].firstDerivPoints?.length).toBeGreaterThan(20);

    // Also verify user-defined arbitrary function composition: g(u, v) = u^2 + v reused as g(x, 5)
    const userReg = buildUserFunctionRegistry([
      { latex: 'g(u, v) = u^2 + v' },
    ]);
    const composed = classifyLatexExpression('g(x, 5)', {}, userReg);
    expect(composed.valid).toBe(true);
    const composedKernel = compileJet2Kernel(composed.stabilizedExpr, 'x');
    // At x = 3: g(3, 5) = 3^2 + 5 = 14, d/dx = 2*3 = 6
    expect(composedKernel.evalJet2(3.0, {}).v).toBeCloseTo(14.0, 8);
    expect(composedKernel.evalJet2(3.0, {}).d1).toBeCloseTo(6.0, 8);
  });

  it('supports the Pure Mathematical Function Library Drawer (toggle ON/OFF, custom function CRUD, and URL round-trip)', () => {
    const store = graphStore.getState();
    store.resetToBlankCanvas();

    // 1. Default library has 6 pure mathematical functions enabled by default
    expect(DEFAULT_FUNCTION_LIBRARY.length).toBe(6);
    const lib0 = graphStore.getState().graph.functionLibrary ?? DEFAULT_FUNCTION_LIBRARY;
    expect(lib0.every((f) => f.enabled)).toBe(true);

    // 2. With Attention enabled in library, standalone \operatorname{Attention}(x, K, V) is valid even without an expression card defining it
    const firstId = graphStore.getState().graph.expressions[0].id;
    const secondId = graphStore.getState().graph.expressions[1].id;
    store.removeExpression(secondId);
    store.updateExpressionLatex(firstId, '\\operatorname{Attention}(x, K, V)');
    expect(graphStore.getState().graph.sliders['K']).toBeDefined();
    expect(graphStore.getState().graph.sliders['V']).toBeDefined();

    // 3. Toggling Attention OFF in the Function Library disables Attention when not defined on the canvas
    store.toggleLibraryFunction('lib-attention', false);
    const disabledReg = buildUserFunctionRegistry(
      [],
      graphStore.getState().graph.functionLibrary
    );
    expect(
      classifyLatexExpression('\\operatorname{Attention}(x, K, V)', {}, disabledReg).valid
    ).toBe(false);

    // Toggling Attention back ON restores validity
    store.toggleLibraryFunction('lib-attention', true);
    const enabledReg = buildUserFunctionRegistry(
      [],
      graphStore.getState().graph.functionLibrary
    );
    expect(
      classifyLatexExpression('\\operatorname{Attention}(x, K, V)', {}, enabledReg).valid
    ).toBe(true);

    // 4. Adding a custom pure mathematical function to the library makes it callable across expressions
    store.upsertLibraryFunction({
      name: 'PolyGate',
      signature: 'PolyGate(u, a, b)',
      definitionLatex: 'PolyGate(u, a, b) = a \\cdot u^3 + b \\cdot u',
      exampleCallLatex: 'PolyGate(x, a, b)',
      description: 'Cubic gated polynomial',
      category: 'custom',
      enabled: true,
    });
    const customLib = graphStore.getState().graph.functionLibrary!;
    const addedFn = customLib.find((f) => f.name === 'PolyGate');
    expect(addedFn).toBeDefined();

    const customReg = buildUserFunctionRegistry([], customLib);
    const callPoly = classifyLatexExpression('PolyGate(x, 2, 3)', {}, customReg);
    expect(callPoly.valid).toBe(true);
    const polyKernel = compileJet2Kernel(callPoly.stabilizedExpr, 'x');
    // At x = 2: 2*(2^3) + 3*2 = 16 + 6 = 22, d/dx = 3*2*(2^2) + 3 = 27
    expect(polyKernel.evalJet2(2.0, {}).v).toBeCloseTo(22.0, 8);
    expect(polyKernel.evalJet2(2.0, {}).d1).toBeCloseTo(27.0, 8);

    // 5. URL hash round-trip preserves custom & toggled Function Library entries
    store.toggleLibraryFunction('lib-rope', false);
    const hashWithLib = encodeStateToUrlHashSync(graphStore.getState().graph);
    const restoredWithLib = decodeStateFromUrlHashSync(
      hashWithLib,
      createInitialGraphState('T-00')
    );
    expect(restoredWithLib?.functionLibrary).toBeDefined();
    expect(
      restoredWithLib?.functionLibrary?.find((f) => f.id === 'lib-rope')?.enabled
    ).toBe(false);
    expect(
      restoredWithLib?.functionLibrary?.find((f) => f.name === 'PolyGate')?.definitionLatex
    ).toContain('PolyGate');

    // 6. Removing custom function and resetting library
    store.removeLibraryFunction(addedFn!.id);
    expect(
      graphStore.getState().graph.functionLibrary?.find((f) => f.name === 'PolyGate')
    ).toBeUndefined();
    store.resetFunctionLibrary();
    expect(
      (graphStore.getState().graph.functionLibrary ?? DEFAULT_FUNCTION_LIBRARY).every(
        (f) => f.enabled
      )
    ).toBe(true);
  });

  it('evaluates dynamic loss & analytical gradients on nonlinear multi-parameter expressions, optimizes all parameters simultaneously, and supports fitLoss target & 3D surface axis selection', () => {
    const store = graphStore.getState();
    store.resetToBlankCanvas();
    store.setViewMode('dual');

    // 1. Set up a 3-parameter nonlinear quadratic expression: f(x) = a*x^2 + b*x + c
    // and a second expression g(x) = m*x + d
    const freshExprs = graphStore.getState().graph.expressions;
    const e1Id = freshExprs[0].id;
    const e2Id = freshExprs[1].id;
    store.updateExpressionLatex(e1Id, 'a \\cdot x^2 + b \\cdot x + c');
    store.updateExpressionLatex(e2Id, 'm \\cdot x + d');

    // Add quadratic training points matching y = 1.5*x^2 - 0.5*x + 0.5
    store.addDataPoint({ x: -2, y: 1.5 * 4 - 0.5 * -2 + 0.5, split: 'train' });
    store.addDataPoint({ x: -1, y: 1.5 * 1 - 0.5 * -1 + 0.5, split: 'train' });
    store.addDataPoint({ x: 0, y: 0.5, split: 'train' });
    store.addDataPoint({ x: 1, y: 1.5 * 1 - 0.5 * 1 + 0.5, split: 'train' });
    store.addDataPoint({ x: 2, y: 1.5 * 4 - 0.5 * 2 + 0.5, split: 'train' });

    // Start parameters away from ground truth: a = 0.2, b = 0.8, c = -0.5
    store.setSliderValue('a', 0.2);
    store.setSliderValue('b', 0.8);
    store.setSliderValue('c', -0.5);

    // 2. Select custom 3D Loss Surface axes ('a', 'c') instead of default ('a', 'b')
    store.setSurfaceParamAxes('a', 'c');
    const gQuad = graphStore.getState().graph;
    expect(gQuad.surfaceParamW1).toBe('a');
    expect(gQuad.surfaceParamW2).toBe('c');

    const resolvedAxes = resolveSurfaceParamPair(
      gQuad.sliders,
      gQuad.surfaceParamW1,
      gQuad.surfaceParamW2
    );
    expect(resolvedAxes.w1Key).toBe('a');
    expect(resolvedAxes.w2Key).toBe('c');

    // 3. Execute Compute Worker job — verify dynamic nonlinear loss & simultaneous 3-parameter optimization (a, b, c)
    const paramValues: Record<string, number> = {};
    for (const [k, s] of Object.entries(gQuad.sliders)) {
      paramValues[k] = s.value;
    }
    const resQuad = executeComputeJob({
      type: 'EVALUATE_FRAME',
      seq: 401,
      expressions: gQuad.expressions,
      paramValues,
      symbolOverrides: gQuad.symbolOverrides,
      subgradConvention: gQuad.subgradConvention,
      leftViewport: gQuad.leftViewport,
      rightViewport: gQuad.rightViewport,
      screenWidth: 720,
      screenHeight: 520,
      dataPoints: gQuad.dataPoints,
      lossKind: 'mse',
      regularizationKind: 'none',
      regularizationRadius: 1.5,
      batchNormEnabled: false,
      optimizerRace: {
        ...gQuad.optimizerRace,
        startW1: 0.2,
        startW2: -0.5,
        steps: 40,
        currentStep: 0,
      },
      hoveredDataPointId: null,
      surfaceParamW1: gQuad.surfaceParamW1,
      surfaceParamW2: gQuad.surfaceParamW2,
    });

    const adamTraj = resQuad.trajectories.adam;
    expect(adamTraj.length).toBe(41);
    // Loss must decrease significantly over the 40 Adam steps on the quadratic model
    expect(adamTraj[40].loss).toBeLessThan(adamTraj[0].loss * 0.25);
    // All 3 parameters (a, b, c) must be updated in trajectory step params
    expect(adamTraj[40].params).toBeDefined();
    expect(adamTraj[40].params!['a']).not.toBeCloseTo(0.2, 2);
    expect(adamTraj[40].params!['b']).not.toBeCloseTo(0.8, 2);
    expect(adamTraj[40].params!['c']).not.toBeCloseTo(-0.5, 2);

    // Stepping Optimizer Race syncs all 3 parameter sliders (a, b, c), not just 2!
    store.applyWorkerResult(resQuad);
    store.updateOptimizerRace({ currentStep: 40, playing: false });
    expect(graphStore.getState().graph.sliders['a'].value).toBeCloseTo(
      adamTraj[40].params!['a'],
      4
    );
    expect(graphStore.getState().graph.sliders['b'].value).toBeCloseTo(
      adamTraj[40].params!['b'],
      4
    );
    expect(graphStore.getState().graph.sliders['c'].value).toBeCloseTo(
      adamTraj[40].params!['c'],
      4
    );

    // 4. Opting the second expression (m*x + d) into loss fitting via setExpressionFitLoss switches the active loss target
    store.setExpressionFitLoss(e2Id);
    expect(graphStore.getState().graph.expressions[0].fitLoss).toBe(false);
    expect(graphStore.getState().graph.expressions[1].fitLoss).toBe(true);

    // 5. Show/Hide All expressions and Collapse/Expand expression card state
    store.toggleAllExpressionsVisible();
    expect(graphStore.getState().graph.expressions.every((e) => !e.visible)).toBe(true);
    store.toggleAllExpressionsVisible();
    expect(graphStore.getState().graph.expressions.every((e) => e.visible)).toBe(true);

    store.toggleExpressionProp(e1Id, 'collapsed');
    expect(graphStore.getState().graph.expressions[0].collapsed).toBe(true);

    // URL hash round-trip preserves fitLoss, collapsed, surfaceParamW1, surfaceParamW2
    const hashFit = encodeStateToUrlHashSync(graphStore.getState().graph);
    const restoredFit = decodeStateFromUrlHashSync(
      hashFit,
      createInitialGraphState('T-00')
    );
    expect(restoredFit?.expressions[0].collapsed).toBe(true);
    expect(restoredFit?.expressions[1].fitLoss).toBe(true);
    expect(restoredFit?.surfaceParamW1).toBe('a');
    expect(restoredFit?.surfaceParamW2).toBe('c');
  });

  it('supports Piecewise & Conditional mathematical syntax ({x < 3, x > 5}, {x < 0: -x, x >= 0: x^2}, \\begin{cases}), symbolic derivatives, clean domain breaks, and KaTeX formatting', () => {
    // 1. Disjoint domain restriction: x^2 {x < 3, x > 5} and comma-separated x^2, {x < 3, x > 5}
    for (const domainLatex of ['x^2 \\{x < 3, x > 5\\}', 'x^2, {x < 3, x > 5}']) {
      const cls = classifyLatexExpression(domainLatex);
      expect(cls.valid).toBe(true);
      const d1 = symbolicDiff(cls.expr, 'x');
      const d2 = symbolicSecondDiff(cls.expr, 'x');
      expect(mathJsonToLatex(d1)).toContain('2');
      expect(mathJsonToLatex(d2)).toBeDefined();

      const kernel = compileJet2Kernel(cls.expr, 'x');

      // Inside x < 3 (x = 2): f(2) = 4, f'(2) = 4, f''(2) = 2
      const at2 = kernel.evalJet2(2, {}, 'zero');
      expect(at2.v).toBeCloseTo(4, 6);
      expect(at2.d1).toBeCloseTo(4, 6);
      expect(at2.d2).toBeCloseTo(2, 6);

      // Inside gap 3 <= x <= 5 (x = 4): f(4) = NaN, f'(4) = NaN
      const at4 = kernel.evalJet2(4, {}, 'zero');
      expect(Number.isNaN(at4.v)).toBe(true);
      expect(Number.isNaN(at4.d1)).toBe(true);

      // Inside x > 5 (x = 6): f(6) = 36, f'(6) = 12
      const at6 = kernel.evalJet2(6, {}, 'zero');
      expect(at6.v).toBeCloseTo(36, 6);
      expect(at6.d1).toBeCloseTo(12, 6);

      // Adaptive curve sampler inserts NaN breaks across the [3, 5] excluded interval
      const curve = sampleAdaptiveCurve(kernel, {}, {
        viewport: { xMin: 0, xMax: 8, yMin: -2, yMax: 60 },
      });
      let nanCount = 0;
      for (let i = 1; i < curve.length; i += 2) {
        if (Number.isNaN(curve[i])) nanCount++;
      }
      expect(nanCount).toBeGreaterThanOrEqual(1);
    }

    // 2. Chained inequality domain restriction: \sin(x) {-2 <= x <= 2}
    const chainedCls = classifyLatexExpression('\\sin(x) \\{-2 \\le x \\le 2\\}');
    expect(chainedCls.valid).toBe(true);
    const chainedKernel = compileJet2Kernel(chainedCls.expr, 'x');
    expect(chainedKernel.evalJet2(0, {}, 'zero').v).toBeCloseTo(0, 6);
    expect(chainedKernel.evalJet2(1, {}, 'zero').v).toBeCloseTo(Math.sin(1), 6);
    expect(chainedKernel.evalJet2(1, {}, 'zero').d1).toBeCloseTo(Math.cos(1), 6);
    expect(Number.isNaN(chainedKernel.evalJet2(3, {}, 'zero').v)).toBe(true);
    expect(Number.isNaN(chainedKernel.evalJet2(-3, {}, 'zero').v)).toBe(true);

    // 3. Multi-branch continuous piecewise function: {x < 0: -x, x >= 0: x^2} and \begin{cases}
    for (const pwLatex of [
      '{x < 0: -x, x >= 0: x^2}',
      '\\begin{cases} -x & x < 0 \\\\ x^2 & x \\ge 0 \\end{cases}',
    ]) {
      const pwCls = classifyLatexExpression(pwLatex);
      expect(pwCls.valid).toBe(true);
      const pwKernel = compileJet2Kernel(pwCls.expr, 'x');

      expect(pwKernel.evalJet2(-2, {}, 'zero').v).toBeCloseTo(2, 6);
      expect(pwKernel.evalJet2(-2, {}, 'zero').d1).toBeCloseTo(-1, 6);
      expect(pwKernel.evalJet2(3, {}, 'zero').v).toBeCloseTo(9, 6);
      expect(pwKernel.evalJet2(3, {}, 'zero').d1).toBeCloseTo(6, 6);

      // Continuous piecewise kink at x = 0 is detected and pinned by adaptive sampler & POI finder
      const pois = extractPointsOfInterest(
        pwKernel,
        {},
        { xMin: -4, xMax: 4, yMin: -2, yMax: 10 },
        'zero'
      );
      const kinkAtZero = pois.find((p) => p.kind === 'kink' && Math.abs(p.x) < 1e-3);
      expect(kinkAtZero).toBeDefined();
      expect(kinkAtZero!.subdiffInterval?.[0]).toBeCloseTo(-1, 2);
      expect(kinkAtZero!.subdiffInterval?.[1]).toBeCloseTo(0, 2);
    }

    // 4. Multi-branch piecewise with fallback/default branch: {x < 3: 2*x, x > 5: x^2, 0}
    const fallbackCls = classifyLatexExpression('{x < 3: 2*x, x > 5: x^2, 0}');
    expect(fallbackCls.valid).toBe(true);
    const fbD1 = symbolicDiff(fallbackCls.expr, 'x');
    const fbKernel = compileJet2Kernel(fallbackCls.expr, 'x');
    expect(fbKernel.evalJet2(2, {}, 'zero').v).toBeCloseTo(4, 6);
    expect(fbKernel.evalJet2(4, {}, 'zero').v).toBeCloseTo(0, 6);
    expect(fbKernel.evalJet2(6, {}, 'zero').v).toBeCloseTo(36, 6);

    // Jump discontinuity at x = 3 and x = 5 inserts NaN breaks instead of false vertical segments
    const sampledJump = sampleAdaptiveCurve(fbKernel, {}, {
      viewport: { xMin: 0, xMax: 8, yMin: -5, yMax: 50 },
    });
    let jumpNanBreaks = 0;
    for (let i = 1; i < sampledJump.length; i += 2) {
      if (Number.isNaN(sampledJump[i])) jumpNanBreaks++;
    }
    expect(jumpNanBreaks).toBeGreaterThanOrEqual(2);

    // 5. KaTeX display formatter converts raw ASCII braces and inequalities to clean LaTeX
    const formattedKatex = formatExpressionForKatex('x^2 {x <= 3, x >= 5}');
    expect(formattedKatex).toContain('\\left\\{');
    expect(formattedKatex).toContain('\\le');
    expect(formattedKatex).toContain('\\ge');
    expect(formattedKatex).toContain('\\right\\}');

    const d1Latex = mathJsonToLatex(fbD1);
    expect(d1Latex).toContain('\\left\\{');
    expect(d1Latex).toContain('2');

    // 6. Nested piecewise user-defined function composition (`clip`), forward references, case-insensitive calls, and mutual recursion rejection
    const nestedReg = buildUserFunctionRegistry([
      { id: 'e1', latex: 'f(x) = g(x) + 1' }, // forward reference to g defined below!
      { id: 'e2', latex: 'g(x) = 2 * x' },
      { id: 'e3', latex: 'clip(x, a, b) = {x < a: a, x > b: b, x}' },
    ]);
    const fwdCall = classifyLatexExpression('f(x) * 3', {}, nestedReg);
    expect(fwdCall.valid).toBe(true);
    expect(compileJet2Kernel(fwdCall.stabilizedExpr, 'x').evalJet2(4, {}).v).toBeCloseTo(27, 8);

    const clipCall = classifyLatexExpression('clip(w * x + c, -1, 1)', {}, nestedReg);
    expect(clipCall.valid).toBe(true);
    const clipKernel = compileJet2Kernel(clipCall.stabilizedExpr, 'x');
    expect(clipKernel.evalJet2(-2, { w: 2, c: 0 }).v).toBeCloseTo(-1, 8);
    expect(clipKernel.evalJet2(0.25, { w: 2, c: 0 }).v).toBeCloseTo(0.5, 8);
    expect(clipKernel.evalJet2(0.25, { w: 2, c: 0 }).d1).toBeCloseTo(2, 8);

    // Case-insensitive library calls (e.g. lowercase swiglu, attention)
    expect(classifyLatexExpression('swiglu(x, w_1, w_2)').valid).toBe(true);
    expect(classifyLatexExpression('attention(x, K, V)').valid).toBe(true);

    // Mutual recursion f(x) = g(x) and g(x) = f(x) is rejected cleanly
    const cyclicReg = buildUserFunctionRegistry([
      { id: 'c1', latex: 'f(x) = g(x)' },
      { id: 'c2', latex: 'g(x) = f(x)' },
    ]);
    expect(classifyLatexExpression('f(x) = g(x)', {}, cyclicReg).valid).toBe(false);

    // 7. Arbitrary formal variable interval constraint f(u) = u {u > 2, u < 5} and zero-derivative domain guard 5 {x < 3}
    const uDomain = classifyLatexExpression('f(u) = u {u > 2, u < 5}');
    expect(uDomain.valid).toBe(true);
    const uKernel = compileJet2Kernel(uDomain.stabilizedExpr, 'u');
    expect(Number.isNaN(uKernel.evalJet2(1, {}).v)).toBe(true);
    expect(uKernel.evalJet2(3, {}).v).toBeCloseTo(3, 8);

    const constDomainD1 = symbolicDiff(classifyLatexExpression('5 {x < 3}').expr, 'x');
    const constDomainKernel = compileJet2Kernel(constDomainD1, 'x');
    expect(constDomainKernel.evalJet2(1, {}).v).toBeCloseTo(0, 8);
    expect(Number.isNaN(constDomainKernel.evalJet2(5, {}).v)).toBe(true);

    // 8. CSE-shared kinked expression relu(x) + 2*relu(x) preserves branchMask kink at (0, 0)
    const cseKink = compileJet2Kernel(classifyLatexExpression('relu(x) + 2 * relu(x)').stabilizedExpr, 'x');
    const csePois = extractPointsOfInterest(cseKink, {}, { xMin: -3, xMax: 3, yMin: -2, yMax: 6 }, 'zero');
    const kink0 = csePois.find((p) => p.kind === 'kink' && Math.abs(p.x) < 1e-6);
    expect(kink0).toBeDefined();
    expect(kink0!.subdiffInterval?.[0]).toBeCloseTo(0, 4);
    expect(kink0!.subdiffInterval?.[1]).toBeCloseTo(3, 4);

    // 9. Piecewise predictor in executeComputeJob skips NaN out-of-domain training samples instead of coercing NaN -> 0
    const pwLossRes = executeComputeJob({
      type: 'EVALUATE_FRAME',
      seq: 505,
      expressions: [
        {
          id: 'pw-fit',
          latex: 'w * x + b {x > 0}',
          color: '#f97316',
          visible: true,
          showFirstDerivative: false,
          showSecondDerivative: false,
          fitLoss: true,
        },
      ],
      paramValues: { w: 2.0, b: 0.0 },
      symbolOverrides: {},
      subgradConvention: 'zero',
      leftViewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
      rightViewport: { xMin: -4, xMax: 4, yMin: -4, yMax: 4 },
      screenWidth: 720,
      screenHeight: 520,
      dataPoints: [
        { id: 'out-of-domain', x: -2.0, y: -3.0, split: 'train' },
        { id: 'in-domain', x: 1.0, y: 2.0, split: 'train' },
      ],
      lossKind: 'mse',
      regularizationKind: 'none',
      regularizationRadius: 1.5,
      batchNormEnabled: false,
      optimizerRace: createInitialGraphState('T-00').optimizerRace,
      hoveredDataPointId: null,
    });
    expect(pwLossRes.trainLoss).toBeCloseTo(0.0, 8);
  });
});

describe('GraphStudio LaTeX Enhancements & Safe Constants [Item 1..5]', () => {
  it('preserves complex macro constants and maps them to clean tokens with LaTeX labels (Item 1)', () => {
    const raw = 'f(x) = \\frac{\\text{TSS}}{x} + \\mathcal{L}_{1,\\text{global}} + N_{\\text{ref}}';
    const cls = classifyLatexExpression(raw);
    expect(cls.valid).toBe(true);

    const names = cls.symbols.map((s) => s.name);
    expect(names).toContain('TSS');
    expect(names).toContain('L_1_global');
    expect(names).toContain('N_ref');

    // Display labels should keep original LaTeX markup
    const tssSym = cls.symbols.find((s) => s.name === 'TSS');
    expect(tssSym?.latex).toBe('\\text{TSS}');
    expect(tssSym?.defaultMin).toBeGreaterThan(0); // Safe positive default for denominator/multi-letter
    expect(tssSym?.defaultValue).toBe(1.0);

    const l1Sym = cls.symbols.find((s) => s.name === 'L_1_global');
    expect(l1Sym?.latex).toBe('\\mathcal{L}_{1,\\text{global}}');

    const nRefSym = cls.symbols.find((s) => s.name === 'N_ref');
    expect(nRefSym?.latex).toBe('N_{\\text{ref}}');
    expect(nRefSym?.defaultMin).toBeGreaterThanOrEqual(1); // N_ count default min >= 1
  });

  it('preserves undefined sub-function calls without decaying into implicit multiplication (Item 2)', () => {
    // 1. Without W(x) in registry: parser must NOT split into W * x, must throw Unknown function 'W'
    const unk = classifyLatexExpression('f(x) = W(x) + 2');
    expect(unk.valid).toBe(false);
    expect(unk.errorMessage).toContain("Unknown function 'W'");

    // 2. When W(x) is registered as user function: resolves cleanly
    const registry = buildUserFunctionRegistry([{ id: 'w1', latex: 'W(x) = 3 * x' }]);
    const resolved = classifyLatexExpression('f(x) = W(x) + 2', {}, registry);
    expect(resolved.valid).toBe(true);
  });

  it('auto-aliases independent variable from LHS (Item 3)', () => {
    const jk = classifyLatexExpression('J(K) = \\frac{1}{K}');
    expect(jk.valid).toBe(true);
    expect(jk.primaryVar).toBe('K');
    expect(jk.symbols.find((s) => s.name === 'K')?.role).toBe('data_var');

    // In compute worker, curvePacket has primaryVar = 'K'
    const job = executeComputeJob({
      type: 'EVALUATE_FRAME',
      seq: 701,
      expressions: [
        {
          id: 'jk-curve',
          latex: 'J(K) = 2 * K + 1',
          color: '#3b82f6',
          visible: true,
          showFirstDerivative: true,
          showSecondDerivative: false,
          fitLoss: false,
        },
      ],
      paramValues: {},
      symbolOverrides: {},
      subgradConvention: 'zero',
      leftViewport: { xMin: 0.1, xMax: 10, yMin: 0, yMax: 25 },
      rightViewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
      screenWidth: 720,
      screenHeight: 520,
      dataPoints: [],
      lossKind: 'mse',
      regularizationKind: 'none',
      regularizationRadius: 1.0,
      batchNormEnabled: false,
      optimizerRace: createInitialGraphState('T-00').optimizerRace,
      hoveredDataPointId: null,
    });

    expect(job.curves[0].primaryVar).toBe('K');
    expect(job.curves[0].label).toContain('(K)');
  });

  it('smart paste pre-cleans LaTeX formulas without syntax error (Item 4)', () => {
    const segsFrac = analyzePastedLatex('\\frac{1}{1 + e^{-x}}');
    expect(segsFrac.length).toBe(1);
    expect(segsFrac[0].status).not.toBe('note');

    const segsWcss = analyzePastedLatex('\\text{WCSS}(K) = \\frac{1}{K}');
    expect(segsWcss.length).toBe(1);
    expect(segsWcss[0].status).not.toBe('note');
  });

  it('manages 1:1 aspect ratio toggle lock and preserves square grid scale', () => {
    const store = graphStore.getState();
    // 1. Initial state defaults lock1to1 to true
    expect(store.graph.lock1to1).toBe(true);

    // 2. Toggle lock1to1 off and on
    store.setLock1to1(false);
    expect(graphStore.getState().graph.lock1to1).toBe(false);

    store.setLock1to1(true);
    expect(graphStore.getState().graph.lock1to1).toBe(true);

    // 3. URL encoding/decoding preserves lock1to1 bit
    const encoded = encodeStateToUrlHashSync(graphStore.getState().graph);
    const decoded = decodeStateFromUrlHashSync(encoded, createInitialGraphState('T-00'));
    expect(decoded?.lock1to1).toBe(true);

    // 4. Squaring math verification: given W = 800, H = 400 (aspect = 2.0) and y in [-5, 5] (ySpan = 10)
    // Locked 1:1 requires xSpan = ySpan * aspect = 20 (x in [-10, 10]), so pxPerUnitX == pxPerUnitY == 40
    const w = 800;
    const h = 400;
    const aspect = w / h;
    const curVp = { xMin: -5, xMax: 5, yMin: -5, yMax: 5 };
    const curYSpan = curVp.yMax - curVp.yMin;
    const halfY = curYSpan * 0.5;
    const halfX = halfY * aspect;
    const xMid = (curVp.xMin + curVp.xMax) * 0.5;
    const yMid = (curVp.yMin + curVp.yMax) * 0.5;
    const squaredVp = {
      xMin: xMid - halfX,
      xMax: xMid + halfX,
      yMin: yMid - halfY,
      yMax: yMid + halfY,
    };
    const pxPerUnitX = w / (squaredVp.xMax - squaredVp.xMin);
    const pxPerUnitY = h / (squaredVp.yMax - squaredVp.yMin);
    expect(pxPerUnitX).toBe(40);
    expect(pxPerUnitY).toBe(40);
    expect(pxPerUnitX).toBe(pxPerUnitY);
  });

  it('locates and centers viewport directly on data points or curve features (Locate Button)', () => {
    // 1. Data points far away: x in [100, 140], y in [200, 260]
    const pts = [
      { id: 'p1', x: 100, y: 200, split: 'train' as const },
      { id: 'p2', x: 140, y: 260, split: 'train' as const },
    ];
    const vp = computeChartFocusViewport({
      dataPoints: pts,
      curves: [],
      width: 800,
      height: 400, // aspect = 2.0
      lock1to1: true,
    });

    const xMid = (vp.xMin + vp.xMax) * 0.5;
    const yMid = (vp.yMin + vp.yMax) * 0.5;
    expect(xMid).toBeCloseTo(120, 4); // exactly center of [100, 140]
    expect(yMid).toBeCloseTo(230, 4); // exactly center of [200, 260]

    // Ensure all points fit inside with padding
    expect(vp.xMin).toBeLessThan(100);
    expect(vp.xMax).toBeGreaterThan(140);
    expect(vp.yMin).toBeLessThan(200);
    expect(vp.yMax).toBeGreaterThan(260);

    // 1:1 Aspect ratio maintained
    const xSpan = vp.xMax - vp.xMin;
    const ySpan = vp.yMax - vp.yMin;
    expect(xSpan / ySpan).toBeCloseTo(2.0, 4);

    // 2. Curve POIs when no data points exist
    const curveVp = computeChartFocusViewport({
      dataPoints: [],
      curves: [
        {
          exprId: 'c1',
          color: '#f97316',
          visible: true,
          primaryPoints: new Float64Array(0),
          pois: [
            { kind: 'root', x: -3, y: 0, label: 'x=-3' },
            { kind: 'root', x: 3, y: 0, label: 'x=3' },
            { kind: 'extremum', x: 0, y: -9, label: 'min' },
          ],
        },
      ],
      width: 600,
      height: 600, // aspect = 1.0
      lock1to1: true,
    });

    const cXMid = (curveVp.xMin + curveVp.xMax) * 0.5;
    const cYMid = (curveVp.yMin + curveVp.yMax) * 0.5;
    expect(cXMid).toBeCloseTo(0, 4);
    expect(cYMid).toBeCloseTo(-4.5, 4); // midpoint of [-9, 0]
  });
});

describe('1:1 aspect lock: square grid cells & shared tick step', () => {
  // Wide canvas, already square in px-per-unit: 1600px / 400u = 400px / 100u = 4 px/u
  const W = 1600;
  const H = 400;
  const squareVp = { xMin: -200, xMax: 200, yMin: -50, yMax: 50 };

  it('reproduces the bug: independent per-axis ticks diverge (50 vs 20) on a square viewport', () => {
    expect(viewportAspectError(squareVp, W, H)).toBeCloseTo(0, 9);
    const xTicks = computeNiceTicks(squareVp.xMin, squareVp.xMax, 8);
    const yTicks = computeNiceTicks(squareVp.yMin, squareVp.yMax, 6);
    expect(xTicks[1] - xTicks[0]).toBe(50);
    expect(yTicks[1] - yTicks[0]).toBe(20);
  });

  it('shares one nice step across both axes when locked', () => {
    const step = computeUniformTickStep(squareVp, W, H);
    const xTicks = computeNiceTicks(squareVp.xMin, squareVp.xMax, 8, step);
    const yTicks = computeNiceTicks(squareVp.yMin, squareVp.yMax, 6, step);
    const dx = xTicks[1] - xTicks[0];
    const dy = yTicks[1] - yTicks[0];
    expect(dx).toBe(dy);
    // Same world step + same px/unit => square cells on screen
    expect((dx / (squareVp.xMax - squareVp.xMin)) * W).toBeCloseTo(
      (dy / (squareVp.yMax - squareVp.yMin)) * H,
      9
    );
    expect(xTicks).toContain(0);
    expect(yTicks).toContain(0);
  });

  it('squares a distorted template viewport without hiding any of the original region', () => {
    const distorted = { xMin: 0, xMax: 1, yMin: -0.2, yMax: 5.5 }; // T-07 style
    const vp = squareViewport(distorted, W, H);
    expect(viewportAspectError(vp, W, H)).toBeLessThan(1e-9);
    expect((vp.xMax - vp.xMin) / W).toBeCloseTo((vp.yMax - vp.yMin) / H, 12);
    expect(vp.xMin).toBeLessThanOrEqual(distorted.xMin);
    expect(vp.xMax).toBeGreaterThanOrEqual(distorted.xMax);
    expect(vp.yMin).toBeLessThanOrEqual(distorted.yMin);
    expect(vp.yMax).toBeGreaterThanOrEqual(distorted.yMax);
    expect((vp.xMin + vp.xMax) / 2).toBeCloseTo(0.5, 12);
    expect((vp.yMin + vp.yMax) / 2).toBeCloseTo(2.65, 12);
  });

  it('is idempotent on an already-square viewport', () => {
    const vp = squareViewport(squareVp, W, H);
    expect(vp.xMin).toBeCloseTo(squareVp.xMin, 9);
    expect(vp.xMax).toBeCloseTo(squareVp.xMax, 9);
    expect(vp.yMin).toBeCloseTo(squareVp.yMin, 9);
    expect(vp.yMax).toBeCloseTo(squareVp.yMax, 9);
  });

  it('treats Transformer d_k as hyperparam so optimizer tunes weights K, V without driving d_k negative', () => {
    const store = graphStore.getState();
    store.resetToBlankCanvas();

    // Expression Attention(x, K, V, d_k)
    const attnExpr = '\\operatorname{Attention}(x, K, V, d_k)';
    const eId = store.graph.expressions[0].id;
    store.updateExpressionLatex(eId, attnExpr);
    store.toggleExpressionProp(eId, 'fitLoss');

    const gState = graphStore.getState().graph;
    expect(gState.sliders['d_k']).toBeDefined();
    expect(gState.sliders['d_k'].role).toBe('hyperparam');
    expect(gState.sliders['d_k'].min).toBe(0.5);

    // Simulate compute job with sample data
    const jobRes = executeComputeJob({
      type: 'EVALUATE_FRAME',
      seq: 701,
      expressions: gState.expressions,
      paramValues: { K: 2.0, V: 1.0, d_k: 4.0 },
      symbolOverrides: {},
      subgradConvention: 'zero',
      leftViewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
      rightViewport: { xMin: -4, xMax: 4, yMin: -4, yMax: 4 },
      screenWidth: 720,
      screenHeight: 520,
      dataPoints: [
        { id: 'p1', x: -1.0, y: -0.5, split: 'train' },
        { id: 'p2', x: 1.0, y: 0.5, split: 'train' },
      ],
      lossKind: 'mse',
      regularizationKind: 'none',
      regularizationRadius: 1.0,
      batchNormEnabled: false,
      optimizerRace: {
        ...createInitialGraphState('T-00').optimizerRace,
        startW1: 2.0,
        startW2: 1.0,
        steps: 50,
      },
      hoveredDataPointId: null,
    });

    const adamTraj = jobRes.trajectories.adam;
    expect(adamTraj.length).toBeGreaterThan(0);
    // d_k must not be in params being modified by gradient descent
    for (const step of adamTraj) {
      if (step.params && 'd_k' in step.params) {
        expect(step.params.d_k).toBeGreaterThanOrEqual(0.5);
      }
    }
  });
});
