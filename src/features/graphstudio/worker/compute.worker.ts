/**
 * Compute Web Worker Engine [FR-2.3, FR-3.1..3.3, FR-4.1..4.2, NFR-1, AC-04].
 *
 * Caches compiled Jet2 JIT kernels by expression LaTeX so slider drags only
 * execute flat Float64Array loops (0 AST parsing or JIT recompilation during drag).
 * Exports `executeComputeJob` for both Web Worker `onmessage` and direct Vitest benchmarks.
 */
import {
  buildUserFunctionRegistry,
  classifyLatexExpression,
} from '../core/parser/ast-classifier';
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
  type PredictorModel,
  resolveSurfaceParamPair,
} from '../core/simulation/loss-evaluator';
import {
  isBoundedDomainParam,
  runOptimizerRace,
} from '../core/simulation/optimizers';
import type {
  MathJsonExpr,
  ParamDomainMode,
  SymbolRole,
  UserFunctionRegistry,
} from '../types/math';
import type { CurveRenderPacket } from '../types/state';
import { createDoubleBufferPool } from './double-buffer';
import type { ComputeJobRequest, ComputeJobResponse } from './protocol';

interface CachedExpressionEntry {
  latex: string;
  valid: boolean;
  errorMessage?: string;
  primaryVar?: string;
  kernel?: CompiledJet2Kernel;
  firstDerivLatex?: string;
  secondDerivLatex?: string;
  paramNames?: string[];
  paramGradKernels?: Record<string, (x: number, params: Record<string, number>) => number>;
  defaultParamBounds?: Record<
    string,
    { min: number; max: number; domainMode?: ParamDomainMode }
  >;
  isCustomPredictor?: boolean;
}

const kernelCache = new Map<string, CachedExpressionEntry>();

const LOSS_TEMPLATE_HEADS = new Set([
  'BCEWithLogits',
  'BCE',
  'Hinge',
  'Huber',
  'BetaPdf',
  'SafeXLogY',
]);

function isCanonicalLinearAst(expr: MathJsonExpr, primaryVar: string): boolean {
  if (!Array.isArray(expr)) return false;
  if (LOSS_TEMPLATE_HEADS.has(expr[0])) return true;
  // Unwrap SafeSigmoid(w * x + b) for canonical logistic templates (T-01, T-13)
  const target = expr[0] === 'SafeSigmoid' && Array.isArray(expr[1]) ? expr[1] : expr;
  if (!Array.isArray(target)) return false;
  if (target[0] === 'Add' && target.length === 3) {
    const [, left, right] = target;
    if (
      Array.isArray(left) &&
      left[0] === 'Multiply' &&
      typeof left[1] === 'string' &&
      left[2] === primaryVar &&
      typeof right === 'string'
    ) {
      return true;
    }
  }
  return false;
}

