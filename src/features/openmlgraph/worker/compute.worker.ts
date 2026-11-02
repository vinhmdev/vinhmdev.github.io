/**
 * Compute Web Worker Engine [FR-2.3, FR-3.1..3.3, FR-4.1..4.2, NFR-1, AC-04].
 *
 * Caches compiled Jet2 JIT kernels by expression LaTeX so slider drags only
 * execute flat Float64Array loops (0 AST parsing or JIT recompilation during drag).
 * Exports `executeComputeJob` for both Web Worker `onmessage` and direct Vitest benchmarks.
 */
import { classifyLatexExpression } from '../core/parser/ast-classifier';
import {
  compileJet2Kernel,
  type CompiledJet2Kernel,
} from '../core/calculus/jit-compiler';
import {
  mathJsonToLatex,
  symbolicDiff,
  symbolicSecondDiff,
} from '../core/calculus/symbolic-diff';
import { sampleAdaptiveCurve } from '../core/geometry/adaptive-sampler';
import { extractPointsOfInterest } from '../core/geometry/poi-finder';
import {
  computeLossSurfaceAndVectorField,
  evaluateEmpiricalLossAndGrad,
  evaluateSingleSamplePull,
  packDataset,
  resolveSurfaceParamPair,
} from '../core/simulation/loss-evaluator';
import { runOptimizerRace } from '../core/simulation/optimizers';
import type { SymbolRole } from '../types/math';
import type { CurveRenderPacket } from '../types/state';
import { createDoubleBufferPool } from './double-buffer';
import type { ComputeJobRequest, ComputeJobResponse } from './protocol';

interface CachedExpressionEntry {
  latex: string;
  valid: boolean;
  errorMessage?: string;
  kernel?: CompiledJet2Kernel;
  firstDerivLatex?: string;
  secondDerivLatex?: string;
}

const kernelCache = new Map<string, CachedExpressionEntry>();

function getOrCompileExpression(
  latex: string,
  symbolOverrides: Record<string, SymbolRole> = {}
): CachedExpressionEntry {
  const overrideKeys = Object.keys(symbolOverrides);
  const cacheKey =
    overrideKeys.length === 0
      ? latex
      : `${latex}::${overrideKeys
          .sort()
          .map((k) => `${k}=${symbolOverrides[k]}`)
          .join(',')}`;
  const existing = kernelCache.get(cacheKey);
  if (existing) return existing;

  const classified = classifyLatexExpression(latex, symbolOverrides);
  if (!classified.valid) {
    const invalidEntry: CachedExpressionEntry = {
      latex,
      valid: false,
      errorMessage: classified.errorMessage ?? 'Invalid expression',
    };
    kernelCache.set(cacheKey, invalidEntry);
    return invalidEntry;
  }

  const kernel = compileJet2Kernel(classified.stabilizedExpr, classified.primaryVar);
  const d1Ast = symbolicDiff(classified.stabilizedExpr, classified.primaryVar);
  const d2Ast = symbolicSecondDiff(classified.stabilizedExpr, classified.primaryVar);

  const entry: CachedExpressionEntry = {
    latex,
    valid: true,
    kernel,
    firstDerivLatex: mathJsonToLatex(d1Ast),
    secondDerivLatex: mathJsonToLatex(d2Ast),
  };

  if (kernelCache.size > 128) {
    const firstKey = kernelCache.keys().next().value;
    if (firstKey) kernelCache.delete(firstKey);
  }
  kernelCache.set(cacheKey, entry);
  return entry;
}

/**
 * Executes a complete frame computation job (curves + POIs + 128x128 Loss Grid +
 * 50x50 Vector Field + 4-Optimizer Trajectories) within the < 4.0ms budget [AC-04].
 */
