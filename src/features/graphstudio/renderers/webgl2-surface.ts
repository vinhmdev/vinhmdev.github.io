/**
 * Native WebGL2 3D Loss Surface, Hardware `fwidth()` Contours & Instanced Vector Field [FR-3.4, FR-4.1..4.3].
 *
 * Uses raw WebGL2 (`#version 300 es`, 0 external npm dependency):
 * - Pipeline 1: 128 x 128 Loss Landscape heightfield updated via `gl.bufferSubData`
 *   with hardware `fwidth()` screen-space anti-aliased contour lines (0ms CPU).
 * - Pipeline 2: 2,500-arrow negative gradient vector field rendered in a SINGLE
 *   `gl.drawArraysInstanced()` call.
 * - Includes an automatic 2D Canvas overlay for the 4 Optimizer Race particles
 *   (Vanilla SGD, Momentum/NAG lookahead & comet tail, RMSProp halo, Adam),
 *   L1/L2 Regularization constraint geometry, and Linked Brushing pull vectors.
 */
import type {
  OptimizerId,
  OptimizerTrajectoryStep,
  RegularizationKind,
  Viewport2DBounds,
} from '../types/state';
import { worldToScreen } from './viewport-controller';

const VERTEX_SHADER_300_ES = `#version 300 es
precision highp float;
in vec2 a_uv;
in float a_height;
uniform float u_minLoss;
uniform float u_maxLoss;
uniform float u_zScale;
uniform float u_pitch;
uniform float u_yaw;
out float v_normH;
out float v_rawH;

void main() {
  float span = max(u_maxLoss - u_minLoss, 1e-5);
  float normH = clamp((a_height - u_minLoss) / span, 0.0, 1.0);
  v_normH = normH;
  v_rawH = a_height;

  // Map uv in [0, 1]^2 to [-1, 1]^2
  vec2 pos2d = a_uv * 2.0 - 1.0;
  if (u_zScale <= 0.01) {
    gl_Position = vec4(pos2d, 0.0, 1.0);
    return;
  }

  // 3D Orbit Camera Projection
  float z = (normH - 0.35) * u_zScale;
  float cy = cos(u_yaw), sy = sin(u_yaw);
  float cp = cos(u_pitch), sp = sin(u_pitch);

  vec3 p = vec3(pos2d.x * 0.78, pos2d.y * 0.78, z);
  vec3 rotZ = vec3(p.x * cy - p.y * sy, p.x * sy + p.y * cy, p.z);
  vec3 rotX = vec3(rotZ.x, rotZ.y * cp - rotZ.z * sp, rotZ.y * sp + rotZ.z * cp);
  gl_Position = vec4(rotX.x, rotX.y, rotX.z * 0.5, 1.0);
}
`;

const FRAGMENT_SHADER_300_ES = `#version 300 es
precision highp float;
in float v_normH;
in float v_rawH;
uniform bool u_isDark;
out vec4 outColor;

void main() {
  // Perceptually uniform Titanium-to-Cinnabar heatmap palette
  vec3 cLow  = u_isDark ? vec3(0.11, 0.16, 0.26) : vec3(0.92, 0.95, 0.99);
  vec3 cMid  = u_isDark ? vec3(0.18, 0.36, 0.48) : vec3(0.68, 0.84, 0.94);
  vec3 cHigh = u_isDark ? vec3(0.75, 0.32, 0.10) : vec3(0.98, 0.62, 0.32);

  float t = clamp(v_normH, 0.0, 1.0);
  vec3 baseColor = t < 0.5
    ? mix(cLow, cMid, t * 2.0)
    : mix(cMid, cHigh, (t - 0.5) * 2.0);

  // Hardware screen-space derivative fwidth() Contour Isolines (18 levels) [FR-3.4]
  float scaled = v_normH * 18.0;
  float distToContour = abs(fract(scaled - 0.5) - 0.5) / max(fwidth(scaled), 1e-4);
  float contourAlpha = 1.0 - smoothstep(0.0, 1.35, distToContour);
  vec3 lineCol = u_isDark ? vec3(0.98, 0.98, 0.98) : vec3(0.12, 0.12, 0.12);

  vec3 finalRgb = mix(baseColor, lineCol, contourAlpha * 0.42);
  outColor = vec4(finalRgb, 1.0);
}
`;

