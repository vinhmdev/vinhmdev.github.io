/**
 * 3-Tier URL Hash Routing State Machine (`HashSessionMode`).
 *
 * Distinguishes and coordinates the 3 URL Hash formats on `/openmlgraph/`:
 * 1. `'local_url'`      : `#v2.dr.<deflate-base64url>` (Stateless compressed URL)
 * 2. `'cloud_e2ee'`     : `#<pasteId>.<aesKey>` (Firebase E2EE encrypted share via `@shared/paste/*`)
 * 3. `'public_gallery'` : `#g.<graphId>` (Firebase Community Gallery public snapshot)
 *
 * CRITICAL INVARIANT: When `mode` is `'cloud_e2ee'` or `'public_gallery'`,
 * automatic 300ms `#v2.dr.*` `history.replaceState` updates are LOCKED so the
 * user's AES key and cloud document ID are never overwritten while dragging sliders!
 */
import type { HashSessionMode } from '../types/state';

export type ParsedHashRoute =
  | { mode: 'local_url'; rawHash: string }
  | { mode: 'cloud_e2ee'; pasteId: string; aesKey: string }
  | { mode: 'public_gallery'; graphId: string }
  | { mode: 'empty' };

export function classifyUrlHash(hash: string): ParsedHashRoute {
  const raw = hash.replace(/^#/, '').trim();
  if (!raw) return { mode: 'empty' };

  if (/^v\d+\.(dr|fl)\.[A-Za-z0-9_-]+$/.test(raw)) {
    return { mode: 'local_url', rawHash: `#${raw}` };
  }

  if (/^g\.[A-Za-z0-9_-]+$/.test(raw)) {
    return { mode: 'public_gallery', graphId: raw.slice(2) };
  }

  const dot = raw.indexOf('.');
  if (dot > 0 && dot < raw.length - 1) {
    const pasteId = raw.slice(0, dot);
    const aesKey = raw.slice(dot + 1);
    if (aesKey.length === 43) {
      return { mode: 'cloud_e2ee', pasteId, aesKey };
    }
  }

  return { mode: 'empty' };
}

let urlDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleStatelessUrlUpdate(
  sessionMode: HashSessionMode,
  encodeFn: () => string,
  debounceMs = 300
): void {
  // Never overwrite an active Firebase E2EE or Public Gallery link!
  if (sessionMode !== 'local_url') return;
  if (typeof window === 'undefined' || typeof history === 'undefined') return;

  if (urlDebounceTimer) clearTimeout(urlDebounceTimer);
  urlDebounceTimer = setTimeout(() => {
    try {
      const hash = encodeFn();
      if (hash.length <= 2000) {
        history.replaceState(null, '', hash);
      }
    } catch {
      /* ignore URL update error */
    }
  }, debounceMs);
}