function getOrCompileExpression(
  latex: string,
  symbolOverrides: Record<string, SymbolRole> = {},
  userFunctions?: UserFunctionRegistry,
  fnCacheTag = '',
  unlockedSymbols?: ReadonlySet<string>
): CachedExpressionEntry {
  const overrideKeys = Object.keys(symbolOverrides);
  const baseKey =
    overrideKeys.length === 0
      ? latex
      : `${latex}::${overrideKeys
          .sort()
          .map((k) => `${k}=${symbolOverrides[k]}`)
          .join(',')}`;
  const unlockedTag =
    unlockedSymbols && unlockedSymbols.size > 0
      ? `~u:${Array.from(unlockedSymbols).sort().join(',')}`
      : '';
  const cacheKey = `${fnCacheTag ? `${baseKey}@@${fnCacheTag}` : baseKey}${unlockedTag}`;
  const existing = kernelCache.get(cacheKey);
  if (existing) return existing;

  const classified = classifyLatexExpression(
    latex,
    symbolOverrides,
    userFunctions,
    unlockedSymbols
  );
  if (!classified.valid) {
    const invalidEntry: CachedExpressionEntry = {
      latex,
      valid: false,
      errorMessage: classified.errorMessage ?? 'Invalid expression',
    };
    kernelCache.set(cacheKey, invalidEntry);
    return invalidEntry;
  }

  const kernel = compileJet2Kernel(classified.stabilizedExpr, classified.primaryVar, {
    unlockedSymbols,
  });
  const d1Ast = symbolicDiff(classified.stabilizedExpr, classified.primaryVar);
  const d2Ast = symbolicSecondDiff(classified.stabilizedExpr, classified.primaryVar);

  const paramNames = classified.symbols
    .filter((s) => s.role === 'param')
    .map((s) => s.name);
  const isCustomPredictor =
    paramNames.length > 2 ||
    !isCanonicalLinearAst(classified.stabilizedExpr, classified.primaryVar);

  const paramGradKernels: Record<string, (x: number, params: Record<string, number>) => number> = {};
  if (isCustomPredictor && paramNames.length > 0) {
    for (const pName of paramNames) {
      const dParamAst = symbolicDiff(classified.stabilizedExpr, pName);
      const pKernel = compileJet2Kernel(dParamAst, classified.primaryVar, {
        unlockedSymbols,
      });
      paramGradKernels[pName] = pKernel.evalScalar;
    }
  }

  const defaultParamBounds: Record<
    string,
    { min: number; max: number; domainMode?: ParamDomainMode }
  > = {};
  for (const sym of classified.symbols) {
    if (sym.role === 'param' || sym.role === 'hyperparam') {
      defaultParamBounds[sym.name] = {
        min: sym.defaultMin,
        max: sym.defaultMax,
        domainMode: sym.domainMode,
      };
    }
  }

  const entry: CachedExpressionEntry = {
    latex,
    valid: true,
    primaryVar: classified.primaryVar,
    kernel,
    firstDerivLatex: mathJsonToLatex(d1Ast),
    secondDerivLatex: mathJsonToLatex(d2Ast),
    paramNames,
    paramGradKernels,
    defaultParamBounds,
    isCustomPredictor,
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

  const hasCustomFnContext =
    Boolean(req.functionLibrary) ||
    req.expressions.some((e) => e.latex.includes('='));
  const userFunctions = hasCustomFnContext
    ? buildUserFunctionRegistry(req.expressions, req.functionLibrary)
    : undefined;
  const fnCacheTag = userFunctions
    ? Object.keys(userFunctions)
        .sort()
        .map(
          (k) =>
            `${k}:${userFunctions[k].rawLatex}:${JSON.stringify(
              userFunctions[k].paramConfigs ?? {}
            )}`
        )
        .join('|')
    : '';

  const unlockedSymbols = new Set<string>();
  if (req.paramBounds) {
    for (const [k, b] of Object.entries(req.paramBounds)) {
      if (b.domainMode === 'free') {
        unlockedSymbols.add(k);
      }
    }
  }

  const curves: CurveRenderPacket[] = [];
  const compiledByExprId = new Map<string, CachedExpressionEntry>();

  for (let idx = 0; idx < req.expressions.length; idx++) {
    const item = req.expressions[idx];
    const compiled = getOrCompileExpression(
      item.latex,
      req.symbolOverrides,
      userFunctions,
      fnCacheTag,
      unlockedSymbols
    );
    compiledByExprId.set(item.id, compiled);
    const resolvedLabel = item.label?.trim() || `f_${idx + 1}(x)`;
    if (!compiled.valid || !compiled.kernel) {
      curves.push({
        exprId: item.id,
        label: resolvedLabel,
        color: item.color,
        visible: item.visible,
        lineStyle: item.lineStyle,
        lineWidth: item.lineWidth,
        primaryPoints: new Float64Array(0),
        pois: [],
        errorMessage: compiled.errorMessage,
      });
      continue;
    }

    const displayLabel =
      item.label?.trim() || `f_${idx + 1}(${compiled.primaryVar ?? 'x'})`;

    if (!item.visible) {
      curves.push({
        exprId: item.id,
        label: displayLabel,
        color: item.color,
        visible: false,
        lineStyle: item.lineStyle,
        lineWidth: item.lineWidth,
        primaryVar: compiled.primaryVar,
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
      label: displayLabel,
      color: item.color,
      visible: true,
      lineStyle: item.lineStyle,
      lineWidth: item.lineWidth,
      primaryVar: compiled.primaryVar,
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
  const { w1Key, w2Key, w1, w2 } = resolveSurfaceParamPair(
    req.paramValues,
    req.surfaceParamW1,
    req.surfaceParamW2
  );
  const delta = req.paramValues['delta'] ?? 1.0;
  const lambda = req.paramValues['lambda'] ?? 0.1;
  const eta = req.paramValues['eta'] ?? 0.08;
  const beta1 = req.paramValues['beta'] ?? 0.9;

  // Resolve target expression for loss fitting (explicit fitLoss -> first visible -> first)
  const targetExpr =
    req.expressions.find((e) => e.fitLoss && e.latex.trim()) ??
    req.expressions.find((e) => e.visible && e.latex.trim()) ??
    req.expressions[0];
  const targetCompiled = targetExpr ? compiledByExprId.get(targetExpr.id) : undefined;

  let effectiveParamBounds:
    | Record<string, { min: number; max: number; domainMode?: ParamDomainMode }>
    | undefined;
  if (targetCompiled?.defaultParamBounds || req.paramBounds) {
    effectiveParamBounds = {
      ...(targetCompiled?.defaultParamBounds ?? {}),
      ...(req.paramBounds ?? {}),
    };
    if (targetCompiled?.defaultParamBounds && req.paramBounds) {
      for (const [k, astB] of Object.entries(targetCompiled.defaultParamBounds)) {
        const reqB = req.paramBounds[k];
        if (!reqB) continue;
        if (reqB.domainMode === 'free') {
          effectiveParamBounds[k] = { ...reqB };
          continue;
        }
        if (reqB.domainMode === 'non_negative') {
          const min = Math.max(0, reqB.min);
          const max =
            astB.max <= 1.0 && astB.min >= -1.0
              ? Math.max(min, Math.min(astB.max, reqB.max))
              : Math.max(min, reqB.max);
          effectiveParamBounds[k] = { min, max, domainMode: 'non_negative' };
          continue;
        }
        if (reqB.domainMode === 'positive') {
          const fallbackPositiveFloor =
            astB.min > 0 ? Math.min(0.01, astB.min) : 0.01;
          const min = reqB.min > 0 ? reqB.min : Math.max(1e-4, fallbackPositiveFloor);
          const max =
            astB.max <= 1.0 && astB.min >= -1.0
              ? Math.max(min, Math.min(astB.max, reqB.max))
              : Math.max(min, reqB.max);
          effectiveParamBounds[k] = { min, max, domainMode: 'positive' };
          continue;
        }
        if (isBoundedDomainParam(k, astB)) {
          const min = Math.max(astB.min, reqB.min);
          const max =
            astB.max <= 1.0
              ? Math.max(min, Math.min(astB.max, reqB.max))
              : Math.max(min, reqB.max);
          effectiveParamBounds[k] = {
            min,
            max,
            domainMode: astB.domainMode,
          };
        }
      }
    }
  }

  let predictor: PredictorModel | undefined;
  if (
    targetCompiled &&
    targetCompiled.valid &&
    targetCompiled.kernel &&
    targetCompiled.isCustomPredictor &&
    (targetCompiled.paramNames?.length ?? 0) > 0
  ) {
    predictor = {
      evalScalar: targetCompiled.kernel.evalScalar,
      paramGradKernels: targetCompiled.paramGradKernels ?? {},
      paramNames: targetCompiled.paramNames ?? [],
      baseParams: req.paramValues,
      paramBounds: effectiveParamBounds,
      w1Key,
      w2Key,
      isCustomPredictor: true,
    };
  }

  const trainEval = evaluateEmpiricalLossAndGrad(
    w1,
    w2,
    packed.trainX,
    packed.trainY,
    req.lossKind,
    delta,
    req.regularizationKind,
    lambda,
    req.subgradConvention,
    predictor
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
          req.subgradConvention,
          predictor
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
    50,
    predictor
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
    req.subgradConvention,
    predictor,
    effectiveParamBounds
  );

  let linkedBrushPull: ComputeJobResponse['linkedBrushPull'];
  if (req.hoveredDataPointId) {
    const hoveredPt = req.dataPoints.find((p) => p.id === req.hoveredDataPointId);
    if (hoveredPt) {
      const pull = evaluateSingleSamplePull(
        w1,
        w2,
        hoveredPt,
        req.lossKind,
        delta,
        predictor
      );
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
