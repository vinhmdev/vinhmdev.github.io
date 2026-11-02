/**
 * 2x DPI High-Resolution PNG Graph Exporter.
 *
 * Composites the Left Data/Function Canvas, Right WebGL2 Surface Canvas,
 * Right 2D Particle Overlay Canvas, and Title/Formula Header into a single
 * publication-ready `.png` image.
 */

export function exportDualViewportPng(opts: {
  leftCanvas: HTMLCanvasElement | null;
  rightGlCanvas: HTMLCanvasElement | null;
  rightOverlayCanvas: HTMLCanvasElement | null;
  title: string;
  primaryLatex: string;
  isDark: boolean;
}): void {
  const { leftCanvas, rightGlCanvas, rightOverlayCanvas, title, primaryLatex, isDark } = opts;
  if (!leftCanvas) return;

  const headerH = 56;
  const lW = leftCanvas.width;
  const lH = leftCanvas.height;
  const rW = rightOverlayCanvas?.width ?? 0;
  const rH = rightOverlayCanvas?.height ?? 0;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = lW + rW;
  outCanvas.height = Math.max(lH, rH) + headerH;

  const ctx = outCanvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = isDark ? '#171717' : '#fafafa';
  ctx.fillRect(0, 0, outCanvas.width, outCanvas.height);

  // Header bar
  ctx.fillStyle = isDark ? '#f5f5f5' : '#171717';
  ctx.font = 'bold 20px Inter, system-ui, sans-serif';
  ctx.fillText(`${title}  —  ${primaryLatex}`, 20, 36);

  ctx.drawImage(leftCanvas, 0, headerH);
  if (rightGlCanvas && rW > 0) {
    ctx.drawImage(rightGlCanvas, lW, headerH);
  }
  if (rightOverlayCanvas && rW > 0) {
    ctx.drawImage(rightOverlayCanvas, lW, headerH);
  }

  const dataUrl = outCanvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = 'openmlgraph-export.png';
  a.click();
}
