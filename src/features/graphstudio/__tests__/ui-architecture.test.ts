/**
 * Multi-Platform UI Architecture Test Suite (Phases 1–3):
 * - Expression & Note drag/keyboard reordering, Z-order sync, fitLoss & Last-Row-Wins semantics
 * - Slider reordering, URL #v2.dr.* order persistence, and 3D Loss Surface axis preservation
 * - Undo/Redo workspaceMode preservation, URL/localStorage sync, and Whiteboard Undo/Redo
 * - 3-tier Mobile Bottom Sheet snap gesture resolver
 * - Sortable Tap-vs-Drag (6px), Edge Auto-Scroll, Portal Popover clamping, Mini Math Bar & i18n parity
 */
import { createRef, h } from 'preact';
import renderToString from 'preact-render-to-string';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enDict from '../i18n/en.json';
import viDict from '../i18n/vi.json';

vi.mock('../scripts/i18n-client', () => ({
  t: (key: string): string => (enDict as Record<string, string>)[key] ?? key,
}));

vi.mock('@shared/firebase/config', () => ({
  isFirebaseConfigured: false,
  db: null,
}));

vi.mock('@shared/firebase/app', () => ({
  getFirebaseApp: () => null,
}));

vi.mock('@shared/paste/crypto', () => ({
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  generateKey: vi.fn(),
  keyToString: vi.fn(() => 'k'),
  keyFromString: vi.fn(),
}));

vi.mock('@shared/paste/payload', () => ({
  encodePayload: vi.fn(),
  decodePayload: vi.fn(),
}));

vi.mock('@shared/paste/store', () => ({
  createPaste: vi.fn(),
  fetchPaste: vi.fn(),
  updatePaste: vi.fn(),
}));

vi.mock('@shared/paste-share/history', () => ({
  createDocStore: () => ({
    getDocs: () => [],
    saveDoc: () => {},
    removeDoc: () => {},
  }),
}));

import { resolveSurfaceParamPair } from '../core/simulation/loss-evaluator';
import {
  clearStateFromLocalStorage,
  loadStateFromLocalStorage,
  saveStateToLocalStorage,
  STORAGE_KEY_V2,
} from '../state/local-persistence';
import { createInitialGraphState, graphStore } from '../state/store';
import {
  decodeStateFromUrlHashSync,
  encodeStateToUrlHashSync,
} from '../state/url-codec';
import type { CurveRenderPacket, DataPoint2D } from '../types/state';
import { CompactSliderCard } from '../ui/CompactSliderCard';
import { CommunityGalleryDrawer } from '../ui/CommunityGalleryDrawer';
import { CustomOptimizerModal } from '../ui/CustomOptimizerModal';
import { DataTablePanel } from '../ui/DataTablePanel';
import { DualViewportPanel } from '../ui/DualViewportPanel';
import { ExpressionSidebar } from '../ui/ExpressionSidebar';
import { FloatingPopover, computePopoverPosition } from '../ui/FloatingPopover';
import { FunctionLibraryDrawer } from '../ui/FunctionLibraryDrawer';
import { MiniMathBar, insertLatexSnippet } from '../ui/MiniMathBar';
import { MobileSheetHandle } from '../ui/MobileSheetHandle';
import { SharePublishModal } from '../ui/SharePublishModal';
import { ToolbarSubheader } from '../ui/ToolbarSubheader';
import {
  resolveSheetSnapGesture,
  SHEET_LARGE_SWIPE_PX,
  SHEET_SWIPE_PX,
  SHEET_TAP_SLOP_PX,
} from '../ui/mobile-sheet-gesture';
import {
  computeAutoScrollDelta,
  computeDropTargetIndex,
  computeSiblingShiftPx,
  EDGE_AUTOSCROLL_ZONE_PX,
  isDragExceeded,
  TAP_DRAG_THRESHOLD_PX,
} from '../ui/useSortableList';
import { executeComputeJob } from '../worker/compute.worker';

function makeDummyCurve(exprId: string, color = '#f97316'): CurveRenderPacket {
  return {
    exprId,
    color,
    visible: true,
    primaryVar: 'x',
    primaryPoints: new Float64Array(0),
    pois: [],
  };
}

