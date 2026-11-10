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

export interface Surface3DProjectionParams {
  zScale: number;
  pitch: number;
  yaw: number;
  width: number;
  height: number;
}

export interface Surface3DCameraTransform {
  effZScale: number;
  safePitch: number;
  safeYaw: number;
  cy: number;
  sy: number;
  cp: number;
  sp: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
}

/**
 * Computes an aspect-aware, frustum-fitted 3D orthographic/orbit transform so that
 * for ANY pitch, yaw, zScale, and viewport aspect ratio, the entire [-1, 1]^2 x [-0.5*zScale, +0.5*zScale]
 * surface bounding box stays centered at (0, 0, 0) and fits strictly within [-0.84, +0.84] clip space
 * without clipping or stretching.
 */
export function computeSurface3DCameraTransform(
  params: Surface3DProjectionParams
): Surface3DCameraTransform {
  const rawZ = Number.isFinite(params.zScale) ? params.zScale : 0;
  const effZScale = Math.min(Math.max(rawZ, 0), 1.2);
  const safePitch = Math.min(
    Math.max(Number.isFinite(params.pitch) ? params.pitch : 0.55, 0.05),
    1.45
  );
  const safeYaw = Number.isFinite(params.yaw) ? params.yaw : -0.65;

  const cy = Math.cos(safeYaw);
  const sy = Math.sin(safeYaw);
  const cp = Math.cos(safePitch);
  const sp = Math.sin(safePitch);

  // Maximum horizontal reach of rotated unit square [-1, 1]^2
  const maxXY = Math.max(Math.abs(cy) + Math.abs(sy), 1.0);
  const halfZ = 0.5 * effZScale;

  const maxExtentX = Math.max(maxXY, 1.0);
  const maxExtentY = Math.max(maxXY * Math.abs(cp) + halfZ * Math.abs(sp), 0.5);
  const maxExtentZ = Math.max(maxXY * Math.abs(sp) + halfZ * Math.abs(cp), 0.5);

  const w = Math.max(Number.isFinite(params.width) ? params.width : 1, 1);
  const h = Math.max(Number.isFinite(params.height) ? params.height : 1, 1);
  const aspect = w / h;

  // Isotropic 1:1 screen pixel scale that fits strictly inside 84% of both width and height
  const FIT_MARGIN = 0.84;
  const baseScaleY = Math.min(
    FIT_MARGIN / maxExtentY,
    (FIT_MARGIN * aspect) / maxExtentX
  );
  const scaleY = baseScaleY;
  const scaleX = baseScaleY / aspect;
  const scaleZ = 0.85 / maxExtentZ;

  return {
    effZScale,
    safePitch,
    safeYaw,
    cy,
    sy,
    cp,
    sp,
    scaleX,
    scaleY,
    scaleZ,
  };
}

/**
 * Safely normalizes a raw loss height into [0, 1], guarding against NaN, Infinity,
 * and huge Float64 offsets or spans.
 */
export function normalizeLossHeight(
  rawH: number,
  minLoss: number,
  maxLoss: number
): number {
  const safeMin = Number.isFinite(minLoss) ? minLoss : 0;
  const safeMax =
    Number.isFinite(maxLoss) && maxLoss > safeMin ? maxLoss : safeMin + 1;
  if (!Number.isFinite(rawH)) {
    return rawH === -Infinity ? 0.0 : 1.0;
  }
  const span = Math.max(safeMax - safeMin, 1e-9);
  const norm = (rawH - safeMin) / span;
  if (!Number.isFinite(norm)) return 0.5;
  return Math.min(Math.max(norm, 0.0), 1.0);
}

/**
 * Samples the normalized [0, 1] height of the 3D surface at parameter point (wx, wy)
 * using bilinear interpolation on `lossGrid` (consistent with the WebGL2 mesh),
 * falling back to `explicitLoss` when `lossGrid` is unavailable.
 */
