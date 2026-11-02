/**
 * Coordinated Dual-Space Viewport Panel [FR-3.4, FR-4.1, FR-4.3].
 *
 * Left Pane  : 2D Data / Function Space (Interactive curves, POIs, Tangent Probe,
 *              Data Point Dragging, Data Brush, Residual Squares r_i^2).
 * Right Pane : 3D WebGL2 Loss Surface + Hardware fwidth() Contours + 2D Particle Overlay
 *              (or Specialized Phase 5 Canvas for Softmax Simplex, ROC-AUC, 3D RBF, MLP Folding).
 */
import type { JSX, RefObject } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
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
import type { LossKind, RegularizationKind } from '../types/state';
import { t } from '../scripts/i18n-client';

interface DualViewportProps {
  storeState: GraphStoreState;
  isDark: boolean;
  leftCanvasRef: RefObject<HTMLCanvasElement | null>;
  rightGlCanvasRef: RefObject<HTMLCanvasElement | null>;
  rightOverlayCanvasRef: RefObject<HTMLCanvasElement | null>;
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
  } = storeState;

  const glRendererRef = useRef<WebGL2SurfaceRenderer | null>(null);
  const draggingPointIdRef = useRef<string | null>(null);
  const isPanningLeftRef = useRef(false);
  const isBrushingLeftRef = useRef(false);
  const isDraggingProbeLeftRef = useRef(false);
  const lastMouseLeftRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const touchMapLeftRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const prevPinchDistLeftRef = useRef<number | null>(null);

  const rightDragModeRef = useRef<'none' | 'param' | 'orbit' | 'reg_radius'>('none');
  const lastMouseRightRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const paramValues: Record<string, number> = {};
  for (const [k, s] of Object.entries(graph.sliders)) {
    paramValues[k] = s.value;
  }

  // Initialize WebGL2 renderer on rightGlCanvas
  useEffect(() => {
    if (rightGlCanvasRef.current && !glRendererRef.current) {
      glRendererRef.current = new WebGL2SurfaceRenderer(rightGlCanvasRef.current, 128);
    }
  }, [rightGlCanvasRef.current]);

  // Render Left 2D Canvas on every state/worker frame update
  useEffect(() => {
    const canvas = leftCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    renderDataSpaceCanvas2D({
      ctx,
      width: canvas.width,
      height: canvas.height,
      isDark,
      viewport: graph.leftViewport,
      curves,
      dataPoints: graph.dataPoints,
      showResiduals: graph.showResiduals,
      probeX: graph.probeX,
      hoveredDataPointId: graph.hoveredDataPointId,
      activeTemplateId: graph.activeTemplateId,
      paramValues,
    });
  }, [
    isDark,
    graph.leftViewport,
    curves,
    graph.dataPoints,
    graph.showResiduals,
    graph.probeX,
    graph.hoveredDataPointId,
    graph.activeTemplateId,
    JSON.stringify(paramValues),
  ]);

  // Render Right Viewport (WebGL2 3D Loss Surface + 2D Overlay OR Specialized Phase 5 Canvas)
  useEffect(() => {
    const overlay = rightOverlayCanvasRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    const W = overlay.width;
    const H = overlay.height;

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
        W,
        H,
        vectorField,
        graph.rightViewport,
        graph.showVectorField
      );
    }

    const w1 = paramValues['w'] ?? paramValues['w_1'] ?? paramValues['mu'] ?? 1.0;
    const w2 = paramValues['b'] ?? paramValues['w_2'] ?? paramValues['sigma'] ?? 0.0;

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
      linkedBrushPull,
    });
  }, [
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
    JSON.stringify(paramValues),
  ]);

  const showLeft =
    graph.viewMode === 'inference' ||
    (graph.viewMode === 'dual' && (mobileTab === 'data' || mobileTab === 'split'));
  const showRight =
    graph.viewMode === 'optimization' ||
    (graph.viewMode === 'dual' && (mobileTab === 'loss' || mobileTab === 'split'));

  const updateRightParamsFromWorld = (wx: number, wy: number): void => {
    if (graph.sliders['w']) storeState.setSliderValue('w', wx);
    else if (graph.sliders['w_1']) storeState.setSliderValue('w_1', wx);
    else if (graph.sliders['mu']) storeState.setSliderValue('mu', wx);

    if (graph.sliders['b']) storeState.setSliderValue('b', wy);
    else if (graph.sliders['w_2']) storeState.setSliderValue('w_2', wy);
    else if (graph.sliders['sigma']) storeState.setSliderValue('sigma', Math.max(0.1, wy));
  };

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
        {/* LEFT PANE: 2D Data / Function Space */}
        {showLeft && (
          <div
            class={`relative min-h-[260px] h-full border-b lg:border-b-0 lg:border-r border-neutral-200 dark:border-neutral-800 overflow-hidden ${
              !showRight ? 'lg:col-span-2' : ''
            }`}
          >
            <canvas
              ref={leftCanvasRef}
              width={720}
              height={520}
              class="w-full h-full block cursor-crosshair touch-none"
              onPointerDown={(e) => {
                const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
                const sx = ((e.clientX - rect.left) / rect.width) * 720;
                const sy = ((e.clientY - rect.top) / rect.height) * 520;

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

                if (brushActive) {
                  isBrushingLeftRef.current = true;
                  lastMouseLeftRef.current = { x: sx, y: sy };
                  const { wx, wy } = screenToWorld(sx, sy, graph.leftViewport, 720, 520);
                  storeState.addDataPoint({ x: wx, y: wy, split: 'train' });
                  return;
                }

                const hit = hitTestDataPoint(
                  sx,
                  sy,
                  graph.dataPoints,
                  graph.leftViewport,
                  720,
                  520
                );
                if (hit) {
                  draggingPointIdRef.current = hit.id;
                  storeState.setHoveredDataPoint(hit.id);
                  return;
                }

                const { wx } = screenToWorld(sx, sy, graph.leftViewport, 720, 520);
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
                const sx = ((e.clientX - rect.left) / rect.width) * 720;
                const sy = ((e.clientY - rect.top) / rect.height) * 520;

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
                      zoomViewportAt(graph.leftViewport, factor, midX, midY, 720, 520)
                    );
                  }
                  prevPinchDistLeftRef.current = dist;
                  return;
                }

                if (isBrushingLeftRef.current && brushActive) {
                  const distPx = Math.hypot(
                    sx - lastMouseLeftRef.current.x,
                    sy - lastMouseLeftRef.current.y
                  );
                  if (distPx >= 16) {
                    lastMouseLeftRef.current = { x: sx, y: sy };
                    const { wx, wy } = screenToWorld(sx, sy, graph.leftViewport, 720, 520);
                    storeState.addDataPoint({ x: wx, y: wy, split: 'train' });
                  }
                  return;
                }

                if (isDraggingProbeLeftRef.current) {
                  const { wx } = screenToWorld(sx, sy, graph.leftViewport, 720, 520);
                  storeState.setProbeX(wx);
                  return;
                }

                if (draggingPointIdRef.current) {
                  const { wx, wy } = screenToWorld(sx, sy, graph.leftViewport, 720, 520);
                  storeState.updateDataPoint(draggingPointIdRef.current, wx, wy);
                  return;
                }

                if (isPanningLeftRef.current) {
                  const dx = sx - lastMouseLeftRef.current.x;
                  const dy = sy - lastMouseLeftRef.current.y;
                  lastMouseLeftRef.current = { x: sx, y: sy };
                  storeState.setLeftViewport(
                    panViewport(graph.leftViewport, dx, dy, 720, 520)
                  );
                  return;
                }

                const hit = hitTestDataPoint(
                  sx,
                  sy,
                  graph.dataPoints,
                  graph.leftViewport,
                  720,
                  520
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
                draggingPointIdRef.current = null;
                isPanningLeftRef.current = false;
                isBrushingLeftRef.current = false;
                isDraggingProbeLeftRef.current = false;
              }}
              onWheel={(e) => {
                e.preventDefault();
                const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
                const sx = ((e.clientX - rect.left) / rect.width) * 720;
                const sy = ((e.clientY - rect.top) / rect.height) * 520;
                const factor = e.deltaY > 0 ? 1.1 : 0.9;
                storeState.setLeftViewport(
                  zoomViewportAt(graph.leftViewport, factor, sx, sy, 720, 520)
                );
              }}
            />

            {/* Top-Left Overlay Controls: Tangent Probe & Residuals Toggle */}
            <div class="absolute top-2.5 left-2.5 flex flex-wrap items-center gap-1.5 pointer-events-auto text-[11px]">
              <span class="px-2 py-0.5 rounded bg-white/90 dark:bg-neutral-900/90 border border-neutral-200 dark:border-neutral-800 font-semibold">
                {t('tab_data')}
              </span>
              <button
                type="button"
                onClick={() =>
                  storeState.setProbeX(graph.probeX === null ? 0.0 : null)
                }
                class={`px-2 py-0.5 rounded border font-medium ${
                  graph.probeX !== null
                    ? 'bg-orange-500 text-white border-orange-500'
                    : 'bg-white/90 dark:bg-neutral-900/90 border-neutral-300 dark:border-neutral-700'
                }`}
              >
                Tangent Probe {graph.probeX !== null ? `x₀=${graph.probeX.toFixed(2)}` : 'OFF'}
              </button>
            </div>
          </div>
        )}

        {/* RIGHT PANE: 3D WebGL2 Loss Surface + 2D Particle Overlay / Specialized ML View */}
        {showRight && (
          <div
            class={`relative min-h-[260px] h-full overflow-hidden ${
              !showLeft ? 'lg:col-span-2' : ''
            }`}
          >
            <canvas
              ref={rightGlCanvasRef}
              width={720}
              height={520}
              class={`w-full h-full block ${
                graph.rightViewportMode === 'loss_surface' ? '' : 'hidden'
              }`}
            />
            <canvas
              ref={rightOverlayCanvasRef}
              width={720}
              height={520}
              class="absolute inset-0 w-full h-full block cursor-pointer touch-none"
              onPointerDown={(e) => {
                if (graph.rightViewportMode !== 'loss_surface') return;
                const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
                const sx = ((e.clientX - rect.left) / rect.width) * 720;
                const sy = ((e.clientY - rect.top) / rect.height) * 520;
                lastMouseRightRef.current = { x: sx, y: sy };

                if (e.shiftKey) {
                  rightDragModeRef.current = 'orbit';
                  return;
                }

                const { wx, wy } = screenToWorld(sx, sy, graph.rightViewport, 720, 520);
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
                storeState.updateOptimizerRace({ startW1: wx, startW2: wy, currentStep: 60 });
              }}
              onPointerMove={(e) => {
                if (
                  rightDragModeRef.current === 'none' ||
                  graph.rightViewportMode !== 'loss_surface'
                ) {
                  return;
                }
                const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
                const sx = ((e.clientX - rect.left) / rect.width) * 720;
                const sy = ((e.clientY - rect.top) / rect.height) * 520;

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

                const { wx, wy } = screenToWorld(sx, sy, graph.rightViewport, 720, 520);
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
              }}
              onPointerUp={() => {
                rightDragModeRef.current = 'none';
              }}
            />

            {/* Top-Left Live Train/Test Loss Badges & Landscape Controls [FR-4.1, FR-4.3] */}
            <div class="absolute top-2.5 left-2.5 right-2.5 flex flex-wrap items-center justify-between gap-1.5 pointer-events-auto text-[11px]">
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="px-2 py-0.5 rounded bg-white/90 dark:bg-neutral-900/90 border border-neutral-200 dark:border-neutral-800 font-mono font-bold text-orange-600 dark:text-orange-400">
                  Train Loss: {trainLoss.toFixed(4)}
                </span>
                {testLoss > 0 && (
                  <span class="px-2 py-0.5 rounded bg-white/90 dark:bg-neutral-900/90 border border-neutral-200 dark:border-neutral-800 font-mono font-bold text-blue-600 dark:text-blue-400">
                    Test Loss: {testLoss.toFixed(4)}
                  </span>
                )}
              </div>

              {graph.rightViewportMode === 'loss_surface' && (
                <div class="flex flex-wrap items-center gap-1">
                  <select
                    aria-label="Loss Function Type"
                    value={graph.lossKind}
                    onChange={(e) =>
                      storeState.setLossKind((e.target as HTMLSelectElement).value as LossKind)
                    }
                    class="h-6 px-1.5 rounded bg-white/90 dark:bg-neutral-900/90 border border-neutral-300 dark:border-neutral-700 font-medium"
                  >
                    <option value="mse">MSE</option>
                    <option value="mae">MAE</option>
                    <option value="huber">Huber</option>
                    <option value="bce">BCEWithLogits</option>
                    <option value="hinge">Hinge (SVM)</option>
                    <option value="gaussian_nll">Gaussian NLL</option>
                    <option value="kl_div">Forward KL D(P||Q)</option>
                    <option value="reverse_kl_div">Reverse KL D(Q||P)</option>
                    <option value="rastrigin">Rastrigin Non-Convex</option>
                  </select>

                  <select
                    aria-label="Regularization Geometry"
                    value={graph.regularizationKind}
                    onChange={(e) =>
                      storeState.setRegularization(
                        (e.target as HTMLSelectElement).value as RegularizationKind
                      )
                    }
                    class="h-6 px-1.5 rounded bg-white/90 dark:bg-neutral-900/90 border border-neutral-300 dark:border-neutral-700 font-medium"
                  >
                    <option value="none">{t('reg_none')}</option>
                    <option value="l1">{t('reg_l1')}</option>
                    <option value="l2">{t('reg_l2')}</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => storeState.setBatchNormEnabled(!graph.batchNormEnabled)}
                    class={`h-6 px-2 rounded border font-semibold ${
                      graph.batchNormEnabled
                        ? 'bg-orange-500 text-white border-orange-500'
                        : 'bg-white/90 dark:bg-neutral-900/90 border-neutral-300 dark:border-neutral-700'
                    }`}
                  >
                    {t('batchnorm_toggle')}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      storeState.setOrbit3D(
                        graph.surface3DOrbitPitch,
                        graph.surface3DOrbitYaw,
                        graph.surface3DZScale > 0.05 ? 0.0 : 0.65
                      )
                    }
                    class="h-6 px-2 rounded bg-white/90 dark:bg-neutral-900/90 border border-neutral-300 dark:border-neutral-700 font-semibold"
                    title="Toggle 2D Contour vs 3D Surface Projection (Shift+drag to orbit)"
                  >
                    {graph.surface3DZScale > 0.05 ? '3D Orbit' : '2D Contour'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
