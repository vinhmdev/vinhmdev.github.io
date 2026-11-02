/**
 * Tier 2 Zero-Backend Stateless URL Hash Codec (`#v2.dr.<payload>`) [FR-5.2, AC-05].
 *
 * Pipeline:
 * 1. Packs `GraphStateV2` into a Compact Positional Array tuple (eliminating repeated JSON keys)
 * 2. Compresses UTF-8 bytes via RFC 1951 `deflate-raw` (`fflate.deflateSync` + native
 *    `CompressionStream('deflate-raw')` async pipeline)
 * 3. Encodes to URL-safe Base64 without padding (`#v2.dr.<payload>`)
 * 4. Supports Unidirectional Schema Migration (`v1 -> v2`) for legacy links.
 *
 * Guarantees that 3 expressions + 5 sliders + 200 interactive data points compress
 * to ~900-1,420 characters (strictly <= 2,000 chars per [AC-05]).
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import type { SymbolRole, SubgradConvention } from '../types/math';
import type {
  DataPoint2D,
  ExpressionItem,
  GraphStateV2,
  LossKind,
  OptimizerRaceConfig,
  RegularizationKind,
  RightViewportMode,
  SliderState,
  ViewMode,
  Viewport2DBounds,
} from '../types/state';

export const URL_HASH_PREFIX_V2 = '#v2.dr.';

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  if (typeof btoa === 'function') {
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  return Buffer.from(bytes).toString('base64url');
}

function fromBase64Url(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  if (typeof atob === 'function') {
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const binary = atob(b64 + pad);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }
  return new Uint8Array(Buffer.from(b64url, 'base64url'));
}

function num4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

type CompactExprTuple = [string, string, string, number, string?];
type CompactSliderTuple = [string, string, SymbolRole, number, number, number, number];

interface CompactPayloadV2 {
  /** Schema version */
  v: 2;
  /** [activeTemplateId, title, viewMode, rightViewportMode, subgradConvention, lossKind, regKind, regRadius, batchNorm, showRes, showVec] */
  m: [
    string,
    string,
    ViewMode,
    RightViewportMode,
    SubgradConvention,
    LossKind,
    RegularizationKind,
    number,
    number,
    number,
    number,
  ];
  /** Expressions: [id, latex, color, bitFlags (vis|d1<<1|d2<<2), label?] */
  e: CompactExprTuple[];
  /** Sliders: [name, latex, role, value, min, max, step] */
  s: CompactSliderTuple[];
  /** Binary delta-encoded Int32Array of [dx_scaled, dy_scaled, flags] in Base64URL */
  db?: string;
  /** Legacy array fallback */
  d?: number[];
  /** Viewports: [lxMin, lxMax, lyMin, lyMax, rxMin, rxMax, ryMin, ryMax] */
  vp: [number, number, number, number, number, number, number, number];
  /** Symbol overrides */
  o?: Record<string, SymbolRole>;
  /** Optimizer race config: [startW1, startW2, steps, currentStep, flags, lrSchedule] */
  r?: [number, number, number, number, number, OptimizerRaceConfig['lrSchedule'], string?];
}

export function packStateToCompactV2(state: GraphStateV2): CompactPayloadV2 {
  const e: CompactExprTuple[] = state.expressions.map((item) => {
    const flags =
      (item.visible ? 1 : 0) |
      (item.showFirstDerivative ? 2 : 0) |
      (item.showSecondDerivative ? 4 : 0);
    return item.label
      ? [item.id, item.latex, item.color, flags, item.label]
      : [item.id, item.latex, item.color, flags];
  });

  const s: CompactSliderTuple[] = Object.values(state.sliders).map((sl) => [
    sl.name,
    sl.latex,
    sl.role,
    num4(sl.value),
    num4(sl.min),
    num4(sl.max),
    num4(sl.step),
  ]);

  // Delta-encode scaled integer coordinates (x * 10000, y * 10000) into binary Int32Array
  const nPts = state.dataPoints.length;
  const intBuf = new Int32Array(nPts * 3);
  let prevXi = 0;
  let prevYi = 0;
  for (let i = 0; i < nPts; i++) {
    const pt = state.dataPoints[i];
    const xi = Math.round(pt.x * 10000);
    const yi = Math.round(pt.y * 10000);
    const splitBit = pt.split === 'test' ? 1 : 0;
    const lblBits = pt.label !== undefined ? (pt.label + 2) << 1 : 0;
    intBuf[i * 3] = xi - prevXi;
    intBuf[i * 3 + 1] = yi - prevYi;
    intBuf[i * 3 + 2] = splitBit | lblBits;
    prevXi = xi;
    prevYi = yi;
  }
  const db = toBase64Url(new Uint8Array(intBuf.buffer));

  const race = state.optimizerRace;
  const raceFlags =
    (race.enabledOptimizers.sgd ? 1 : 0) |
    (race.enabledOptimizers.momentum ? 2 : 0) |
    (race.enabledOptimizers.rmsprop ? 4 : 0) |
    (race.enabledOptimizers.adam ? 8 : 0) |
    (race.useNesterov ? 16 : 0) |
    (race.adamBiasCorrection ? 32 : 0);

  return {
    v: 2,
    m: [
      state.activeTemplateId,
      state.title,
      state.viewMode,
      state.rightViewportMode,
      state.subgradConvention,
      state.lossKind,
      state.regularizationKind,
      num4(state.regularizationRadius),
      state.batchNormEnabled ? 1 : 0,
      state.showResiduals ? 1 : 0,
      state.showVectorField ? 1 : 0,
    ],
    e,
    s,
    db,
    vp: [
      num4(state.leftViewport.xMin),
      num4(state.leftViewport.xMax),
      num4(state.leftViewport.yMin),
      num4(state.leftViewport.yMax),
      num4(state.rightViewport.xMin),
      num4(state.rightViewport.xMax),
      num4(state.rightViewport.yMin),
      num4(state.rightViewport.yMax),
    ],
    o: Object.keys(state.symbolOverrides).length > 0 ? state.symbolOverrides : undefined,
    r: [
      num4(race.startW1),
      num4(race.startW2),
      race.steps,
      race.currentStep,
      raceFlags,
      race.lrSchedule,
      race.customJsCode,
    ],
  };
}

