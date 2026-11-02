/**
 * Specialized Right-Viewport Canvas Renderers for Phase 5 Multivariate ML Templates:
 * - `softmax_simplex` (T-03): Barycentric 2-Simplex Triangle + 3-Logit Probability Bars
 * - `roc_curve`       (T-13): ROC Curve, Shaded AUC Area & Live Confusion Matrix
 * - `svm_feature_3d`  (T-14): 3D RBF Feature Hill \phi(x) = exp(-\gamma||x||^2) + Separating Plane
 * - `mlp_grid_warp`   (T-15): Homotopy Space Folding Grid Morphing (XOR Linear Separability)
 */
import type { DataPoint2D } from '../types/state';
import {
  computeRbfLift3D,
  computeRocAndConfusionMatrix,
  computeSoftmaxSimplexPoint,
  warpMlpHomotopyPoint,
} from '../core/simulation/special-kernels';

export function renderSoftmaxSimplexCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  isDark: boolean,
  params: Record<string, number>
): void {
  ctx.fillStyle = isDark ? '#171717' : '#fafafa';
  ctx.fillRect(0, 0, width, height);

  const z1 = params['z_1'] ?? 1.4;
  const z2 = params['z_2'] ?? 0.3;
  const z3 = params['z_3'] ?? -0.8;
  const tau = params['tau'] ?? 0.5;
  const { p1, p2, p3, entropy, simplexX, simplexY } = computeSoftmaxSimplexPoint(z1, z2, z3, tau);

  const cx = width * 0.5;
  const cy = height * 0.52;
  const scale = Math.min(width, height) * 0.36;

  const v1 = { x: cx, y: cy - 0.85 * scale };
  const v2 = { x: cx - 0.85 * scale, y: cy + 0.65 * scale };
  const v3 = { x: cx + 0.85 * scale, y: cy + 0.65 * scale };

  ctx.save();
  ctx.fillStyle = isDark ? 'rgba(249, 115, 22, 0.12)' : 'rgba(249, 115, 22, 0.08)';
  ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.35)' : 'rgba(23, 23, 23, 0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(v1.x, v1.y);
  ctx.lineTo(v2.x, v2.y);
  ctx.lineTo(v3.x, v3.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Active probability barycentric point
  const px = cx + simplexX * scale;
  const py = cy - simplexY * scale;

  ctx.beginPath();
  ctx.arc(px, py, 7, 0, Math.PI * 2);
  ctx.fillStyle = '#f97316';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  ctx.fillStyle = isDark ? '#f5f5f5' : '#171717';
  ctx.font = '600 12px Inter, system-ui, sans-serif';
  ctx.fillText(`p₁ = ${p1.toFixed(3)}`, v1.x - 28, v1.y - 10);
  ctx.fillText(`p₂ = ${p2.toFixed(3)}`, v2.x - 16, v2.y + 18);
  ctx.fillText(`p₃ = ${p3.toFixed(3)}`, v3.x - 42, v3.y + 18);
  ctx.fillText(`Temperature τ = ${tau.toFixed(3)}  |  Entropy H(p) = ${entropy.toFixed(3)} nats`, 16, 26);

  // 3-Logit / Probability Bars in bottom-left corner [FR-4.4, T-03]
  const bars = [
    { label: `p₁ (z₁=${z1.toFixed(1)})`, prob: p1, color: '#f97316' },
    { label: `p₂ (z₂=${z2.toFixed(1)})`, prob: p2, color: '#3b82f6' },
    { label: `p₃ (z₃=${z3.toFixed(1)})`, prob: p3, color: '#10b981' },
  ];
  const barBaseX = 16;
  const barBaseY = height - 68;
  const maxBarW = Math.min(120, width * 0.25);
  ctx.font = '500 10px Inter, system-ui, sans-serif';
  bars.forEach((b, idx) => {
    const y = barBaseY + idx * 18;
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
    ctx.fillRect(barBaseX + 72, y - 9, maxBarW, 11);
    ctx.fillStyle = b.color;
    ctx.fillRect(barBaseX + 72, y - 9, Math.max(2, b.prob * maxBarW), 11);
    ctx.fillStyle = isDark ? '#e5e5e5' : '#262626';
    ctx.fillText(b.label, barBaseX, y);
  });
  ctx.restore();
}

export function renderRocCurveCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  isDark: boolean,
  points: DataPoint2D[],
  params: Record<string, number>
): void {
  ctx.fillStyle = isDark ? '#171717' : '#fafafa';
  ctx.fillRect(0, 0, width, height);

  const w1 = params['w_1'] ?? params['w'] ?? 1.4;
  const w2 = params['w_2'] ?? 1.1;
  const b = params['b'] ?? -0.2;
  const tau = params['tau'] ?? 0.5;

  const roc = computeRocAndConfusionMatrix(points, w1, w2, b, tau);
  const pad = 48;
  const plotW = Math.max(width - pad * 2, 60);
  const plotH = Math.max(height - pad * 2, 60);

  const toScreen = (fpr: number, tpr: number): { x: number; y: number } => ({
    x: pad + fpr * plotW,
    y: pad + (1.0 - tpr) * plotH,
  });

  ctx.save();
  // Shaded AUC region
  ctx.fillStyle = 'rgba(249, 115, 22, 0.22)';
  ctx.beginPath();
  const start = toScreen(0, 0);
  ctx.moveTo(start.x, start.y);
  for (let i = 0; i + 1 < roc.curvePoints.length; i += 2) {
    const pt = toScreen(roc.curvePoints[i], roc.curvePoints[i + 1]);
    ctx.lineTo(pt.x, pt.y);
  }
  const bottomRight = toScreen(1, 0);
  ctx.lineTo(bottomRight.x, bottomRight.y);
  ctx.closePath();
  ctx.fill();

  // Diagonal random classifier line
  ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)';
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  const p00 = toScreen(0, 0);
  const p11 = toScreen(1, 1);
  ctx.moveTo(p00.x, p00.y);
  ctx.lineTo(p11.x, p11.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // ROC Curve
  ctx.strokeStyle = '#f97316';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  for (let i = 0; i + 1 < roc.curvePoints.length; i += 2) {
    const pt = toScreen(roc.curvePoints[i], roc.curvePoints[i + 1]);
    if (i === 0) ctx.moveTo(pt.x, pt.y);
    else ctx.lineTo(pt.x, pt.y);
  }
  ctx.stroke();

  // Active operating point at threshold tau
  const active = toScreen(roc.activeFpr, roc.activeTpr);
  ctx.beginPath();
  ctx.arc(active.x, active.y, 6.5, 0, Math.PI * 2);
  ctx.fillStyle = '#3b82f6';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  ctx.fillStyle = isDark ? '#f5f5f5' : '#171717';
  ctx.font = '600 12px Inter, system-ui, sans-serif';
  ctx.fillText(
    `ROC Curve (AUC = ${roc.auc.toFixed(3)})  |  τ = ${tau.toFixed(2)} → TP:${roc.tp} FP:${roc.fp} TN:${roc.tn} FN:${roc.fn}`,
    16,
    26
  );
  ctx.restore();
}

