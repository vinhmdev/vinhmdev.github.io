/**
 * Tier 1 LocalStorage Persistence, 500ms Auto-Save & JSON File I/O [FR-5.1, FR-5.2, AC-05].
 *
 * Synchronizes active session state to `graphstudio_state_v2` in `localStorage`.
 */
import type { GraphStateV2 } from '../types/state';

export const STORAGE_KEY_V2 = 'graphstudio_state_v2';

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

export function saveStateToLocalStorage(state: GraphStateV2): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    const serialized = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY_V2, serialized);
    return true;
  } catch {
    return false;
  }
}

export function scheduleAutoSave(state: GraphStateV2, delayMs = 500): void {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    saveStateToLocalStorage(state);
  }, delayMs);
}

export function loadStateFromLocalStorage(): GraphStateV2 | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY_V2);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GraphStateV2>;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.expressions)) {
      return null;
    }
    return parsed as GraphStateV2;
  } catch {
    return null;
  }
}

export function clearStateFromLocalStorage(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.removeItem(STORAGE_KEY_V2);
    return true;
  } catch {
    return false;
  }
}

export function exportStateAsJsonString(state: GraphStateV2): string {
  return JSON.stringify(state, null, 2);
}

export function downloadStateJsonFile(state: GraphStateV2): void {
  if (typeof document === 'undefined') return;
  const json = exportStateAsJsonString(state);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const slug = (state.title || 'graphstudio-session')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  a.href = url;
  a.download = `${slug || 'graphstudio'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
