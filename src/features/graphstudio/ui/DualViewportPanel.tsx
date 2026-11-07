/**
 * Coordinated Dual-Space Viewport Panel [FR-3.4, FR-4.1, FR-4.3].
 *
 * Left Pane  : HiDPI 2D Data / Function Space (Interactive curves, POIs, Tangent Probe,
 *              Data Point Dragging, Data Brush, Residual Squares r_i^2, and
 *              Interactive Whiteboard Freehand Annotations).
 * Right Pane : HiDPI 3D WebGL2 Loss Surface + Hardware fwidth() Contours + 2D Particle Overlay
 *              (or Specialized Phase 5 Canvas for Softmax Simplex, ROC-AUC, 3D RBF, MLP Folding).
 */
import type { JSX, RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { resolveSurfaceParamPair } from '../core/simulation/loss-evaluator';
import { renderDataSpaceCanvas2D } from '../renderers/canvas2d-renderer';
import {
  renderMlpSpaceFoldingCanvas,
  renderRocCurveCanvas,
  renderSoftmaxSimplexCanvas,
  renderSvmFeature3DCanvas,
} from '../renderers/specialized-canvas';
import {
  hitTestDataPoint,
  panViewport,
  screenToWorld,
  zoomViewportAt,
} from '../renderers/viewport-controller';
import {
  renderLossSpaceOverlay2D,
  WebGL2SurfaceRenderer,
} from '../renderers/webgl2-surface';
import type { GraphStoreState } from '../state/store';
import type {
  LossKind,
  RegularizationKind,
  RightViewportMode,
  WhiteboardStroke,
  WhiteboardTool,
} from '../types/state';
import { t } from '../scripts/i18n-client';
import {
  IconCursor,
  IconEraser,
  IconHighlighter,
  IconHome,
  IconPen,
  IconTrash,
} from './icons';

interface DualViewportProps {
  storeState: GraphStoreState;
  isDark: boolean;
  leftCanvasRef: RefObject<HTMLCanvasElement | null>;
  rightGlCanvasRef: RefObject<HTMLCanvasElement | null>;
  rightOverlayCanvasRef: RefObject<HTMLCanvasElement | null>;
}

const WHITEBOARD_COLORS = ['#f97316', '#3b82f6', '#10b981', '#ef4444', '#a855f7'];

function getHiDpiRatio(): number {
  if (typeof window === 'undefined') return 2;
  // Minimum 2x supersampling guarantees razor-sharp curves and text even on 1x monitors
  return Math.min(Math.max(window.devicePixelRatio || 1, 2), 3);
}

export function DualViewportPanel({
  storeState,
  isDark,
  leftCanvasRef,
  rightGlCanvasRef,
  rightOverlayCanvasRef,
}: DualViewportProps): JSX.Element {
  const {
    graph,
    curves,
    trainLoss,
    testLoss,
    lossGrid,
    minLoss,
    maxLoss,
    vectorField,
    trajectories,
    linkedBrushPull,
    mobileTab,
    brushActive,
    whiteboardTool,
    whiteboardColor,
    whiteboardStrokes,
  } = storeState;

  const leftContainerRef = useRef<HTMLDivElement>(null);
  const rightContainerRef = useRef<HTMLDivElement>(null);
  const [leftSize, setLeftSize] = useState<{ width: number; height: number }>({
    width: 720,
    height: 520,
  });
  const [rightSize, setRightSize] = useState<{ width: number; height: number }>({
    width: 720,
    height: 520,
  });
  const [dpr, setDpr] = useState<number>(() => getHiDpiRatio());
  const [draftStroke, setDraftStroke] = useState<WhiteboardStroke | null>(null);
  const [leftToolsOpen, setLeftToolsOpen] = useState<boolean>(false);
  const [rightToolsOpen, setRightToolsOpen] = useState<boolean>(false);

  useEffect(() => {
    if (!rightToolsOpen || typeof window === 'undefined') return;
    const closeRightMenu = (): void => setRightToolsOpen(false);
    window.addEventListener('click', closeRightMenu);
    return () => window.removeEventListener('click', closeRightMenu);
  }, [rightToolsOpen]);

  const glRendererRef = useRef<WebGL2SurfaceRenderer | null>(null);
  const glCanvasBoundRef = useRef<HTMLCanvasElement | null>(null);
  const draggingPointIdRef = useRef<string | null>(null);
  const isPanningLeftRef = useRef(false);
  const isBrushingLeftRef = useRef(false);
  const isDraggingProbeLeftRef = useRef(false);
  const isErasingWhiteboardRef = useRef(false);
  const draftStrokeRef = useRef<WhiteboardStroke | null>(null);
  const lastMouseLeftRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const touchMapLeftRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const prevPinchDistLeftRef = useRef<number | null>(null);

  const rightDragModeRef = useRef<'none' | 'param' | 'orbit' | 'reg_radius'>('none');
  const lastMouseRightRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const showLeft =
    graph.viewMode === 'inference' ||
    (graph.viewMode === 'dual' && (mobileTab === 'data' || mobileTab === 'split'));
  const showRight =
    graph.viewMode === 'optimization' ||
    (graph.viewMode === 'dual' && (mobileTab === 'loss' || mobileTab === 'split'));

  const paramValues: Record<string, number> = {};
  for (const [k, s] of Object.entries(graph.sliders)) {
    paramValues[k] = s.value;
  }
  const { w1Key, w2Key, w1, w2 } = resolveSurfaceParamPair(
    graph.sliders,
    graph.surfaceParamW1,
    graph.surfaceParamW2
  );
  const paramSliderKeys = Object.values(graph.sliders)
    .filter((s) => s.role === 'param')
    .map((s) => s.name);
  const fitLossExprId = (
    graph.expressions.find((e) => e.fitLoss) ?? graph.expressions[0]
  )?.id;

  // Observe Left & Right viewport container dimensions + devicePixelRatio changes
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateSizes = (): void => {
      setDpr(getHiDpiRatio());
      if (leftContainerRef.current) {
        const r = leftContainerRef.current.getBoundingClientRect();
        if (r.width >= 40 && r.height >= 40) {
          const w = Math.round(r.width);
          const h = Math.round(r.height);
          setLeftSize((prev) =>
            prev.width === w && prev.height === h ? prev : { width: w, height: h }
          );
        }
      }
      if (rightContainerRef.current) {
        const r = rightContainerRef.current.getBoundingClientRect();
        if (r.width >= 40 && r.height >= 40) {
          const w = Math.round(r.width);
          const h = Math.round(r.height);
          setRightSize((prev) =>
            prev.width === w && prev.height === h ? prev : { width: w, height: h }
          );
        }
      }
    };

    updateSizes();
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => updateSizes())
        : null;
    if (ro) {
      if (leftContainerRef.current) ro.observe(leftContainerRef.current);
      if (rightContainerRef.current) ro.observe(rightContainerRef.current);
    }
    window.addEventListener('resize', updateSizes);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', updateSizes);
    };
  }, [showLeft, showRight, graph.viewMode, mobileTab]);

  // Initialize or re-bind WebGL2 renderer whenever rightGlCanvas mounts
  useEffect(() => {
    const glCanvas = rightGlCanvasRef.current;
    if (glCanvas && glCanvasBoundRef.current !== glCanvas) {
      glRendererRef.current = new WebGL2SurfaceRenderer(glCanvas, 128);
      glCanvasBoundRef.current = glCanvas;
    } else if (!glCanvas) {
      glRendererRef.current = null;
      glCanvasBoundRef.current = null;
    }
  }, [showRight, rightGlCanvasRef.current]);

  // Render Left 2D Canvas on every state/worker/resize/whiteboard update
  useEffect(() => {
    const canvas = leftCanvasRef.current;
    if (!canvas || !showLeft) return;

    const physW = Math.max(1, Math.round(leftSize.width * dpr));
    const physH = Math.max(1, Math.round(leftSize.height * dpr));
    if (canvas.width !== physW) canvas.width = physW;
    if (canvas.height !== physH) canvas.height = physH;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const allStrokes = draftStroke
      ? [...whiteboardStrokes, draftStroke]
      : whiteboardStrokes;

    renderDataSpaceCanvas2D({
      ctx,
      width: leftSize.width,
      height: leftSize.height,
      isDark,
      viewport: graph.leftViewport,
      curves,
      dataPoints: graph.dataPoints,
      showResiduals: graph.showResiduals,
      probeX: graph.probeX,
      hoveredDataPointId: graph.hoveredDataPointId,
      activeTemplateId: graph.activeTemplateId,
      lossKind: graph.lossKind,
      rightViewportMode: graph.rightViewportMode,
      paramValues,
      whiteboardStrokes: allStrokes,
      fitLossExprId,
    });
  }, [
    showLeft,
    leftSize.width,
    leftSize.height,
    dpr,
    isDark,
    graph.leftViewport,
    curves,
    graph.dataPoints,
    graph.showResiduals,
    graph.probeX,
    graph.hoveredDataPointId,
    graph.activeTemplateId,
    graph.lossKind,
    graph.rightViewportMode,
    whiteboardStrokes,
    draftStroke,
    fitLossExprId,
    JSON.stringify(paramValues),
  ]);

  // Render Right Viewport (WebGL2 3D Loss Surface + 2D Overlay OR Specialized Phase 5 Canvas)
  useEffect(() => {
    const overlay = rightOverlayCanvasRef.current;
    if (!overlay || !showRight) return;

    const physW = Math.max(1, Math.round(rightSize.width * dpr));
    const physH = Math.max(1, Math.round(rightSize.height * dpr));
    if (overlay.width !== physW) overlay.width = physW;
    if (overlay.height !== physH) overlay.height = physH;

    const glCanvas = rightGlCanvasRef.current;
    if (glCanvas) {
      if (glCanvas.width !== physW) glCanvas.width = physW;
      if (glCanvas.height !== physH) glCanvas.height = physH;
    }

    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    const W = rightSize.width;
    const H = rightSize.height;

    if (graph.rightViewportMode === 'softmax_simplex') {
      renderSoftmaxSimplexCanvas(ctx, W, H, isDark, paramValues);
      return;
    }
    if (graph.rightViewportMode === 'roc_curve') {
      renderRocCurveCanvas(ctx, W, H, isDark, graph.dataPoints, paramValues);
      return;
    }
    if (graph.rightViewportMode === 'svm_feature_3d') {
      renderSvmFeature3DCanvas(ctx, W, H, isDark, graph.dataPoints, paramValues);
      return;
    }
    if (graph.rightViewportMode === 'mlp_grid_warp') {
      renderMlpSpaceFoldingCanvas(ctx, W, H, isDark, graph.dataPoints, paramValues);
      return;
    }

    // Default: WebGL2 Loss Landscape + Instanced Vector Field + 2D Particle Overlay
    if (glRendererRef.current) {
      glRendererRef.current.renderSurface(
        lossGrid,
        minLoss,
        maxLoss,
        graph.surface3DZScale,
        graph.surface3DOrbitPitch,
        graph.surface3DOrbitYaw,
        isDark,
        physW,
        physH,
        vectorField,
        graph.rightViewport,
        graph.showVectorField
      );
    }

    renderLossSpaceOverlay2D({
      ctx,
      width: W,
      height: H,
      isDark,
      viewport: graph.rightViewport,
      w1,
      w2,
      vectorField,
      showVectorField: graph.showVectorField,
      regularizationKind: graph.regularizationKind,
      regularizationRadius: graph.regularizationRadius,
      trajectories,
      currentStep: graph.optimizerRace.currentStep,
      zScale: graph.surface3DZScale,
      pitch: graph.surface3DOrbitPitch,
      yaw: graph.surface3DOrbitYaw,
      minLoss,
      maxLoss,
      lossGrid,
      linkedBrushPull,
    });
  }, [
    showRight,
    rightSize.width,
    rightSize.height,
    dpr,
    isDark,
    graph.rightViewportMode,
    graph.rightViewport,
    graph.surface3DZScale,
    graph.surface3DOrbitPitch,
    graph.surface3DOrbitYaw,
    graph.showVectorField,
    graph.regularizationKind,
    graph.regularizationRadius,
    graph.optimizerRace.currentStep,
    lossGrid,
    minLoss,
    maxLoss,
    vectorField,
    trajectories,
    linkedBrushPull,
    w1,
    w2,
    JSON.stringify(paramValues),
  ]);

  const updateRightParamsFromWorld = (wx: number, wy: number): void => {
    const s1 = graph.sliders[w1Key];
    if (s1) {
      if (wx < s1.min || wx > s1.max) {
        storeState.updateSliderBounds(w1Key, {
          min: Math.min(s1.min, Math.floor(wx * 10) / 10),
          max: Math.max(s1.max, Math.ceil(wx * 10) / 10),
          value: wx,
          playing: false,
        });
      } else {
        storeState.setSliderValue(w1Key, wx);
      }
    }
    const s2 = graph.sliders[w2Key];
    if (s2 && w2Key !== w1Key) {
      const targetWy = w2Key === 'sigma' ? Math.max(0.1, wy) : wy;
      if (targetWy < s2.min || targetWy > s2.max) {
        storeState.updateSliderBounds(w2Key, {
          min: Math.min(s2.min, Math.floor(targetWy * 10) / 10),
          max: Math.max(s2.max, Math.ceil(targetWy * 10) / 10),
          value: targetWy,
          playing: false,
        });
      } else {
        storeState.setSliderValue(w2Key, targetWy);
      }
    }
  };

  const handleResetLeftViewport = (): void => {
    if (graph.activeTemplateId === 'T-00') {
      storeState.setLeftViewport({ xMin: -10, xMax: 10, yMin: -6, yMax: 6 });
    } else {
      storeState.setLeftViewport({ xMin: -5, xMax: 5, yMin: -3.5, yMax: 3.5 });
    }
  };

  const wbTools: { id: WhiteboardTool; labelKey: string; icon: JSX.Element }[] = [
    { id: 'cursor', labelKey: 'wb_cursor', icon: <IconCursor /> },
    { id: 'pen', labelKey: 'wb_pen', icon: <IconPen /> },
    { id: 'highlighter', labelKey: 'wb_highlighter', icon: <IconHighlighter /> },
    { id: 'eraser', labelKey: 'wb_eraser', icon: <IconEraser /> },
  ];

  return (
    <div class="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Mobile / Compact Responsive Tab Bar (< 1024px) */}
      {graph.viewMode === 'dual' && (
        <div class="flex lg:hidden items-center justify-center gap-2 py-1 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-100/70 dark:bg-neutral-900 text-xs">
          {(['data', 'loss', 'split'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => storeState.setMobileTab(tab)}
              class={`px-3 py-0.5 rounded font-semibold ${
                mobileTab === tab ? 'bg-orange-500 text-white' : 'text-neutral-500'
              }`}
            >
              {tab === 'data'
                ? t('tab_data')
                : tab === 'loss'
                  ? t('tab_loss')
                  : t('tab_split')}
            </button>
          ))}
        </div>
      )}

      {/* Main Split Viewports */}
      <div class="flex-1 grid grid-cols-1 lg:grid-cols-2 min-h-0 relative">
        {/* LEFT PANE: 2D Data / Function Space + Interactive Whiteboard */}
        {showLeft && (
          <div
            ref={leftContainerRef}
            class={`relative min-h-[260px] h-full border-b lg:border-b-0 lg:border-r border-neutral-200 dark:border-neutral-800 overflow-hidden ${
              !showRight ? 'lg:col-span-2' : ''
            }`}
          >
            <canvas
              ref={leftCanvasRef}
              width={Math.round(leftSize.width * dpr)}
              height={Math.round(leftSize.height * dpr)}
              class={`w-full h-full block touch-none ${
                whiteboardTool === 'cursor' ? 'cursor-crosshair' : 'cursor-pointer'
              }`}
              onPointerDown={(e) => {
                const canvasEl = e.currentTarget as HTMLCanvasElement;
                try {
                  canvasEl.setPointerCapture?.(e.pointerId);
                } catch {
                  /* ignore synthetic pointerId in automated tests */
                }
                const rect = canvasEl.getBoundingClientRect();
                const W = Math.max(rect.width, 1);
                const H = Math.max(rect.height, 1);
                const sx = e.clientX - rect.left;
                const sy = e.clientY - rect.top;

                touchMapLeftRef.current.set(e.pointerId, { x: sx, y: sy });
                if (touchMapLeftRef.current.size === 2) {
                  const pts = Array.from(touchMapLeftRef.current.values());
                  prevPinchDistLeftRef.current = Math.hypot(
                    pts[1].x - pts[0].x,
                    pts[1].y - pts[0].y
                  );
                  isPanningLeftRef.current = false;
                  return;
                }

                // Whiteboard Freehand Pen / Highlighter / Eraser Mode
                if (whiteboardTool === 'pen' || whiteboardTool === 'highlighter') {
                  const { wx, wy } = screenToWorld(sx, sy, graph.leftViewport, W, H);
                  const newStroke: WhiteboardStroke = {
                    id: `wb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    tool: whiteboardTool,
                    color: whiteboardColor,
                    width: whiteboardTool === 'highlighter' ? 14 : 2.8,
                    points: [{ x: wx, y: wy }],
                  };
                  draftStrokeRef.current = newStroke;
                  setDraftStroke(newStroke);
                  return;
                }

                if (whiteboardTool === 'eraser') {
                  isErasingWhiteboardRef.current = true;
                  const { wx, wy } = screenToWorld(sx, sy, graph.leftViewport, W, H);
                  const radiusWorld =
                    ((graph.leftViewport.xMax - graph.leftViewport.xMin) / W) * 18;
                  storeState.eraseWhiteboardAt(wx, wy, radiusWorld);
                  return;
                }

                if (brushActive) {
                  isBrushingLeftRef.current = true;
                  lastMouseLeftRef.current = { x: sx, y: sy };
                  const { wx, wy } = screenToWorld(sx, sy, graph.leftViewport, W, H);
                  storeState.addDataPoint({ x: wx, y: wy, split: 'train' });
                  return;
                }

                const hit = hitTestDataPoint(
                  sx,
                  sy,
                  graph.dataPoints,
                  graph.leftViewport,
                  W,
                  H
                );
                if (hit) {
                  draggingPointIdRef.current = hit.id;
                  storeState.setHoveredDataPoint(hit.id);
                  return;
                }

                const { wx } = screenToWorld(sx, sy, graph.leftViewport, W, H);
                if (
                  e.shiftKey ||
                  (graph.probeX !== null &&
                    Math.abs(wx - graph.probeX) <
                      (graph.leftViewport.xMax - graph.leftViewport.xMin) * 0.03)
                ) {
                  isDraggingProbeLeftRef.current = true;
                  storeState.setProbeX(wx);
                } else {
                  isPanningLeftRef.current = true;
                  lastMouseLeftRef.current = { x: sx, y: sy };
                }
              }}
              onPointerMove={(e) => {
                const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
                const W = Math.max(rect.width, 1);
                const H = Math.max(rect.height, 1);
                const sx = e.clientX - rect.left;
                const sy = e.clientY - rect.top;

                if (touchMapLeftRef.current.has(e.pointerId)) {
                  touchMapLeftRef.current.set(e.pointerId, { x: sx, y: sy });
                }

                // 2-Finger Touch Pinch-to-Zoom
                if (touchMapLeftRef.current.size === 2) {
                  const pts = Array.from(touchMapLeftRef.current.values());
                  const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
                  if (prevPinchDistLeftRef.current && dist > 8) {
                    const factor = prevPinchDistLeftRef.current / dist;
                    const midX = (pts[0].x + pts[1].x) * 0.5;
                    const midY = (pts[0].y + pts[1].y) * 0.5;
                    storeState.setLeftViewport(
                      zoomViewportAt(graph.leftViewport, factor, midX, midY, W, H)
                    );
                  }
                  prevPinchDistLeftRef.current = dist;
                  return;
                }

                if (draftStrokeRef.current) {
                  const { wx, wy } = screenToWorld(sx, sy, graph.leftViewport, W, H);
                  const updated: WhiteboardStroke = {
                    ...draftStrokeRef.current,
                    points: [...draftStrokeRef.current.points, { x: wx, y: wy }],
                  };
                  draftStrokeRef.current = updated;
                  setDraftStroke(updated);
                  return;
                }

                if (isErasingWhiteboardRef.current && whiteboardTool === 'eraser') {
                  const { wx, wy } = screenToWorld(sx, sy, graph.leftViewport, W, H);
                  const radiusWorld =
                    ((graph.leftViewport.xMax - graph.leftViewport.xMin) / W) * 18;
                  storeState.eraseWhiteboardAt(wx, wy, radiusWorld);
                  return;
                }

                if (isBrushingLeftRef.current && brushActive) {
                  const distPx = Math.hypot(
                    sx - lastMouseLeftRef.current.x,
                    sy - lastMouseLeftRef.current.y
                  );
                  if (distPx >= 16) {
                    lastMouseLeftRef.current = { x: sx, y: sy };
                    const { wx, wy } = screenToWorld(sx, sy, graph.leftViewport, W, H);
                    storeState.addDataPoint({ x: wx, y: wy, split: 'train' });
                  }
                  return;
                }

                if (isDraggingProbeLeftRef.current) {
                  const { wx } = screenToWorld(sx, sy, graph.leftViewport, W, H);
                  storeState.setProbeX(wx);
                  return;
                }

                if (draggingPointIdRef.current) {
                  const { wx, wy } = screenToWorld(sx, sy, graph.leftViewport, W, H);
                  storeState.updateDataPoint(draggingPointIdRef.current, wx, wy);
                  return;
                }

                if (isPanningLeftRef.current) {
                  const dx = sx - lastMouseLeftRef.current.x;
                  const dy = sy - lastMouseLeftRef.current.y;
                  lastMouseLeftRef.current = { x: sx, y: sy };
                  storeState.setLeftViewport(
                    panViewport(graph.leftViewport, dx, dy, W, H)
                  );
                  return;
                }

                const hit = hitTestDataPoint(
                  sx,
                  sy,
                  graph.dataPoints,
                  graph.leftViewport,
                  W,
                  H
                );
                if (hit?.id !== graph.hoveredDataPointId) {
                  storeState.setHoveredDataPoint(hit?.id ?? null);
                }
              }}
              onPointerUp={(e) => {
                touchMapLeftRef.current.delete(e.pointerId);
                if (touchMapLeftRef.current.size < 2) {
                  prevPinchDistLeftRef.current = null;
                }
                if (draftStrokeRef.current) {
                  storeState.addWhiteboardStroke(draftStrokeRef.current);
                  draftStrokeRef.current = null;
                  setDraftStroke(null);
                }
                isErasingWhiteboardRef.current = false;
                draggingPointIdRef.current = null;
                isPanningLeftRef.current = false;
                isBrushingLeftRef.current = false;
                isDraggingProbeLeftRef.current = false;
              }}
              onPointerCancel={(e) => {
                touchMapLeftRef.current.delete(e.pointerId);
                prevPinchDistLeftRef.current = null;
                draftStrokeRef.current = null;
                setDraftStroke(null);
                isErasingWhiteboardRef.current = false;
                draggingPointIdRef.current = null;
                isPanningLeftRef.current = false;
                isBrushingLeftRef.current = false;
                isDraggingProbeLeftRef.current = false;
              }}
              onWheel={(e) => {
                e.preventDefault();
                const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
                const W = Math.max(rect.width, 1);
                const H = Math.max(rect.height, 1);
                const sx = e.clientX - rect.left;
                const sy = e.clientY - rect.top;
                const factor = e.deltaY > 0 ? 1.1 : 0.9;
                storeState.setLeftViewport(
                  zoomViewportAt(graph.leftViewport, factor, sx, sy, W, H)
                );
              }}
            />

            {/* Top-Left & Top-Right Overlay Controls: Compact & Decluttered */}
            <div class="absolute top-2 left-2 right-2 flex items-start justify-between gap-1.5 pointer-events-none text-[11px]">
              {/* Left Compact Pill Row: Reset, 1:1, Tangent Probe */}
              <div class="flex items-center gap-1 pointer-events-auto">
                <button
                  type="button"
                  onClick={handleResetLeftViewport}
                  class="flex items-center gap-1 px-2 py-0.5 rounded bg-white/90 dark:bg-neutral-900/90 border border-neutral-300 dark:border-neutral-700 hover:border-orange-500 font-medium shadow-2xs"
                  title={t('reset_view_btn')}
                >
                  <IconHome class="w-3 h-3" />
                  <span class="hidden sm:inline">{t('reset_view_btn')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const aspect = Math.max(leftSize.width, 1) / Math.max(leftSize.height, 1);
                    const yMid = (graph.leftViewport.yMin + graph.leftViewport.yMax) * 0.5;
                    const xMid = (graph.leftViewport.xMin + graph.leftViewport.xMax) * 0.5;
                    const halfY = (graph.leftViewport.yMax - graph.leftViewport.yMin) * 0.5;
                    const halfX = halfY * aspect;
                    storeState.setLeftViewport({
                      xMin: xMid - halfX,
                      xMax: xMid + halfX,
                      yMin: yMid - halfY,
                      yMax: yMid + halfY,
                    });
                  }}
                  class="px-1.5 py-0.5 rounded bg-white/90 dark:bg-neutral-900/90 border border-neutral-300 dark:border-neutral-700 hover:border-orange-500 font-mono font-semibold shadow-2xs"
                  title="Square 1:1 Aspect Ratio"
                >
                  1:1
                </button>
                <button
                  type="button"
                  onClick={() =>
                    storeState.setProbeX(graph.probeX === null ? 0.0 : null)
                  }
                  class={`px-2 py-0.5 rounded border font-medium shadow-2xs ${
                    graph.probeX !== null
                      ? 'bg-orange-500 text-white border-orange-500'
                      : 'bg-white/90 dark:bg-neutral-900/90 border-neutral-300 dark:border-neutral-700 hover:border-orange-500'
                  }`}
                  title="Toggle draggable Tangent Probe on primary curve"
                >
                  {graph.probeX !== null ? `Probe x₀=${graph.probeX.toFixed(2)}` : 'Probe'}
                </button>
                <button
                  type="button"
                  onClick={() => storeState.setShowResiduals(!graph.showResiduals)}
                  class={`px-1.5 py-0.5 rounded border font-mono font-semibold shadow-2xs transition-colors ${
                    graph.showResiduals
                      ? 'bg-orange-500 text-white border-orange-500'
                      : 'bg-white/90 dark:bg-neutral-900/90 border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:border-orange-500'
                  }`}
                  title={t('residuals_btn')}
                >
                  r²
                </button>
              </div>

              {/* Right: Compact Whiteboard Dropdown / Popover Toolbar */}
              <div class="relative flex flex-col items-end gap-1 pointer-events-auto">
                <button
                  type="button"
                  onClick={() => setLeftToolsOpen((prev) => !prev)}
                  aria-expanded={leftToolsOpen || whiteboardTool !== 'cursor'}
                  class={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-semibold shadow-2xs transition-colors ${
                    leftToolsOpen || whiteboardTool !== 'cursor'
                      ? 'bg-orange-500 text-white border-orange-500'
                      : 'bg-white/90 dark:bg-neutral-900/90 border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 hover:border-orange-500'
                  }`}
                  title="Toggle Whiteboard Drawing Tools"
                >
                  <span>✏️</span>
                  <span class="hidden sm:inline">{t('blank_mode_btn')}</span>
                  <span>{leftToolsOpen || whiteboardTool !== 'cursor' ? '▴' : '▾'}</span>
                </button>

                {(leftToolsOpen || whiteboardTool !== 'cursor') && (
                  <div class="flex flex-wrap items-center gap-1 px-1.5 py-1 rounded-lg bg-white/95 dark:bg-neutral-900/95 border border-neutral-200 dark:border-neutral-800 shadow-lg">
                    {wbTools.map((tool) => {
                      const active = whiteboardTool === tool.id;
                      return (
                        <button
                          key={tool.id}
                          type="button"
                          onClick={() => {
                            storeState.setWhiteboardTool(tool.id);
                            if (tool.id === 'cursor') {
                              setLeftToolsOpen(false);
                            }
                          }}
                          class={`flex items-center gap-1 px-1.5 py-0.5 rounded font-medium transition-colors ${
                            active
                              ? 'bg-orange-500 text-white'
                              : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                          }`}
                          title={t(tool.labelKey)}
                        >
                          {tool.icon}
                          <span class="hidden md:inline">{t(tool.labelKey)}</span>
                        </button>
                      );
                    })}

                    {/* Color Swatches */}
                    <div class="flex items-center gap-1 px-1 border-l border-neutral-200 dark:border-neutral-700">
                      {WHITEBOARD_COLORS.map((col) => (
                        <button
                          key={col}
                          type="button"
                          onClick={() => {
                            storeState.setWhiteboardColor(col);
                            if (whiteboardTool === 'cursor' || whiteboardTool === 'eraser') {
                              storeState.setWhiteboardTool('pen');
                            }
                          }}
                          class={`w-3.5 h-3.5 rounded-full transition-transform ${
                            whiteboardColor === col
                              ? 'scale-125 ring-2 ring-neutral-900 dark:ring-white'
                              : 'opacity-75 hover:opacity-100'
                          }`}
                          style={{ backgroundColor: col }}
                          title={`Ink color ${col}`}
                        />
                      ))}
                    </div>

                    {whiteboardStrokes.length > 0 && (
                      <button
                        type="button"
                        onClick={() => storeState.clearWhiteboard()}
                        class="flex items-center gap-1 px-1.5 py-0.5 rounded text-red-600 dark:text-red-400 hover:bg-red-500/10 font-medium"
                        title={t('wb_clear')}
                      >
                        <IconTrash class="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* RIGHT PANE: 3D WebGL2 Loss Surface + 2D Particle Overlay / Specialized ML View */}
        {showRight && (
          <div
            ref={rightContainerRef}
            class={`relative min-h-[260px] h-full overflow-hidden ${
              !showLeft ? 'lg:col-span-2' : ''
            }`}
          >
            <canvas
              ref={rightGlCanvasRef}
              width={Math.round(rightSize.width * dpr)}
              height={Math.round(rightSize.height * dpr)}
              class={`w-full h-full block ${
                graph.rightViewportMode === 'loss_surface' ? '' : 'hidden'
              }`}
            />
            <canvas
              ref={rightOverlayCanvasRef}
              width={Math.round(rightSize.width * dpr)}
              height={Math.round(rightSize.height * dpr)}
              class="absolute inset-0 w-full h-full block cursor-pointer touch-none"
              onPointerDown={(e) => {
                if (graph.rightViewportMode !== 'loss_surface') return;
                const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
                const W = Math.max(rect.width, 1);
                const H = Math.max(rect.height, 1);
                const sx = e.clientX - rect.left;
                const sy = e.clientY - rect.top;
                lastMouseRightRef.current = { x: sx, y: sy };

                if (e.shiftKey) {
                  rightDragModeRef.current = 'orbit';
                  return;
                }

                const { wx, wy } = screenToWorld(sx, sy, graph.rightViewport, W, H);
                if (graph.regularizationKind !== 'none') {
                  const normVal =
                    graph.regularizationKind === 'l1'
                      ? Math.abs(wx) + Math.abs(wy)
                      : Math.hypot(wx, wy);
                  if (Math.abs(normVal - graph.regularizationRadius) < 0.25) {
                    rightDragModeRef.current = 'reg_radius';
                    return;
                  }
                }

                rightDragModeRef.current = 'param';
                updateRightParamsFromWorld(wx, wy);
                storeState.updateOptimizerRace({
                  startW1: wx,
                  startW2: wy,
                  currentStep: graph.optimizerRace.steps,
                  playing: false,
                });
              }}
              onPointerMove={(e) => {
                if (
                  rightDragModeRef.current === 'none' ||
                  graph.rightViewportMode !== 'loss_surface'
                ) {
                  return;
                }
                const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
                const W = Math.max(rect.width, 1);
                const H = Math.max(rect.height, 1);
                const sx = e.clientX - rect.left;
                const sy = e.clientY - rect.top;

                if (rightDragModeRef.current === 'orbit') {
                  const dx = sx - lastMouseRightRef.current.x;
                  const dy = sy - lastMouseRightRef.current.y;
                  lastMouseRightRef.current = { x: sx, y: sy };
                  storeState.setOrbit3D(
                    graph.surface3DOrbitPitch + dy * 0.006,
                    graph.surface3DOrbitYaw + dx * 0.008
                  );
                  return;
                }

                const { wx, wy } = screenToWorld(sx, sy, graph.rightViewport, W, H);
                if (rightDragModeRef.current === 'reg_radius') {
                  const nextRadius =
                    graph.regularizationKind === 'l1'
                      ? Math.abs(wx) + Math.abs(wy)
                      : Math.hypot(wx, wy);
                  storeState.setRegularization(
                    graph.regularizationKind,
                    Math.min(Math.max(nextRadius, 0.2), 4.0)
                  );
                  return;
                }

                updateRightParamsFromWorld(wx, wy);
                storeState.updateOptimizerRace({
                  startW1: wx,
                  startW2: wy,
                  currentStep: graph.optimizerRace.steps,
                  playing: false,
                });
              }}
              onPointerUp={() => {
                rightDragModeRef.current = 'none';
              }}
              onPointerCancel={() => {
                rightDragModeRef.current = 'none';
              }}
            />

            {/* Top-Left Live Train/Test Loss Badges & Compact 3D Options Menu [FR-4.1, FR-4.3] */}
            <div class="absolute top-2 left-2 right-2 flex items-start justify-between gap-1.5 pointer-events-auto text-[11px]">
              <div class="flex flex-wrap items-center gap-1">
                <span class="px-2 py-0.5 rounded bg-white/90 dark:bg-neutral-900/90 border border-neutral-200 dark:border-neutral-800 font-mono font-bold text-orange-600 dark:text-orange-400 shadow-2xs">
                  Loss: {trainLoss.toFixed(4)}
                </span>
                {testLoss > 0 && (
                  <span class="px-2 py-0.5 rounded bg-white/90 dark:bg-neutral-900/90 border border-neutral-200 dark:border-neutral-800 font-mono font-bold text-blue-600 dark:text-blue-400 shadow-2xs">
                    Test: {testLoss.toFixed(4)}
                  </span>
                )}
                {graph.rightViewportMode === 'loss_surface' && (
                  <button
                    type="button"
                    onClick={() =>
                      storeState.setOrbit3D(
                        graph.surface3DOrbitPitch,
                        graph.surface3DOrbitYaw,
                        graph.surface3DZScale > 0.05 ? 0.0 : 0.65
                      )
                    }
                    class="px-2 py-0.5 rounded bg-white/90 dark:bg-neutral-900/90 border border-neutral-300 dark:border-neutral-700 hover:border-orange-500 font-semibold shadow-2xs"
                    title="Toggle 2D Contour vs 3D Surface Projection (Shift+drag to orbit)"
                  >
                    {graph.surface3DZScale > 0.05 ? '3D Orbit' : '2D Contour'}
                  </button>
                )}
              </div>

              {/* Consolidated Right Viewport & 3D Options Popover Menu */}
              <div
                onClick={(e) => e.stopPropagation()}
                class="relative flex flex-col items-end"
              >
                <button
                  type="button"
                  onClick={() => setRightToolsOpen((prev) => !prev)}
                  aria-expanded={rightToolsOpen}
                  class={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-semibold shadow-2xs transition-colors ${
                    rightToolsOpen
                      ? 'bg-orange-500 text-white border-orange-500'
                      : 'bg-white/90 dark:bg-neutral-900/90 border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 hover:border-orange-500'
                  }`}
                  title={t('view3d_options_btn')}
                >
                  <span>⚙️</span>
                  <span class="hidden sm:inline">{t('view3d_options_btn')}</span>
                  <span>{rightToolsOpen ? '▴' : '▾'}</span>
                </button>

                {rightToolsOpen && (
                  <div class="mt-1.5 z-30 w-64 p-2.5 rounded-lg bg-white/95 dark:bg-neutral-900/95 border border-neutral-200 dark:border-neutral-700 shadow-xl flex flex-col gap-2 text-xs">
                    <label class="flex flex-col gap-1">
                      <span class="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                        Right Space Mode
                      </span>
                      <select
                        aria-label="Right Viewport Visualizer Mode"
                        value={graph.rightViewportMode}
                        onChange={(e) =>
                          storeState.setRightViewportMode(
                            (e.target as HTMLSelectElement).value as RightViewportMode
                          )
                        }
                        class="h-7 px-2 rounded bg-neutral-50 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 font-medium"
                      >
                        <option value="loss_surface">{t('right_mode_surface')}</option>
                        <option value="softmax_simplex">{t('right_mode_simplex')}</option>
                        <option value="roc_curve">{t('right_mode_roc')}</option>
                        <option value="svm_feature_3d">{t('right_mode_rbf')}</option>
                        <option value="mlp_grid_warp">{t('right_mode_mlp')}</option>
                      </select>
                    </label>

                    {graph.rightViewportMode === 'loss_surface' && (
                      <>
                        <label class="flex flex-col gap-1">
                          <span class="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                            Objective / Loss Function
                          </span>
                          <select
                            aria-label="Loss Function Type"
                            value={graph.lossKind}
                            onChange={(e) =>
                              storeState.setLossKind(
                                (e.target as HTMLSelectElement).value as LossKind
                              )
                            }
                            class="h-7 px-2 rounded bg-neutral-50 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 font-medium"
                          >
                            <option value="mse">MSE (Quadratic)</option>
                            <option value="mae">MAE (L1 Absolute)</option>
                            <option value="huber">Huber Loss</option>
                            <option value="bce">BCEWithLogits</option>
                            <option value="hinge">Hinge (SVM Margin)</option>
                            <option value="gaussian_nll">Gaussian NLL</option>
                            <option value="kl_div">Forward KL D(P||Q)</option>
                            <option value="reverse_kl_div">Reverse KL D(Q||P)</option>
                            <option value="rastrigin">Rastrigin Non-Convex</option>
                          </select>
                        </label>

                        <label class="flex flex-col gap-1">
                          <span class="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                            Regularization
                          </span>
                          <select
                            aria-label="Regularization Geometry"
                            value={graph.regularizationKind}
                            onChange={(e) =>
                              storeState.setRegularization(
                                (e.target as HTMLSelectElement).value as RegularizationKind
                              )
                            }
                            class="h-7 px-2 rounded bg-neutral-50 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 font-medium"
                          >
                            <option value="none">{t('reg_none')}</option>
                            <option value="l1">{t('reg_l1')}</option>
                            <option value="l2">{t('reg_l2')}</option>
                          </select>
                        </label>

                        <div class="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-neutral-200 dark:border-neutral-800">
                          <label class="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={graph.batchNormEnabled}
                              onChange={(e) =>
                                storeState.setBatchNormEnabled(
                                  (e.target as HTMLInputElement).checked
                                )
                              }
                            />
                            <span>{t('batchnorm_toggle')}</span>
                          </label>

                          <label class="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={graph.showResiduals}
                              onChange={(e) =>
                                storeState.setShowResiduals(
                                  (e.target as HTMLInputElement).checked
                                )
                              }
                            />
                            <span>Residuals r²</span>
                          </label>
                        </div>

                        <div class="flex flex-col gap-1 pt-1 border-t border-neutral-200 dark:border-neutral-800">
                          <span class="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                            3D Surface Parameter Axes ({w1Key}, {w2Key})
                          </span>
                          {paramSliderKeys.length >= 2 && (
                            <div class="grid grid-cols-2 gap-1.5">
                              <select
                                aria-label="Surface Axis 1 Parameter"
                                value={w1Key}
                                onChange={(e) => {
                                  const nextW1 = (e.target as HTMLSelectElement).value;
                                  const nextW2 =
                                    nextW1 === w2Key
                                      ? (paramSliderKeys.find((k) => k !== nextW1) ?? w2Key)
                                      : w2Key;
                                  storeState.setSurfaceParamAxes(nextW1, nextW2);
                                }}
                                class="h-6 px-1.5 rounded bg-neutral-50 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 font-mono text-[11px]"
                              >
                                {paramSliderKeys.map((k) => (
                                  <option key={k} value={k}>
                                    X: {k}
                                  </option>
                                ))}
                              </select>
                              <select
                                aria-label="Surface Axis 2 Parameter"
                                value={w2Key}
                                onChange={(e) => {
                                  const nextW2 = (e.target as HTMLSelectElement).value;
                                  const nextW1 =
                                    nextW2 === w1Key
                                      ? (paramSliderKeys.find((k) => k !== nextW2) ?? w1Key)
                                      : w1Key;
                                  storeState.setSurfaceParamAxes(nextW1, nextW2);
                                }}
                                class="h-6 px-1.5 rounded bg-neutral-50 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 font-mono text-[11px]"
                              >
                                {paramSliderKeys.map((k) => (
                                  <option key={k} value={k}>
                                    Y: {k}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
