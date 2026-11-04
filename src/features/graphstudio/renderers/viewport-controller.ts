/**
 * Viewport Coordinate Transformer, Nice Axis Tick Generator & Spatial Hit-Tester.
 */
import type { DataPoint2D, Viewport2DBounds } from '../types/state';

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

/** Computes human-friendly decimal grid ticks (1, 2, 5 * 10^k) */
export function computeNiceTicks(min: number, max: number, targetCount = 8): number[] {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 1e-12) return [min];
  const rawStep = span / targetCount;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / mag;
  const step = residual > 5 ? 10 * mag : residual > 2 ? 5 * mag : residual > 1 ? 2 * mag : mag;

  const first = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = first; v <= max + 1e-9 * step && ticks.length < 32; v += step) {
    ticks.push(Math.abs(v) < 1e-12 ? 0 : Number(v.toPrecision(10)));
  }
  return ticks;
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