const VECTOR_VS_300_ES = `#version 300 es
precision highp float;
in vec2 a_arrowPos;
in vec4 a_instanceVec; // [w1, w2, dx, dy]
uniform vec4 u_bounds; // [w1Min, w1Max, w2Min, w2Max]
out float v_mag;

void main() {
  vec2 w = a_instanceVec.xy;
  vec2 d = a_instanceVec.zw;
  float mag = length(d);
  v_mag = mag;
  vec2 dir = mag > 1e-6 ? d / mag : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  float scale = clamp(log(1.0 + mag) * 0.014, 0.006, 0.032);
  vec2 localOffset = (dir * a_arrowPos.x + perp * a_arrowPos.y) * scale;

  vec2 uv = (w - u_bounds.xz) / max(u_bounds.yw - u_bounds.xz, vec2(1e-5));
  vec2 clip = (uv * 2.0 - 1.0) + localOffset;
  gl_Position = vec4(clip, -0.02, 1.0);
}
`;

const VECTOR_FS_300_ES = `#version 300 es
precision highp float;
in float v_mag;
uniform bool u_isDark;
out vec4 outColor;

void main() {
  if (v_mag < 1e-6) discard;
  vec3 col = u_isDark ? vec3(0.95, 0.95, 0.95) : vec3(0.12, 0.12, 0.12);
  outColor = vec4(col, 0.28);
}
`;

export class WebGL2SurfaceRenderer {
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private heightBuffer: WebGLBuffer | null = null;
  private vecProgram: WebGLProgram | null = null;
  private vecVao: WebGLVertexArrayObject | null = null;
  private vecInstBuffer: WebGLBuffer | null = null;
  private indexCount = 0;
  private gridSize = 128;

