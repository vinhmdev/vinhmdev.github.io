/**
 * Zustand Reactive State Store with 50-Step Undo/Redo & AST Auto-Slider Sync [FR-1.3, FR-1.4].
 */
import { createStore } from 'zustand/vanilla';
import type {
  LibraryFunctionEntry,
  ParamDomainMode,
  SubgradConvention,
  SymbolRole,
} from '../types/math';
import type {
  CurveLineStyle,
  CurveRenderPacket,
  DataPoint2D,
  ExpressionItem,
  ExpressionKind,
  GraphStateV2,
  HashSessionMode,
  LossKind,
  MobileTabMode,
  OptimizerId,
  OptimizerTrajectoryStep,
  RegularizationKind,
  RightViewportMode,
  SliderState,
  ViewMode,
  Viewport2DBounds,
  WhiteboardStroke,
  WhiteboardTool,
  WorkspaceMode,
} from '../types/state';
import {
  buildUserFunctionRegistry,
  classifyLatexExpression,
  classifySymbolRole,
} from '../core/parser/ast-classifier';
import {
  DEFAULT_FUNCTION_LIBRARY,
  extractFunctionSignature,
  extractLeadingFunctionLabel,
  resolveDerivSymbol,
} from '../core/parser/cortex-setup';
import {
  mathJsonToLatex,
  symbolicDiff,
  symbolicSecondDiff,
} from '../core/calculus/symbolic-diff';
import { resolveSurfaceParamPair } from '../core/simulation/loss-evaluator';
import { isBoundedDomainParam, projectParam } from '../core/simulation/optimizers';
import { getTemplateById, isMathTemplateId } from '../extensions/templates';
import { ensureFitTarget, getPlottableExpressions, isNoteExpression } from './expression-kind';
import { scheduleAutoSave } from './local-persistence';
import { scheduleStatelessUrlUpdate } from './hash-router';
import { encodeStateToUrlHashSync } from './url-codec';

const MAX_UNDO_STEPS = 50;

export interface ExpressionBatchItem {
  latex: string;
  kind: ExpressionKind;
  label?: string;
}

export function createInitialGraphState(templateId = 'T-00'): GraphStateV2 {
  const tpl = getTemplateById(templateId);
  const partial = tpl.buildInitialState();

  const rawExpressions = partial.expressions ?? [
    {
      id: 'expr-1',
      latex: tpl.defaultLatex,
      color: '#f97316',
      visible: true,
      showFirstDerivative: true,
      showSecondDerivative: false,
      fitLoss: true,
    },
  ];
  const hasFitLoss = rawExpressions.some((e) => e.fitLoss);
  const expressions = hasFitLoss
    ? rawExpressions
    : rawExpressions.map((e, idx) => (idx === 0 ? { ...e, fitLoss: true } : e));

  const base: GraphStateV2 = {
    v: 2,
    activeTemplateId: tpl.id,
    title: partial.title ?? 'GraphStudio Session',
    viewMode: partial.viewMode ?? 'dual',
    rightViewportMode: partial.rightViewportMode ?? 'loss_surface',
    subgradConvention: partial.subgradConvention ?? 'zero',
    expressions,
    symbolOverrides: partial.symbolOverrides ?? {},
    sliders: partial.sliders ?? {},
    dataPoints: partial.dataPoints ?? [
      { id: 'p1', x: -2.0, y: -1.4, split: 'train' },
      { id: 'p2', x: -1.0, y: -0.6, split: 'train' },
      { id: 'p3', x: 0.0, y: 0.1, split: 'train' },
      { id: 'p4', x: 1.0, y: 0.9, split: 'train' },
      { id: 'p5', x: 2.0, y: 1.8, split: 'train' },
    ],
    lossKind: partial.lossKind ?? 'mse',
    regularizationKind: partial.regularizationKind ?? 'none',
    regularizationRadius: partial.regularizationRadius ?? 1.5,
    batchNormEnabled: partial.batchNormEnabled ?? false,
    showResiduals: partial.showResiduals ?? true,
    showVectorField: partial.showVectorField ?? true,
    lock1to1: partial.lock1to1 ?? true,
    surface3DOrbitPitch: partial.surface3DOrbitPitch ?? 0.55,
    surface3DOrbitYaw: partial.surface3DOrbitYaw ?? -0.65,
    surface3DZScale: partial.surface3DZScale ?? 0.0,
    leftViewport: partial.leftViewport ?? { xMin: -5, xMax: 5, yMin: -3.5, yMax: 3.5 },
    rightViewport: partial.rightViewport ?? { xMin: -4, xMax: 4, yMin: -4, yMax: 4 },
    optimizerRace: {
      enabledOptimizers: {
        sgd: true,
        momentum: true,
        rmsprop: true,
        adam: true,
        custom_js: false,
      },
      useNesterov: true,
      adamBiasCorrection: true,
      startW1: -2.8,
      startW2: 2.6,
      steps: 60,
      currentStep: 60,
      playing: false,
      lrSchedule: 'constant',
      speed: 1,
      loopMode: 'once',
      direction: 1,
      ...partial.optimizerRace,
    },
    probeX: partial.probeX ?? null,
    hoveredDataPointId: null,
    surfaceParamW1: partial.surfaceParamW1,
    surfaceParamW2: partial.surfaceParamW2,
    functionLibrary:
      partial.functionLibrary ??
      DEFAULT_FUNCTION_LIBRARY.map((entry) => ({ ...entry })),
  };

  return syncSlidersFromExpressions(base);
}

/**
 * Automatically reconciles `state.sliders` with all Group 4 (`param`) and
 * Group 5 (`hyperparam`) symbols detected across `state.expressions` [FR-1.2, FR-1.3].
 */
export function syncSlidersFromExpressions(state: GraphStateV2): GraphStateV2 {
  const nextSliders: Record<string, SliderState> = { ...state.sliders };
  const activeSymbols = new Set<string>();
  const restrictedInPass = new Set<string>();
  const domainSeenInPass = new Set<string>();
  const domainRank = (m?: ParamDomainMode): number =>
    m === 'positive' ? 2 : m === 'non_negative' ? 1 : 0;
  let hasInvalidNonEmptyExpr = false;
  const plottable = getPlottableExpressions(state.expressions);

  const userFunctions = buildUserFunctionRegistry(plottable, state.functionLibrary);
  const unlockedSymbols = new Set<string>();
  for (const [k, sl] of Object.entries(state.sliders)) {
    if (sl.domainUserSet && sl.domainMode === 'free') {
      unlockedSymbols.add(k);
    }
  }

  const isGenericAutoBounds = (s: SliderState): boolean =>
    (s.min === -5 && s.max === 5) ||
    (s.min === 0.01 && s.max === 10) ||
    (s.min === -1 && s.max === 1) ||
    (s.min === 0.01 && s.max === 1);

  for (const expr of plottable) {
    const trimmed = expr.latex.trim();
    if (!trimmed) continue;
    const classified = classifyLatexExpression(
      trimmed,
      state.symbolOverrides,
      userFunctions,
      unlockedSymbols
    );
    if (!classified.valid) {
      hasInvalidNonEmptyExpr = true;
      continue;
    }

    for (const sym of classified.symbols) {
      if (sym.role === 'param' || sym.role === 'hyperparam') {
        activeSymbols.add(sym.name);
        const symIsRestricted = isBoundedDomainParam(sym.name, {
          min: sym.defaultMin,
          max: sym.defaultMax,
          domainMode: sym.domainMode,
        });
        if (!nextSliders[sym.name]) {
          if (symIsRestricted) restrictedInPass.add(sym.name);
          domainSeenInPass.add(sym.name);
          nextSliders[sym.name] = {
            name: sym.name,
            latex: sym.latex,
            role: sym.role,
            value: sym.defaultValue,
            min: sym.defaultMin,
            max: sym.defaultMax,
            step: sym.defaultStep,
            playing: false,
            speed: 1,
            loopMode: 'bounce',
            direction: 1,
            domainMode: sym.domainMode ?? 'free',
            domainSource: sym.domainSource,
          };
        } else {
          const existing = nextSliders[sym.name];
          const wasCreatedInPass = !state.sliders[sym.name];
          const seenEarlierInPass = domainSeenInPass.has(sym.name);
          domainSeenInPass.add(sym.name);

          let nextDomainMode: ParamDomainMode;
          let nextDomainSource: string | undefined;
          if (existing.domainUserSet) {
            nextDomainMode = existing.domainMode ?? 'free';
            nextDomainSource = existing.domainSource;
          } else if (!seenEarlierInPass) {
            nextDomainMode = sym.domainMode ?? 'free';
            nextDomainSource = sym.domainSource;
          } else {
            const curMode = existing.domainMode ?? 'free';
            const incMode = sym.domainMode ?? 'free';
            if (domainRank(incMode) > domainRank(curMode)) {
              nextDomainMode = incMode;
              nextDomainSource = sym.domainSource;
            } else {
              nextDomainMode = curMode;
              nextDomainSource = existing.domainSource;
            }
          }
          const nextRole =
            seenEarlierInPass &&
            !state.symbolOverrides[sym.name] &&
            domainRank(existing.domainMode) > domainRank(sym.domainMode)
              ? existing.role
              : sym.role;
          const shouldTightenBounds =
            !existing.domainUserSet &&
            symIsRestricted &&
            (wasCreatedInPass || isGenericAutoBounds(existing));
          let nextMin = existing.min;
          let nextMax = existing.max;
          let nextStep = existing.step;
          let nextVal = existing.value;

          if (shouldTightenBounds) {
            const mergeWithPriorRestricted = restrictedInPass.has(sym.name);
            nextMin = mergeWithPriorRestricted
              ? Math.max(existing.min, sym.defaultMin)
              : sym.defaultMin;
            nextMax = mergeWithPriorRestricted
              ? Math.max(nextMin, Math.min(existing.max, sym.defaultMax))
              : sym.defaultMax;
            nextStep = mergeWithPriorRestricted
              ? Math.min(existing.step, sym.defaultStep)
              : sym.defaultStep;
            if (nextVal < nextMin || nextVal > nextMax) {
              nextVal = Math.min(Math.max(sym.defaultValue, nextMin), nextMax);
            }
            restrictedInPass.add(sym.name);
          } else if (!existing.domainUserSet) {
            if (nextDomainMode === 'positive' && nextMin <= 0) {
              nextMin = sym.defaultMin > 0 ? sym.defaultMin : 0.01;
              nextMax = Math.max(nextMin + nextStep, nextMax);
              nextVal = Math.min(Math.max(nextVal, nextMin), nextMax);
            } else if (nextDomainMode === 'non_negative' && nextMin < 0) {
              nextMin = sym.defaultMin >= 0 ? sym.defaultMin : 0;
              nextMax = Math.max(nextMin + nextStep, nextMax);
              nextVal = Math.min(Math.max(nextVal, nextMin), nextMax);
            }
          }

          nextSliders[sym.name] = {
            ...existing,
            role: nextRole,
            latex: sym.latex || existing.latex || sym.name,
            min: nextMin,
            max: nextMax,
            step: nextStep,
            value: nextVal,
            domainMode: nextDomainMode,
            domainSource: nextDomainSource,
          };
        }
      } else if (sym.role === 'data_var') {
        delete nextSliders[sym.name];
      }
    }
  }

  // Prune unused sliders when expressions change or are cleared:
  // - In Math / Blank Graph mode (T-00, M-*), prune any slider not present in activeSymbols.
  // - In ML templates, also prune freeform algebraic or Transformer constants when removed from expressions.
  if (!hasInvalidNonEmptyExpr) {
    const freeformConstants = new Set([
      'a',
      'c',
      'd',
      'm',
      'k',
      'Q',
      'K',
      'V',
      'W',
      'd_k',
      'd_v',
      'd_model',
      'epsilon',
    ]);
    for (const key of Object.keys(nextSliders)) {
      if (!activeSymbols.has(key)) {
        if (isMathTemplateId(state.activeTemplateId) || freeformConstants.has(key)) {
          delete nextSliders[key];
        }
      }
    }
  }

  const { w1Key, w2Key, w1, w2 } = resolveSurfaceParamPair(
    nextSliders,
    state.surfaceParamW1,
    state.surfaceParamW2
  );
  let rightViewport = state.rightViewport;
  const s1 = nextSliders[w1Key];
  if (
    s1 &&
    Number.isFinite(w1) &&
    (w1 < rightViewport.xMin ||
      w1 > rightViewport.xMax ||
      s1.max < rightViewport.xMin ||
      s1.min > rightViewport.xMax ||
      s1.max - s1.min > (rightViewport.xMax - rightViewport.xMin) * 2.5)
  ) {
    const lo = Math.min(s1.min, w1);
    const hi = Math.max(s1.max, w1, lo + 0.5);
    rightViewport = { ...rightViewport, xMin: lo, xMax: hi };
  }
  const s2 = nextSliders[w2Key];
  if (
    s2 &&
    Number.isFinite(w2) &&
    (w2 < rightViewport.yMin ||
      w2 > rightViewport.yMax ||
      s2.max < rightViewport.yMin ||
      s2.min > rightViewport.yMax ||
      s2.max - s2.min > (rightViewport.yMax - rightViewport.yMin) * 2.5)
  ) {
    const lo = Math.min(s2.min, w2);
    const hi = Math.max(s2.max, w2, lo + 0.5);
    rightViewport = { ...rightViewport, yMin: lo, yMax: hi };
  }

  return {
    ...state,
    sliders: nextSliders,
    rightViewport,
  };
}

