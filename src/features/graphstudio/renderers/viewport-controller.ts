/**
 * Viewport Coordinate Transformer, Nice Axis Tick Generator & Spatial Hit-Tester.
 */
import type { CurveRenderPacket, DataPoint2D, Viewport2DBounds } from '../types/state';

export function worldToScreen(
  wx: number,
  wy: number,
  vp: Viewport2DBounds,
  width: number,
  height: number
): { sx: number; sy: number } {
  const sx = ((wx - vp.xMin) / Math.max(vp.xMax - vp.xMin, 1e-9)) * width;
  const sy = height - ((wy - vp.yMin) / Math.max(vp.yMax - vp.yMin, 1e-9)) * height;
  return { sx, sy };
}

export function screenToWorld(
  sx: number,
  sy: number,
  vp: Viewport2DBounds,
  width: number,
  height: number
): { wx: number; wy: number } {
  const wx = vp.xMin + (sx / Math.max(width, 1)) * (vp.xMax - vp.xMin);
  const wy = vp.yMin + ((height - sy) / Math.max(height, 1)) * (vp.yMax - vp.yMin);
  return { wx, wy };
}

/** Rounds a raw step up to the nearest human-friendly 1, 2, 5 * 10^k value */
export function niceStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / mag;
  return residual > 5 ? 10 * mag : residual > 2 ? 5 * mag : residual > 1 ? 2 * mag : mag;
}

/**
 * Computes human-friendly decimal grid ticks (1, 2, 5 * 10^k).
 * Pass `fixedStep` to force a shared step (e.g. both axes under a 1:1 aspect lock).
 */
export function computeNiceTicks(
  min: number,
  max: number,
  targetCount = 8,
  fixedStep?: number
): number[] {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 1e-12) return [min];
  const step =
    fixedStep !== undefined && Number.isFinite(fixedStep) && fixedStep > 0
      ? fixedStep
      : niceStep(span / targetCount);

  const first = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = first; v <= max + 1e-9 * step && ticks.length < 64; v += step) {
    ticks.push(Math.abs(v) < 1e-12 ? 0 : Number(v.toPrecision(10)));
  }
  return ticks;
}

/**
 * Single tick step shared by both axes when 1:1 is locked, targeting roughly
 * `targetPx` screen pixels per major grid cell so cells render as true squares.
 */
export function computeUniformTickStep(
  vp: Viewport2DBounds,
  width: number,
  height: number,
  targetPx = 90
): number {
  const unitsPerPxX = (vp.xMax - vp.xMin) / Math.max(width, 1);
  const unitsPerPxY = (vp.yMax - vp.yMin) / Math.max(height, 1);
  return niceStep(Math.max(unitsPerPxX, unitsPerPxY) * targetPx);
}

/** Relative mismatch between the X and Y pixel scales (0 = perfectly square grid) */
export function viewportAspectError(vp: Viewport2DBounds, width: number, height: number): number {
  const pxPerUnitX = Math.max(width, 1) / Math.max(vp.xMax - vp.xMin, 1e-12);
  const pxPerUnitY = Math.max(height, 1) / Math.max(vp.yMax - vp.yMin, 1e-12);
  return Math.abs(pxPerUnitX - pxPerUnitY) / Math.max(pxPerUnitX, pxPerUnitY);
}

/**
 * Enforces scaleX === scaleY (pixels per world unit) around the current center.
 * The under-sized axis is expanded so the whole previous region stays visible.
 */
export function squareViewport(
  vp: Viewport2DBounds,
  width: number,
  height: number
): Viewport2DBounds {
  const aspect = Math.max(width, 1) / Math.max(height, 1);
  const xMid = (vp.xMin + vp.xMax) * 0.5;
  const yMid = (vp.yMin + vp.yMax) * 0.5;
  let spanX = Math.max(vp.xMax - vp.xMin, 1e-9);
  let spanY = Math.max(vp.yMax - vp.yMin, 1e-9);
  if (spanX / aspect > spanY) {
    spanY = spanX / aspect;
  } else {
    spanX = spanY * aspect;
  }
  return {
    xMin: xMid - spanX * 0.5,
    xMax: xMid + spanX * 0.5,
    yMin: yMid - spanY * 0.5,
    yMax: yMid + spanY * 0.5,
  };
}

export function panViewport(
  vp: Viewport2DBounds,
  dxPx: number,
  dyPx: number,
  width: number,
  height: number
): Viewport2DBounds {
  const dxWorld = (dxPx / Math.max(width, 1)) * (vp.xMax - vp.xMin);
  const dyWorld = (dyPx / Math.max(height, 1)) * (vp.yMax - vp.yMin);
  return {
    xMin: vp.xMin - dxWorld,
    xMax: vp.xMax - dxWorld,
    yMin: vp.yMin + dyWorld,
    yMax: vp.yMax + dyWorld,
  };
}