  constructor(canvas: HTMLCanvasElement, gridSize = 128) {
    this.gridSize = gridSize;
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: true });
    if (!gl) return;
    this.gl = gl;
    this.initPipeline(gl, gridSize);
    this.initVectorPipeline(gl);
  }

  private initPipeline(gl: WebGL2RenderingContext, N: number): void {
    const vs = this.compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_300_ES);
    const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_300_ES);
    if (!vs || !fs) return;

    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    this.program = prog;

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    this.vao = vao;

    // Static UV grid
    const uvs = new Float32Array(N * N * 2);
    let ptr = 0;
    for (let r = 0; r < N; r++) {
      const v = r / (N - 1);
      for (let c = 0; c < N; c++) {
        uvs[ptr++] = c / (N - 1);
        uvs[ptr++] = v;
      }
    }
    const uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
    const uvLoc = gl.getAttribLocation(prog, 'a_uv');
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);

    // Dynamic height buffer updated via gl.bufferSubData (< 0.3ms)
    const hBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, hBuf);
    gl.bufferData(gl.ARRAY_BUFFER, N * N * 4, gl.DYNAMIC_DRAW);
    const hLoc = gl.getAttribLocation(prog, 'a_height');
    gl.enableVertexAttribArray(hLoc);
    gl.vertexAttribPointer(hLoc, 1, gl.FLOAT, false, 0, 0);
    this.heightBuffer = hBuf;

    // Triangle indices
    const indices = new Uint32Array((N - 1) * (N - 1) * 6);
    let idx = 0;
    for (let r = 0; r < N - 1; r++) {
      for (let c = 0; c < N - 1; c++) {
        const i0 = r * N + c;
        const i1 = i0 + 1;
        const i2 = i0 + N;
        const i3 = i2 + 1;
        indices[idx++] = i0;
        indices[idx++] = i1;
        indices[idx++] = i2;
        indices[idx++] = i1;
        indices[idx++] = i3;
        indices[idx++] = i2;
      }
    }
    const idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    this.indexCount = indices.length;

    gl.bindVertexArray(null);
  }

  private initVectorPipeline(gl: WebGL2RenderingContext): void {
    const vs = this.compileShader(gl, gl.VERTEX_SHADER, VECTOR_VS_300_ES);
    const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, VECTOR_FS_300_ES);
    if (!vs || !fs) return;

    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    this.vecProgram = prog;

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    this.vecVao = vao;

    // 6-vertex arrow geometry (shaft + 2 arrowhead wings) for gl.LINES
    const arrowVerts = new Float32Array([
      0.0, 0.0, 1.0, 0.0,
      1.0, 0.0, 0.65, 0.28,
      1.0, 0.0, 0.65, -0.28,
    ]);
    const geomBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, geomBuf);
    gl.bufferData(gl.ARRAY_BUFFER, arrowVerts, gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(prog, 'a_arrowPos');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // Per-instance [w1, w2, dx, dy] buffer for 50x50 = 2,500 arrows
    const instBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, 50 * 50 * 4 * 4, gl.DYNAMIC_DRAW);
    const instLoc = gl.getAttribLocation(prog, 'a_instanceVec');
    gl.enableVertexAttribArray(instLoc);
    gl.vertexAttribPointer(instLoc, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(instLoc, 1);
    this.vecInstBuffer = instBuf;

    gl.bindVertexArray(null);
  }

  private compileShader(
    gl: WebGL2RenderingContext,
    type: number,
    src: string
  ): WebGLShader | null {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  public renderSurface(
    lossGrid: Float32Array,
    minLoss: number,
    maxLoss: number,
    zScale: number,
    pitch: number,
    yaw: number,
    isDark: boolean,
    width: number,
    height: number,
    vectorField?: Float32Array,
    viewport?: Viewport2DBounds,
    showVectorField = false
  ): boolean {
    const gl = this.gl;
    if (!gl || !this.program || !this.vao || !this.heightBuffer) return false;
    if (lossGrid.length !== this.gridSize * this.gridSize) return false;

    const fbW = gl.drawingBufferWidth || width;
    const fbH = gl.drawingBufferHeight || height;
    gl.viewport(0, 0, fbW, fbH);
    gl.clearColor(isDark ? 0.09 : 0.98, isDark ? 0.09 : 0.98, isDark ? 0.09 : 0.98, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.heightBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, lossGrid);

    gl.uniform1f(gl.getUniformLocation(this.program, 'u_minLoss'), minLoss);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_maxLoss'), maxLoss);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_zScale'), zScale);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_pitch'), pitch);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_yaw'), yaw);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_isDark'), isDark ? 1 : 0);

    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);

    // Pipeline 2: Instanced 2,500-arrow Vector Field in a single gl.drawArraysInstanced() call [FR-3.4]
    if (
      showVectorField &&
      zScale <= 0.01 &&
      vectorField &&
      vectorField.length >= 4 &&
      viewport &&
      this.vecProgram &&
      this.vecVao &&
      this.vecInstBuffer
    ) {
      const instanceCount = Math.min(2500, Math.floor(vectorField.length / 4));
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.vecProgram);
      gl.bindVertexArray(this.vecVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vecInstBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, vectorField.subarray(0, instanceCount * 4));
      gl.uniform4f(
        gl.getUniformLocation(this.vecProgram, 'u_bounds'),
        viewport.xMin,
        viewport.xMax,
        viewport.yMin,
        viewport.yMax
      );
      gl.uniform1i(gl.getUniformLocation(this.vecProgram, 'u_isDark'), isDark ? 1 : 0);
      gl.drawArraysInstanced(gl.LINES, 0, 6, instanceCount);
      gl.disable(gl.BLEND);
    }

    gl.bindVertexArray(null);
    return true;
  }
}

export interface LossOverlayRenderParams {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  isDark: boolean;
  viewport: Viewport2DBounds;
  w1: number;
  w2: number;
  vectorField: Float32Array;
  showVectorField: boolean;
  regularizationKind: RegularizationKind;
  regularizationRadius: number;
  trajectories: Record<OptimizerId, OptimizerTrajectoryStep[]>;
  currentStep: number;
  zScale?: number;
  pitch?: number;
  yaw?: number;
  minLoss?: number;
  maxLoss?: number;
  lossGrid?: Float32Array;
  linkedBrushPull?: {
    pointId: string;
    sampleLoss: number;
    pullW1: number;
    pullW2: number;
  };
}