describe('Phase 1 — Expression, Note & Slider Reordering Semantics', () => {
  beforeEach(() => {
    graphStore.getState().selectTemplate('T-00');
    graphStore.getState().clearAllExpressions();
  });

  it('reorders expressions, updates curve Z-order synchronously (0ms), preserves fitLoss, and records 1 undo step', () => {
    const st = graphStore.getState();
    st.addExpression('x^2', 'f(x)');
    st.addExpression('\\sin(x)', 'g(x)');
    st.addExpression('2x + 1', 'h(x)');
    const [id1, id2, id3] = graphStore.getState().graph.expressions.map((e) => e.id);
    graphStore.getState().setExpressionFitLoss(id2);

    graphStore.setState({
      curves: [makeDummyCurve(id1), makeDummyCurve(id2), makeDummyCurve(id3)],
    });
    const undoBefore = graphStore.getState().undoStack.length;

    graphStore.getState().reorderExpressions(0, 2);

    const after = graphStore.getState();
    expect(after.graph.expressions.map((e) => e.id)).toEqual([id2, id3, id1]);
    expect(after.curves.map((c) => c.exprId)).toEqual([id2, id3, id1]);
    expect(after.graph.expressions.find((e) => e.fitLoss)?.id).toBe(id2);
    expect(after.undoStack.length).toBe(undoBefore + 1);

    // Out-of-bounds or same-index moves are safe no-ops
    graphStore.getState().reorderExpressions(1, 1);
    graphStore.getState().reorderExpressions(-1, 2);
    graphStore.getState().reorderExpressions(0, 99);
    expect(graphStore.getState().undoStack.length).toBe(undoBefore + 1);

    // Stepwise keyboard / menu move (Alt+Up / Alt+Down)
    graphStore.getState().moveExpression(id1, -1);
    expect(graphStore.getState().graph.expressions.map((e) => e.id)).toEqual([
      id2,
      id1,
      id3,
    ]);
  });

  it('reorders mixed Note and Plot rows while keeping fitLoss strictly on plottable rows', () => {
    graphStore.getState().addExpressionsBatch([
      { latex: '\\text{Section Header}', kind: 'note' },
      { latex: 'a \\cdot x + b', kind: 'plot' },
      { latex: 'x^3', kind: 'plot' },
    ]);
    const exprs = graphStore.getState().graph.expressions;
    expect(exprs.length).toBe(3);
    const [noteId, plotAId, plotBId] = exprs.map((e) => e.id);
    expect(exprs.find((e) => e.fitLoss)?.id).toBe(plotAId);

    // Move Note below plotA, then back to top
    graphStore.getState().reorderExpressions(0, 1);
    expect(graphStore.getState().graph.expressions.map((e) => e.id)).toEqual([
      plotAId,
      noteId,
      plotBId,
    ]);
    expect(graphStore.getState().graph.expressions.find((e) => e.fitLoss)?.id).toBe(
      plotAId
    );
  });

  it('re-evaluates Last-Row-Wins formal function definitions and sliders when duplicate signatures reorder', () => {
    const st = graphStore.getState();
    st.addExpression('q(x) = m \\cdot x', 'q_1');
    st.addExpression('q(x) = c \\cdot x^2', 'q_2');
    st.addExpression('q(x)', 'y');
    const [defA, defB, callId] = graphStore.getState().graph.expressions.map((e) => e.id);
    expect([defA, defB, callId].length).toBe(3);

    // Initially defB (`c * x^2`) is last, so `c` is active and at x=2, q(2) = c * 4
    graphStore.getState().setSliderValue('c', 2);
    const runEval = () => {
      const g = graphStore.getState().graph;
      const paramValues: Record<string, number> = {};
      const paramBounds: Record<string, { min: number; max: number }> = {};
      for (const [k, sl] of Object.entries(g.sliders)) {
        paramValues[k] = sl.value;
        paramBounds[k] = { min: sl.min, max: sl.max };
      }
      return executeComputeJob({
        type: 'EVALUATE_FRAME',
        seq: 1,
        expressions: g.expressions,
        paramValues,
        paramBounds,
        symbolOverrides: g.symbolOverrides,
        subgradConvention: g.subgradConvention,
        leftViewport: { xMin: -5, xMax: 5, yMin: -10, yMax: 10 },
        rightViewport: g.rightViewport,
        screenWidth: 400,
        screenHeight: 300,
        dataPoints: [],
        lossKind: g.lossKind,
        regularizationKind: g.regularizationKind,
        regularizationRadius: g.regularizationRadius,
        batchNormEnabled: false,
        optimizerRace: g.optimizerRace,
        hoveredDataPointId: null,
        functionLibrary: g.functionLibrary,
      });
    };

    const resBefore = runEval();
    const callCurveBefore = resBefore.curves.find((c) => c.exprId === callId);
    expect(callCurveBefore).toBeDefined();

    // Swap defA below defB so `q(x) = m * x` becomes the winning definition
    graphStore.getState().reorderExpressions(0, 1);
    expect(graphStore.getState().graph.sliders['m']).toBeDefined();
    graphStore.getState().setSliderValue('m', 3);

    const resAfter = runEval();
    const callCurveAfter = resAfter.curves.find((c) => c.exprId === callId);
    expect(callCurveAfter).toBeDefined();
    const rawPts = callCurveAfter!.primaryPoints;
    let bestX = 0;
    let bestY = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i + 1 < rawPts.length; i += 2) {
      const px = rawPts[i];
      const py = rawPts[i + 1];
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
      const d = Math.abs(px - 1);
      if (d < bestDist) {
        bestDist = d;
        bestX = px;
        bestY = py;
      }
    }
    expect(bestDist).toBeLessThan(0.2);
    expect(bestY).toBeCloseTo(3 * bestX, 2);
  });

  it('duplicates an expression right below the source with its own id and preserves original fitLoss', () => {
    const st = graphStore.getState();
    st.addExpression('a \\cdot x + 1', 'line');
    const id1 = graphStore.getState().graph.expressions[0].id;
    const copyId = graphStore.getState().duplicateExpression(id1);
    expect(copyId).toBeTruthy();
    const exprs = graphStore.getState().graph.expressions;
    expect(exprs.map((e) => e.id)).toEqual([id1, copyId!]);
    expect(exprs[0].fitLoss).toBe(true);
    expect(exprs[1].fitLoss).toBe(false);
    expect(exprs[1].latex).toBe('a \\cdot x + 1');
  });

  it('reorders sliders, persists order across expression edits & #v2.dr.* URLs, and preserves 3D Loss Surface axes', () => {
    const st = graphStore.getState();
    // Non-canonical parameter names p, q, r so resolveSurfaceParamPair initially picks ('p', 'q') by insertion order
    st.addExpression('p \\cdot x^2 + q \\cdot x + r', 'poly');
    expect(Object.keys(graphStore.getState().graph.sliders)).toEqual(['p', 'q', 'r']);

    const initialAxes = resolveSurfaceParamPair(
      graphStore.getState().graph.sliders,
      graphStore.getState().graph.surfaceParamW1,
      graphStore.getState().graph.surfaceParamW2
    );
    expect([initialAxes.w1Key, initialAxes.w2Key]).toEqual(['p', 'q']);

    // Drag 'r' to index 0 -> order becomes ['r', 'p', 'q'], while 3D axes stay ('p', 'q')!
    graphStore.getState().reorderSliders(2, 0);
    const afterReorder = graphStore.getState().graph;
    expect(Object.keys(afterReorder.sliders)).toEqual(['r', 'p', 'q']);
    expect([afterReorder.surfaceParamW1, afterReorder.surfaceParamW2]).toEqual(['p', 'q']);

    const preservedAxes = resolveSurfaceParamPair(
      afterReorder.sliders,
      afterReorder.surfaceParamW1,
      afterReorder.surfaceParamW2
    );
    expect([preservedAxes.w1Key, preservedAxes.w2Key]).toEqual(['p', 'q']);

    // Editing / adding another expression runs syncSlidersFromExpressions and preserves ['r', 'p', 'q']
    graphStore.getState().addExpression('\\sin(x)', 'wave');
    expect(Object.keys(graphStore.getState().graph.sliders)).toEqual(['r', 'p', 'q']);

    // Stepwise moveSlider ('p' down to end -> ['r', 'q', 'p'])
    graphStore.getState().moveSlider('p', 1);
    expect(Object.keys(graphStore.getState().graph.sliders)).toEqual(['r', 'q', 'p']);

    // Round-trip through #v2.dr.* stateless URL codec preserves slider key order & 3D axes
    const hash = encodeStateToUrlHashSync(graphStore.getState().graph);
    const decoded = decodeStateFromUrlHashSync(hash, createInitialGraphState('T-00'));
    expect(decoded).not.toBeNull();
    expect(Object.keys(decoded!.sliders)).toEqual(['r', 'q', 'p']);
    expect([decoded!.surfaceParamW1, decoded!.surfaceParamW2]).toEqual(['p', 'q']);
  });
});

