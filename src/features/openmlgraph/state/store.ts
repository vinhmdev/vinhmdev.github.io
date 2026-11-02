/**
 * Zustand Reactive State Store with 50-Step Undo/Redo & AST Auto-Slider Sync [FR-1.3, FR-1.4].
 */
import { createStore } from 'zustand/vanilla';
import type { SymbolRole, SubgradConvention } from '../types/math';
import type {
  CurveRenderPacket,
  DataPoint2D,
  ExpressionItem,
  GraphStateV2,
  HashSessionMode,
  LossKind,
  MobileTabMode,
  OptimizerId,
  OptimizerTrajectoryStep,
  RegularizationKind,
  SliderState,
  ViewMode,
  Viewport2DBounds,
  WhiteboardStroke,
  WhiteboardTool,
  WorkspaceMode,
} from '../types/state';
import {
  classifyLatexExpression,
  classifySymbolRole,
} from '../core/parser/ast-classifier';
import { resolveSurfaceParamPair } from '../core/simulation/loss-evaluator';
import { getTemplateById, isMathTemplateId } from '../extensions/templates';
import { scheduleAutoSave } from './local-persistence';
import { scheduleStatelessUrlUpdate } from './hash-router';
import { encodeStateToUrlHashSync } from './url-codec';

const MAX_UNDO_STEPS = 50;

