/**
 * 2x DPI High-Resolution PNG Graph Exporter.
 *
 * Composites the Left Data/Function Canvas (with Whiteboard annotations),
 * Right WebGL2 Surface Canvas, Right 2D Particle Overlay Canvas, and
 * Title/Formula Header into a single publication-ready `.png` image.
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
  if (!leftCanvas && !rightOverlayCanvas && !rightGlCanvas) return;

  const activeCanvas = leftCanvas ?? rightOverlayCanvas ?? rightGlCanvas;
  const dpr =
    activeCanvas && activeCanvas.clientWidth > 0
      ? Math.max(activeCanvas.width / activeCanvas.clientWidth, 1)
      : typeof window !== 'undefined'
        ? Math.max(window.devicePixelRatio || 1, 2)
        : 2;

  const headerH = Math.round(56 * dpr);
  const lW = leftCanvas?.width ?? 0;
  const lH = leftCanvas?.height ?? 0;
  const rW = rightOverlayCanvas?.width ?? rightGlCanvas?.width ?? 0;
  const rH = rightOverlayCanvas?.height ?? rightGlCanvas?.height ?? 0;

  const totalW = lW + rW;
  const maxPaneH = Math.max(lH, rH);
  if (totalW <= 0 || maxPaneH <= 0) return;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = totalW;
  outCanvas.height = maxPaneH + headerH;

  const ctx = outCanvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = isDark ? '#171717' : '#fafafa';
  ctx.fillRect(0, 0, outCanvas.width, outCanvas.height);

  // Header bar scaled to HiDPI
  ctx.fillStyle = isDark ? '#f5f5f5' : '#171717';
  ctx.font = `bold ${Math.round(18 * dpr)}px Inter, system-ui, sans-serif`;
  ctx.fillText(
    `${title}  —  ${primaryLatex}`,
    Math.round(20 * dpr),
    Math.round(35 * dpr)
  );

  if (leftCanvas && lW > 0) {
    ctx.drawImage(leftCanvas, 0, headerH);
  }
  if (rightGlCanvas && rW > 0 && !rightGlCanvas.classList.contains('hidden')) {
    ctx.drawImage(rightGlCanvas, lW, headerH);
  }
  if (rightOverlayCanvas && rW > 0) {
    ctx.drawImage(rightOverlayCanvas, lW, headerH);
  }

  const dataUrl = outCanvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = 'graphstudio-export.png';
  a.click();
}