describe('Phase 2 & 3 — Undo/Redo Sync, LocalStorage & Whiteboard History', () => {
  const storageBacking = new Map<string, string>();
  const replacedUrls: string[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    storageBacking.clear();
    replacedUrls.length = 0;

    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storageBacking.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storageBacking.set(k, v);
      },
      removeItem: (k: string) => {
        storageBacking.delete(k);
      },
    });
    vi.stubGlobal('history', {
      replaceState: (_data: unknown, _unused: string, url?: string | URL | null) => {
        if (url) replacedUrls.push(String(url));
      },
    });
    vi.stubGlobal('location', {
      pathname: '/graphstudio/',
      origin: 'https://vinhmdev.com',
      hash: '',
    });

    graphStore.getState().selectTemplate('M-01');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('preserves workspaceMode ("math") and syncs both stateless URL & localStorage on undo() and redo()', () => {
    graphStore.getState().setWorkspaceMode('math');
    expect(graphStore.getState().workspaceMode).toBe('math');

    graphStore.getState().addExpression('\\cos(x)', 'h(x)');
    const exprsWithAdded = graphStore.getState().graph.expressions;
    const addedId = exprsWithAdded[exprsWithAdded.length - 1].id;
    vi.advanceTimersByTime(600);
    const hashWithAdded = replacedUrls[replacedUrls.length - 1];
    expect(hashWithAdded).toMatch(/^#v2\.dr\./);

    // Undo should keep workspaceMode === 'math' AND update URL + localStorage back to pre-add state
    graphStore.getState().undo();
    expect(graphStore.getState().workspaceMode).toBe('math');
    expect(
      graphStore.getState().graph.expressions.some((e) => e.id === addedId)
    ).toBe(false);

    vi.advanceTimersByTime(600);
    const hashAfterUndo = replacedUrls[replacedUrls.length - 1];
    expect(hashAfterUndo).not.toBe(hashWithAdded);

    const savedAfterUndo = loadStateFromLocalStorage();
    expect(savedAfterUndo).not.toBeNull();
    expect(savedAfterUndo!.expressions.some((e) => e.id === addedId)).toBe(false);

    // Redo restores the expression, keeps workspaceMode === 'math', and updates URL + localStorage
    graphStore.getState().redo();
    expect(graphStore.getState().workspaceMode).toBe('math');
    expect(
      graphStore.getState().graph.expressions.some((e) => e.id === addedId)
    ).toBe(true);

    vi.advanceTimersByTime(600);
    expect(replacedUrls[replacedUrls.length - 1]).toBe(hashWithAdded);
    expect(
      loadStateFromLocalStorage()!.expressions.some((e) => e.id === addedId)
    ).toBe(true);
  });

  it('supports save, restore, and clear on localStorage persistence', () => {
    const g = graphStore.getState().graph;
    expect(saveStateToLocalStorage(g)).toBe(true);
    expect(storageBacking.has(STORAGE_KEY_V2)).toBe(true);
    expect(loadStateFromLocalStorage()?.activeTemplateId).toBe('M-01');
    expect(clearStateFromLocalStorage()).toBe(true);
    expect(loadStateFromLocalStorage()).toBeNull();
  });

  it('supports Whiteboard stroke undo/redo, single-gesture erase snapshot, and clear recovery', () => {
    const s1 = {
      id: 'wb-1',
      tool: 'pen' as const,
      color: '#f97316',
      width: 2.8,
      points: [
        { x: 0, y: 0 },
        { x: 2, y: 2 },
      ],
    };
    const s2 = {
      id: 'wb-2',
      tool: 'highlighter' as const,
      color: '#3b82f6',
      width: 14,
      points: [
        { x: -3, y: 1 },
        { x: -1, y: 1 },
      ],
    };

    graphStore.getState().addWhiteboardStroke(s1);
    graphStore.getState().addWhiteboardStroke(s2);
    expect(graphStore.getState().whiteboardStrokes.length).toBe(2);
    expect(graphStore.getState().whiteboardUndoStack.length).toBe(2);

    // Eraser miss records 0 undo snapshots
    expect(graphStore.getState().eraseWhiteboardAt(50, 50, 0.5, true)).toBe(false);
    expect(graphStore.getState().whiteboardUndoStack.length).toBe(2);

    // Single continuous eraser gesture erasing both strokes records only 1 undo snapshot
    expect(graphStore.getState().eraseWhiteboardAt(1, 1, 0.5, true)).toBe(true);
    expect(graphStore.getState().eraseWhiteboardAt(-2, 1, 0.5, false)).toBe(true);
    expect(graphStore.getState().whiteboardStrokes.length).toBe(0);
    expect(graphStore.getState().whiteboardUndoStack.length).toBe(3);

    // One undo restores BOTH strokes from before the eraser drag
    graphStore.getState().undoWhiteboard();
    expect(graphStore.getState().whiteboardStrokes.map((s) => s.id)).toEqual([
      'wb-1',
      'wb-2',
    ]);

    // Clear all strokes can also be undone and redone
    graphStore.getState().clearWhiteboard();
    expect(graphStore.getState().whiteboardStrokes.length).toBe(0);
    graphStore.getState().undoWhiteboard();
    expect(graphStore.getState().whiteboardStrokes.length).toBe(2);
    graphStore.getState().redoWhiteboard();
    expect(graphStore.getState().whiteboardStrokes.length).toBe(0);
  });
});