export interface GraphStoreState {
  graph: GraphStateV2;
  workspaceMode: WorkspaceMode;
  undoStack: GraphStateV2[];
  redoStack: GraphStateV2[];
  sessionMode: HashSessionMode;
  cloudMeta: {
    id: string;
    keyStr?: string;
    mode: 'editable' | 'owner' | 'readonly';
    isDirty: boolean;
  } | null;
  mobileTab: MobileTabMode;
  brushActive: boolean;
  whiteboardTool: WhiteboardTool;
  whiteboardColor: string;
  whiteboardStrokes: WhiteboardStroke[];
  whiteboardUndoStack: WhiteboardStroke[][];
  whiteboardRedoStack: WhiteboardStroke[][];
  shareModalOpen: boolean;
  galleryDrawerOpen: boolean;
  galleryInitialTab: 'examples' | 'my_docs' | 'community';
  customOptModalOpen: boolean;
  functionLibraryDrawerOpen: boolean;
  functionLibraryFocusName: string | null;
  /** Latest computed worker output */
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
  computeDurationMs: number;

  // Actions
  loadFullState: (next: GraphStateV2, pushUndo?: boolean) => void;
  selectTemplate: (templateId: string) => void;
  resetToBlankCanvas: () => void;
  setWorkspaceMode: (mode: WorkspaceMode) => void;
  setViewMode: (mode: ViewMode) => void;
  setRightViewportMode: (mode: RightViewportMode) => void;
  setMobileTab: (tab: MobileTabMode) => void;
  setSubgradConvention: (conv: SubgradConvention) => void;
  setShowResiduals: (show: boolean) => void;
  setShowVectorField: (show: boolean) => void;
  setLock1to1: (lock: boolean) => void;
  updateExpressionLatex: (id: string, latex: string) => void;
  updateExpressionLabel: (id: string, label: string) => void;
  updateExpressionStyle: (
    id: string,
    patch: { color?: string; lineStyle?: CurveLineStyle; lineWidth?: number }
  ) => void;
  cloneDerivativeAsExpression: (
    sourceExprId: string,
    order?: 1 | 2,
    formulaLatex?: string
  ) => string | null;
  addExpression: (customLatex?: string, customLabel?: string) => void;
  /**
   * Inserts several rows in a single commit (one undo step). When `replaceId` names an existing row,
   * the first item overwrites that row in place and the rest are inserted right after it.
   */
  addExpressionsBatch: (items: ExpressionBatchItem[], replaceId?: string) => void;
  setExpressionKind: (id: string, kind: ExpressionKind) => void;
  reorderExpressions: (fromIndex: number, toIndex: number) => void;
  moveExpression: (id: string, dir: -1 | 1) => void;
  duplicateExpression: (id: string) => string | null;
  removeExpression: (id: string) => void;
  clearAllExpressions: () => void;
  toggleExpressionProp: (
    id: string,
    prop:
      | 'visible'
      | 'showFirstDerivative'
      | 'showSecondDerivative'
      | 'collapsed'
      | 'fitLoss'
  ) => void;
  setExpressionFitLoss: (id: string) => void;
  toggleAllExpressionsVisible: () => void;
  setSurfaceParamAxes: (w1Key: string, w2Key: string) => void;
  setFunctionLibraryDrawerOpen: (
    open: boolean,
    focusFunctionName?: string | null
  ) => void;
  toggleLibraryFunction: (id: string, enabled?: boolean) => void;
  toggleAllLibraryFunctions: (enabled: boolean) => void;
  upsertLibraryFunction: (
    entry: Omit<LibraryFunctionEntry, 'id'> & { id?: string }
  ) => void;
  removeLibraryFunction: (id: string) => void;
  resetFunctionLibrary: () => void;
  setSymbolRole: (symbolName: string, nextRole: SymbolRole) => void;
  cycleSymbolRole: (symbolName: string) => void;
  setSliderValue: (name: string, value: number, commitUndo?: boolean) => void;
  updateSliderBounds: (name: string, bounds: Partial<SliderState>) => void;
  stepSliderByDelta: (name: string, dir: 1 | -1) => void;
  reorderSliders: (fromIndex: number, toIndex: number) => void;
  moveSlider: (name: string, dir: -1 | 1) => void;
  toggleAllSlidersPlay: () => void;
  stepPlayingSliders: (dtSec: number) => boolean;
  addDataPoint: (pt: Omit<DataPoint2D, 'id'>) => void;
  updateDataPoint: (id: string, x: number, y: number) => void;
  removeDataPoint: (id: string) => void;
  setDataPoints: (pts: DataPoint2D[]) => void;
  setHoveredDataPoint: (id: string | null) => void;
  setProbeX: (x: number | null) => void;
  setLossKind: (kind: LossKind) => void;
  setRegularization: (kind: RegularizationKind, radius?: number) => void;
  setBatchNormEnabled: (enabled: boolean) => void;
  setLeftViewport: (vp: Viewport2DBounds) => void;
  setRightViewport: (vp: Viewport2DBounds) => void;
  setOrbit3D: (pitch: number, yaw: number, zScale?: number) => void;
  updateOptimizerRace: (patch: Partial<GraphStateV2['optimizerRace']>) => void;
  stepOptimizerRace: () => boolean;
  flipBayesianCoins: (numFlips: number, trueProb?: number) => void;
  undo: () => void;
  redo: () => void;
  setSessionMode: (
    mode: HashSessionMode,
    cloudMeta?: GraphStoreState['cloudMeta']
  ) => void;
  setShareModalOpen: (open: boolean) => void;
  setGalleryDrawerOpen: (
    open: boolean,
    initialTab?: 'examples' | 'my_docs' | 'community'
  ) => void;
  setCustomOptModalOpen: (open: boolean) => void;
  setBrushActive: (active: boolean) => void;
  setWhiteboardTool: (tool: WhiteboardTool) => void;
  setWhiteboardColor: (color: string) => void;
  addWhiteboardStroke: (stroke: WhiteboardStroke) => void;
  eraseWhiteboardAt: (
    wx: number,
    wy: number,
    radiusWorld: number,
    recordUndo?: boolean
  ) => boolean;
  clearWhiteboard: () => void;
  undoWhiteboard: () => void;
  redoWhiteboard: () => void;
  applyWorkerResult: (res: {
    curves: CurveRenderPacket[];
    trainLoss: number;
    testLoss: number;
    lossGrid: Float32Array;
    minLoss: number;
    maxLoss: number;
    vectorField: Float32Array;
    trajectories: Record<OptimizerId, OptimizerTrajectoryStep[]>;
    linkedBrushPull?: GraphStoreState['linkedBrushPull'];
    computeDurationMs: number;
  }) => void;
}