export function renderSvmFeature3DCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  isDark: boolean,
  points: DataPoint2D[],
  params: Record<string, number>
): void {
  ctx.fillStyle = isDark ? '#171717' : '#fafafa';
  ctx.fillRect(0, 0, width, height);

  const gamma = params['gamma'] ?? 0.6;
  const tau = params['tau'] ?? 0.45;
  const cx = width * 0.5;
  const cy = height * 0.68;
  const scale = Math.min(width, height) * 0.16;

  const project3D = (x1: number, x2: number, z: number): { sx: number; sy: number } => {
    const isoX = (x1 - x2) * 0.866;
    const isoY = (x1 + x2) * 0.35 - z * 2.2;
    return { sx: cx + isoX * scale, sy: cy + isoY * scale };
  };

  ctx.save();
  // Wireframe RBF Gaussian hill
  ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.18)' : 'rgba(23, 23, 23, 0.16)';
  ctx.lineWidth = 1;
  for (let u = -2.5; u <= 2.5; u += 0.5) {
    ctx.beginPath();
    for (let v = -2.5; v <= 2.5; v += 0.25) {
      const z = computeRbfLift3D(u, v, gamma);
      const { sx, sy } = project3D(u, v, z);
      if (v === -2.5) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
  }

  // Separating horizontal plane at z = tau
  const c1 = project3D(-2.4, -2.4, tau);
  const c2 = project3D(2.4, -2.4, tau);
  const c3 = project3D(2.4, 2.4, tau);
  const c4 = project3D(-2.4, 2.4, tau);
  ctx.fillStyle = 'rgba(59, 130, 246, 0.22)';
  ctx.strokeStyle = 'rgba(59, 130, 246, 0.75)';
  ctx.beginPath();
  ctx.moveTo(c1.sx, c1.sy);
  ctx.lineTo(c2.sx, c2.sy);
  ctx.lineTo(c3.sx, c3.sy);
  ctx.lineTo(c4.sx, c4.sy);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Lifted 3D points
  for (const pt of points) {
    const x2 = pt.x2 ?? pt.y;
    const z = computeRbfLift3D(pt.x, x2, gamma);
    const { sx, sy } = project3D(pt.x, x2, z);
    ctx.beginPath();
    ctx.arc(sx, sy, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = (pt.label ?? 0) > 0 ? '#f97316' : '#3b82f6';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.fillStyle = isDark ? '#f5f5f5' : '#171717';
  ctx.font = '600 12px Inter, system-ui, sans-serif';
  ctx.fillText(`3D RBF Lift φ(x) = exp(-${gamma.toFixed(2)}||x||²)  |  Hyperplane z = ${tau.toFixed(2)}`, 16, 26);
  ctx.restore();
}

export function renderMlpSpaceFoldingCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  isDark: boolean,
  points: DataPoint2D[],
  params: Record<string, number>
): void {
  ctx.fillStyle = isDark ? '#171717' : '#fafafa';
  ctx.fillRect(0, 0, width, height);

  const t = params['t'] ?? 1.0;
  const cx = width * 0.5;
  const cy = height * 0.52;
  const scale = Math.min(width, height) * 0.22;

  const toScreen = (wx: number, wy: number): { sx: number; sy: number } => ({
    sx: cx + wx * scale,
    sy: cy - wy * scale,
  });

  ctx.save();
  ctx.strokeStyle = isDark ? 'rgba(249, 115, 22, 0.28)' : 'rgba(249, 115, 22, 0.25)';
  ctx.lineWidth = 1.2;

  // Draw warped horizontal & vertical homotopy grid lines
  for (let g = -1.6; g <= 1.61; g += 0.4) {
    ctx.beginPath();
    for (let s = -1.6; s <= 1.61; s += 0.1) {
      const { wx, wy } = warpMlpHomotopyPoint(s, g, t);
      const { sx, sy } = toScreen(wx, wy);
      if (s === -1.6) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();

    ctx.beginPath();
    for (let s = -1.6; s <= 1.61; s += 0.1) {
      const { wx, wy } = warpMlpHomotopyPoint(g, s, t);
      const { sx, sy } = toScreen(wx, wy);
      if (s === -1.6) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
  }

  // Draw XOR points in warped representation space
  for (const pt of points) {
    const x2 = pt.x2 ?? pt.y;
    const { wx, wy } = warpMlpHomotopyPoint(pt.x, x2, t);
    const { sx, sy } = toScreen(wx, wy);
    ctx.beginPath();
    ctx.arc(sx, sy, 7, 0, Math.PI * 2);
    ctx.fillStyle = (pt.label ?? 0) > 0 ? '#f97316' : '#3b82f6';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }

  ctx.fillStyle = isDark ? '#f5f5f5' : '#171717';
  ctx.font = '600 12px Inter, system-ui, sans-serif';
  ctx.fillText(`Homotopy Space Folding h(t) = (1-t)x + t·tanh(W₁x+b₁)  |  Morph t = ${t.toFixed(2)}`, 16, 26);
  ctx.restore();
}
