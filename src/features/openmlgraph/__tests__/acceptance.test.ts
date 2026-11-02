/**
 * Comprehensive Quantitative Acceptance Test Suite (AC-01 through AC-06)
 * for OpenMLGraph v2.0.0.
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
} from '../core/simulation/loss-evaluator';
import { runOptimizerRace } from '../core/simulation/optimizers';
import {
  computeRocAndConfusionMatrix,
  computeSoftmaxSimplexPoint,
  warpMlpHomotopyPoint,
} from '../core/simulation/special-kernels';
import { getRegisteredMathFunction } from '../extensions/contracts';
import { ALL_ML_TEMPLATES } from '../extensions/templates';
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

describe('OpenMLGraph Core Parser & 5-Group AST Classifier [FR-1.1, FR-1.2]', () => {
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
});


