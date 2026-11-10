/**
 * High-FPS 2D Data/Function Canvas Renderer [FR-2.2, FR-3.1..3.3, FR-4.3, NFR-4].
 *
 * Implements Perceptual Opacity Layering [NFR-4]:
 * - Background coordinate grid : opacity 0.15
 * - Contextual overlays (residual squares r_i^2, subdifferential fan, derivatives) : opacity 0.25-0.35
 * - Primary curves, POIs & data points : opacity 1.0
 */
import type {
  CurveLineStyle,
  CurveRenderPacket,
  DataPoint2D,
  LossKind,
  RightViewportMode,
  Viewport2DBounds,
  WhiteboardStroke,
} from '../types/state';
import { computeNiceTicks, computeUniformTickStep, worldToScreen } from './viewport-controller';

export function resolveCurveDashPattern(
  lineStyle?: CurveLineStyle,
  lineWidth = 2.6
): number[] {
  if (lineStyle === 'dashed') {
    return lineWidth > 3.2 ? [10, 6] : [7, 5];
  }
  if (lineStyle === 'dotted') {
    return lineWidth > 3.2 ? [2.5, 6] : [2, 5];
  }
  return [];
}

export interface Canvas2DRenderParams {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  isDark: boolean;
  viewport: Viewport2DBounds;
  curves: CurveRenderPacket[];
  dataPoints: DataPoint2D[];
  showResiduals: boolean;
  probeX: number | null;
  hoveredDataPointId: string | null;
  activeTemplateId: string;
  lossKind?: LossKind;
  rightViewportMode?: RightViewportMode;
  paramValues?: Record<string, number>;
  whiteboardStrokes?: WhiteboardStroke[];
  fitLossExprId?: string;
  /** 1:1 aspect lock: both axes share one tick step so grid cells are squares */
  lock1to1?: boolean;
}