describe('Phase 2 — 3-Tier Mobile Bottom Sheet Gesture & UI Geometry Engines', () => {
  it('resolves 3-tier bottom-sheet gestures (collapsed <-> half <-> full)', () => {
    // Taps
    expect(resolveSheetSnapGesture(0, 'collapsed')).toBe('half');
    expect(resolveSheetSnapGesture(SHEET_TAP_SLOP_PX, 'half')).toBe('collapsed');
    expect(resolveSheetSnapGesture(-SHEET_TAP_SLOP_PX, 'full')).toBe('half');

    // Slop dead-zone
    expect(resolveSheetSnapGesture(SHEET_TAP_SLOP_PX + 2, 'half')).toBe('half');
    expect(resolveSheetSnapGesture(-(SHEET_SWIPE_PX - 1), 'collapsed')).toBe('collapsed');

    // Incremental swipes
    expect(resolveSheetSnapGesture(-SHEET_SWIPE_PX, 'collapsed')).toBe('half');
    expect(resolveSheetSnapGesture(-SHEET_SWIPE_PX, 'half')).toBe('full');
    expect(resolveSheetSnapGesture(-SHEET_SWIPE_PX, 'full')).toBe('full');
    expect(resolveSheetSnapGesture(SHEET_SWIPE_PX, 'full')).toBe('half');
    expect(resolveSheetSnapGesture(SHEET_SWIPE_PX, 'half')).toBe('collapsed');
    expect(resolveSheetSnapGesture(SHEET_SWIPE_PX, 'collapsed')).toBe('collapsed');

    // Fast long flick jumps straight to full or collapsed
    expect(resolveSheetSnapGesture(-SHEET_LARGE_SWIPE_PX, 'collapsed')).toBe('full');
    expect(resolveSheetSnapGesture(SHEET_LARGE_SWIPE_PX, 'full')).toBe('collapsed');

    // Non-finite safety
    expect(resolveSheetSnapGesture(Number.NaN, 'half')).toBe('half');
  });

  it('disambiguates Tap (<= 6px) vs Drag (> 6px) and computes Edge Auto-Scroll & Drop Index', () => {
    expect(isDragExceeded(0)).toBe(false);
    expect(isDragExceeded(TAP_DRAG_THRESHOLD_PX)).toBe(false);
    expect(isDragExceeded(-TAP_DRAG_THRESHOLD_PX)).toBe(false);
    expect(isDragExceeded(TAP_DRAG_THRESHOLD_PX + 0.5)).toBe(true);
    expect(isDragExceeded(-(TAP_DRAG_THRESHOLD_PX + 1))).toBe(true);

    // Edge auto-scroll inside [100, 500] container
    expect(computeAutoScrollDelta(100 + EDGE_AUTOSCROLL_ZONE_PX / 2, 100, 500)).toBeLessThan(0);
    expect(computeAutoScrollDelta(500 - EDGE_AUTOSCROLL_ZONE_PX / 2, 100, 500)).toBeGreaterThan(0);
    expect(computeAutoScrollDelta(300, 100, 500)).toBe(0);

    // Drop target & sibling displacement across 4 cards (height 50, gap 8)
    const boxes = [
      { top: 0, height: 50 },
      { top: 58, height: 50 },
      { top: 116, height: 50 },
      { top: 174, height: 50 },
    ];
    expect(computeDropTargetIndex(150, 0, boxes)).toBe(2);
    expect(computeSiblingShiftPx(1, 0, 2, 58)).toBe(-58);
    expect(computeSiblingShiftPx(2, 0, 2, 58)).toBe(-58);
    expect(computeSiblingShiftPx(3, 0, 2, 58)).toBe(0);

    expect(computeDropTargetIndex(70, 3, boxes)).toBe(1);
    expect(computeSiblingShiftPx(1, 3, 1, 58)).toBe(58);
    expect(computeSiblingShiftPx(2, 3, 1, 58)).toBe(58);
    expect(computeSiblingShiftPx(0, 3, 1, 58)).toBe(0);

    // Variable-height cards: expanded card (117px) dragged past collapsed card (38px)
    const mixedDown = [
      { top: 0, height: 117 },
      { top: 125, height: 38 },
    ];
    // Dragging card 0 down by 50px (center moves 58.5 -> 108.5, bottom edge reaches 167 >= mid 144)
    expect(computeDropTargetIndex(58.5 + 50, 0, mixedDown)).toBe(1);

    // Dragging expanded card 1 (117px) upward over collapsed card 0 (38px, mid 19) by 27px
    const mixedUp = [
      { top: 0, height: 38 },
      { top: 46, height: 117 },
    ];
    expect(computeDropTargetIndex(104.5 - 27, 1, mixedUp)).toBe(0);
  });

  it('clamps FloatingPopover within 320px narrow mobile screen, respects layoutViewportHeight, and caps tight spaceAbove', () => {
    // 320x568 viewport with anchor near right & bottom edges
    const pos = computePopoverPosition({
      anchorRect: { top: 510, bottom: 538, left: 270, right: 308, width: 38 },
      viewportWidth: 320,
      viewportHeight: 568,
      layoutViewportHeight: 568,
      align: 'right',
      menuWidth: 240,
    });
    expect(pos.left).toBeGreaterThanOrEqual(8);
    expect(pos.left + 240).toBeLessThanOrEqual(312);
    expect(pos.bottom).toBe(568 - 510 + 4);
    expect(pos.top).toBeUndefined();

    // Very short mobile visualViewport (e.g. virtual keyboard open, spaceAbove = 92 < 120)
    const tightPos = computePopoverPosition({
      anchorRect: { top: 104, bottom: 132, left: 16, right: 80, width: 64 },
      viewportWidth: 320,
      viewportHeight: 160,
      layoutViewportHeight: 568,
      align: 'left',
      menuWidth: 200,
    });
    expect(tightPos.bottom).toBe(568 - 104 + 4);
    expect(tightPos.maxHeight).toBeLessThanOrEqual(92);
  });

  it('inserts MiniMathBar LaTeX snippets with cursor step-back and wraps active selection', () => {
    const emptySqrt = insertLatexSnippet('', 0, 0, '\\sqrt{}', 1);
    expect(emptySqrt).toEqual({ value: '\\sqrt{}', caret: 6 });

    const fracMid = insertLatexSnippet('2 + ', 4, 4, '\\frac{}{}', 3);
    expect(fracMid).toEqual({ value: '2 + \\frac{}{}', caret: 10 });

    const wrapped = insertLatexSnippet('x + 1', 0, 5, '\\sqrt{}', 1);
    expect(wrapped).toEqual({ value: '\\sqrt{x + 1}', caret: 11 });
  });

  it('maintains 100% key parity and non-empty strings between vi.json and en.json', () => {
    const viKeys = Object.keys(viDict).sort();
    const enKeys = Object.keys(enDict).sort();
    expect(viKeys).toEqual(enKeys);
    for (const k of viKeys) {
      expect((viDict as Record<string, string>)[k].trim().length).toBeGreaterThan(0);
      expect((enDict as Record<string, string>)[k].trim().length).toBeGreaterThan(0);
    }
  });
});

