/**
 * Application State, Viewport, Optimizer & Storage Schema Types for GraphStudio.
 */
import type { SymbolRole, SubgradConvention, PointOfInterest } from './math';
export type { SubgradConvention };

/** Three primary view modes in [FR-1.4] */
export type ViewMode = 'inference' | 'optimization' | 'dual';

/** Two high-level workspace perspectives: General Math/Graphing vs ML/Optimization Lab */
export type WorkspaceMode = 'math' | 'ml';

/** Interactive Whiteboard / Freehand Annotation tool on the 2D Graph Canvas */
export type WhiteboardTool = 'cursor' | 'pen' | 'highlighter' | 'eraser';

export interface WhiteboardStroke {
  id: string;
  tool: 'pen' | 'highlighter';
  color: string;
  width: number;
  /** World-space points (wx, wy) so annotations pan and zoom with the graph */
  points: { x: number; y: number }[];
}

/** Mobile responsive active tab (< 1024px) */
export type MobileTabMode = 'data' | 'loss' | 'split';

/** Specialized Right Viewport modes for Phase 3 & Phase 5 templates */
export type RightViewportMode =
  | 'loss_surface'
  | 'softmax_simplex'
  | 'roc_curve'
  | 'svm_feature_3d'
  | 'mlp_grid_warp';

/** URL Hash routing session state machine to prevent overwriting E2EE / Gallery links */
export type HashSessionMode = 'local_url' | 'cloud_e2ee' | 'public_gallery';

/** Built-in loss function types for Dual-Space ML Simulation [FR-4.1, FR-4.3] */
export type LossKind =
  | 'mse'
  | 'mae'
  | 'huber'
  | 'bce'
  | 'hinge'
  | 'gaussian_nll'
  | 'kl_div'
  | 'reverse_kl_div'
  | 'rastrigin';

/** Regularization geometry mode [FR-4.3] */
export type RegularizationKind = 'none' | 'l1' | 'l2';

/** Optimizer algorithm identifiers [FR-4.2] */
export type OptimizerId = 'sgd' | 'momentum' | 'rmsprop' | 'adam' | 'custom_js';

export interface ExpressionItem {
  id: string;
  latex: string;
  color: string;
  visible: boolean;
  showFirstDerivative: boolean;
  showSecondDerivative: boolean;
  /** Optional human-readable label for template curves */
  label?: string;
}

export type PlaybackSpeed = 0.25 | 0.5 | 1 | 2 | 4;

export type SliderLoopMode = 'bounce' | 'wrap' | 'wrap_reverse' | 'once';

export type OptimizerLoopMode = 'once' | 'loop' | 'bounce';

export interface SliderState {
  name: string;
  latex: string;
  role: SymbolRole;
  value: number;
  min: number;
  max: number;
  step: number;
  playing: boolean;
  speed: PlaybackSpeed;
  loopMode: SliderLoopMode;
  direction: 1 | -1;
}

export interface DataPoint2D {
  id: string;
  x: number;
  y: number;
  /** Second feature x_2 for 2D classification templates (T-13, T-14, T-15) */
  x2?: number;
  /** Class label (0 or 1, or -1 / +1 for SVM) */
  label?: number;
  split: 'train' | 'test';
}

export interface Viewport2DBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface OptimizerTrajectoryStep {
  step: number;
  w1: number;
  w2: number;
  loss: number;
  gradW1: number;
  gradW2: number;
  /** Velocity / 1st moment vector (for Momentum/NAG & Adam comet tail) */
  velW1: number;
  velW2: number;
  /** 2nd moment / adaptive scale (for RMSProp & Adam halo) */
  cacheW1: number;
  cacheW2: number;
  /** Lookahead probe coordinate for Nesterov Accelerated Gradient */
  nagLookaheadW1?: number;
  nagLookaheadW2?: number;
  diverged: boolean;
}

export interface OptimizerRaceConfig {
  enabledOptimizers: Record<OptimizerId, boolean>;
  useNesterov: boolean;
  adamBiasCorrection: boolean;
  startW1: number;
  startW2: number;
  steps: number;
  currentStep: number;
  playing: boolean;
  lrSchedule: 'constant' | 'cosine_warm_restart' | 'catapult';
  speed?: PlaybackSpeed;
  loopMode?: OptimizerLoopMode;
  direction?: 1 | -1;
  customJsCode?: string;
}

export interface GraphStateV2 {
  v: 2;
  activeTemplateId: string;
  title: string;
  viewMode: ViewMode;
  rightViewportMode: RightViewportMode;
  subgradConvention: SubgradConvention;
  expressions: ExpressionItem[];
  symbolOverrides: Record<string, SymbolRole>;
  sliders: Record<string, SliderState>;
  dataPoints: DataPoint2D[];
  lossKind: LossKind;
  regularizationKind: RegularizationKind;
  regularizationRadius: number;
  batchNormEnabled: boolean;
  showResiduals: boolean;
  showVectorField: boolean;
  surface3DOrbitPitch: number;
  surface3DOrbitYaw: number;
  surface3DZScale: number;
  leftViewport: Viewport2DBounds;
  rightViewport: Viewport2DBounds;
  optimizerRace: OptimizerRaceConfig;
  probeX: number | null;
  hoveredDataPointId: string | null;
}

/** Computed geometry packet returned from Worker to Main Thread */
export interface CurveRenderPacket {
  exprId: string;
  color: string;
  visible: boolean;
  /** Interleaved [x0, y0, x1, y1, ...] with NaN, NaN breaks */
  primaryPoints: Float64Array;
  firstDerivPoints?: Float64Array;
  secondDerivPoints?: Float64Array;
  firstDerivFormulaLatex?: string;
  secondDerivFormulaLatex?: string;
  pois: PointOfInterest[];
  errorMessage?: string;
}