export function sampleNormalizedSurfaceHeight(
  wx: number,
  wy: number,
  viewport: Viewport2DBounds,
  lossGrid?: Float32Array,
  minLoss = 0,
  maxLoss = 1,
  explicitLoss?: number
): number {
  if (lossGrid && lossGrid.length >= 4) {
    const N = Math.round(Math.sqrt(lossGrid.length));
    if (N >= 2) {
      const u = Math.min(
        Math.max((wx - viewport.xMin) / Math.max(viewport.xMax - viewport.xMin, 1e-9), 0),
        1
      );
      const v = Math.min(
        Math.max((wy - viewport.yMin) / Math.max(viewport.yMax - viewport.yMin, 1e-9), 0),
        1
      );
      const fx = u * (N - 1);
      const fy = v * (N - 1);
      const c0 = Math.min(Math.floor(fx), N - 2);
      const r0 = Math.min(Math.floor(fy), N - 2);
      const tx = fx - c0;
      const ty = fy - r0;
      const r0Off = r0 * N;
      const r1Off = (r0 + 1) * N;
      const v00 = lossGrid[r0Off + c0] ?? minLoss;
      const v10 = lossGrid[r0Off + c0 + 1] ?? minLoss;
      const v01 = lossGrid[r1Off + c0] ?? minLoss;
      const v11 = lossGrid[r1Off + c0 + 1] ?? minLoss;
      const top = v00 + tx * (v10 - v00);
      const bot = v01 + tx * (v11 - v01);
      const interp = top + ty * (bot - top);
      const rawH = Number.isFinite(interp) ? interp : minLoss;
      return normalizeLossHeight(rawH, minLoss, maxLoss);
    }
  }
  const fallbackRaw =
    explicitLoss !== undefined && Number.isFinite(explicitLoss) ? explicitLoss : minLoss;
  return normalizeLossHeight(fallbackRaw, minLoss, maxLoss);
}

/**
 * Projects a world parameter point (wx, wy) with normalized height normH in [0, 1]
 * onto screen coordinates (sx, sy) and clip-space coordinates (clipX, clipY, clipZ).
 */
export function projectSurface3DPoint(
  wx: number,
  wy: number,
  normH: number,
  viewport: Viewport2DBounds,
  params: Surface3DProjectionParams,
  clampToSurfaceBox = true
): { sx: number; sy: number; clipX: number; clipY: number; clipZ: number } {
  const width = Math.max(params.width, 1);
  const height = Math.max(params.height, 1);
  if (!(params.zScale > 0.01)) {
    const pt = worldToScreen(wx, wy, viewport, width, height);
    const clipX = (pt.sx / width) * 2.0 - 1.0;
    const clipY = 1.0 - (pt.sy / height) * 2.0;
    return { sx: pt.sx, sy: pt.sy, clipX, clipY, clipZ: 0 };
  }

  const spanX = Math.max(viewport.xMax - viewport.xMin, 1e-9);
  const spanY = Math.max(viewport.yMax - viewport.yMin, 1e-9);
  const rawU = (wx - viewport.xMin) / spanX;
  const rawV = (wy - viewport.yMin) / spanY;
  const rawPos2dX = Number.isFinite(rawU) ? rawU * 2.0 - 1.0 : 0.0;
  const rawPos2dY = Number.isFinite(rawV) ? rawV * 2.0 - 1.0 : 0.0;

  const limit = clampToSurfaceBox ? 1.0 : 10.0;
  const pos2dX = Math.min(Math.max(rawPos2dX, -limit), limit);
  const pos2dY = Math.min(Math.max(rawPos2dY, -limit), limit);

  const clampedNormH = Number.isFinite(normH)
    ? Math.min(Math.max(normH, 0.0), 1.0)
    : 0.5;

  const cam = computeSurface3DCameraTransform(params);
  const z = (clampedNormH - 0.5) * cam.effZScale;

  const rotZX = pos2dX * cam.cy - pos2dY * cam.sy;
  const rotZY = pos2dX * cam.sy + pos2dY * cam.cy;
  // Positive z (higher loss) rises upward (+Y in clip space) and closer to viewer (-Z in depth)
  const rotXY = rotZY * cam.cp + z * cam.sp;
  const rotXZ = rotZY * cam.sp - z * cam.cp;

  const clipX = rotZX * cam.scaleX;
  const clipY = rotXY * cam.scaleY;
  const clipZ = Math.min(Math.max(rotXZ * cam.scaleZ, -0.98), 0.98);

  return {
    sx: (clipX * 0.5 + 0.5) * width,
    sy: (0.5 - clipY * 0.5) * height,
    clipX,
    clipY,
    clipZ,
  };
}

