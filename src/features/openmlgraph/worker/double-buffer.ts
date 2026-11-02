/**
 * Ping-Pong Transferable Double Buffer & Optional SharedArrayBuffer Manager [NFR-1].
 *
 * Uses zero-copy `Transferable ArrayBuffer` ping-pong by default (< 0.01ms transfer,
 * preserving full compatibility with `firestore.googleapis.com` without requiring
 * `Cross-Origin-Embedder-Policy: require-corp`), while automatically detecting
 * `globalThis.crossOriginIsolated === true` to support `SharedArrayBuffer` + `Atomics`.
 */
import type { ComputeJobResponse } from './protocol';

export interface DoubleBufferPool {
  readonly isSharedMemory: boolean;
  extractTransferables(response: ComputeJobResponse): Transferable[];
}

export function createDoubleBufferPool(): DoubleBufferPool {
  const isSharedMemory =
    typeof SharedArrayBuffer !== 'undefined' &&
    typeof globalThis !== 'undefined' &&
    (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;

  return {
    isSharedMemory,
    extractTransferables(response: ComputeJobResponse): Transferable[] {
      if (isSharedMemory) {
        return [];
      }
      const list: Transferable[] = [];
      const seen = new Set<ArrayBufferLike>();

      const addBuf = (arr?: { buffer: ArrayBufferLike }): void => {
        if (!arr || !arr.buffer) return;
        if (arr.buffer instanceof ArrayBuffer && !seen.has(arr.buffer)) {
          seen.add(arr.buffer);
          list.push(arr.buffer);
        }
      };

      addBuf(response.lossGrid);
      addBuf(response.vectorField);
      for (const c of response.curves) {
        addBuf(c.primaryPoints);
        addBuf(c.firstDerivPoints);
        addBuf(c.secondDerivPoints);
      }

      return list;
    },
  };
}