export const EXPRESSION_COLORS = [
  '#f97316',
  '#3b82f6',
  '#10b981',
  '#a855f7',
  '#ec4899',
  '#ef4444',
  '#eab308',
  '#06b6d4',
];

export function getSliderDomainMode(slider: SliderState): ParamDomainMode {
  if (slider.domainMode) return slider.domainMode;
  if (
    slider.name === 'sigma' ||
    slider.name === 'tau' ||
    slider.name === 'epsilon' ||
    slider.name === 'delta'
  ) {
    return 'positive';
  }
  return 'free';
}

export function isStrictlyPositiveParam(slider: SliderState): boolean {
  return getSliderDomainMode(slider) === 'positive';
}

function applySyncedSliderVal(
  slider: SliderState,
  rawVal: number
): SliderState {
  const domainMode = getSliderDomainMode(slider);
  const projected = projectParam(slider.name, rawVal, {
    min: slider.min,
    max: slider.max,
    domainMode,
  });
  const isStrictlyPositive = domainMode === 'positive';
  const isNonNegative = domainMode === 'non_negative';
  const floorLimit = isStrictlyPositive
    ? slider.min > 0 && slider.min < 0.01
      ? slider.min
      : 0.01
    : 0;
  const guardedVal =
    isStrictlyPositive || isNonNegative ? Math.max(floorLimit, projected) : projected;
  const val = Math.round(guardedVal * 1e6) / 1e6;
  const rawMin = val < slider.min ? Math.floor(val * 10) / 10 : slider.min;
  const nextMin =
    isStrictlyPositive || isNonNegative ? Math.max(floorLimit, rawMin) : rawMin;
  const nextMax = val > slider.max ? Math.ceil(val * 10) / 10 : slider.max;
  return {
    ...slider,
    min: nextMin,
    max: Math.max(nextMin, nextMax),
    value: val,
    playing: false,
  };
}

function syncSlidersToRaceStep(
  sliders: Record<string, SliderState>,
  race: GraphStateV2['optimizerRace'],
  trajectories: Record<OptimizerId, OptimizerTrajectoryStep[]>,
  step: number,
  preferredW1?: string,
  preferredW2?: string
): Record<string, SliderState> {
  const priorityOrder: OptimizerId[] = ['adam', 'momentum', 'rmsprop', 'sgd', 'custom_js'];
  const leadOpt =
    priorityOrder.find(
      (id) =>
        race.enabledOptimizers[id] &&
        trajectories[id] &&
        trajectories[id].length > 0 &&
        !trajectories[id][trajectories[id].length - 1]?.diverged
    ) ??
    priorityOrder.find(
      (id) => race.enabledOptimizers[id] && trajectories[id] && trajectories[id].length > 0
    );
  if (!leadOpt) return sliders;

  const traj = trajectories[leadOpt];
  const pt = traj[Math.min(Math.max(0, step), traj.length - 1)];
  if (!pt || pt.diverged || !Number.isFinite(pt.w1) || !Number.isFinite(pt.w2)) {
    return sliders;
  }

  const nextSliders: Record<string, SliderState> = { ...sliders };
  const { w1Key, w2Key } = resolveSurfaceParamPair(
    nextSliders,
    preferredW1,
    preferredW2
  );
  if (nextSliders[w1Key]) {
    nextSliders[w1Key] = applySyncedSliderVal(nextSliders[w1Key], pt.w1);
  }
  if (nextSliders[w2Key] && w2Key !== w1Key) {
    nextSliders[w2Key] = applySyncedSliderVal(nextSliders[w2Key], pt.w2);
  }
  if (pt.params) {
    for (const [pKey, pVal] of Object.entries(pt.params)) {
      if (pKey === w1Key || pKey === w2Key) continue;
      if (nextSliders[pKey] && Number.isFinite(pVal)) {
        nextSliders[pKey] = applySyncedSliderVal(nextSliders[pKey], pVal);
      }
    }
  }
  return nextSliders;
}

function expandRightViewportForActiveParams(
  rightViewport: Viewport2DBounds,
  sliders: Record<string, SliderState>,
  preferredW1?: string,
  preferredW2?: string
): Viewport2DBounds {
  const { w1Key, w2Key, w1, w2 } = resolveSurfaceParamPair(
    sliders,
    preferredW1,
    preferredW2
  );
  let nextVp = rightViewport;
  const s1 = sliders[w1Key];
  if (s1 && Number.isFinite(w1) && (w1 < nextVp.xMin || w1 > nextVp.xMax)) {
    nextVp = {
      ...nextVp,
      xMin: Math.min(nextVp.xMin, s1.min, w1),
      xMax: Math.max(nextVp.xMax, s1.max, w1),
    };
  }
  const s2 = sliders[w2Key];
  if (s2 && Number.isFinite(w2) && (w2 < nextVp.yMin || w2 > nextVp.yMax)) {
    nextVp = {
      ...nextVp,
      yMin: Math.min(nextVp.yMin, s2.min, w2),
      yMax: Math.max(nextVp.yMax, s2.max, w2),
    };
  }
  return nextVp;
}