/**
 * Inverse 3D projection: maps a screen pointer position (sx, sy) back to parameter space (wx, wy)
 * at normalized height `normH` (default 0.5), with optional heightfield refinement on `lossGrid`.
 */
export function screenToWorldSurface3D(
  sx: number,
  sy: number,
  viewport: Viewport2DBounds,
  params: Surface3DProjectionParams,
  normH = 0.5,
  lossGrid?: Float32Array,
  minLoss = 0,
  maxLoss = 1
): { wx: number; wy: number } {
  const width = Math.max(params.width, 1);
  const height = Math.max(params.height, 1);
  if (!(params.zScale > 0.01)) {
    const wx = viewport.xMin + (sx / width) * (viewport.xMax - viewport.xMin);
    const wy = viewport.yMin + ((height - sy) / height) * (viewport.yMax - viewport.yMin);
    return { wx, wy };
  }

  const cam = computeSurface3DCameraTransform(params);
  const clipX = (sx / width) * 2.0 - 1.0;
  const clipY = 1.0 - (sy / height) * 2.0;
  const rotZX = clipX / Math.max(cam.scaleX, 1e-6);
  const rotXY = clipY / Math.max(cam.scaleY, 1e-6);

  const unprojectAtHeight = (h: number): { wx: number; wy: number } => {
    const clampedH = Number.isFinite(h) ? Math.min(Math.max(h, 0.0), 1.0) : 0.5;
    const z = (clampedH - 0.5) * cam.effZScale;
    const rotZY = (rotXY - z * cam.sp) / Math.max(cam.cp, 0.05);

    const pos2dX = Math.min(Math.max(rotZX * cam.cy + rotZY * cam.sy, -1.0), 1.0);
    const pos2dY = Math.min(Math.max(-rotZX * cam.sy + rotZY * cam.cy, -1.0), 1.0);

    const u = (pos2dX + 1.0) * 0.5;
    const v = (pos2dY + 1.0) * 0.5;
    return {
      wx: viewport.xMin + u * (viewport.xMax - viewport.xMin),
      wy: viewport.yMin + v * (viewport.yMax - viewport.yMin),
    };
  };

  let pt = unprojectAtHeight(normH);
  if (lossGrid && lossGrid.length >= 4) {
    const refinedH = sampleNormalizedSurfaceHeight(
      pt.wx,
      pt.wy,
      viewport,
      lossGrid,
      minLoss,
      maxLoss
    );
    pt = unprojectAtHeight(0.5 * normH + 0.5 * refinedH);
  }
  return pt;
}