export function unpackCompactV2ToState(
  compact: CompactPayloadV2,
  fallbackBase: GraphStateV2
): GraphStateV2 {
  const [
    activeTemplateId,
    title,
    viewMode,
    rightViewportMode,
    subgradConvention,
    lossKind,
    regularizationKind,
    regularizationRadius,
    batchNormBit,
    showResBit,
    showVecBit,
  ] = compact.m;

  const expressions: ExpressionItem[] = compact.e.map(([id, latex, color, flags, label]) => ({
    id,
    latex,
    color,
    visible: (flags & 1) !== 0,
    showFirstDerivative: (flags & 2) !== 0,
    showSecondDerivative: (flags & 4) !== 0,
    label,
  }));

  const sliders: Record<string, SliderState> = {};
  for (const [name, latex, role, value, min, max, step] of compact.s) {
    sliders[name] = {
      name,
      latex,
      role,
      value,
      min,
      max,
      step,
      playing: false,
      speed: 1,
      loopMode: 'bounce',
      direction: 1,
    };
  }

  const dataPoints: DataPoint2D[] = [];
  if (typeof compact.db === 'string' && compact.db.length > 0) {
    const rawU8 = fromBase64Url(compact.db);
    const aligned = new Uint8Array(rawU8.length);
    aligned.set(rawU8);
    const intBuf = new Int32Array(aligned.buffer);
    let prevXi = 0;
    let prevYi = 0;
    for (let i = 0; i + 2 < intBuf.length; i += 3) {
      prevXi += intBuf[i];
      prevYi += intBuf[i + 1];
      const flags = intBuf[i + 2];
      const x = prevXi / 10000;
      const y = prevYi / 10000;
      const split = (flags & 1) !== 0 ? 'test' : 'train';
      const lblRaw = flags >> 1;
      const label = lblRaw > 0 ? lblRaw - 2 : undefined;
      dataPoints.push({
        id: `p${i / 3 + 1}`,
        x,
        y,
        x2: y,
        label,
        split,
      });
    }
  } else if (Array.isArray(compact.d)) {
    for (let i = 0; i + 2 < compact.d.length; i += 3) {
      const x = compact.d[i];
      const y = compact.d[i + 1];
      const flags = compact.d[i + 2];
      const split = (flags & 1) !== 0 ? 'test' : 'train';
      const lblRaw = flags >> 1;
      const label = lblRaw > 0 ? lblRaw - 2 : undefined;
      dataPoints.push({
        id: `p${i / 3 + 1}`,
        x,
        y,
        x2: y,
        label,
        split,
      });
    }
  }

  const leftViewport: Viewport2DBounds = {
    xMin: compact.vp[0],
    xMax: compact.vp[1],
    yMin: compact.vp[2],
    yMax: compact.vp[3],
  };
  const rightViewport: Viewport2DBounds = {
    xMin: compact.vp[4],
    xMax: compact.vp[5],
    yMin: compact.vp[6],
    yMax: compact.vp[7],
  };

  const r = compact.r;
  const rFlags = r ? r[4] : 15 | 32;

  return {
    ...fallbackBase,
    v: 2,
    activeTemplateId,
    title,
    viewMode,
    rightViewportMode,
    subgradConvention,
    lossKind,
    regularizationKind,
    regularizationRadius,
    batchNormEnabled: batchNormBit === 1,
    showResiduals: showResBit === 1,
    showVectorField: showVecBit === 1,
    expressions,
    sliders,
    dataPoints,
    leftViewport,
    rightViewport,
    symbolOverrides: compact.o ?? {},
    optimizerRace: r
      ? {
          enabledOptimizers: {
            sgd: (rFlags & 1) !== 0,
            momentum: (rFlags & 2) !== 0,
            rmsprop: (rFlags & 4) !== 0,
            adam: (rFlags & 8) !== 0,
            custom_js: Boolean(r[6]),
          },
          useNesterov: (rFlags & 16) !== 0,
          adamBiasCorrection: (rFlags & 32) !== 0,
          startW1: r[0],
          startW2: r[1],
          steps: r[2],
          currentStep: r[3],
          playing: false,
          lrSchedule: r[5],
          customJsCode: r[6],
        }
      : fallbackBase.optimizerRace,
  };
}