const OPTIMIZER_COLORS: Record<OptimizerId, string> = {
  sgd: '#ef4444',      // Red
  momentum: '#f97316', // Orange
  rmsprop: '#06b6d4',  // Cyan
  adam: '#3b82f6',     // Blue
  custom_js: '#a855f7', // Purple
};

export function renderLossSpaceOverlay2D(p: LossOverlayRenderParams): void {
  const {
    ctx,
    width,
    height,
    isDark,
    viewport,
    w1,
    w2,
    vectorField,
    showVectorField,
    regularizationKind,
    regularizationRadius,
    trajectories,
    currentStep,
    zScale = 0,
    pitch = 0.55,
    yaw = -0.65,
    minLoss = 0,
    maxLoss = 1,
    lossGrid,
    linkedBrushPull,
  } = p;

  const sampleGridHeight = (wx: number, wy: number): number => {
    if (!lossGrid || lossGrid.length === 0) return minLoss;
    const N = Math.round(Math.sqrt(lossGrid.length));
    if (N < 2) return minLoss;
    const u = Math.min(Math.max((wx - viewport.xMin) / Math.max(viewport.xMax - viewport.xMin, 1e-5), 0), 1);
    const v = Math.min(Math.max((wy - viewport.yMin) / Math.max(viewport.yMax - viewport.yMin, 1e-5), 0), 1);
    const c = Math.min(Math.floor(u * (N - 1)), N - 1);
    const r = Math.min(Math.floor(v * (N - 1)), N - 1);
    return lossGrid[r * N + c] ?? minLoss;
  };

  const toScreen = (wx: number, wy: number, explicitLoss?: number): { sx: number; sy: number } => {
    if (zScale <= 0.01) {
      return worldToScreen(wx, wy, viewport, width, height);
    }
    const u = (wx - viewport.xMin) / Math.max(viewport.xMax - viewport.xMin, 1e-5);
    const v = (wy - viewport.yMin) / Math.max(viewport.yMax - viewport.yMin, 1e-5);
    const pos2dX = u * 2.0 - 1.0;
    const pos2dY = v * 2.0 - 1.0;
    const rawH = explicitLoss !== undefined && Number.isFinite(explicitLoss)
      ? explicitLoss
      : sampleGridHeight(wx, wy);
    const span = Math.max(maxLoss - minLoss, 1e-5);
    const normH = Math.min(Math.max((rawH - minLoss) / span, 0.0), 1.0);
    const z = (normH - 0.35) * zScale;

    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);

    const px = pos2dX * 0.78;
    const py = pos2dY * 0.78;
    const rotZX = px * cy - py * sy;
    const rotZY = px * sy + py * cy;
    const rotXY = rotZY * cp - z * sp;

    return {
      sx: (rotZX * 0.5 + 0.5) * width,
      sy: (0.5 - rotXY * 0.5) * height,
    };
  };

  const scaleX = ctx.canvas ? ctx.canvas.width / Math.max(width, 1) : 1;
  const scaleY = ctx.canvas ? ctx.canvas.height / Math.max(height, 1) : 1;
  ctx.save();
  ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
  ctx.clearRect(0, 0, width, height);

  // 1. Regularization Constraint Geometry: L1 Diamond (Lasso) or L2 Circle (Ridge) [FR-4.3]
  if (regularizationKind !== 'none' && regularizationRadius > 0) {
    const origin = toScreen(0, 0);
    const pTop = toScreen(0, regularizationRadius);
    const pRight = toScreen(regularizationRadius, 0);
    const pBottom = toScreen(0, -regularizationRadius);
    const pLeft = toScreen(-regularizationRadius, 0);

    ctx.save();
    ctx.fillStyle = 'rgba(16, 185, 129, 0.25)';
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (regularizationKind === 'l1') {
      ctx.moveTo(pTop.sx, pTop.sy);
      ctx.lineTo(pRight.sx, pRight.sy);
      ctx.lineTo(pBottom.sx, pBottom.sy);
      ctx.lineTo(pLeft.sx, pLeft.sy);
      ctx.closePath();
    } else {
      const rx = Math.abs(pRight.sx - origin.sx);
      const ry = Math.abs(pTop.sy - origin.sy);
      ctx.ellipse(origin.sx, origin.sy, rx, ry, 0, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // 2. Negative Gradient Vector Field Arrows (only in 2D Contour mode so arrows don't float outside 3D mesh)
  if (showVectorField && zScale <= 0.01 && vectorField.length >= 4) {
    ctx.save();
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(23, 23, 23, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Draw every 2nd arrow on 2D overlay for crisp visual clarity
    for (let i = 0; i + 3 < vectorField.length; i += 8) {
      const vx = vectorField[i];
      const vy = vectorField[i + 1];
      const dx = vectorField[i + 2];
      const dy = vectorField[i + 3];
      const mag = Math.hypot(dx, dy);
      if (mag < 1e-6) continue;
      const { sx, sy } = worldToScreen(vx, vy, viewport, width, height);
      const lenPx = Math.min(12, 4 + Math.log1p(mag) * 3);
      const ux = (dx / mag) * lenPx;
      const uy = -(dy / mag) * lenPx;
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + ux, sy + uy);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 3. Render 4-Optimizer Race Trajectories up to `currentStep` [FR-4.2]
  const optIds: OptimizerId[] = ['sgd', 'momentum', 'rmsprop', 'adam', 'custom_js'];
  for (const id of optIds) {
    const traj = trajectories[id];
    if (!traj || traj.length === 0) continue;
    const maxIdx = Math.min(currentStep, traj.length - 1);
    if (maxIdx < 0) continue;

    const color = OPTIMIZER_COLORS[id];
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let k = 0; k <= maxIdx; k++) {
      const step = traj[k];
      const { sx, sy } = toScreen(step.w1, step.w2, step.loss);
      if (k === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();

    // Active head particle at step t
    const head = traj[maxIdx];
    const headScreen = toScreen(head.w1, head.w2, head.loss);

    // RMSProp / Adam adaptive second-moment elliptical halo
    if (id === 'rmsprop' || id === 'adam') {
      const rx = Math.min(18, Math.max(6, 8 / Math.pow(head.cacheW1 + 1e-3, 0.15)));
      const ry = Math.min(18, Math.max(6, 8 / Math.pow(head.cacheW2 + 1e-3, 0.15)));
      ctx.beginPath();
      ctx.ellipse(headScreen.sx, headScreen.sy, rx, ry, 0, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    }

    // Nesterov NAG lookahead probe dot
    if (
      id === 'momentum' &&
      head.nagLookaheadW1 !== undefined &&
      head.nagLookaheadW2 !== undefined
    ) {
      const look = toScreen(head.nagLookaheadW1, head.nagLookaheadW2);
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(headScreen.sx, headScreen.sy);
      ctx.lineTo(look.sx, look.sy);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    ctx.arc(headScreen.sx, headScreen.sy, 5.2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.restore();
  }

  // 4. Linked Brushing Single-Sample Pull Vector `-grad l_i(w, b)` [FR-4.1]
  const currentPos = toScreen(w1, w2);
  if (linkedBrushPull) {
    const target = toScreen(
      w1 + linkedBrushPull.pullW1 * 0.35,
      w2 + linkedBrushPull.pullW2 * 0.35
    );
    ctx.save();
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(currentPos.sx, currentPos.sy);
    ctx.lineTo(target.sx, target.sy);
    ctx.stroke();
    ctx.restore();
  }

  // 5. Draggable Active Parameter Particle (w1, w2)
  ctx.save();
  ctx.beginPath();
  ctx.arc(currentPos.sx, currentPos.sy, 7.0, 0, Math.PI * 2);
  ctx.fillStyle = '#f97316';
  ctx.fill();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}