export function zoomViewportAt(
  vp: Viewport2DBounds,
  factor: number,
  centerSx: number,
  centerSy: number,
  width: number,
  height: number
): Viewport2DBounds {
  const clampedFactor = Math.min(Math.max(factor, 0.2), 5.0);
  const { wx, wy } = screenToWorld(centerSx, centerSy, vp, width, height);
  const newXMin = wx - (wx - vp.xMin) * clampedFactor;
  const newXMax = wx + (vp.xMax - wx) * clampedFactor;
  const newYMin = wy - (wy - vp.yMin) * clampedFactor;
  const newYMax = wy + (vp.yMax - wy) * clampedFactor;

  if (newXMax - newXMin < 1e-4 || newXMax - newXMin > 1e5) return vp;
  return { xMin: newXMin, xMax: newXMax, yMin: newYMin, yMax: newYMax };
}

export function hitTestDataPoint(
  sx: number,
  sy: number,
  points: DataPoint2D[],
  vp: Viewport2DBounds,
  width: number,
  height: number,
  radiusPx = 11
): DataPoint2D | null {
  const rSq = radiusPx * radiusPx;
  for (let i = points.length - 1; i >= 0; i--) {
    const pt = points[i];
    const pScreen = worldToScreen(pt.x, pt.y, vp, width, height);
    const dx = sx - pScreen.sx;
    const dy = sy - pScreen.sy;
    if (dx * dx + dy * dy <= rSq) {
      return pt;
    }
  }
  return null;
}

export interface ChartFocusParams {
  dataPoints?: DataPoint2D[];
  curves?: CurveRenderPacket[];
  fallbackViewport?: Viewport2DBounds;
  lock1to1?: boolean;
  width: number;
  height: number;
}

/**
 * Computes a balanced, centered 2D viewport framing data points and curve features (POIs),
 * preventing users from getting lost when dragging or zooming far from the chart.
 */
export function computeChartFocusViewport(params: ChartFocusParams): Viewport2DBounds {
  const {
    dataPoints = [],
    curves = [],
    fallbackViewport = { xMin: -5, xMax: 5, yMin: -3.5, yMax: 3.5 },
    lock1to1 = true,
    width,
    height,
  } = params;

  const aspect = Math.max(width, 1) / Math.max(height, 1);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  // 1. Data Points bounding box
  for (const pt of dataPoints) {
    if (Number.isFinite(pt.x) && Number.isFinite(pt.y)) {
      minX = Math.min(minX, pt.x);
      maxX = Math.max(maxX, pt.x);
      minY = Math.min(minY, pt.y);
      maxY = Math.max(maxY, pt.y);
    }
  }

  // 2. Visible curve POIs (roots, local extrema, inflection points, piecewise kinks)
  for (const c of curves) {
    if (!c.visible) continue;
    for (const poi of c.pois) {
      if (Number.isFinite(poi.x) && Number.isFinite(poi.y)) {
        minX = Math.min(minX, poi.x);
        maxX = Math.max(maxX, poi.x);
        minY = Math.min(minY, poi.y);
        maxY = Math.max(maxY, poi.y);
      }
    }
  }

  // If features exist: center on them with 35% margin
  if (
    Number.isFinite(minX) &&
    Number.isFinite(maxX) &&
    Number.isFinite(minY) &&
    Number.isFinite(maxY)
  ) {
    const rawSpanX = Math.max(maxX - minX, 1.5);
    const rawSpanY = Math.max(maxY - minY, 1.5);
    const xMid = (minX + maxX) * 0.5;
    const yMid = (minY + maxY) * 0.5;

    let spanX = rawSpanX * 1.35;
    let spanY = rawSpanY * 1.35;

    if (lock1to1) {
      if (spanX / aspect > spanY) {
        spanY = spanX / aspect;
      } else {
        spanX = spanY * aspect;
      }
    }

    return {
      xMin: xMid - spanX * 0.5,
      xMax: xMid + spanX * 0.5,
      yMin: yMid - spanY * 0.5,
      yMax: yMid + spanY * 0.5,
    };
  }

  // 3. Fallback to designated template viewport
  const xMid = (fallbackViewport.xMin + fallbackViewport.xMax) * 0.5;
  const yMid = (fallbackViewport.yMin + fallbackViewport.yMax) * 0.5;
  let spanX = Math.max(fallbackViewport.xMax - fallbackViewport.xMin, 1e-4);
  let spanY = Math.max(fallbackViewport.yMax - fallbackViewport.yMin, 1e-4);

  if (lock1to1) {
    if (spanX / aspect > spanY) {
      spanY = spanX / aspect;
    } else {
      spanX = spanY * aspect;
    }
  }

  return {
    xMin: xMid - spanX * 0.5,
    xMax: xMid + spanX * 0.5,
    yMin: yMid - spanY * 0.5,
    yMax: yMid + spanY * 0.5,
  };
}