export function executeComputeJob(req: ComputeJobRequest): ComputeJobResponse {
  const t0 = performance.now();

  const curves: CurveRenderPacket[] = [];

  for (const item of req.expressions) {
    const compiled = getOrCompileExpression(item.latex, req.symbolOverrides);
    if (!compiled.valid || !compiled.kernel) {
      curves.push({
        exprId: item.id,
        color: item.color,
        visible: item.visible,
        primaryPoints: new Float64Array(0),
        pois: [],
        errorMessage: compiled.errorMessage,
      });
      continue;
    }

    if (!item.visible) {
      curves.push({
        exprId: item.id,
        color: item.color,
        visible: false,
        primaryPoints: new Float64Array(0),
        firstDerivFormulaLatex: compiled.firstDerivLatex,
        secondDerivFormulaLatex: compiled.secondDerivLatex,
        pois: [],
      });
      continue;
    }

    const primaryPoints = sampleAdaptiveCurve(compiled.kernel, req.paramValues, {
      viewport: req.leftViewport,
      screenWidth: req.screenWidth,
      screenHeight: req.screenHeight,
      convention: req.subgradConvention,
      derivativeOrder: 0,
    });

    const firstDerivPoints = item.showFirstDerivative
      ? sampleAdaptiveCurve(compiled.kernel, req.paramValues, {
          viewport: req.leftViewport,
          screenWidth: req.screenWidth,
          screenHeight: req.screenHeight,
          convention: req.subgradConvention,
          derivativeOrder: 1,
        })
      : undefined;

    const secondDerivPoints = item.showSecondDerivative
      ? sampleAdaptiveCurve(compiled.kernel, req.paramValues, {
          viewport: req.leftViewport,
          screenWidth: req.screenWidth,
          screenHeight: req.screenHeight,
          convention: req.subgradConvention,
          derivativeOrder: 2,
        })
      : undefined;

    const pois = extractPointsOfInterest(
      compiled.kernel,
      req.paramValues,
      req.leftViewport,
      req.subgradConvention
    );

    curves.push({
      exprId: item.id,
      color: item.color,
      visible: true,
      primaryPoints,
      firstDerivPoints,
      secondDerivPoints,
      firstDerivFormulaLatex: compiled.firstDerivLatex,
      secondDerivFormulaLatex: compiled.secondDerivLatex,
      pois,
    });
  }

  // Evaluate Dual-Space Empirical Loss, 128x128 Landscape, 50x50 Vector Field & 4-Optimizer Race
  const packed = packDataset(req.dataPoints, req.batchNormEnabled);
  const { w1, w2 } = resolveSurfaceParamPair(req.paramValues);
  const delta = req.paramValues['delta'] ?? 1.0;
  const lambda = req.paramValues['lambda'] ?? 0.1;
  const eta = req.paramValues['eta'] ?? 0.08;
  const beta1 = req.paramValues['beta'] ?? 0.9;

  const trainEval = evaluateEmpiricalLossAndGrad(
    w1,
    w2,
    packed.trainX,
    packed.trainY,
    req.lossKind,
    delta,
    req.regularizationKind,
    lambda,
    req.subgradConvention
  );

  const testEval =
    packed.testX.length > 0
      ? evaluateEmpiricalLossAndGrad(
          w1,
          w2,
          packed.testX,
          packed.testY,
          req.lossKind,
          delta,
          'none',
          0.0,
          req.subgradConvention
        )
      : { loss: 0, gradW1: 0, gradW2: 0 };

  const { lossGrid, minLoss, maxLoss, vectorField } = computeLossSurfaceAndVectorField(
    packed,
    req.rightViewport,
    req.lossKind,
    delta,
    req.regularizationKind,
    lambda,
    128,
    50
  );

  const trajectories = runOptimizerRace(
    packed,
    req.optimizerRace,
    {
      eta,
      beta1,
      beta2: 0.99,
      epsilon: 1e-8,
      delta,
      lambda,
    },
    req.lossKind,
    req.regularizationKind,
    req.subgradConvention
  );

  let linkedBrushPull: ComputeJobResponse['linkedBrushPull'];
  if (req.hoveredDataPointId) {
    const hoveredPt = req.dataPoints.find((p) => p.id === req.hoveredDataPointId);
    if (hoveredPt) {
      const pull = evaluateSingleSamplePull(w1, w2, hoveredPt, req.lossKind, delta);
      linkedBrushPull = {
        pointId: hoveredPt.id,
        ...pull,
      };
    }
  }

  const computeDurationMs = performance.now() - t0;

  return {
    type: 'FRAME_RESULT',
    seq: req.seq,
    computeDurationMs,
    curves,
    trainLoss: trainEval.loss,
    testLoss: testEval.loss,
    lossGrid,
    minLoss,
    maxLoss,
    vectorField,
    trajectories,
    linkedBrushPull,
  };
}

// Wire Web Worker message listener when running in a Worker context
const isWorkerContext =
  typeof self !== 'undefined' &&
  typeof window === 'undefined' &&
  typeof (self as unknown as Worker).postMessage === 'function';

interface WorkerEndpointScope {
  onmessage: ((event: MessageEvent<ComputeJobRequest>) => void) | null;
  postMessage: (message: ComputeJobResponse, transfer: Transferable[]) => void;
}

if (isWorkerContext) {
  const pool = createDoubleBufferPool();
  const workerSelf = self as unknown as WorkerEndpointScope;

  workerSelf.onmessage = (event: MessageEvent<ComputeJobRequest>) => {
    const req = event.data;
    if (!req || req.type !== 'EVALUATE_FRAME') return;
    const res = executeComputeJob(req);
    const transferables = pool.extractTransferables(res);
    workerSelf.postMessage(res, transferables);
  };
}