export function createInitialGraphState(templateId = 'T-00'): GraphStateV2 {
  const tpl = getTemplateById(templateId);
  const partial = tpl.buildInitialState();

  const base: GraphStateV2 = {
    v: 2,
    activeTemplateId: tpl.id,
    title: partial.title ?? 'OpenMathGraph Session',
    viewMode: partial.viewMode ?? 'dual',
    rightViewportMode: partial.rightViewportMode ?? 'loss_surface',
    subgradConvention: partial.subgradConvention ?? 'zero',
    expressions: partial.expressions ?? [
      {
        id: 'expr-1',
        latex: tpl.defaultLatex,
        color: '#f97316',
        visible: true,
        showFirstDerivative: true,
        showSecondDerivative: false,
      },
    ],
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
    surface3DOrbitPitch: partial.surface3DOrbitPitch ?? 0.55,
    surface3DOrbitYaw: partial.surface3DOrbitYaw ?? -0.65,
    surface3DZScale: partial.surface3DZScale ?? 0.0,
    leftViewport: partial.leftViewport ?? { xMin: -5, xMax: 5, yMin: -3.5, yMax: 3.5 },
    rightViewport: partial.rightViewport ?? { xMin: -4, xMax: 4, yMin: -4, yMax: 4 },
    optimizerRace: partial.optimizerRace ?? {
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
    },
    probeX: partial.probeX ?? null,
    hoveredDataPointId: null,
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

  for (const expr of state.expressions) {
    const trimmed = expr.latex.trim();
    if (!trimmed) continue;
    const classified = classifyLatexExpression(trimmed, state.symbolOverrides);
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
          };
        }
      } else if (sym.role === 'data_var') {
        delete nextSliders[sym.name];
      }
    }
  }

  // In General Math / Blank Graph mode (T-00, M-*), prune unused sliders when expressions change or are cleared
  if (isMathTemplateId(state.activeTemplateId) && !hasInvalidNonEmptyExpr) {
    for (const key of Object.keys(nextSliders)) {
      if (!activeSymbols.has(key)) {
        delete nextSliders[key];
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
  customOptModalOpen: boolean;
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
  setMobileTab: (tab: MobileTabMode) => void;
  setSubgradConvention: (conv: SubgradConvention) => void;
  updateExpressionLatex: (id: string, latex: string) => void;
  addExpression: (customLatex?: string) => void;
  removeExpression: (id: string) => void;
  toggleExpressionProp: (
    id: string,
    prop: 'visible' | 'showFirstDerivative' | 'showSecondDerivative'
  ) => void;
  setSymbolRole: (symbolName: string, nextRole: SymbolRole) => void;
  cycleSymbolRole: (symbolName: string) => void;
  setSliderValue: (name: string, value: number, commitUndo?: boolean) => void;
  updateSliderBounds: (name: string, bounds: Partial<SliderState>) => void;
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
  setGalleryDrawerOpen: (open: boolean) => void;
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

export const graphStore = createStore<GraphStoreState>((set, get) => {
  function commitGraph(nextGraph: GraphStateV2, recordUndo = false): void {
    const prev = get();
    const synced = syncSlidersFromExpressions(nextGraph);
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
    workspaceMode: 'math',
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
    customOptModalOpen: false,
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
      const inferredMode: WorkspaceMode =
        isMathTemplateId(next.activeTemplateId) && next.viewMode === 'inference'
          ? 'math'
          : 'ml';
      set({ workspaceMode: inferredMode });
      commitGraph(next, pushUndo);
    },

    selectTemplate(templateId) {
      const next = createInitialGraphState(templateId);
      const nextMode: WorkspaceMode = isMathTemplateId(templateId) ? 'math' : 'ml';
      set({
        workspaceMode: nextMode,
        whiteboardStrokes: [],
        whiteboardTool: 'cursor',
        brushActive: false,
      });
      commitGraph(next, true);
    },

    resetToBlankCanvas() {
      const next = createInitialGraphState('T-00');
      set({
        workspaceMode: 'math',
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
      if (viewMode !== 'inference' && get().workspaceMode === 'math') {
        set({ workspaceMode: 'ml' });
      }
      commitGraph({ ...get().graph, viewMode }, true);
    },

    setMobileTab(mobileTab) {
      set({ mobileTab });
    },

    setSubgradConvention(subgradConvention) {
      commitGraph({ ...get().graph, subgradConvention }, true);
    },

    updateExpressionLatex(id, latex) {
      const g = get().graph;
      const expressions = g.expressions.map((e) => (e.id === id ? { ...e, latex } : e));
      commitGraph({ ...g, expressions }, true);
    },

    addExpression(customLatex) {
      const g = get().graph;
      const idx = g.expressions.length;
      const defaultExpr =
        customLatex ?? (isMathTemplateId(g.activeTemplateId) ? '\\sin(x)' : 'w \\cdot x + b');
      const newExpr: ExpressionItem = {
        id: `expr-${Date.now()}-${idx}`,
        latex: defaultExpr,
        color: EXPRESSION_COLORS[idx % EXPRESSION_COLORS.length],
        visible: true,
        showFirstDerivative: false,
        showSecondDerivative: false,
      };
      commitGraph({ ...g, expressions: [...g.expressions, newExpr] }, true);
    },

    removeExpression(id) {
      const g = get().graph;
      if (g.expressions.length <= 1) {
        commitGraph(
          {
            ...g,
            expressions: g.expressions.map((e) => (e.id === id ? { ...e, latex: '' } : e)),
          },
          true
        );
        return;
      }
      commitGraph(
        { ...g, expressions: g.expressions.filter((e) => e.id !== id) },
        true
      );
    },

    toggleExpressionProp(id, prop) {
      const g = get().graph;
      const expressions = g.expressions.map((e) =>
        e.id === id ? { ...e, [prop]: !e[prop] } : e
      );
      commitGraph({ ...g, expressions }, true);
    },

    setSymbolRole(symbolName, nextRole) {
      const g = get().graph;
      const current = classifySymbolRole(symbolName, g.symbolOverrides);
      if (current === nextRole) return;

      const symbolOverrides: Record<string, SymbolRole> = {
        ...g.symbolOverrides,
        [symbolName]: nextRole,
      };

      // Collect all symbols in active expressions to coordinate axis role swaps [FR-1.4]
      const allSyms = new Map<string, SymbolRole>();
      for (const expr of g.expressions) {
        const cls = classifyLatexExpression(expr.latex, g.symbolOverrides);
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
        get().workspaceMode === 'math'
          ? 'inference'
          : g.viewMode === 'optimization' && nextRole === 'data_var'
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
      if (!existing) return;
      const clamped = Math.min(Math.max(value, existing.min), existing.max);
      const sliders = {
        ...g.sliders,
        [name]: { ...existing, value: clamped },
      };
      commitGraph({ ...g, sliders }, commitUndo);
    },

    updateSliderBounds(name, bounds) {
      const g = get().graph;
      const existing = g.sliders[name];
      if (!existing) return;
      const sliders = {
        ...g.sliders,
        [name]: { ...existing, ...bounds },
      };
      commitGraph({ ...g, sliders }, false);
    },

    stepPlayingSliders(dtSec) {
      const g = get().graph;
      const clampedDt = Math.min(Math.max(dtSec, 0.001), 0.1);
      let anyUpdated = false;
      const nextSliders: Record<string, SliderState> = { ...g.sliders };

      for (const [key, s] of Object.entries(g.sliders)) {
        if (!s.playing) continue;
        const span = s.max - s.min;
        if (span <= 0) continue;
        const dir: 1 | -1 = s.direction === -1 ? -1 : 1;
        const delta = span * 0.25 * (s.speed || 1) * clampedDt * dir;
        let nextVal = s.value + delta;
        let nextDir: 1 | -1 = dir;

        if (nextVal >= s.max) {
          if (s.loopMode === 'bounce') {
            nextVal = s.max;
            nextDir = -1;
          } else {
            nextVal = s.min;
          }
        } else if (nextVal <= s.min) {
          if (s.loopMode === 'bounce') {
            nextVal = s.min;
            nextDir = 1;
          } else {
            nextVal = s.max;
          }
        }

        nextSliders[key] = { ...s, value: nextVal, direction: nextDir };
        anyUpdated = true;
      }

      if (anyUpdated) {
        commitGraph({ ...g, sliders: nextSliders }, false);
      }
      return anyUpdated;
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
      commitGraph({ ...g, dataPoints }, false);
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
        false
      );
    },

    setBatchNormEnabled(batchNormEnabled) {
      commitGraph({ ...get().graph, batchNormEnabled }, true);
    },

    setLeftViewport(leftViewport) {
      commitGraph({ ...get().graph, leftViewport }, false);
    },

    setRightViewport(rightViewport) {
      commitGraph({ ...get().graph, rightViewport }, false);
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
      const g = get().graph;
      commitGraph(
        {
          ...g,
          optimizerRace: { ...g.optimizerRace, ...patch },
        },
        false
      );
    },

    stepOptimizerRace() {
      const { graph: g, trajectories } = get();
      const cur = g.optimizerRace;
      if (!cur.playing) return false;
      if (cur.currentStep >= cur.steps) {
        commitGraph(
          {
            ...g,
            optimizerRace: { ...cur, playing: false },
          },
          false
        );
        return false;
      }

      const nextStep = cur.currentStep + 1;
      const nextSliders: Record<string, SliderState> = { ...g.sliders };

      // Sync active model parameter pair (w/b, w_1/w_2, mu/sigma, a/b, etc.) to leading enabled trajectory
      const priorityOrder: OptimizerId[] = ['adam', 'momentum', 'rmsprop', 'sgd', 'custom_js'];
      const leadOpt = priorityOrder.find(
        (id) => cur.enabledOptimizers[id] && trajectories[id] && trajectories[id].length > 0
      );
      if (leadOpt) {
        const traj = trajectories[leadOpt];
        const pt = traj[Math.min(nextStep, traj.length - 1)];
        if (pt && Number.isFinite(pt.w1) && Number.isFinite(pt.w2)) {
          const { w1Key, w2Key } = resolveSurfaceParamPair(nextSliders);
          if (nextSliders[w1Key]) {
            nextSliders[w1Key] = {
              ...nextSliders[w1Key],
              value: Math.min(
                Math.max(pt.w1, nextSliders[w1Key].min),
                nextSliders[w1Key].max
              ),
            };
          }
          if (nextSliders[w2Key] && w2Key !== w1Key) {
            const rawW2 = w2Key === 'sigma' ? Math.max(0.1, pt.w2) : pt.w2;
            nextSliders[w2Key] = {
              ...nextSliders[w2Key],
              value: Math.min(
                Math.max(rawW2, nextSliders[w2Key].min),
                nextSliders[w2Key].max
              ),
            };
          }
        }
      }

      commitGraph(
        {
          ...g,
          sliders: nextSliders,
          optimizerRace: {
            ...cur,
            currentStep: nextStep,
            playing: nextStep < cur.steps,
          },
        },
        false
      );
      return nextStep < cur.steps;
    },

    flipBayesianCoins(numFlips, trueProb = 0.65) {
      const g = get().graph;
      const kSlider = g.sliders['k'];
      const nSlider = g.sliders['n'];
      if (!kSlider || !nSlider) return;
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
        true
      );
    },

    undo() {
      const { undoStack, redoStack, graph } = get();
      if (undoStack.length === 0) return;
      const previous = undoStack[undoStack.length - 1];
      const workspaceMode: WorkspaceMode =
        isMathTemplateId(previous.activeTemplateId) && previous.viewMode === 'inference'
          ? 'math'
          : 'ml';
      set({
        graph: previous,
        workspaceMode,
        undoStack: undoStack.slice(0, -1),
        redoStack: [graph, ...redoStack].slice(0, MAX_UNDO_STEPS),
      });
    },

    redo() {
      const { undoStack, redoStack, graph } = get();
      if (redoStack.length === 0) return;
      const next = redoStack[0];
      const workspaceMode: WorkspaceMode =
        isMathTemplateId(next.activeTemplateId) && next.viewMode === 'inference'
          ? 'math'
          : 'ml';
      set({
        graph: next,
        workspaceMode,
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

    setGalleryDrawerOpen(galleryDrawerOpen) {
      set({ galleryDrawerOpen });
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
      set({
        curves: res.curves,
        trainLoss: res.trainLoss,
        testLoss: res.testLoss,
        lossGrid: res.lossGrid,
        minLoss: res.minLoss,
        maxLoss: res.maxLoss,
        vectorField: res.vectorField,
        trajectories: res.trajectories,
        linkedBrushPull: res.linkedBrushPull,
        computeDurationMs: res.computeDurationMs,
      });
    },
  };
});