describe('Phase 1–3 — Preact Component Render & Contextual HUD Verification', () => {
  beforeEach(() => {
    graphStore.getState().selectTemplate('T-00');
    graphStore.getState().clearAllExpressions();
    graphStore.getState().setBrushActive(false);
    graphStore.getState().setFunctionLibraryDrawerOpen(false);
  });

  it('renders ExpressionSidebar with unified 32px gutter, shadowed function badge, visibleSection filtering, and contextual Fit button', () => {
    const st = graphStore.getState();
    st.addExpression('h(x) = a \\cdot x', 'h_1');
    st.addExpression('h(x) = b \\cdot x^2', 'h_2');
    st.addExpressionsBatch([{ latex: '\\text{Group Note}', kind: 'note' }]);
    const firstId = graphStore.getState().graph.expressions[0].id;

    // Pure 2D inference mode with 0 data points -> Fit button is hidden
    graphStore.getState().setViewMode('inference');
    const html2D = renderToString(
      h(ExpressionSidebar, { storeState: graphStore.getState(), visibleSection: 'all' })
    );
    expect(html2D).toContain(`data-testid="expr-style-btn-${firstId}"`);
    // Shadowed duplicate formal function badge rendered on overridden first definition
    expect(html2D).toMatch(/Shadowed|Ghi đè/);
    expect(html2D).not.toContain('>Fit<');

    // visibleSection="fx" hides sliders; visibleSection="sliders" hides expressions
    const htmlFxOnly = renderToString(
      h(ExpressionSidebar, { storeState: graphStore.getState(), visibleSection: 'fx' })
    );
    const htmlSlidersOnly = renderToString(
      h(ExpressionSidebar, { storeState: graphStore.getState(), visibleSection: 'sliders' })
    );
    expect(htmlFxOnly).toContain(`data-testid="expr-style-btn-${firstId}"`);
    expect(htmlSlidersOnly).not.toContain(`data-testid="expr-style-btn-${firstId}"`);

    // Dual mode shows Fit button on plottable cards
    graphStore.getState().setViewMode('dual');
    const htmlDual = renderToString(
      h(ExpressionSidebar, { storeState: graphStore.getState(), visibleSection: 'all' })
    );
    expect(htmlDual).toContain('>Fit<');
  });

  it('renders CompactSliderCard with 3D surface axis badge and MiniMathBar / FloatingPopover cleanly', () => {
    graphStore.getState().addExpression('a \\cdot x + b', 'f(x)');
    const sliderA = graphStore.getState().graph.sliders['a'];
    expect(sliderA).toBeDefined();

    const dummyItemBind = {
      ref: () => {},
      style: undefined,
      isDragging: false,
      dropIndicator: null,
      onKeyDown: () => {},
    };
    const dummyHandleBind = {
      onPointerDown: () => {},
      onPointerMove: () => {},
      onPointerUp: () => {},
      onPointerCancel: () => {},
      onClick: () => {},
    };

    const cardHtml = renderToString(
      h(CompactSliderCard, {
        slider: sliderA,
        index: 0,
        totalCount: 2,
        axisBadge: 'X',
        configOpen: false,
        onToggleConfig: () => {},
        storeState: graphStore.getState(),
        itemBind: dummyItemBind,
        handleBind: dummyHandleBind,
      })
    );
    expect(cardHtml).toContain('>X<');
    expect(cardHtml).toContain('gs-slider');

    const mathBarHtml = renderToString(
      h(MiniMathBar, { inputEl: null, currentValue: 'x', onInsert: () => {} })
    );
    expect(mathBarHtml).toContain('√');
    expect(mathBarHtml).toContain('a/b');

    const closedPopoverHtml = renderToString(
      h(FloatingPopover, {
        open: false,
        anchorEl: null,
        onClose: () => {},
        children: 'menu',
      })
    );
    expect(closedPopoverHtml).toBe('');
  });

  it('truncates DataTablePanel at 40 rows by default and renders expansion button when > 40 points exist', () => {
    const pts: DataPoint2D[] = Array.from({ length: 55 }, (_, idx) => ({
      id: `pt-${idx}`,
      x: idx * 0.1,
      y: idx * 0.2,
      split: 'train',
    }));
    graphStore.getState().setDataPoints(pts);

    const html = renderToString(h(DataTablePanel, { storeState: graphStore.getState() }));
    const rowInputs = html.match(/aria-label="Point X coordinate"/g) ?? [];
    expect(rowInputs.length).toBe(40);
    expect(html).toContain('55');
  });

  it('declutters DualViewportPanel HUD (r², Point Brush pill, Loss pill), renders 3-tier MobileSheetHandle & ToolbarSubheader, and aligns FunctionLibraryDrawer theme', () => {
    const leftRef = createRef<HTMLCanvasElement>();
    const rightGlRef = createRef<HTMLCanvasElement>();
    const rightOverlayRef = createRef<HTMLCanvasElement>();

    // 1. 0 data points -> no r² button; brushActive=true -> renders floating brush pill; softmax_simplex -> no Loss: pill
    graphStore.getState().setViewMode('dual');
    graphStore.getState().setRightViewportMode('softmax_simplex');
    graphStore.getState().setBrushActive(true);

    const hudSpecialized = renderToString(
      h(DualViewportPanel, {
        storeState: graphStore.getState(),
        isDark: false,
        leftCanvasRef: leftRef,
        rightGlCanvasRef: rightGlRef,
        rightOverlayCanvasRef: rightOverlayRef,
      })
    );
    expect(hudSpecialized).not.toContain('>r²<');
    expect(hudSpecialized).not.toContain('Loss:');
    expect(hudSpecialized).toContain('🖌');

    // 2. Switching back to `loss_surface` + adding 1 data point reveals r² and Loss:
    graphStore.getState().setRightViewportMode('loss_surface');
    graphStore.getState().addDataPoint({ x: 1, y: 2, split: 'train' });
    const hudLoss = renderToString(
      h(DualViewportPanel, {
        storeState: graphStore.getState(),
        isDark: false,
        leftCanvasRef: leftRef,
        rightGlCanvasRef: rightGlRef,
        rightOverlayCanvasRef: rightOverlayRef,
      })
    );
    expect(hudLoss).toContain('>r²<');
    expect(hudLoss).toContain('Loss:');

    // 3. 3-tier MobileSheetHandle renders expand/half height pill when open, hides it when collapsed
    const handleHalfHtml = renderToString(
      h(MobileSheetHandle, { tier: 'half', onTierChange: () => {} })
    );
    const handleCollapsedHtml = renderToString(
      h(MobileSheetHandle, { tier: 'collapsed', onTierChange: () => {} })
    );
    expect(handleHalfHtml).toContain('aria-expanded="true"');
    expect(handleHalfHtml).toContain('Full height');
    expect(handleCollapsedHtml).toContain('aria-expanded="false"');
    expect(handleCollapsedHtml).not.toContain('Full height');

    // 4. ToolbarSubheader renders cleanly below < lg when no desktop portal slot is mounted
    const toolbarHtml = renderToString(
      h(ToolbarSubheader, {
        storeState: graphStore.getState(),
        sidebarOpen: true,
        onToggleSidebar: () => {},
        onExportPng: () => {},
        onToast: () => {},
      })
    );
    expect(toolbarHtml).toContain(enDict.explore_examples_btn);

    // 5. FunctionLibraryDrawer uses Pure Titanium Light/Dark neutral classes (no hardcoded #0d1220)
    graphStore.getState().setFunctionLibraryDrawerOpen(true);
    const fnDrawerHtml = renderToString(
      h(FunctionLibraryDrawer, {
        storeState: graphStore.getState(),
        onToast: () => {},
      })
    );
    expect(fnDrawerHtml).toContain('dark:bg-neutral-900');
    expect(fnDrawerHtml).not.toContain('#0d1220');
    expect(fnDrawerHtml).toContain(enDict.fn_lib_insert_def_btn);

    // 6. SharePublishModal, CustomOptimizerModal & CommunityGalleryDrawer render localized strings & neutral theme
    graphStore.getState().setShareModalOpen(true);
    const shareHtml = renderToString(
      h(SharePublishModal, { storeState: graphStore.getState(), onToast: () => {} })
    );
    expect(shareHtml).toContain(enDict.share_e2ee_submit.replace('&', '&amp;'));
    graphStore.getState().setShareModalOpen(false);

    graphStore.getState().setCustomOptModalOpen(true);
    const customOptHtml = renderToString(
      h(CustomOptimizerModal, { storeState: graphStore.getState(), onToast: () => {} })
    );
    expect(customOptHtml).toContain(enDict.custom_opt_submit.replace('&', '&amp;'));
    graphStore.getState().setCustomOptModalOpen(false);

    graphStore.getState().setGalleryDrawerOpen(true, 'examples');
    const galleryHtml = renderToString(
      h(CommunityGalleryDrawer, { storeState: graphStore.getState(), onToast: () => {} })
    );
    expect(galleryHtml).toContain(enDict.gallery_cat_math.replace('&', '&amp;'));
    graphStore.getState().setGalleryDrawerOpen(false);
  });
});
