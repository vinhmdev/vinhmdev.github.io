/**
 * Zustand Reactive State Store with 50-Step Undo/Redo & AST Auto-Slider Sync [FR-1.3, FR-1.4].
 */
import { createStore } from 'zustand/vanilla';
import type {
  LibraryFunctionEntry,
  SubgradConvention,
  SymbolRole,
} from '../types/math';
import type {
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
  extractLeadingFunctionLabel,
} from '../core/parser/cortex-setup';
import { resolveSurfaceParamPair } from '../core/simulation/loss-evaluator';
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
  let hasInvalidNonEmptyExpr = false;
  const plottable = getPlottableExpressions(state.expressions);

  const userFunctions = buildUserFunctionRegistry(plottable, state.functionLibrary);

  for (const expr of plottable) {
    const trimmed = expr.latex.trim();
    if (!trimmed) continue;
    const classified = classifyLatexExpression(
      trimmed,
      state.symbolOverrides,
      userFunctions
    );
    if (!classified.valid) {
      hasInvalidNonEmptyExpr = true;
      continue;
    }

    for (const sym of classified.symbols) {
      if (sym.role === 'param' || sym.role === 'hyperparam') {
        activeSymbols.add(sym.name);
        if (!nextSliders[sym.name]) {
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
          };
        } else {
          nextSliders[sym.name] = {
            ...nextSliders[sym.name],
            role: sym.role,
            latex: sym.latex || nextSliders[sym.name].latex || sym.name,
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

  return {
    ...state,
    sliders: nextSliders,
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
  shareModalOpen: boolean;
  galleryDrawerOpen: boolean;
  galleryInitialTab: 'examples' | 'my_docs' | 'community';
  customOptModalOpen: boolean;
  functionLibraryDrawerOpen: boolean;
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
  addExpression: (customLatex?: string, customLabel?: string) => void;
  /**
   * Inserts several rows in a single commit (one undo step). When `replaceId` names an existing row,
   * the first item overwrites that row in place and the rest are inserted right after it.
   */
  addExpressionsBatch: (items: ExpressionBatchItem[], replaceId?: string) => void;
  setExpressionKind: (id: string, kind: ExpressionKind) => void;
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
  setFunctionLibraryDrawerOpen: (open: boolean) => void;
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
  eraseWhiteboardAt: (wx: number, wy: number, radiusWorld: number) => void;
  clearWhiteboard: () => void;
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

const EXPRESSION_COLORS = ['#f97316', '#3b82f6', '#10b981', '#a855f7', '#ec4899'];

export function isStrictlyPositiveParam(slider: SliderState): boolean {
  return (
    slider.min > 0 ||
    slider.name === 'sigma' ||
    slider.name === 'd_k' ||
    slider.name === 'd_v' ||
    slider.name === 'd_model' ||
    slider.name === 'tau' ||
    slider.name === 'epsilon' ||
    slider.name === 'delta' ||
    slider.name === 'gamma'
  );
}

function applySyncedSliderVal(
  slider: SliderState,
  rawVal: number
): SliderState {
  const isStrictlyPositive = isStrictlyPositiveParam(slider);
  const floorLimit = slider.min > 0 ? slider.min : 0.01;
  const guardedVal = isStrictlyPositive ? Math.max(floorLimit, rawVal) : rawVal;
  const val = Math.round(guardedVal * 1e6) / 1e6;
  const nextMin = isStrictlyPositive
    ? Math.max(floorLimit, Math.min(slider.min, Math.floor(val * 10) / 10))
    : Math.min(slider.min, Math.floor(val * 10) / 10);
  return {
    ...slider,
    min: nextMin,
    max: Math.max(slider.max, Math.ceil(val * 10) / 10),
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
  const leadOpt = priorityOrder.find(
    (id) => race.enabledOptimizers[id] && trajectories[id] && trajectories[id].length > 0
  );
  if (!leadOpt) return sliders;

  const traj = trajectories[leadOpt];
  const pt = traj[Math.min(Math.max(0, step), traj.length - 1)];
  if (!pt || !Number.isFinite(pt.w1) || !Number.isFinite(pt.w2)) return sliders;

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
    shareModalOpen: false,
    galleryDrawerOpen: false,
    galleryInitialTab: 'examples',
    customOptModalOpen: false,
    functionLibraryDrawerOpen: false,
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
      commitGraph(
        {
          ...g,
          surfaceParamW1: nextW1,
          surfaceParamW2: nextW2,
        },
        true,
        true
      );
    },

    setFunctionLibraryDrawerOpen(functionLibraryDrawerOpen) {
      set({ functionLibraryDrawerOpen });
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
      let nextLib: LibraryFunctionEntry[];
      if (existingIdx >= 0) {
        nextLib = currentLib.map((item, idx) =>
          idx === existingIdx ? { ...item, ...entry, id: item.id } : item
        );
      } else {
        nextLib = [...currentLib, { ...entry, id }];
      }
      commitGraph({ ...g, functionLibrary: nextLib }, true);
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
      commitGraph(
        {
          ...g,
          functionLibrary: DEFAULT_FUNCTION_LIBRARY.map((f) => ({ ...f })),
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
      const optimizerRace = g.optimizerRace.playing
        ? { ...g.optimizerRace, playing: false }
        : g.optimizerRace;
      commitGraph({ ...g, sliders, optimizerRace }, commitUndo, true);
    },

    updateSliderBounds(name, bounds) {
      const g = get().graph;
      const existing = g.sliders[name];
      if (!existing) return;

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

      const isPositive = isStrictlyPositiveParam(existing);
      if (isPositive && nextMin <= 0) {
        nextMin = existing.min > 0 ? existing.min : 0.01;
      }

      if (nextMin > nextMax) {
        if (bounds.min !== undefined && bounds.max === undefined) {
          nextMax = nextMin + Math.max(nextStep, 1);
        } else {
          nextMin = nextMax - Math.max(nextStep, 1);
          if (isPositive && nextMin <= 0) {
            nextMin = 0.01;
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
        },
      };
      commitGraph({ ...g, sliders }, false, true);
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
      commitGraph({ ...g, sliders }, true, true);
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
        commitGraph({ ...g, sliders: nextSliders }, false, true);
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

      commitGraph(
        {
          ...g,
          sliders: nextSliders,
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

      commitGraph(
        {
          ...g,
          sliders: nextSliders,
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
      const { undoStack, redoStack, graph } = get();
      if (undoStack.length === 0) return;
      const previous = undoStack[undoStack.length - 1];
      set({
        graph: previous,
        workspaceMode: 'ml',
        undoStack: undoStack.slice(0, -1),
        redoStack: [graph, ...redoStack].slice(0, MAX_UNDO_STEPS),
      });
    },

    redo() {
      const { undoStack, redoStack, graph } = get();
      if (redoStack.length === 0) return;
      const next = redoStack[0];
      set({
        graph: next,
        workspaceMode: 'ml',
        undoStack: [...undoStack, graph].slice(-MAX_UNDO_STEPS),
        redoStack: redoStack.slice(1),
      });
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
      set({ whiteboardStrokes: [...get().whiteboardStrokes, stroke] });
    },

    eraseWhiteboardAt(wx, wy, radiusWorld) {
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

      const filtered = get().whiteboardStrokes.filter((stroke) => {
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
      if (filtered.length !== get().whiteboardStrokes.length) {
        set({ whiteboardStrokes: filtered });
      }
    },

    clearWhiteboard() {
      set({ whiteboardStrokes: [] });
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