export function renderDataSpaceCanvas2D(p: Canvas2DRenderParams): void {
  const {
    ctx,
    width,
    height,
    isDark,
    viewport,
    curves,
    dataPoints,
    showResiduals,
    probeX,
    hoveredDataPointId,
    activeTemplateId,
    lossKind,
    rightViewportMode,
    paramValues = {},
    whiteboardStrokes = [],
    fitLossExprId,
    lock1to1 = false,
  } = p;

  const scaleX = ctx.canvas ? ctx.canvas.width / Math.max(width, 1) : 1;
  const scaleY = ctx.canvas ? ctx.canvas.height / Math.max(height, 1) : 1;
  ctx.save();
  ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);

  // 1. Background Fill (Pure Titanium #FAFAFA / #171717)
  ctx.fillStyle = isDark ? '#171717' : '#fafafa';
  ctx.fillRect(0, 0, width, height);

  // 2. Adaptive Coordinate Grid (opacity 0.15 [NFR-4])
  const sharedStep = lock1to1 ? computeUniformTickStep(viewport, width, height) : undefined;
  const xTicks = computeNiceTicks(viewport.xMin, viewport.xMax, 8, sharedStep);
  const yTicks = computeNiceTicks(viewport.yMin, viewport.yMax, 6, sharedStep);

  ctx.save();
  // Minor subdivisions (Desmos/GeoGebra style 5-subdivision grid)
  if (xTicks.length >= 2 && yTicks.length >= 2) {
    const dxSub = (xTicks[1] - xTicks[0]) / 5;
    const dySub = (yTicks[1] - yTicks[0]) / 5;
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.045)' : 'rgba(23, 23, 23, 0.04)';
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    if (dxSub > 0) {
      const startX = Math.floor(viewport.xMin / dxSub) * dxSub;
      for (let gx = startX; gx <= viewport.xMax; gx += dxSub) {
        const { sx } = worldToScreen(gx, 0, viewport, width, height);
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, height);
      }
    }
    if (dySub > 0) {
      const startY = Math.floor(viewport.yMin / dySub) * dySub;
      for (let gy = startY; gy <= viewport.yMax; gy += dySub) {
        const { sy } = worldToScreen(0, gy, viewport, width, height);
        ctx.moveTo(0, sy);
        ctx.lineTo(width, sy);
      }
    }
    ctx.stroke();
  }

  ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(23, 23, 23, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const tx of xTicks) {
    const { sx } = worldToScreen(tx, 0, viewport, width, height);
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, height);
  }
  for (const ty of yTicks) {
    const { sy } = worldToScreen(0, ty, viewport, width, height);
    ctx.moveTo(0, sy);
    ctx.lineTo(width, sy);
  }
  ctx.stroke();

  // Principal Axes (x = 0, y = 0)
  ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.35)' : 'rgba(23, 23, 23, 0.32)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const origin = worldToScreen(0, 0, viewport, width, height);
  if (origin.sx >= 0 && origin.sx <= width) {
    ctx.moveTo(origin.sx, 0);
    ctx.lineTo(origin.sx, height);
  }
  if (origin.sy >= 0 && origin.sy <= height) {
    ctx.moveTo(0, origin.sy);
    ctx.lineTo(width, origin.sy);
  }
  ctx.stroke();

  // Axis Tick Labels
  ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.65)' : 'rgba(23, 23, 23, 0.62)';
  ctx.font = '500 11px Inter, system-ui, sans-serif';
  const labelY = Math.min(Math.max(origin.sy + 14, 18), height - 8);
  ctx.textAlign = 'center';
  for (const tx of xTicks) {
    if (tx === 0) continue;
    const { sx } = worldToScreen(tx, 0, viewport, width, height);
    if (sx < 22 || sx > width - 22) continue;
    ctx.fillText(String(tx), sx, labelY);
  }
  ctx.textAlign = 'left';
  const labelX = Math.min(Math.max(origin.sx + 6, 6), width - 34);
  for (const ty of yTicks) {
    if (ty === 0) continue;
    const { sy } = worldToScreen(0, ty, viewport, width, height);
    if (sy < 22 || sy > height - 16) continue;
    ctx.fillText(String(ty), labelX, sy + 4);
  }
  ctx.restore();

  // Helper to evaluate interpolated y on active fitLoss or primary curve at world x
  const primaryCurve =
    (fitLossExprId
      ? curves.find((c) => c.exprId === fitLossExprId && c.primaryPoints.length >= 4)
      : undefined) ??
    curves.find((c) => c.visible && c.primaryPoints.length >= 4) ??
    curves.find((c) => c.primaryPoints.length >= 4);
  const evalCurveAtX = (wx: number): { y: number; slope: number } | null => {
    if (!primaryCurve) return null;
    const pts = primaryCurve.primaryPoints;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const x0 = pts[i];
      const y0 = pts[i + 1];
      const x1 = pts[i + 2];
      const y1 = pts[i + 3];
      if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) {
        continue;
      }
      if ((wx >= x0 && wx <= x1) || (wx >= x1 && wx <= x0)) {
        const dx = x1 - x0;
        const t = Math.abs(dx) > 1e-12 ? (wx - x0) / dx : 0.0;
        return {
          y: y0 + t * (y1 - y0),
          slope: Math.abs(dx) > 1e-12 ? (y1 - y0) / dx : 0.0,
        };
      }
    }
    return null;
  };

  // 3. Residual Squares r_i^2 (opacity 0.25) or Gaussian MLE Drop-Lines (T-07) [FR-4.3]
  if (showResiduals && primaryCurve && dataPoints.length > 0) {
    ctx.save();
    for (const pt of dataPoints) {
      const evalRes = evalCurveAtX(pt.x);
      if (!evalRes) continue;
      const pData = worldToScreen(pt.x, pt.y, viewport, width, height);
      const pPred = worldToScreen(pt.x, evalRes.y, viewport, width, height);

      if (activeTemplateId === 'T-07' || lossKind === 'gaussian_nll') {
        // Gaussian MLE dashed density drop-line from axis to PDF curve
        ctx.strokeStyle = 'rgba(249, 115, 22, 0.65)';
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(pData.sx, pData.sy);
        ctx.lineTo(pPred.sx, pPred.sy);
        ctx.stroke();
      } else {
        // Residual error square r_i^2 with opacity 0.25 [FR-4.3, NFR-4]
        const sidePx = Math.abs(pPred.sy - pData.sy);
        const topY = Math.min(pData.sy, pPred.sy);
        if (sidePx > 1 && sidePx < width) {
          ctx.fillStyle = 'rgba(249, 115, 22, 0.22)';
          ctx.fillRect(pData.sx, topY, sidePx, sidePx);
          ctx.strokeStyle = 'rgba(249, 115, 22, 0.48)';
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(pData.sx, pData.sy);
          ctx.lineTo(pPred.sx, pPred.sy);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // 4. Render Curves: f''(x) (dash-dot), f'(x) (dashed), and primary f(x) (solid)
  for (const c of curves) {
    if (!c.visible) continue;

    if (c.secondDerivPoints && c.secondDerivPoints.length >= 4) {
      drawPolylineWithBreaks(ctx, c.secondDerivPoints, viewport, width, height, {
        color: c.color,
        lineWidth: 1.5,
        dash: [6, 3, 2, 3],
        opacity: 0.45,
      });
    }

    if (c.firstDerivPoints && c.firstDerivPoints.length >= 4) {
      drawPolylineWithBreaks(ctx, c.firstDerivPoints, viewport, width, height, {
        color: c.color,
        lineWidth: 1.8,
        dash: [6, 4],
        opacity: 0.68,
      });
    }

    if (c.primaryPoints.length >= 4) {
      const primaryLineWidth =
        c.lineWidth && Number.isFinite(c.lineWidth) && c.lineWidth > 0 ? c.lineWidth : 2.6;
      drawPolylineWithBreaks(ctx, c.primaryPoints, viewport, width, height, {
        color: c.color,
        lineWidth: primaryLineWidth,
        dash: resolveCurveDashPattern(c.lineStyle, primaryLineWidth),
        opacity: 1.0,
      });
    }
  }

  // 4b. Render Curve Name Labels along visible primary curves
  const placedLabels: { x: number; y: number }[] = [];
  for (let cIdx = 0; cIdx < curves.length; cIdx++) {
    const c = curves[cIdx];
    if (!c.visible || !c.label || c.primaryPoints.length < 4) continue;
    const pts = c.primaryPoints;
    const targetFrac = Math.min(0.76, Math.max(0.24, 0.72 - cIdx * 0.14));
    const startIdx = Math.floor((pts.length / 2) * targetFrac) * 2;
    let anchor: { sx: number; sy: number } | null = null;

    for (let offset = 0; offset < pts.length; offset += 4) {
      const idx = (startIdx + offset) % pts.length;
      const wx = pts[idx];
      const wy = pts[idx + 1];
      if (!Number.isFinite(wx) || !Number.isFinite(wy)) continue;
      const { sx, sy } = worldToScreen(wx, wy, viewport, width, height);
      if (sx >= 36 && sx <= width - 80 && sy >= 44 && sy <= height - 24) {
        const overlaps = placedLabels.some((p) => Math.hypot(p.x - sx, p.y - sy) < 28);
        if (!overlaps) {
          anchor = { sx, sy };
          break;
        }
      }
    }

    if (anchor) {
      placedLabels.push({ x: anchor.sx, y: anchor.sy });
      ctx.save();
      ctx.font = '600 11px Inter, system-ui, sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = isDark ? 'rgba(23, 23, 23, 0.88)' : 'rgba(250, 250, 250, 0.92)';
      ctx.fillStyle = c.color;
      const lx = anchor.sx + 6;
      const ly = anchor.sy - 8;
      ctx.strokeText(c.label, lx, ly);
      ctx.fillText(c.label, lx, ly);
      ctx.restore();
    }
  }

  // 5. Render Points of Interest (POIs) & Subdifferential Fan at Piecewise Kinks [FR-2.2, FR-3.3]
  for (const c of curves) {
    if (!c.visible) continue;
    for (const poi of c.pois) {
      const { sx, sy } = worldToScreen(poi.x, poi.y, viewport, width, height);
      if (sx < -10 || sx > width + 10 || sy < -10 || sy > height + 10) continue;

      if (poi.kind === 'kink' && poi.subdiffInterval) {
        drawSubdifferentialFan(ctx, poi.x, poi.y, poi.subdiffInterval, viewport, width, height);
      }

      ctx.save();
      ctx.beginPath();
      ctx.arc(sx, sy, poi.kind === 'kink' ? 5.5 : 4.2, 0, Math.PI * 2);
      ctx.fillStyle =
        poi.kind === 'kink'
          ? '#f97316'
          : poi.kind === 'extremum'
            ? '#3b82f6'
            : poi.kind === 'root'
              ? '#10b981'
              : '#a855f7';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = isDark ? '#171717' : '#ffffff';
      ctx.stroke();
      ctx.restore();
    }
  }

  // 6. Dynamic Tangent Line & Slope Triangle at Probe x0 [FR-2.2]
  if (probeX !== null && primaryCurve) {
    const probeEval = evalCurveAtX(probeX);
    if (probeEval) {
      const { y: y0, slope } = probeEval;
      const p0 = worldToScreen(probeX, y0, viewport, width, height);
      const dxWorld = (viewport.xMax - viewport.xMin) * 0.12;
      const pLeft = worldToScreen(probeX - dxWorld, y0 - slope * dxWorld, viewport, width, height);
      const pRight = worldToScreen(probeX + dxWorld, y0 + slope * dxWorld, viewport, width, height);
      const pCorner = worldToScreen(probeX + dxWorld, y0, viewport, width, height);

      ctx.save();
      // Slope right-triangle
      ctx.fillStyle = 'rgba(249, 115, 22, 0.18)';
      ctx.beginPath();
      ctx.moveTo(p0.sx, p0.sy);
      ctx.lineTo(pCorner.sx, pCorner.sy);
      ctx.lineTo(pRight.sx, pRight.sy);
      ctx.closePath();
      ctx.fill();

      // Tangent line
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pLeft.sx, pLeft.sy);
      ctx.lineTo(pRight.sx, pRight.sy);
      ctx.stroke();

      // Probe dot
      ctx.beginPath();
      ctx.arc(p0.sx, p0.sy, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = '#f97316';
      ctx.fill();
      ctx.fillStyle = isDark ? '#f5f5f5' : '#171717';
      ctx.font = '600 11px Inter, system-ui, sans-serif';
      const pVar = primaryCurve.primaryVar ?? 'x';
      const dVar =
        pVar === 'theta'
          ? 'θ'
          : pVar === 'phi'
          ? 'φ'
          : pVar === 'psi'
          ? 'ψ'
          : pVar === 'omega'
          ? 'ω'
          : pVar === 'mu'
          ? 'μ'
          : pVar === 'lambda'
          ? 'λ'
          : pVar === 'eta'
          ? 'η'
          : pVar === 'alpha'
          ? 'α'
          : pVar === 'beta'
          ? 'β'
          : pVar === 'gamma'
          ? 'γ'
          : pVar;
      ctx.fillText(`dy/d${dVar} = ${slope.toFixed(3)}`, p0.sx + 9, p0.sy - 8);
      ctx.restore();
    }
  }

  // 7. Interactive Data Points (Train = solid circle, Test = hollow circle) [FR-4.3]
  for (const pt of dataPoints) {
    const { sx, sy } = worldToScreen(pt.x, pt.y, viewport, width, height);
    const isHovered = pt.id === hoveredDataPointId;
    const isClassZero = pt.label !== undefined && pt.label <= 0;
    const color = pt.label !== undefined ? (isClassZero ? '#3b82f6' : '#f97316') : '#f97316';

    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, isHovered ? 7.5 : 5.5, 0, Math.PI * 2);
    if (pt.split === 'train') {
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = isHovered ? 2.5 : 1.5;
      ctx.strokeStyle = isDark ? '#171717' : '#ffffff';
      ctx.stroke();
    } else {
      ctx.fillStyle = isDark ? '#171717' : '#fafafa';
      ctx.fill();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = color;
      ctx.stroke();
    }
    ctx.restore();
  }

  // 8. Specialized 2D Decision Boundaries for Logistic Line (ROC) & RBF Circle (3D Kernel)
  if (activeTemplateId === 'T-13' || rightViewportMode === 'roc_curve') {
    const w1 = paramValues['w_1'] ?? paramValues['w'] ?? 1.4;
    const w2 = paramValues['w_2'] ?? 1.1;
    const b = paramValues['b'] ?? -0.2;
    const tau = Math.min(Math.max(paramValues['tau'] ?? 0.5, 0.01), 0.99);
    const logitTau = Math.log(tau / (1.0 - tau));
    if (Math.abs(w2) > 1e-4) {
      const yAtMin = (logitTau - b - w1 * viewport.xMin) / w2;
      const yAtMax = (logitTau - b - w1 * viewport.xMax) / w2;
      const pA = worldToScreen(viewport.xMin, yAtMin, viewport, width, height);
      const pB = worldToScreen(viewport.xMax, yAtMax, viewport, width, height);
      ctx.save();
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2.2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(pA.sx, pA.sy);
      ctx.lineTo(pB.sx, pB.sy);
      ctx.stroke();
      ctx.restore();
    }
  } else if (activeTemplateId === 'T-14' || rightViewportMode === 'svm_feature_3d') {
    const gamma = Math.max(paramValues['gamma'] ?? 0.6, 0.05);
    const tau = Math.min(Math.max(paramValues['tau'] ?? 0.45, 0.02), 0.98);
    const rSq = -Math.log(tau) / gamma;
    if (rSq > 0) {
      const rWorld = Math.sqrt(rSq);
      const c0 = worldToScreen(0, 0, viewport, width, height);
      const cEdge = worldToScreen(rWorld, rWorld, viewport, width, height);
      const rx = Math.abs(cEdge.sx - c0.sx);
      const ry = Math.abs(cEdge.sy - c0.sy);
      ctx.save();
      ctx.strokeStyle = '#3b82f6';
      ctx.fillStyle = 'rgba(59, 130, 246, 0.12)';
      ctx.lineWidth = 2.2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.ellipse(c0.sx, c0.sy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  // 9. Freehand Whiteboard Annotations (Pen & Highlighter in World Coordinates)
  if (whiteboardStrokes.length > 0) {
    for (const stroke of whiteboardStrokes) {
      if (stroke.points.length === 0) continue;
      ctx.save();
      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = stroke.tool === 'highlighter' ? 0.34 : 0.95;

      if (stroke.points.length === 1) {
        const { sx, sy } = worldToScreen(
          stroke.points[0].x,
          stroke.points[0].y,
          viewport,
          width,
          height
        );
        ctx.beginPath();
        ctx.arc(sx, sy, stroke.width * 0.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        for (let i = 0; i < stroke.points.length; i++) {
          const { sx, sy } = worldToScreen(
            stroke.points[i].x,
            stroke.points[i].y,
            viewport,
            width,
            height
          );
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  ctx.restore();
}

function drawPolylineWithBreaks(
  ctx: CanvasRenderingContext2D,
  pts: Float64Array,
  vp: Viewport2DBounds,
  width: number,
  height: number,
  style: { color: string; lineWidth: number; dash: number[]; opacity: number }
): void {
  ctx.save();
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.lineWidth;
  ctx.globalAlpha = style.opacity;
  ctx.setLineDash(style.dash);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  let penDown = false;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const wx = pts[i];
    const wy = pts[i + 1];
    if (!Number.isFinite(wx) || !Number.isFinite(wy)) {
      penDown = false;
      continue;
    }
    const { sx, sy } = worldToScreen(wx, wy, vp, width, height);
    if (sy < -height * 2 || sy > height * 3) {
      penDown = false;
      continue;
    }
    if (!penDown) {
      ctx.moveTo(sx, sy);
      penDown = true;
    } else {
      ctx.lineTo(sx, sy);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function drawSubdifferentialFan(
  ctx: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  interval: [number, number],
  vp: Viewport2DBounds,
  width: number,
  height: number
): void {
  const [mMin, mMax] = interval;
  if (Math.abs(mMax - mMin) < 1e-4) return;
  const center = worldToScreen(wx, wy, vp, width, height);
  const dx = (vp.xMax - vp.xMin) * 0.14;
  const pMinR = worldToScreen(wx + dx, wy + mMin * dx, vp, width, height);
  const pMaxR = worldToScreen(wx + dx, wy + mMax * dx, vp, width, height);
  const pMinL = worldToScreen(wx - dx, wy - mMin * dx, vp, width, height);
  const pMaxL = worldToScreen(wx - dx, wy - mMax * dx, vp, width, height);

  ctx.save();
  ctx.fillStyle = 'rgba(249, 115, 22, 0.28)';
  ctx.beginPath();
  ctx.moveTo(center.sx, center.sy);
  ctx.lineTo(pMinR.sx, pMinR.sy);
  ctx.lineTo(pMaxR.sx, pMaxR.sy);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(center.sx, center.sy);
  ctx.lineTo(pMinL.sx, pMinL.sy);
  ctx.lineTo(pMaxL.sx, pMaxL.sy);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