export const graphStore = createStore<GraphStoreState>((set, get) => {
  function commitGraph(
    nextGraph: GraphStateV2,
    recordUndo = false,
    skipExprSync = false
  ): void {
    const prev = get();
    const synced = skipExprSync ? nextGraph : syncSlidersFromExpressions(nextGraph);
    const undoStack = recordUndo
      ? [...prev.undoStack.slice(-(MAX_UNDO_STEPS - 1)), prev.graph]
      : prev.undoStack;
    const redoStack = recordUndo ? [] : prev.redoStack;

    const cloudMeta = prev.cloudMeta
      ? { ...prev.cloudMeta, isDirty: true }
      : null;

    set({ graph: synced, undoStack, redoStack, cloudMeta });
    scheduleAutoSave(synced, 500);
    scheduleStatelessUrlUpdate(prev.sessionMode, () => encodeStateToUrlHashSync(synced), 300);
  }

  return {
    graph: createInitialGraphState('T-00'),
    workspaceMode: 'ml',
    undoStack: [],
    redoStack: [],
    sessionMode: 'local_url',
    cloudMeta: null,
    mobileTab: 'split',
    brushActive: false,
    whiteboardTool: 'cursor',
    whiteboardColor: '#f97316',
    whiteboardStrokes: [],
    whiteboardUndoStack: [],
    whiteboardRedoStack: [],
    shareModalOpen: false,
    galleryDrawerOpen: false,
    galleryInitialTab: 'examples',
    customOptModalOpen: false,
    functionLibraryDrawerOpen: false,
    functionLibraryFocusName: null,
    curves: [],
    trainLoss: 0,
    testLoss: 0,
    lossGrid: new Float32Array(128 * 128),
    minLoss: 0,
    maxLoss: 1,
    vectorField: new Float32Array(50 * 50 * 4),
    trajectories: { sgd: [], momentum: [], rmsprop: [], adam: [], custom_js: [] },
    computeDurationMs: 0,

    loadFullState(next, pushUndo = false) {
      set({ workspaceMode: 'ml' });
      commitGraph(next, pushUndo);
    },

    selectTemplate(templateId) {
      const next = createInitialGraphState(templateId);
      set({
        workspaceMode: 'ml',
        whiteboardStrokes: [],
        whiteboardUndoStack: [],
        whiteboardRedoStack: [],
        whiteboardTool: 'cursor',
        brushActive: false,
      });
      commitGraph(next, true);
    },

    resetToBlankCanvas() {
      const next = createInitialGraphState('T-00');
      set({
        workspaceMode: 'ml',
        whiteboardStrokes: [],
        whiteboardUndoStack: [],
        whiteboardRedoStack: [],
        whiteboardTool: 'cursor',
        brushActive: false,
      });
      commitGraph(next, true);
    },

    setWorkspaceMode(workspaceMode) {
      const g = get().graph;
      if (workspaceMode === 'math') {
        set({ workspaceMode: 'math' });
        if (g.viewMode !== 'inference') {
          commitGraph({ ...g, viewMode: 'inference' }, false);
        }
      } else {
        set({ workspaceMode: 'ml' });
        if (g.viewMode === 'inference') {
          commitGraph({ ...g, viewMode: 'dual' }, false);
        }
      }
    },

    setViewMode(viewMode) {
      commitGraph({ ...get().graph, viewMode }, true);
    },

    setRightViewportMode(rightViewportMode) {
      const g = get().graph;
      const viewMode: ViewMode = g.viewMode === 'inference' ? 'dual' : g.viewMode;
      commitGraph({ ...g, rightViewportMode, viewMode }, true);
    },

    setMobileTab(mobileTab) {
      set({ mobileTab });
    },

    setSubgradConvention(subgradConvention) {
      commitGraph({ ...get().graph, subgradConvention }, true);
    },

    setShowResiduals(showResiduals) {
      commitGraph({ ...get().graph, showResiduals }, true, true);
    },

    setShowVectorField(showVectorField) {
      commitGraph({ ...get().graph, showVectorField }, true, true);
    },

    setLock1to1(lock1to1) {
      commitGraph({ ...get().graph, lock1to1 }, false, true);
    },

    updateExpressionLatex(id, latex) {
      const g = get().graph;
      const inferredLabel = extractLeadingFunctionLabel(latex);
      const expressions = g.expressions.map((e) =>
        e.id === id
          ? {
              ...e,
              latex,
              ...(inferredLabel ? { label: inferredLabel } : {}),
            }
          : e
      );
      commitGraph({ ...g, expressions }, true);
    },

    updateExpressionLabel(id, label) {
      const g = get().graph;
      const expressions = g.expressions.map((e) =>
        e.id === id ? { ...e, label: label.trim().length > 0 ? label : undefined } : e
      );
      commitGraph({ ...g, expressions }, true, true);
    },

    updateExpressionStyle(id, patch) {
      const prev = get();
      const g = prev.graph;
      const expressions = g.expressions.map((e) =>
        e.id === id
          ? {
              ...e,
              ...(patch.color !== undefined ? { color: patch.color } : {}),
              ...(patch.lineStyle !== undefined ? { lineStyle: patch.lineStyle } : {}),
              ...(patch.lineWidth !== undefined ? { lineWidth: patch.lineWidth } : {}),
            }
          : e
      );
      const curves = prev.curves.map((c) =>
        c.exprId === id
          ? {
              ...c,
              ...(patch.color !== undefined ? { color: patch.color } : {}),
              ...(patch.lineStyle !== undefined ? { lineStyle: patch.lineStyle } : {}),
              ...(patch.lineWidth !== undefined ? { lineWidth: patch.lineWidth } : {}),
            }
          : c
      );
      set({ curves });
      commitGraph({ ...g, expressions }, true, true);
    },

    cloneDerivativeAsExpression(sourceExprId, order = 1, formulaLatex) {
      const prev = get();
      const g = prev.graph;
      const sourceIdx = g.expressions.findIndex((e) => e.id === sourceExprId);
      if (sourceIdx < 0) return null;
      const sourceExpr = g.expressions[sourceIdx];
      if (isNoteExpression(sourceExpr) || !sourceExpr.latex.trim()) return null;

      const plottable = getPlottableExpressions(g.expressions);
      const userFunctions = buildUserFunctionRegistry(plottable, g.functionLibrary);
      const classified = classifyLatexExpression(
        sourceExpr.latex,
        g.symbolOverrides,
        userFunctions
      );
      if (!classified.valid) return null;

      const packet = prev.curves.find((c) => c.exprId === sourceExprId);
      const packetLatex =
        order === 2 ? packet?.secondDerivFormulaLatex : packet?.firstDerivFormulaLatex;
      const resolvedDerivLatex =
        formulaLatex?.trim() ||
        packetLatex?.trim() ||
        mathJsonToLatex(
          order === 2
            ? symbolicSecondDiff(classified.stabilizedExpr, classified.primaryVar)
            : symbolicDiff(classified.stabilizedExpr, classified.primaryVar)
        );
      if (!resolvedDerivLatex) return null;

      const derivSymbol = resolveDerivSymbol(
        classified.signature?.rawHeader ?? sourceExpr.label ?? `f_${sourceIdx + 1}`
      );
      const primaryVar = classified.primaryVar || 'x';
      const primeSuffix = order === 2 ? "''" : "'";
      const clonedLabel = `${derivSymbol}${primeSuffix}(${primaryVar})`;

      const usedColors = new Set(g.expressions.map((e) => e.color.toLowerCase()));
      const unusedColor = EXPRESSION_COLORS.find((c) => !usedColors.has(c.toLowerCase()));
      const idx = g.expressions.length;
      const nextColor =
        unusedColor ??
        EXPRESSION_COLORS.find((c) => c.toLowerCase() !== sourceExpr.color.toLowerCase()) ??
        EXPRESSION_COLORS[idx % EXPRESSION_COLORS.length];

      const newExpr: ExpressionItem = {
        id: `expr-${Date.now()}-${idx}`,
        latex: resolvedDerivLatex,
        label: clonedLabel,
        color: nextColor,
        visible: true,
        showFirstDerivative: false,
        showSecondDerivative: false,
      };
      commitGraph(
        { ...g, expressions: ensureFitTarget([...g.expressions, newExpr]) },
        true
      );
      return newExpr.id;
    },

    addExpression(customLatex, customLabel) {
      const g = get().graph;
      const idx = g.expressions.length;
      const defaultExpr =
        customLatex ?? (isMathTemplateId(g.activeTemplateId) ? '\\sin(x)' : 'w \\cdot x + b');
      const inferredLabel = customLabel ?? extractLeadingFunctionLabel(defaultExpr) ?? undefined;
      const newExpr: ExpressionItem = {
        id: `expr-${Date.now()}-${idx}`,
        latex: defaultExpr,
        color: EXPRESSION_COLORS[idx % EXPRESSION_COLORS.length],
        visible: true,
        showFirstDerivative: false,
        showSecondDerivative: false,
        ...(inferredLabel ? { label: inferredLabel } : {}),
      };
      commitGraph(
        { ...g, expressions: ensureFitTarget([...g.expressions, newExpr]) },
        true
      );
    },

    addExpressionsBatch(items, replaceId) {
      if (items.length === 0) return;
      const g = get().graph;
      const replaceIdx = replaceId ? g.expressions.findIndex((e) => e.id === replaceId) : -1;
      const stamp = Date.now();
      const created: ExpressionItem[] = items.map((item, i) => {
        const colorIdx = g.expressions.length + i;
        const label = item.label ?? extractLeadingFunctionLabel(item.latex) ?? undefined;
        const base: ExpressionItem =
          i === 0 && replaceIdx >= 0
            ? { ...g.expressions[replaceIdx], latex: item.latex, fitLoss: false }
            : {
                id: `expr-${stamp}-${colorIdx}`,
                latex: item.latex,
                color: EXPRESSION_COLORS[colorIdx % EXPRESSION_COLORS.length],
                visible: true,
                showFirstDerivative: false,
                showSecondDerivative: false,
              };
        const { kind: _prevKind, label: _prevLabel, ...rest } = base;
        return {
          ...rest,
          ...(item.kind === 'note' ? { kind: 'note' as const } : {}),
          ...(label ? { label } : {}),
        };
      });

      const expressions =
        replaceIdx >= 0
          ? [
              ...g.expressions.slice(0, replaceIdx),
              ...created,
              ...g.expressions.slice(replaceIdx + 1),
            ]
          : [...g.expressions, ...created];
      const previousFitId = g.expressions.find((e) => e.fitLoss)?.id;
      const withFit = expressions.map((e) =>
        e.id === previousFitId && !isNoteExpression(e) ? { ...e, fitLoss: true } : e
      );
      commitGraph({ ...g, expressions: ensureFitTarget(withFit) }, true);
    },

    setExpressionKind(id, kind) {
      const g = get().graph;
      const expressions = g.expressions.map((e) => {
        if (e.id !== id) return e;
        const { kind: _prevKind, ...rest } = e;
        return kind === 'note' ? { ...rest, kind: 'note' as const, fitLoss: false } : rest;
      });
      commitGraph({ ...g, expressions: ensureFitTarget(expressions) }, true);
    },

    reorderExpressions(fromIndex, toIndex) {
      const prev = get();
      const g = prev.graph;
      const len = g.expressions.length;
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= len ||
        toIndex >= len
      ) {
        return;
      }

      const nextExprs = [...g.expressions];
      const [moved] = nextExprs.splice(fromIndex, 1);
      nextExprs.splice(toIndex, 0, moved);
      const expressions = ensureFitTarget(nextExprs);

      // Update curve packet Z-order synchronously (0ms) so later rows render on top
      const orderMap = new Map(expressions.map((e, idx) => [e.id, idx]));
      const curves = [...prev.curves].sort(
        (a, b) => (orderMap.get(a.exprId) ?? 9999) - (orderMap.get(b.exprId) ?? 9999)
      );
      set({ curves });

      // Only run full AST slider sync when duplicate formal function names exist (Last-Row-Wins)
      const seenFnNames = new Set<string>();
      let hasDuplicateFnDefs = false;
      for (const item of getPlottableExpressions(expressions)) {
        const sig = extractFunctionSignature(item.latex);
        if (sig && sig.formalParams.length > 0) {
          const lower = sig.name.toLowerCase();
          if (seenFnNames.has(lower)) {
            hasDuplicateFnDefs = true;
            break;
          }
          seenFnNames.add(lower);
        }
      }

      commitGraph({ ...g, expressions }, true, !hasDuplicateFnDefs);
    },

    moveExpression(id, dir) {
      const exprs = get().graph.expressions;
      const idx = exprs.findIndex((e) => e.id === id);
      if (idx < 0) return;
      const targetIdx = idx + dir;
      if (targetIdx < 0 || targetIdx >= exprs.length) return;
      get().reorderExpressions(idx, targetIdx);
    },

    duplicateExpression(id) {
      const g = get().graph;
      const idx = g.expressions.findIndex((e) => e.id === id);
      if (idx < 0) return null;
      const src = g.expressions[idx];
      const usedColors = new Set(g.expressions.map((e) => e.color.toLowerCase()));
      const nextColor = isNoteExpression(src)
        ? src.color
        : (EXPRESSION_COLORS.find((c) => !usedColors.has(c.toLowerCase())) ??
          EXPRESSION_COLORS[(g.expressions.length + 1) % EXPRESSION_COLORS.length]);
      const copyId = `expr-${Date.now()}-${g.expressions.length}`;
      const cloned: ExpressionItem = {
        ...src,
        id: copyId,
        color: nextColor,
        fitLoss: false,
        collapsed: false,
      };
      const nextExprs = [
        ...g.expressions.slice(0, idx + 1),
        cloned,
        ...g.expressions.slice(idx + 1),
      ];
      commitGraph({ ...g, expressions: ensureFitTarget(nextExprs) }, true);
      return copyId;
    },

    removeExpression(id) {
      const g = get().graph;
      const filtered = g.expressions.filter((e) => e.id !== id);
      commitGraph({ ...g, expressions: ensureFitTarget(filtered) }, true);
    },

    clearAllExpressions() {
      const g = get().graph;
      commitGraph({ ...g, expressions: [], sliders: {} }, true);
    },

    toggleExpressionProp(id, prop) {
      if (prop === 'fitLoss') {
        get().setExpressionFitLoss(id);
        return;
      }
      const g = get().graph;
      const expressions = g.expressions.map((e) =>
        e.id === id ? { ...e, [prop]: !e[prop] } : e
      );
      commitGraph({ ...g, expressions }, true, prop === 'collapsed');
    },

    setExpressionFitLoss(id) {
      const g = get().graph;
      const target = g.expressions.find((e) => e.id === id);
      if (!target || isNoteExpression(target)) return;
      const expressions = g.expressions.map((e) => ({
        ...e,
        fitLoss: e.id === id,
      }));
      commitGraph({ ...g, expressions }, true, true);
    },

    toggleAllExpressionsVisible() {
      const g = get().graph;
      const anyVisible = g.expressions.some((e) => e.visible);
      const nextVisible = !anyVisible;
      const expressions = g.expressions.map((e) => ({
        ...e,
        visible: nextVisible,
      }));
      commitGraph({ ...g, expressions }, true, true);
    },

    setSurfaceParamAxes(w1Key, w2Key) {
      const g = get().graph;
      const nextW1 = w1Key.trim() || undefined;
      const nextW2 =
        w2Key.trim() && w2Key.trim() !== nextW1 ? w2Key.trim() : undefined;
      const { w1Key: rW1, w2Key: rW2, w1, w2 } = resolveSurfaceParamPair(
        g.sliders,
        nextW1,
        nextW2
      );
      const s1 = g.sliders[rW1];
      const s2 = g.sliders[rW2];
      let rightViewport = g.rightViewport;
      if (
        s1 &&
        (w1 < rightViewport.xMin ||
          w1 > rightViewport.xMax ||
          s1.max < rightViewport.xMin ||
          s1.min > rightViewport.xMax)
      ) {
        rightViewport = {
          ...rightViewport,
          xMin: Math.min(s1.min, w1),
          xMax: Math.max(s1.max, w1, Math.min(s1.min, w1) + 0.5),
        };
      }
      if (
        s2 &&
        (w2 < rightViewport.yMin ||
          w2 > rightViewport.yMax ||
          s2.max < rightViewport.yMin ||
          s2.min > rightViewport.yMax)
      ) {
        rightViewport = {
          ...rightViewport,
          yMin: Math.min(s2.min, w2),
          yMax: Math.max(s2.max, w2, Math.min(s2.min, w2) + 0.5),
        };
      }
      commitGraph(
        {
          ...g,
          surfaceParamW1: nextW1,
          surfaceParamW2: nextW2,
          rightViewport,
        },
        true,
        true
      );
    },

    setFunctionLibraryDrawerOpen(functionLibraryDrawerOpen, focusFunctionName = null) {
      set({
        functionLibraryDrawerOpen,
        functionLibraryFocusName: functionLibraryDrawerOpen ? focusFunctionName : null,
      });
    },

    toggleLibraryFunction(id, enabled) {
      const g = get().graph;
      const currentLib =
        g.functionLibrary ?? DEFAULT_FUNCTION_LIBRARY.map((f) => ({ ...f }));
      const nextLib = currentLib.map((entry) =>
        entry.id === id
          ? { ...entry, enabled: enabled !== undefined ? enabled : !entry.enabled }
          : entry
      );
      commitGraph({ ...g, functionLibrary: nextLib }, true);
    },

    toggleAllLibraryFunctions(enabled) {
      const g = get().graph;
      const currentLib =
        g.functionLibrary ?? DEFAULT_FUNCTION_LIBRARY.map((f) => ({ ...f }));
      const nextLib = currentLib.map((entry) => ({ ...entry, enabled }));
      commitGraph({ ...g, functionLibrary: nextLib }, true);
    },

    upsertLibraryFunction(entry) {
      const g = get().graph;
      const currentLib =
        g.functionLibrary ?? DEFAULT_FUNCTION_LIBRARY.map((f) => ({ ...f }));
      const id = entry.id ?? `fn-custom-${Date.now()}`;
      const existingIdx = currentLib.findIndex(
        (item) => item.id === id || item.name === entry.name
      );
      const prevEntry = existingIdx >= 0 ? currentLib[existingIdx] : undefined;
      let nextLib: LibraryFunctionEntry[];
      if (existingIdx >= 0) {
        nextLib = currentLib.map((item, idx) =>
          idx === existingIdx ? { ...item, ...entry, id: item.id } : item
        );
      } else {
        nextLib = [...currentLib, { ...entry, id }];
      }

      // Propagate explicitly edited parameter setups from Function Library to active sliders
      // ONLY when `entry` is actually invoked by an active canvas expression (not shadowed)
      // AND ONLY for parameter keys whose configuration actually changed (`cfgChanged`).
      let nextSliders = g.sliders;
      let nextSymbolOverrides = g.symbolOverrides;
      if (entry.paramConfigs) {
        const plottable = getPlottableExpressions(g.expressions);
        const nextUserFunctions = buildUserFunctionRegistry(plottable, nextLib);
        const targetId = prevEntry?.id ?? id;
        const targetNameLower = entry.name.toLowerCase();
        const resolvedDef = Object.values(nextUserFunctions).find(
          (fn) => fn.signature.name.toLowerCase() === targetNameLower
        );
        const isUnshadowedLibEntry = resolvedDef?.sourceExprId === targetId;
        const isCalledOnCanvas =
          isUnshadowedLibEntry &&
          plottable.some((expr) => {
            const trimmed = expr.latex.trim();
            if (!trimmed) return false;
            const cls = classifyLatexExpression(
              trimmed,
              g.symbolOverrides,
              nextUserFunctions
            );
            return (
              cls.valid &&
              Boolean(
                cls.calledFunctions?.some((fn) => fn.toLowerCase() === targetNameLower)
              )
            );
          });

        if (isCalledOnCanvas) {
          const builtinEntry = DEFAULT_FUNCTION_LIBRARY.find(
            (b) => b.id === targetId || b.name.toLowerCase() === targetNameLower
          );
          nextSliders = { ...g.sliders };
          for (const [pKey, pCfg] of Object.entries(entry.paramConfigs)) {
            const prevCfg =
              prevEntry?.paramConfigs?.[pKey] ?? builtinEntry?.paramConfigs?.[pKey];
            const cfgChanged =
              !prevCfg ||
              prevCfg.role !== pCfg.role ||
              (prevCfg.domainMode ?? 'free') !== (pCfg.domainMode ?? 'free') ||
              prevCfg.min !== pCfg.min ||
              prevCfg.max !== pCfg.max ||
              prevCfg.step !== pCfg.step ||
              prevCfg.defaultValue !== pCfg.defaultValue;
            if (!cfgChanged) continue;

            if (
              pCfg.role &&
              prevCfg?.role !== pCfg.role &&
              g.symbolOverrides[pKey] &&
              g.symbolOverrides[pKey] !== pCfg.role
            ) {
              nextSymbolOverrides = { ...nextSymbolOverrides };
              delete nextSymbolOverrides[pKey];
            }
            const sl = nextSliders[pKey];
            if (sl) {
              const domainMode: ParamDomainMode = pCfg.domainMode ?? 'free';
              let min =
                pCfg.min !== undefined && prevCfg?.min !== pCfg.min ? pCfg.min : sl.min;
              let max =
                pCfg.max !== undefined && prevCfg?.max !== pCfg.max ? pCfg.max : sl.max;
              const step = Math.max(
                1e-4,
                pCfg.step !== undefined && prevCfg?.step !== pCfg.step
                  ? pCfg.step
                  : sl.step
              );
              if (domainMode === 'positive' && min <= 0) {
                min = pCfg.min !== undefined && pCfg.min > 0 ? pCfg.min : 0.01;
              }
              if (domainMode === 'non_negative' && min < 0) {
                min = pCfg.min !== undefined && pCfg.min >= 0 ? pCfg.min : 0;
              }
              if (min > max) max = min + Math.max(step, 1);
              const rawVal =
                pCfg.defaultValue !== undefined &&
                prevCfg?.defaultValue !== pCfg.defaultValue
                  ? pCfg.defaultValue
                  : sl.value;
              const value = Math.min(Math.max(rawVal, min), max);
              nextSliders[pKey] = {
                ...sl,
                role:
                  pCfg.role && prevCfg?.role !== pCfg.role ? pCfg.role : sl.role,
                min,
                max,
                step,
                value,
                domainMode,
                domainSource: domainMode !== 'free' ? entry.name : undefined,
                domainUserSet: false,
              };
            }
          }
        }
      }

      commitGraph(
        {
          ...g,
          functionLibrary: nextLib,
          sliders: nextSliders,
          symbolOverrides: nextSymbolOverrides,
        },
        true
      );
    },

    removeLibraryFunction(id) {
      const g = get().graph;
      const currentLib =
        g.functionLibrary ?? DEFAULT_FUNCTION_LIBRARY.map((f) => ({ ...f }));
      const nextLib = currentLib.filter((item) => item.id !== id);
      commitGraph({ ...g, functionLibrary: nextLib }, true);
    },

    resetFunctionLibrary() {
      const g = get().graph;
      const resetSliders: Record<string, SliderState> = {};
      for (const [k, sl] of Object.entries(g.sliders)) {
        resetSliders[k] = { ...sl, domainUserSet: false };
      }
      commitGraph(
        {
          ...g,
          sliders: resetSliders,
          functionLibrary: DEFAULT_FUNCTION_LIBRARY.map((f) => ({
            ...f,
            ...(f.paramConfigs ? { paramConfigs: { ...f.paramConfigs } } : {}),
          })),
        },
        true
      );
    },

    setSymbolRole(symbolName, nextRole) {
      const g = get().graph;
      const current = classifySymbolRole(symbolName, g.symbolOverrides);
      if (current === nextRole) return;

      const symbolOverrides: Record<string, SymbolRole> = {
        ...g.symbolOverrides,
        [symbolName]: nextRole,
      };

      const plottable = getPlottableExpressions(g.expressions);
      const userFunctions = buildUserFunctionRegistry(plottable, g.functionLibrary);
      // Collect all symbols in active expressions to coordinate axis role swaps [FR-1.4]
      const allSyms = new Map<string, SymbolRole>();
      for (const expr of plottable) {
        const cls = classifyLatexExpression(
          expr.latex,
          g.symbolOverrides,
          userFunctions
        );
        for (const s of cls.symbols) {
          allSyms.set(s.name, s.role);
        }
      }

      if (nextRole === 'data_var') {
        // Demote any previous data_var (e.g. 'x') to 'param' so it gets a fixed slider
        for (const [name, role] of allSyms.entries()) {
          if (name !== symbolName && role === 'data_var') {
            symbolOverrides[name] = 'param';
          }
        }
      } else if (current === 'data_var') {
        // Ensure at least one symbol acts as horizontal axis ('data_var'), preferring 'x' first
        const hasOtherDataVar = Array.from(allSyms.entries()).some(
          ([name, role]) => name !== symbolName && (symbolOverrides[name] ?? role) === 'data_var'
        );
        if (!hasOtherDataVar) {
          if (symbolName !== 'x' && allSyms.has('x')) {
            symbolOverrides['x'] = 'data_var';
          } else {
            const candidateParam = Array.from(allSyms.entries()).find(
              ([name, role]) => name !== symbolName && (symbolOverrides[name] ?? role) === 'param'
            );
            if (candidateParam) {
              symbolOverrides[candidateParam[0]] = 'data_var';
            }
          }
        }
      }

      const viewMode: ViewMode =
        g.viewMode === 'optimization' && nextRole === 'data_var'
          ? 'dual'
          : g.viewMode;
      commitGraph({ ...g, symbolOverrides, viewMode }, true);
    },

    cycleSymbolRole(symbolName) {
      const g = get().graph;
      const current = classifySymbolRole(symbolName, g.symbolOverrides);
      const order: SymbolRole[] = ['param', 'data_var', 'hyperparam'];
      const nextRole = order[(order.indexOf(current) + 1) % order.length];
      get().setSymbolRole(symbolName, nextRole);
    },

    setSliderValue(name, value, commitUndo = false) {
      const g = get().graph;
      const existing = g.sliders[name];
      if (!existing || !Number.isFinite(value)) return;
      const clamped = Math.min(Math.max(value, existing.min), existing.max);
      const sliders = {
        ...g.sliders,
        [name]: { ...existing, value: clamped },
      };
      const { w1Key, w2Key } = resolveSurfaceParamPair(
        sliders,
        g.surfaceParamW1,
        g.surfaceParamW2
      );
      let rightViewport = g.rightViewport;
      if (name === w1Key && (clamped < rightViewport.xMin || clamped > rightViewport.xMax)) {
        rightViewport = {
          ...rightViewport,
          xMin: Math.min(rightViewport.xMin, existing.min, clamped),
          xMax: Math.max(rightViewport.xMax, existing.max, clamped),
        };
      }
      if (name === w2Key && (clamped < rightViewport.yMin || clamped > rightViewport.yMax)) {
        rightViewport = {
          ...rightViewport,
          yMin: Math.min(rightViewport.yMin, existing.min, clamped),
          yMax: Math.max(rightViewport.yMax, existing.max, clamped),
        };
      }
      const optimizerRace = g.optimizerRace.playing
        ? { ...g.optimizerRace, playing: false }
        : g.optimizerRace;
      commitGraph({ ...g, sliders, rightViewport, optimizerRace }, commitUndo, true);
    },

    updateSliderBounds(name, bounds) {
      const g = get().graph;
      const existing = g.sliders[name];
      if (!existing) return;

      const nextDomainMode: ParamDomainMode =
        bounds.domainMode !== undefined
          ? bounds.domainMode
          : getSliderDomainMode(existing);
      const nextDomainUserSet =
        bounds.domainMode !== undefined
          ? (bounds.domainUserSet ?? true)
          : existing.domainUserSet;
      const nextDomainSource =
        bounds.domainMode !== undefined
          ? (bounds.domainSource ??
            (bounds.domainMode === 'free' ? undefined : existing.domainSource ?? 'user'))
          : existing.domainSource;

      let nextMin =
        bounds.min !== undefined && Number.isFinite(bounds.min)
          ? bounds.min
          : existing.min;
      let nextMax =
        bounds.max !== undefined && Number.isFinite(bounds.max)
          ? bounds.max
          : existing.max;
      const nextStep =
        bounds.step !== undefined && Number.isFinite(bounds.step)
          ? Math.max(1e-4, bounds.step)
          : existing.step;

      const isPositive = nextDomainMode === 'positive';
      const isNonNeg = nextDomainMode === 'non_negative';
      const posFloor =
        existing.min > 0 && existing.min < 0.01 ? existing.min : 0.01;
      if (isPositive && nextMin <= 0) {
        nextMin = posFloor;
      } else if (isNonNeg && nextMin < 0) {
        nextMin = 0;
      }

      if (nextMin > nextMax) {
        if (bounds.min !== undefined && bounds.max === undefined) {
          nextMax = nextMin + Math.max(nextStep, 1);
        } else {
          nextMin = nextMax - Math.max(nextStep, 1);
          if (isPositive && nextMin <= 0) {
            nextMin = posFloor;
            nextMax = Math.max(nextMax, nextMin + Math.max(nextStep, 1));
          } else if (isNonNeg && nextMin < 0) {
            nextMin = 0;
            nextMax = Math.max(nextMax, nextMin + Math.max(nextStep, 1));
          }
        }
      }

      const nextLoopMode = bounds.loopMode ?? existing.loopMode;
      let nextDir: 1 | -1 = bounds.direction ?? existing.direction;
      if (bounds.loopMode === 'wrap_reverse' && bounds.direction === undefined) {
        nextDir = -1;
      } else if (
        bounds.loopMode === 'wrap' &&
        existing.loopMode === 'wrap_reverse' &&
        bounds.direction === undefined
      ) {
        nextDir = 1;
      }

      let nextValue =
        bounds.value !== undefined && Number.isFinite(bounds.value)
          ? bounds.value
          : existing.value;
      nextValue = Math.min(Math.max(nextValue, nextMin), nextMax);

      // Commercial Play button auto-rewind when starting from a target boundary
      if (bounds.playing === true && !existing.playing && bounds.value === undefined) {
        if (
          nextLoopMode === 'once' ||
          nextLoopMode === 'wrap' ||
          nextLoopMode === 'wrap_reverse'
        ) {
          if (nextDir === 1 && nextValue >= nextMax) {
            nextValue = nextMin;
          } else if (nextDir === -1 && nextValue <= nextMin) {
            nextValue = nextMax;
          }
        } else if (nextLoopMode === 'bounce') {
          if (nextValue >= nextMax) nextDir = -1;
          else if (nextValue <= nextMin) nextDir = 1;
        }
      }

      const sliders = {
        ...g.sliders,
        [name]: {
          ...existing,
          ...bounds,
          min: nextMin,
          max: nextMax,
          step: nextStep,
          value: nextValue,
          loopMode: nextLoopMode,
          direction: nextDir,
          domainMode: nextDomainMode,
          domainSource: nextDomainSource,
          domainUserSet: nextDomainUserSet,
        },
      };
      const boundsEdited =
        (bounds.min !== undefined || bounds.max !== undefined) &&
        bounds.value === undefined;
      const { w1Key, w2Key } = resolveSurfaceParamPair(
        sliders,
        g.surfaceParamW1,
        g.surfaceParamW2
      );
      let rightViewport = g.rightViewport;
      if (
        name === w1Key &&
        (boundsEdited || nextValue < rightViewport.xMin || nextValue > rightViewport.xMax)
      ) {
        const lo = boundsEdited
          ? Math.min(nextMin, nextValue)
          : Math.min(rightViewport.xMin, nextMin, nextValue);
        const hi = boundsEdited
          ? Math.max(nextMax, nextValue, lo + 0.5)
          : Math.max(rightViewport.xMax, nextMax, nextValue, lo + 0.5);
        rightViewport = { ...rightViewport, xMin: lo, xMax: hi };
      }
      if (
        name === w2Key &&
        (boundsEdited || nextValue < rightViewport.yMin || nextValue > rightViewport.yMax)
      ) {
        const lo = boundsEdited
          ? Math.min(nextMin, nextValue)
          : Math.min(rightViewport.yMin, nextMin, nextValue);
        const hi = boundsEdited
          ? Math.max(nextMax, nextValue, lo + 0.5)
          : Math.max(rightViewport.yMax, nextMax, nextValue, lo + 0.5);
        rightViewport = { ...rightViewport, yMin: lo, yMax: hi };
      }
      commitGraph(
        { ...g, sliders, rightViewport },
        bounds.domainMode !== undefined,
        true
      );
    },

    stepSliderByDelta(name, dir) {
      const g = get().graph;
      const existing = g.sliders[name];
      if (!existing) return;
      const step = Math.max(1e-4, existing.step || 0.05);
      const rawNext = existing.value + dir * step;
      const rounded = Math.round(rawNext * 1e6) / 1e6;
      const clamped = Math.min(Math.max(rounded, existing.min), existing.max);
      const sliders = {
        ...g.sliders,
        [name]: {
          ...existing,
          value: clamped,
          direction: dir,
          playing: false,
        },
      };
      const rightViewport = expandRightViewportForActiveParams(
        g.rightViewport,
        sliders,
        g.surfaceParamW1,
        g.surfaceParamW2
      );
      commitGraph({ ...g, sliders, rightViewport }, true, true);
    },

    reorderSliders(fromIndex, toIndex) {
      const g = get().graph;
      const keys = Object.keys(g.sliders);
      const len = keys.length;
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= len ||
        toIndex >= len
      ) {
        return;
      }

      const prevAxes = resolveSurfaceParamPair(
        g.sliders,
        g.surfaceParamW1,
        g.surfaceParamW2
      );

      const nextKeys = [...keys];
      const [movedKey] = nextKeys.splice(fromIndex, 1);
      nextKeys.splice(toIndex, 0, movedKey);

      const nextSliders: Record<string, SliderState> = {};
      for (const k of nextKeys) {
        nextSliders[k] = g.sliders[k];
      }

      // Preserve active 3D Loss Surface parameter axes when reordering sliders in the UI
      let surfaceParamW1 = g.surfaceParamW1;
      let surfaceParamW2 = g.surfaceParamW2;
      if (len >= 2) {
        const afterAxes = resolveSurfaceParamPair(
          nextSliders,
          surfaceParamW1,
          surfaceParamW2
        );
        if (
          (afterAxes.w1Key !== prevAxes.w1Key || afterAxes.w2Key !== prevAxes.w2Key) &&
          prevAxes.w1Key in nextSliders &&
          prevAxes.w2Key in nextSliders &&
          prevAxes.w1Key !== prevAxes.w2Key
        ) {
          surfaceParamW1 = prevAxes.w1Key;
          surfaceParamW2 = prevAxes.w2Key;
        }
      }

      commitGraph(
        {
          ...g,
          sliders: nextSliders,
          surfaceParamW1,
          surfaceParamW2,
        },
        true,
        true
      );
    },

    moveSlider(name, dir) {
      const keys = Object.keys(get().graph.sliders);
      const idx = keys.indexOf(name);
      if (idx < 0) return;
      const targetIdx = idx + dir;
      if (targetIdx < 0 || targetIdx >= keys.length) return;
      get().reorderSliders(idx, targetIdx);
    },

    toggleAllSlidersPlay() {
      const g = get().graph;
      const keys = Object.keys(g.sliders);
      if (keys.length === 0) return;
      const anyPlaying = keys.some((k) => g.sliders[k].playing);
      const nextPlaying = !anyPlaying;
      const nextSliders: Record<string, SliderState> = {};

      for (const k of keys) {
        const s = g.sliders[k];
        let val = s.value;
        let dir: 1 | -1 =
          s.loopMode === 'wrap_reverse'
            ? -1
            : s.direction === -1
              ? -1
              : 1;
        if (nextPlaying) {
          if (
            s.loopMode === 'once' ||
            s.loopMode === 'wrap' ||
            s.loopMode === 'wrap_reverse'
          ) {
            if (dir === 1 && val >= s.max) val = s.min;
            else if (dir === -1 && val <= s.min) val = s.max;
          } else if (s.loopMode === 'bounce') {
            if (val >= s.max) dir = -1;
            else if (val <= s.min) dir = 1;
          }
        }
        nextSliders[k] = { ...s, playing: nextPlaying, value: val, direction: dir };
      }

      commitGraph({ ...g, sliders: nextSliders }, false, true);
    },

    stepPlayingSliders(dtSec) {
      const g = get().graph;
      const clampedDt = Math.min(Math.max(dtSec, 0.001), 0.1);
      let anyUpdated = false;
      let anyStillPlaying = false;
      const nextSliders: Record<string, SliderState> = { ...g.sliders };

      for (const [key, s] of Object.entries(g.sliders)) {
        if (!s.playing) continue;
        const span = s.max - s.min;
        if (span <= 0) {
          nextSliders[key] = { ...s, playing: false };
          anyUpdated = true;
          continue;
        }
        const dir: 1 | -1 =
          s.loopMode === 'wrap_reverse'
            ? -1
            : s.direction === -1
              ? -1
              : 1;
        const delta = span * 0.25 * (s.speed || 1) * clampedDt * dir;
        let nextVal = s.value + delta;
        let nextDir: 1 | -1 = dir;
        let nextPlaying = true;

        if (nextVal >= s.max) {
          if (s.loopMode === 'bounce') {
            nextVal = s.max;
            nextDir = -1;
          } else if (s.loopMode === 'once') {
            nextVal = s.max;
            nextPlaying = false;
          } else {
            nextVal = s.min;
          }
        } else if (nextVal <= s.min) {
          if (s.loopMode === 'bounce') {
            nextVal = s.min;
            nextDir = 1;
          } else if (s.loopMode === 'once') {
            nextVal = s.min;
            nextPlaying = false;
          } else {
            nextVal = s.max;
          }
        }

        nextSliders[key] = {
          ...s,
          value: nextVal,
          direction: nextDir,
          playing: nextPlaying,
        };
        anyUpdated = true;
        if (nextPlaying) anyStillPlaying = true;
      }

      if (anyUpdated) {
        const rightViewport = expandRightViewportForActiveParams(
          g.rightViewport,
          nextSliders,
          g.surfaceParamW1,
          g.surfaceParamW2
        );
        commitGraph({ ...g, sliders: nextSliders, rightViewport }, false, true);
      }
      return anyStillPlaying;
    },

    addDataPoint(pt) {
      const g = get().graph;
      const newPt: DataPoint2D = {
        ...pt,
        id: `pt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      };
      commitGraph({ ...g, dataPoints: [...g.dataPoints, newPt] }, true);
    },

    updateDataPoint(id, x, y) {
      const g = get().graph;
      const dataPoints = g.dataPoints.map((p) =>
        p.id === id ? { ...p, x, y, x2: y } : p
      );
      commitGraph({ ...g, dataPoints }, false, true);
    },

    removeDataPoint(id) {
      const g = get().graph;
      commitGraph(
        { ...g, dataPoints: g.dataPoints.filter((p) => p.id !== id) },
        true
      );
    },

    setDataPoints(dataPoints) {
      commitGraph({ ...get().graph, dataPoints }, true);
    },

    setHoveredDataPoint(hoveredDataPointId) {
      set({ graph: { ...get().graph, hoveredDataPointId } });
    },

    setProbeX(probeX) {
      set({ graph: { ...get().graph, probeX } });
    },

    setLossKind(lossKind) {
      commitGraph({ ...get().graph, lossKind }, true);
    },

    setRegularization(regularizationKind, radius) {
      const g = get().graph;
      commitGraph(
        {
          ...g,
          regularizationKind,
          regularizationRadius: radius ?? g.regularizationRadius,
        },
        false,
        true
      );
    },

    setBatchNormEnabled(batchNormEnabled) {
      commitGraph({ ...get().graph, batchNormEnabled }, true);
    },

    setLeftViewport(leftViewport) {
      commitGraph({ ...get().graph, leftViewport }, false, true);
    },

    setRightViewport(rightViewport) {
      commitGraph({ ...get().graph, rightViewport }, false, true);
    },

    setOrbit3D(pitch, yaw, zScale) {
      const g = get().graph;
      set({
        graph: {
          ...g,
          surface3DOrbitPitch: Math.min(Math.max(pitch, 0.05), 1.45),
          surface3DOrbitYaw: yaw,
          surface3DZScale: zScale ?? g.surface3DZScale,
        },
      });
    },

    updateOptimizerRace(patch) {
      const { graph: g, trajectories } = get();
      const cur = g.optimizerRace;

      const nextSteps =
        patch.steps !== undefined && Number.isFinite(patch.steps)
          ? Math.min(Math.max(Math.round(patch.steps), 1), 1000)
          : cur.steps;

      let nextCurrentStep = cur.currentStep;
      if (patch.currentStep !== undefined && Number.isFinite(patch.currentStep)) {
        nextCurrentStep = Math.min(Math.max(Math.round(patch.currentStep), 0), nextSteps);
      } else if (patch.steps !== undefined) {
        if (!cur.playing && cur.currentStep >= cur.steps) {
          nextCurrentStep = nextSteps;
        } else {
          nextCurrentStep = Math.min(cur.currentStep, nextSteps);
        }
      }

      const nextLoopMode = patch.loopMode ?? cur.loopMode ?? 'once';
      let nextDirection: 1 | -1 = patch.direction ?? cur.direction ?? 1;

      if (patch.playing === true && patch.currentStep === undefined) {
        if (nextLoopMode === 'bounce') {
          if (nextCurrentStep >= nextSteps) nextDirection = -1;
          else if (nextCurrentStep <= 0) nextDirection = 1;
        } else {
          if (nextDirection === 1 && nextCurrentStep >= nextSteps) {
            nextCurrentStep = 0;
          } else if (nextDirection === -1 && nextCurrentStep <= 0) {
            nextCurrentStep = nextSteps;
          }
        }
      }

      const nextRace: GraphStateV2['optimizerRace'] = {
        ...cur,
        ...patch,
        steps: nextSteps,
        currentStep: nextCurrentStep,
        loopMode: nextLoopMode,
        direction: nextDirection,
      };

      let nextSliders = g.sliders;
      if (nextRace.playing) {
        const { w1Key, w2Key } = resolveSurfaceParamPair(
          nextSliders,
          g.surfaceParamW1,
          g.surfaceParamW2
        );
        if (nextSliders[w1Key]?.playing || nextSliders[w2Key]?.playing) {
          nextSliders = { ...nextSliders };
          if (nextSliders[w1Key]?.playing) {
            nextSliders[w1Key] = { ...nextSliders[w1Key], playing: false };
          }
          if (nextSliders[w2Key]?.playing) {
            nextSliders[w2Key] = { ...nextSliders[w2Key], playing: false };
          }
        }
      }

      const shouldSyncStepToSliders =
        (patch.currentStep !== undefined ||
          (patch.playing === true && nextCurrentStep !== cur.currentStep)) &&
        patch.startW1 === undefined &&
        patch.startW2 === undefined;

      if (shouldSyncStepToSliders) {
        nextSliders = syncSlidersToRaceStep(
          nextSliders,
          nextRace,
          trajectories,
          nextCurrentStep,
          g.surfaceParamW1,
          g.surfaceParamW2
        );
      }

      const rightViewport = shouldSyncStepToSliders
        ? expandRightViewportForActiveParams(
            g.rightViewport,
            nextSliders,
            g.surfaceParamW1,
            g.surfaceParamW2
          )
        : g.rightViewport;

      commitGraph(
        {
          ...g,
          sliders: nextSliders,
          rightViewport,
          optimizerRace: nextRace,
        },
        false,
        true
      );
    },

    stepOptimizerRace() {
      const { graph: g, trajectories } = get();
      const cur = g.optimizerRace;
      if (!cur.playing) return false;

      const loopMode = cur.loopMode ?? 'once';
      let dir: 1 | -1 = cur.direction === -1 ? -1 : 1;

      if (loopMode === 'once') {
        if ((dir === 1 && cur.currentStep >= cur.steps) || (dir === -1 && cur.currentStep <= 0)) {
          commitGraph(
            {
              ...g,
              optimizerRace: { ...cur, playing: false },
            },
            false,
            true
          );
          return false;
        }
      }

      let nextStep = cur.currentStep + dir;
      let nextPlaying = true;

      if (nextStep >= cur.steps) {
        if (loopMode === 'bounce') {
          nextStep = cur.steps;
          dir = -1;
        } else if (loopMode === 'loop') {
          if (cur.currentStep >= cur.steps) {
            nextStep = 0;
          } else {
            nextStep = cur.steps;
          }
        } else {
          nextStep = cur.steps;
          nextPlaying = false;
        }
      } else if (nextStep <= 0) {
        if (loopMode === 'bounce') {
          nextStep = 0;
          dir = 1;
        } else if (loopMode === 'loop') {
          if (cur.currentStep <= 0) {
            nextStep = cur.steps;
          } else {
            nextStep = 0;
          }
        } else {
          nextStep = 0;
          nextPlaying = false;
        }
      }

      const nextSliders = syncSlidersToRaceStep(
        g.sliders,
        cur,
        trajectories,
        nextStep,
        g.surfaceParamW1,
        g.surfaceParamW2
      );
      const rightViewport = expandRightViewportForActiveParams(
        g.rightViewport,
        nextSliders,
        g.surfaceParamW1,
        g.surfaceParamW2
      );

      commitGraph(
        {
          ...g,
          sliders: nextSliders,
          rightViewport,
          optimizerRace: {
            ...cur,
            currentStep: nextStep,
            direction: dir,
            playing: nextPlaying,
          },
        },
        false,
        true
      );
      return nextPlaying;
    },

    flipBayesianCoins(numFlips, trueProb = 0.65) {
      const g = get().graph;
      const kSlider = g.sliders['k'] ?? {
        name: 'k',
        latex: 'k',
        role: 'hyperparam' as const,
        value: 0,
        min: 0,
        max: 100,
        step: 1,
        playing: false,
        speed: 1 as const,
        loopMode: 'bounce' as const,
        direction: 1 as const,
      };
      const nSlider = g.sliders['n'] ?? {
        name: 'n',
        latex: 'n',
        role: 'hyperparam' as const,
        value: 0,
        min: 1,
        max: 100,
        step: 1,
        playing: false,
        speed: 1 as const,
        loopMode: 'bounce' as const,
        direction: 1 as const,
      };
      let heads = 0;
      for (let i = 0; i < numFlips; i++) {
        if (Math.random() < trueProb) heads++;
      }
      const nextN = Math.min(nSlider.max, nSlider.value + numFlips);
      const nextK = Math.min(nextN, kSlider.value + heads);
      commitGraph(
        {
          ...g,
          sliders: {
            ...g.sliders,
            k: { ...kSlider, value: nextK },
            n: { ...nSlider, value: nextN },
          },
        },
        true,
        true
      );
    },

    undo() {
      const prev = get();
      if (prev.undoStack.length === 0) return;
      const previous = prev.undoStack[prev.undoStack.length - 1];
      const orderMap = new Map(previous.expressions.map((e, idx) => [e.id, idx]));
      const curves = [...prev.curves].sort(
        (a, b) => (orderMap.get(a.exprId) ?? 9999) - (orderMap.get(b.exprId) ?? 9999)
      );
      const cloudMeta = prev.cloudMeta ? { ...prev.cloudMeta, isDirty: true } : null;
      set({
        graph: previous,
        curves,
        cloudMeta,
        undoStack: prev.undoStack.slice(0, -1),
        redoStack: [prev.graph, ...prev.redoStack].slice(0, MAX_UNDO_STEPS),
      });
      scheduleAutoSave(previous, 500);
      scheduleStatelessUrlUpdate(
        prev.sessionMode,
        () => encodeStateToUrlHashSync(previous),
        300
      );
    },

    redo() {
      const prev = get();
      if (prev.redoStack.length === 0) return;
      const next = prev.redoStack[0];
      const orderMap = new Map(next.expressions.map((e, idx) => [e.id, idx]));
      const curves = [...prev.curves].sort(
        (a, b) => (orderMap.get(a.exprId) ?? 9999) - (orderMap.get(b.exprId) ?? 9999)
      );
      const cloudMeta = prev.cloudMeta ? { ...prev.cloudMeta, isDirty: true } : null;
      set({
        graph: next,
        curves,
        cloudMeta,
        undoStack: [...prev.undoStack, prev.graph].slice(-MAX_UNDO_STEPS),
        redoStack: prev.redoStack.slice(1),
      });
      scheduleAutoSave(next, 500);
      scheduleStatelessUrlUpdate(
        prev.sessionMode,
        () => encodeStateToUrlHashSync(next),
        300
      );
    },

    setSessionMode(sessionMode, cloudMeta = null) {
      set({ sessionMode, cloudMeta });
    },

    setShareModalOpen(shareModalOpen) {
      set({ shareModalOpen });
    },

    setGalleryDrawerOpen(galleryDrawerOpen, initialTab) {
      set({
        galleryDrawerOpen,
        ...(initialTab ? { galleryInitialTab: initialTab } : {}),
      });
    },

    setCustomOptModalOpen(customOptModalOpen) {
      set({ customOptModalOpen });
    },

    setBrushActive(brushActive) {
      set({
        brushActive,
        whiteboardTool: brushActive ? 'cursor' : get().whiteboardTool,
      });
    },

    setWhiteboardTool(whiteboardTool) {
      set({
        whiteboardTool,
        brushActive: whiteboardTool !== 'cursor' ? false : get().brushActive,
      });
    },

    setWhiteboardColor(whiteboardColor) {
      set({ whiteboardColor });
    },

    addWhiteboardStroke(stroke) {
      const prev = get();
      set({
        whiteboardUndoStack: [
          ...prev.whiteboardUndoStack.slice(-(MAX_UNDO_STEPS - 1)),
          prev.whiteboardStrokes,
        ],
        whiteboardRedoStack: [],
        whiteboardStrokes: [...prev.whiteboardStrokes, stroke],
      });
    },

    eraseWhiteboardAt(wx, wy, radiusWorld, recordUndo = true) {
      const rSq = radiusWorld * radiusWorld;
      const distToSegmentSq = (
        px: number,
        py: number,
        x1: number,
        y1: number,
        x2: number,
        y2: number
      ): number => {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq < 1e-12) {
          return (px - x1) * (px - x1) + (py - y1) * (py - y1);
        }
        const t = Math.min(Math.max(((px - x1) * dx + (py - y1) * dy) / lenSq, 0.0), 1.0);
        const projX = x1 + t * dx;
        const projY = y1 + t * dy;
        return (px - projX) * (px - projX) + (py - projY) * (py - projY);
      };

      const prev = get();
      const filtered = prev.whiteboardStrokes.filter((stroke) => {
        const pts = stroke.points;
        if (pts.length === 0) return false;
        if (pts.length === 1) {
          const dx = pts[0].x - wx;
          const dy = pts[0].y - wy;
          return dx * dx + dy * dy > rSq;
        }
        for (let i = 0; i + 1 < pts.length; i++) {
          if (distToSegmentSq(wx, wy, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) <= rSq) {
            return false;
          }
        }
        return true;
      });
      if (filtered.length !== prev.whiteboardStrokes.length) {
        set({
          whiteboardStrokes: filtered,
          ...(recordUndo
            ? {
                whiteboardUndoStack: [
                  ...prev.whiteboardUndoStack.slice(-(MAX_UNDO_STEPS - 1)),
                  prev.whiteboardStrokes,
                ],
                whiteboardRedoStack: [],
              }
            : {}),
        });
        return true;
      }
      return false;
    },

    clearWhiteboard() {
      const prev = get();
      if (prev.whiteboardStrokes.length === 0) return;
      set({
        whiteboardUndoStack: [
          ...prev.whiteboardUndoStack.slice(-(MAX_UNDO_STEPS - 1)),
          prev.whiteboardStrokes,
        ],
        whiteboardRedoStack: [],
        whiteboardStrokes: [],
      });
    },

    undoWhiteboard() {
      const prev = get();
      if (prev.whiteboardUndoStack.length === 0) return;
      const restored = prev.whiteboardUndoStack[prev.whiteboardUndoStack.length - 1];
      set({
        whiteboardStrokes: restored,
        whiteboardUndoStack: prev.whiteboardUndoStack.slice(0, -1),
        whiteboardRedoStack: [prev.whiteboardStrokes, ...prev.whiteboardRedoStack].slice(
          0,
          MAX_UNDO_STEPS
        ),
      });
    },

    redoWhiteboard() {
      const prev = get();
      if (prev.whiteboardRedoStack.length === 0) return;
      const next = prev.whiteboardRedoStack[0];
      set({
        whiteboardStrokes: next,
        whiteboardUndoStack: [...prev.whiteboardUndoStack, prev.whiteboardStrokes].slice(
          -MAX_UNDO_STEPS
        ),
        whiteboardRedoStack: prev.whiteboardRedoStack.slice(1),
      });
    },

    applyWorkerResult(res) {
      const prevCustomTraj = get().trajectories.custom_js;
      const incomingCustomTraj = res.trajectories.custom_js;
      const trajectories =
        incomingCustomTraj && incomingCustomTraj.length > 0
          ? res.trajectories
          : prevCustomTraj && prevCustomTraj.length > 0 && get().graph.optimizerRace.enabledOptimizers.custom_js
            ? { ...res.trajectories, custom_js: prevCustomTraj }
            : res.trajectories;

      set({
        curves: res.curves,
        trainLoss: res.trainLoss,
        testLoss: res.testLoss,
        lossGrid: res.lossGrid,
        minLoss: res.minLoss,
        maxLoss: res.maxLoss,
        vectorField: res.vectorField,
        trajectories,
        linkedBrushPull: res.linkedBrushPull,
        computeDurationMs: res.computeDurationMs,
      });
    },
  };
});