const VERTEX_SHADER_300_ES = `#version 300 es
precision highp float;
in vec2 a_uv;
in float a_height;
uniform float u_minLoss;
uniform float u_maxLoss;
uniform float u_zScale;
uniform float u_pitch;
uniform float u_yaw;
uniform vec3 u_projScale;
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

  // 3D Orbit Camera Projection (centered at normH = 0.5 and frustum-fitted via u_projScale)
  float z = (normH - 0.5) * u_zScale;
  float cy = cos(u_yaw), sy = sin(u_yaw);
  float cp = cos(u_pitch), sp = sin(u_pitch);

  vec3 p = vec3(pos2d.x, pos2d.y, z);
  vec3 rotZ = vec3(p.x * cy - p.y * sy, p.x * sy + p.y * cy, p.z);
  vec3 rotX = vec3(rotZ.x, rotZ.y * cp + rotZ.z * sp, rotZ.y * sp - rotZ.z * cp);
  gl_Position = vec4(
    rotX.x * u_projScale.x,
    rotX.y * u_projScale.y,
    clamp(rotX.z * u_projScale.z, -0.98, 0.98),
    1.0
  );
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
  private normHeightScratch: Float32Array;
  private vecProgram: WebGLProgram | null = null;
  private vecVao: WebGLVertexArrayObject | null = null;
  private vecInstBuffer: WebGLBuffer | null = null;
  private indexCount = 0;
  private gridSize = 128;

  constructor(canvas: HTMLCanvasElement, gridSize = 128) {
    this.gridSize = gridSize;
    this.normHeightScratch = new Float32Array(gridSize * gridSize);
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
    const total = this.gridSize * this.gridSize;
    if (lossGrid.length !== total) return false;

    const fbW = gl.drawingBufferWidth || width;
    const fbH = gl.drawingBufferHeight || height;
    gl.viewport(0, 0, fbW, fbH);
    gl.clearColor(isDark ? 0.09 : 0.98, isDark ? 0.09 : 0.98, isDark ? 0.09 : 0.98, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    // Pre-normalize heights on CPU in Float64 so GPU Float32 never overflows or loses precision
    const scratch = this.normHeightScratch;
    for (let i = 0; i < total; i++) {
      scratch[i] = normalizeLossHeight(lossGrid[i], minLoss, maxLoss);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.heightBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratch);

    const cam = computeSurface3DCameraTransform({
      zScale,
      pitch,
      yaw,
      width: fbW,
      height: fbH,
    });

    gl.uniform1f(gl.getUniformLocation(this.program, 'u_minLoss'), 0.0);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_maxLoss'), 1.0);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_zScale'), cam.effZScale);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_pitch'), cam.safePitch);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_yaw'), cam.safeYaw);
    gl.uniform3f(
      gl.getUniformLocation(this.program, 'u_projScale'),
      cam.scaleX,
      cam.scaleY,
      cam.scaleZ
    );
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_isDark'), isDark ? 1 : 0);

    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);

    // Pipeline 2: Instanced 2,500-arrow Vector Field in a single gl.drawArraysInstanced() call [FR-3.4]
    if (
      showVectorField &&
      cam.effZScale <= 0.01 &&
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
  glRendered?: boolean;
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
    glRendered = true,
    linkedBrushPull,
  } = p;

  const hasValidGrid = Boolean(lossGrid && lossGrid.length >= 4);

  const projParams: Surface3DProjectionParams = {
    zScale,
    pitch,
    yaw,
    width,
    height,
  };

  const toScreen = (wx: number, wy: number, explicitLoss?: number): { sx: number; sy: number } => {
    if (!(zScale > 0.01)) {
      const pt = worldToScreen(wx, wy, viewport, width, height);
      return {
        sx: Math.min(Math.max(Number.isFinite(pt.sx) ? pt.sx : width * 0.5, -width), width * 2),
        sy: Math.min(Math.max(Number.isFinite(pt.sy) ? pt.sy : height * 0.5, -height), height * 2),
      };
    }
    const normH = sampleNormalizedSurfaceHeight(
      wx,
      wy,
      viewport,
      lossGrid,
      minLoss,
      maxLoss,
      explicitLoss
    );
    const pt3d = projectSurface3DPoint(wx, wy, normH, viewport, projParams, true);
    return { sx: pt3d.sx, sy: pt3d.sy };
  };

  const formatBound = (val: number): string => {
    if (!Number.isFinite(val)) return '0';
    return Math.abs(val) >= 1e4 || (Math.abs(val) > 0 && Math.abs(val) < 1e-2)
      ? val.toExponential(1)
      : Number(val.toFixed(1)).toString();
  };

  const scaleX = ctx.canvas ? ctx.canvas.width / Math.max(width, 1) : 1;
  const scaleY = ctx.canvas ? ctx.canvas.height / Math.max(height, 1) : 1;
  ctx.save();
  ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
  ctx.clearRect(0, 0, width, height);

  // 0. 3D Base Frame & Canvas 2D Surface Fallback when WebGL2 is unavailable
  if (zScale > 0.01) {
    ctx.save();
    // Subtle 3D floor pedestal frame at normH = 0.0
    const b00 = projectSurface3DPoint(viewport.xMin, viewport.yMin, 0.0, viewport, projParams, true);
    const b10 = projectSurface3DPoint(viewport.xMax, viewport.yMin, 0.0, viewport, projParams, true);
    const b11 = projectSurface3DPoint(viewport.xMax, viewport.yMax, 0.0, viewport, projParams, true);
    const b01 = projectSurface3DPoint(viewport.xMin, viewport.yMax, 0.0, viewport, projParams, true);
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(23, 23, 23, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(b00.sx, b00.sy);
    ctx.lineTo(b10.sx, b10.sy);
    ctx.lineTo(b11.sx, b11.sy);
    ctx.lineTo(b01.sx, b01.sy);
    ctx.closePath();
    ctx.stroke();

    // Vertical drop-line from active parameter (w1, w2) down to the 3D floor (normH = 0.0)
    const floorPt = projectSurface3DPoint(w1, w2, 0.0, viewport, projParams, true);
    const surfPt = toScreen(w1, w2);
    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = isDark ? 'rgba(249, 115, 22, 0.45)' : 'rgba(249, 115, 22, 0.5)';
    ctx.beginPath();
    ctx.moveTo(floorPt.sx, floorPt.sy);
    ctx.lineTo(surfPt.sx, surfPt.sy);
    ctx.stroke();
    ctx.setLineDash([]);

    if (typeof ctx.fillText === 'function') {
      ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.45)' : 'rgba(23, 23, 23, 0.45)';
      ctx.font = '500 10px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillText(
        `[${formatBound(viewport.xMin)}, ${formatBound(viewport.xMax)}]`,
        Math.min(Math.max((b00.sx + b10.sx) * 0.5 - 24, 6), Math.max(width - 68, 6)),
        Math.min(Math.max((b00.sy + b10.sy) * 0.5 + 12, 16), Math.max(height - 6, 16))
      );
      ctx.fillText(
        `[${formatBound(viewport.yMin)}, ${formatBound(viewport.yMax)}]`,
        Math.min(Math.max((b10.sx + b11.sx) * 0.5 + 4, 6), Math.max(width - 68, 6)),
        Math.min(Math.max((b10.sy + b11.sy) * 0.5 + 4, 16), Math.max(height - 6, 16))
      );
    }

    // If WebGL2 did not render (e.g. headless/fallback environment), draw wireframe 3D surface
    if (!glRendered && hasValidGrid) {
      const steps = 16;
      ctx.strokeStyle = isDark ? 'rgba(249, 115, 22, 0.35)' : 'rgba(249, 115, 22, 0.42)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const wxFixed = viewport.xMin + u * (viewport.xMax - viewport.xMin);
        const wyFixed = viewport.yMin + u * (viewport.yMax - viewport.yMin);
        ctx.beginPath();
        for (let j = 0; j <= steps; j++) {
          const v = j / steps;
          const wy = viewport.yMin + v * (viewport.yMax - viewport.yMin);
          const pt = toScreen(wxFixed, wy);
          if (j === 0) ctx.moveTo(pt.sx, pt.sy);
          else ctx.lineTo(pt.sx, pt.sy);
        }
        ctx.stroke();

        ctx.beginPath();
        for (let j = 0; j <= steps; j++) {
          const v = j / steps;
          const wx = viewport.xMin + v * (viewport.xMax - viewport.xMin);
          const pt = toScreen(wx, wyFixed);
          if (j === 0) ctx.moveTo(pt.sx, pt.sy);
          else ctx.lineTo(pt.sx, pt.sy);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

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
    } else if (zScale > 0.01) {
      const segs = 36;
      for (let i = 0; i <= segs; i++) {
        const ang = (i / segs) * Math.PI * 2;
        const pt = toScreen(
          Math.cos(ang) * regularizationRadius,
          Math.sin(ang) * regularizationRadius
        );
        if (i === 0) ctx.moveTo(pt.sx, pt.sy);
        else ctx.lineTo(pt.sx, pt.sy);
      }
      ctx.closePath();
    } else {
      const rx = Math.max(Math.abs(pRight.sx - origin.sx), 1);
      const ry = Math.max(Math.abs(pTop.sy - origin.sy), 1);
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
      if (!Number.isFinite(mag) || mag < 1e-6) continue;
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
    const headRaw = toScreen(head.w1, head.w2, head.loss);
    const headScreen = {
      sx: Math.min(Math.max(headRaw.sx, 8), Math.max(width - 8, 8)),
      sy: Math.min(Math.max(headRaw.sy, 8), Math.max(height - 8, 8)),
    };

    // RMSProp / Adam adaptive second-moment elliptical halo
    if (id === 'rmsprop' || id === 'adam') {
      const safeCache1 = Number.isFinite(head.cacheW1) ? Math.max(head.cacheW1, 0) : 0;
      const safeCache2 = Number.isFinite(head.cacheW2) ? Math.max(head.cacheW2, 0) : 0;
      const rx = Math.min(18, Math.max(6, 8 / Math.pow(safeCache1 + 1e-3, 0.15)));
      const ry = Math.min(18, Math.max(6, 8 / Math.pow(safeCache2 + 1e-3, 0.15)));
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
      head.nagLookaheadW2 !== undefined &&
      Number.isFinite(head.nagLookaheadW1) &&
      Number.isFinite(head.nagLookaheadW2)
    ) {
      const look = toScreen(head.nagLookaheadW1, head.nagLookaheadW2);
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(headScreen.sx, headScreen.sy);
      ctx.lineTo(
        Math.min(Math.max(look.sx, 8), Math.max(width - 8, 8)),
        Math.min(Math.max(look.sy, 8), Math.max(height - 8, 8))
      );
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
  const rawPos = toScreen(w1, w2);
  const currentPos = {
    sx: Math.min(Math.max(rawPos.sx, 8), Math.max(width - 8, 8)),
    sy: Math.min(Math.max(rawPos.sy, 8), Math.max(height - 8, 8)),
  };
  if (linkedBrushPull) {
    const pw1 = Number.isFinite(linkedBrushPull.pullW1) ? linkedBrushPull.pullW1 : 0;
    const pw2 = Number.isFinite(linkedBrushPull.pullW2) ? linkedBrushPull.pullW2 : 0;
    const pullMag = Math.hypot(pw1, pw2);
    if (pullMag > 1e-6) {
      const maxSpan = Math.max(
        viewport.xMax - viewport.xMin,
        viewport.yMax - viewport.yMin,
        1.0
      );
      const cappedLen = Math.min(pullMag * 0.35, maxSpan * 0.25);
      const scale = cappedLen / pullMag;
      const target = toScreen(w1 + pw1 * scale, w2 + pw2 * scale);
      ctx.save();
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(currentPos.sx, currentPos.sy);
      ctx.lineTo(
        Math.min(Math.max(target.sx, 8), Math.max(width - 8, 8)),
        Math.min(Math.max(target.sy, 8), Math.max(height - 8, 8))
      );
      ctx.stroke();
      ctx.restore();
    }
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