/**
 * Unidirectional Schema Migration (`v1 -> v2`) [FR-5.2].
 */
export function migrateSchemaToV2(
  rawObj: unknown,
  fallbackBase: GraphStateV2
): GraphStateV2 {
  if (!rawObj || typeof rawObj !== 'object') return fallbackBase;
  const obj = rawObj as Record<string, unknown>;

  if (obj.v === 2 && Array.isArray(obj.m) && Array.isArray(obj.e)) {
    return unpackCompactV2ToState(obj as unknown as CompactPayloadV2, fallbackBase);
  }

  if (obj.v === 2 && Array.isArray(obj.expressions)) {
    return { ...fallbackBase, ...(obj as Partial<GraphStateV2>), v: 2 };
  }

  // Migrate legacy v1 schema -> v2
  const migrated: GraphStateV2 = {
    ...fallbackBase,
    v: 2,
    title: typeof obj.title === 'string' ? obj.title : fallbackBase.title,
    expressions: Array.isArray(obj.expressions)
      ? (obj.expressions as ExpressionItem[])
      : fallbackBase.expressions,
  };
  return migrated;
}

/**
 * Encodes `GraphStateV2` synchronously into `#v2.dr.<deflate-base64url>`.
 */
export function encodeStateToUrlHashSync(state: GraphStateV2): string {
  const compact = packStateToCompactV2(state);
  const rawBytes = strToU8(JSON.stringify(compact));
  const compressed = deflateSync(rawBytes, { level: 9 });
  return `${URL_HASH_PREFIX_V2}${toBase64Url(compressed)}`;
}

/**
 * Decodes `#v2.dr.<payload>` (or `#v1.dr.<payload>`) synchronously back into `GraphStateV2`.
 */
export function decodeStateFromUrlHashSync(
  hash: string,
  fallbackBase: GraphStateV2
): GraphStateV2 | null {
  try {
    const cleaned = hash.startsWith('#') ? hash : `#${hash}`;
    const match = /^#v(\d+)\.(dr|fl)\.([A-Za-z0-9_-]+)$/.exec(cleaned);
    if (!match) return null;

    const payloadB64 = match[3];
    const compressedBytes = fromBase64Url(payloadB64);
    const decompressedBytes = inflateSync(compressedBytes);
    const jsonStr = strFromU8(decompressedBytes);
    const parsed = JSON.parse(jsonStr);
    return migrateSchemaToV2(parsed, fallbackBase);
  } catch {
    return null;
  }
}

/**
 * Encodes `GraphStateV2` asynchronously using native `CompressionStream('deflate-raw')`
 * with automatic fallback to synchronous `fflate.deflateSync` [FR-5.2, AC-05].
 */
export async function encodeStateToUrlHashAsync(state: GraphStateV2): Promise<string> {
  if (typeof CompressionStream === 'function') {
    try {
      const compact = packStateToCompactV2(state);
      const rawBytes = strToU8(JSON.stringify(compact));
      const cs = new CompressionStream('deflate-raw');
      const writer = cs.writable.getWriter();
      void writer.write(new Uint8Array(rawBytes));
      void writer.close();
      const compressedBuf = await new Response(cs.readable).arrayBuffer();
      return `${URL_HASH_PREFIX_V2}${toBase64Url(new Uint8Array(compressedBuf))}`;
    } catch {
      return encodeStateToUrlHashSync(state);
    }
  }
  return encodeStateToUrlHashSync(state);
}

/**
 * Decodes `#v2.dr.<payload>` asynchronously using native `DecompressionStream('deflate-raw')`
 * with automatic fallback to synchronous `fflate.inflateSync` [FR-5.2, AC-05].
 */
export async function decodeStateFromUrlHashAsync(
  hash: string,
  fallbackBase: GraphStateV2
): Promise<GraphStateV2 | null> {
  if (typeof DecompressionStream === 'function') {
    try {
      const cleaned = hash.startsWith('#') ? hash : `#${hash}`;
      const match = /^#v(\d+)\.(dr|fl)\.([A-Za-z0-9_-]+)$/.exec(cleaned);
      if (!match) return null;
      const compressedBytes = fromBase64Url(match[3]);
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      void writer.write(new Uint8Array(compressedBytes));
      void writer.close();
      const decompressedBuf = await new Response(ds.readable).arrayBuffer();
      const jsonStr = strFromU8(new Uint8Array(decompressedBuf));
      return migrateSchemaToV2(JSON.parse(jsonStr), fallbackBase);
    } catch {
      return decodeStateFromUrlHashSync(hash, fallbackBase);
    }
  }
  return decodeStateFromUrlHashSync(hash, fallbackBase);
}
