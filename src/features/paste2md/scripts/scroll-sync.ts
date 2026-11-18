/**
 * scroll-sync.ts — Deterministic, loop-free synchronized scrolling controller
 * for the split-pane Paste to Markdown editor.
 *
 * Key invariants that prevent UI / scroll jumping while typing:
 *   1. Active Driver Ownership: Only the pane the user is actively scrolling
 *      ('editor' vs 'preview') may drive the opposite pane.
 *   2. User-Edit Lock: Typing, pasting, deleting, or formatting in the editor
 *      locks ownership to 'editor' and blocks any Preview -> Editor scroll sync.
 *   3. Preview Mutation Lock: DOM replacements, height clamping, image loads,
 *      and async Mermaid SVG swaps inside Preview never propagate back to Editor.
 *   4. Timestamp Echo Suppression: Replaces fragile single-rAF flags (which
 *      race when browsers dispatch scroll events on the next frame) with a
 *      deterministic time window + 1px sub-pixel deadband.
 */

export type ScrollDriver = 'editor' | 'preview';

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface ScrollSyncDeps {
  isEnabled: () => boolean;
  getEditorMetrics: () => ScrollMetrics | null;
  getPreviewMetrics: () => ScrollMetrics | null;
  scrollEditorTo: (top: number) => void;
  scrollPreviewTo: (top: number) => void;
  now?: () => number;
}

export interface ScrollSyncController {
  setActiveDriver(driver: ScrollDriver): void;
  getActiveDriver(): ScrollDriver;
  markUserEditing(): void;
  beginPreviewMutation(): void;
  endPreviewMutation(): void;
  handleEditorScroll(metrics: ScrollMetrics): void;
  handlePreviewScroll(metrics: ScrollMetrics): void;
}

/** Echo-suppression window (ms) covering cross-frame browser scroll dispatch. */
const ECHO_SUPPRESS_MS = 140;
/** Extra suppression window (ms) after user edits or preview DOM mutations. */
const MUTATION_SUPPRESS_MS = 220;
/** Minimum scroll delta (px) before applying programmatic scroll sync. */
const SCROLL_DEADBAND_PX = 1;

function clampRatio(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  const maxScroll = scrollHeight - clientHeight;
  if (maxScroll <= 0) return 0;
  const raw = scrollTop / maxScroll;
  if (!Number.isFinite(raw)) return 0;
  return Math.min(1, Math.max(0, raw));
}

export function createScrollSyncController(deps: ScrollSyncDeps): ScrollSyncController {
  const now = deps.now ?? (() => performance.now());

  let activeDriver: ScrollDriver = 'editor';
  let ignoreEditorUntil = 0;
  let ignorePreviewUntil = 0;
  let previewMutationDepth = 0;

  return {
    setActiveDriver(driver: ScrollDriver): void {
      if (driver !== activeDriver) {
        activeDriver = driver;
        if (driver === 'preview' && previewMutationDepth === 0) {
          ignorePreviewUntil = 0;
        } else if (driver === 'editor') {
          ignoreEditorUntil = 0;
        }
      }
    },

    getActiveDriver(): ScrollDriver {
      return activeDriver;
    },

    markUserEditing(): void {
      activeDriver = 'editor';
      ignorePreviewUntil = Math.max(ignorePreviewUntil, now() + MUTATION_SUPPRESS_MS);
    },

    beginPreviewMutation(): void {
      previewMutationDepth += 1;
      ignorePreviewUntil = Math.max(ignorePreviewUntil, now() + MUTATION_SUPPRESS_MS);
    },

    endPreviewMutation(): void {
      previewMutationDepth = Math.max(0, previewMutationDepth - 1);
      ignorePreviewUntil = Math.max(ignorePreviewUntil, now() + MUTATION_SUPPRESS_MS);
    },

    handleEditorScroll(metrics: ScrollMetrics): void {
      if (!deps.isEnabled()) return;
      if (activeDriver !== 'editor') return;
      const ts = now();
      if (ts < ignoreEditorUntil) return;

      const preview = deps.getPreviewMetrics();
      if (!preview) return;

      const ratio = clampRatio(metrics.scrollTop, metrics.scrollHeight, metrics.clientHeight);
      const maxPreview = Math.max(0, preview.scrollHeight - preview.clientHeight);
      const targetTop = ratio * maxPreview;

      if (Math.abs(preview.scrollTop - targetTop) < SCROLL_DEADBAND_PX) return;

      ignorePreviewUntil = Math.max(ignorePreviewUntil, ts + ECHO_SUPPRESS_MS);
      deps.scrollPreviewTo(targetTop);
    },

    handlePreviewScroll(metrics: ScrollMetrics): void {
      if (!deps.isEnabled()) return;
      if (activeDriver !== 'preview') return;
      if (previewMutationDepth > 0) return;
      const ts = now();
      if (ts < ignorePreviewUntil) return;

      const editor = deps.getEditorMetrics();
      if (!editor) return;

      const ratio = clampRatio(metrics.scrollTop, metrics.scrollHeight, metrics.clientHeight);
      const maxEditor = Math.max(0, editor.scrollHeight - editor.clientHeight);
      const targetTop = ratio * maxEditor;

      if (Math.abs(editor.scrollTop - targetTop) < SCROLL_DEADBAND_PX) return;

      ignoreEditorUntil = Math.max(ignoreEditorUntil, ts + ECHO_SUPPRESS_MS);
      deps.scrollEditorTo(targetTop);
    },
  };
}
