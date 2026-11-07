/**
 * Serializable Worker Protocol between Main Thread and Compute Web Worker [NFR-1].
 *
 * Strictly uses cloneable JSON structures (`MathJsonExpr`, plain records) and
 * zero-copy `Transferable` ArrayBuffers (or `SharedArrayBuffer` when crossOriginIsolated).
 * Compiled `new Function()` closures NEVER cross `postMessage`.
 */
import type {
  LibraryFunctionEntry,
  SubgradConvention,
  SymbolRole,
} from '../types/math';
import type {
  CurveRenderPacket,
  DataPoint2D,
  ExpressionItem,
  LossKind,
  OptimizerId,
  OptimizerRaceConfig,
  OptimizerTrajectoryStep,
  RegularizationKind,
  Viewport2DBounds,
} from '../types/state';

export interface ComputeJobRequest {
  type: 'EVALUATE_FRAME';
  seq: number;
  expressions: ExpressionItem[];
  paramValues: Record<string, number>;
  symbolOverrides?: Record<string, SymbolRole>;
  subgradConvention: SubgradConvention;
  leftViewport: Viewport2DBounds;
  rightViewport: Viewport2DBounds;
  screenWidth: number;
  screenHeight: number;
  dataPoints: DataPoint2D[];
  lossKind: LossKind;
  regularizationKind: RegularizationKind;
  regularizationRadius: number;
  batchNormEnabled: boolean;
  optimizerRace: OptimizerRaceConfig;
  hoveredDataPointId: string | null;
  surfaceParamW1?: string;
  surfaceParamW2?: string;
  functionLibrary?: LibraryFunctionEntry[];
}

export interface ComputeJobResponse {
  type: 'FRAME_RESULT';
  seq: number;
  computeDurationMs: number;
  curves: CurveRenderPacket[];
  trainLoss: number;
  testLoss: number;
  lossGrid: Float32Array;
  minLoss: number;
  maxLoss: number;
  vectorField: Float32Array;
  trajectories: Record<OptimizerId, OptimizerTrajectoryStep[]>;
  linkedBrushPull?: {
    pointId: string;
    sampleLoss: number;
    pullW1: number;
    pullW2: number;
  };
}
