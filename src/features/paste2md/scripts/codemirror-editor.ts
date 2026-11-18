/**
 * CodeMirror 6 wrapper for Paste to Markdown (paste2md) editor.
 * Provides a clean API for the main app to interact with.
 */
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  rectangularSelection,
} from '@codemirror/view';
import {
  EditorState,
  Compartment,
  Text,
  ChangeSet,
  EditorSelection,
  Transaction,
  type ChangeSpec,
} from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  isolateHistory,
} from '@codemirror/commands';
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  HighlightStyle,
  indentOnInput,
  bracketMatching,
} from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';

// --- Custom highlight style factory ---
// Only theme-sensitive values differ between light and dark; everything else is shared.
// All tokens keep uniform 1em monospace metrics so typing `#`, `-`, `---`, or `=`
// never changes line height, re-wraps paragraphs, or shifts CodeMirror's virtualized height.
interface HighlightColors {
  heading: string;
  link: string;
  monoBg: string;
  quote: string;
  meta: string;
}

function buildHighlightStyle(colors: HighlightColors) {
  return HighlightStyle.define([
    {
      tag: tags.heading1,
      fontWeight: '700',
      color: colors.heading,
    },
    {
      tag: tags.heading2,
      fontWeight: '700',
      color: colors.heading,
    },
    {
      tag: tags.heading3,
      fontWeight: '600',
      color: colors.heading,
    },
    { tag: tags.heading4, fontWeight: '600', color: colors.heading },
    { tag: tags.heading5, fontWeight: '600', color: colors.heading },
    { tag: tags.heading6, fontWeight: '600', color: colors.heading },
    { tag: tags.strong, fontWeight: '700' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    { tag: tags.link, color: colors.link, textDecoration: 'underline' },
    { tag: tags.url, color: colors.link },
    {
      tag: tags.monospace,
      fontFamily: "'JetBrains Mono', monospace",
      backgroundColor: colors.monoBg,
      borderRadius: '3px',
    },
    { tag: tags.quote, color: colors.quote, fontStyle: 'italic' },
    { tag: tags.meta, color: colors.meta },
    { tag: tags.processingInstruction, color: colors.meta }, // markdown markers like **, ##
    { tag: tags.comment, color: colors.meta },
  ]);
}

const markdownHighlight = buildHighlightStyle({
  heading: '#c2410c',
  link: '#2563eb',
  monoBg: 'rgba(249, 115, 22, 0.08)',
  quote: '#78716c',
  meta: '#a3a3a3',
});

const markdownHighlightDark = buildHighlightStyle({
  heading: '#fb923c',
  link: '#60a5fa',
  monoBg: 'rgba(249, 115, 22, 0.12)',
  quote: '#a8a29e',
  meta: '#737373',
});

// --- Editor theme (base styles) ---
const baseTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '0.875rem',
  },
  '.cm-scroller': {
    fontFamily: "'JetBrains Mono', monospace",
    lineHeight: '1.7',
    padding: '0',
    overflow: 'auto',
    scrollbarGutter: 'stable',
    overscrollBehavior: 'contain',
  },
  '.cm-content': {
    padding: '1.25rem 1.25rem 1.25rem 0.5rem',
    caretColor: '#f97316',
  },
  '.cm-cursor': {
    borderLeftColor: '#f97316',
    borderLeftWidth: '2px',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(249, 115, 22, 0.04)',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'rgba(249, 115, 22, 0.15) !important',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'rgba(249, 115, 22, 0.2) !important',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    borderRight: 'none',
    color: 'var(--color-neutral-400)',
    userSelect: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 0.75rem 0 1rem',
    minWidth: '3.75rem',
    textAlign: 'right',
    fontSize: '0.75rem',
    fontVariantNumeric: 'tabular-nums',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: '#f97316',
    fontWeight: '600',
  },
  '.cm-line': {
    padding: '0 4px',
  },
  '&.cm-focused': {
    outline: 'none',
  },
});

// --- Compartments for dynamic reconfiguration ---
const highlightCompartment = new Compartment();
const readOnlyCompartment = new Compartment();
const historyCompartment = new Compartment();

// Check if currently in dark mode
function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark');
}

// Get highlight extensions for current theme
function getHighlightExtensions() {
  if (isDarkMode()) {
    return [
      syntaxHighlighting(markdownHighlightDark),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    ];
  }
  return [
    syntaxHighlighting(markdownHighlight),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  ];
}

export interface EditorUpdateMeta {
  isPaste: boolean;
  isComposing: boolean;
}

export interface SetValueOptions {
  /**
   * When true (default), applies minimal line-diff hunks so cursor position,
   * undo history, and visual viewport offset are preserved across full-document
   * transforms (e.g. Pretty / Compact) without yanking the screen.
   * When false, resets cursor and scroll to the top (e.g. Clear / Load doc).
   */
  preservePosition?: boolean;
  /**
   * When true, omits the replacement from Undo history and clears prior undo
   * entries (used when hydrating drafts, loading shared docs, or switching
   * auth workspaces so Cmd/Ctrl+Z never wipes loaded work or leaks prior docs).
   */
  resetHistory?: boolean;
}

interface LineDiffHunk {
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
}

const MAX_DIFF_EDIT_DISTANCE = 800;

function computeLineDiffHunks(
  oldLines: readonly string[],
  newLines: readonly string[],
  prefix: number,
  n: number,
  m: number
): LineDiffHunk[] {
  if (n === 0 && m === 0) return [];
  if (n === 0) return [{ oldStart: prefix, oldEnd: prefix, newStart: prefix, newEnd: prefix + m }];
  if (m === 0) return [{ oldStart: prefix, oldEnd: prefix + n, newStart: prefix, newEnd: prefix }];

  // Intern strings to integer IDs so Myers comparisons are O(1)
  const idByLine = new Map<string, number>();
  let nextId = 1;
  const a = new Int32Array(n);
  const b = new Int32Array(m);
  for (let i = 0; i < n; i++) {
    const s = oldLines[prefix + i];
    let id = idByLine.get(s);
    if (id === undefined) {
      id = nextId++;
      idByLine.set(s, id);
    }
    a[i] = id;
  }
  for (let j = 0; j < m; j++) {
    const s = newLines[prefix + j];
    let id = idByLine.get(s);
    if (id === undefined) {
      id = nextId++;
      idByLine.set(s, id);
    }
    b[j] = id;
  }

  const maxD = n + m;
  const limit = Math.min(maxD, MAX_DIFF_EDIT_DISTANCE);
  const offset = maxD;
  const v = new Int32Array(2 * maxD + 1);
  const trace: Int32Array[] = [];
  let foundD = -1;

  outer: for (let d = 0; d <= limit; d++) {
    if (d > 0) {
      trace[d] = v.slice(offset - (d - 1), offset + (d - 1) + 1);
    }
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        foundD = d;
        break outer;
      }
    }
  }

  if (foundD < 0) {
    return [{ oldStart: prefix, oldEnd: prefix + n, newStart: prefix, newEnd: prefix + m }];
  }

  const rawEdits: LineDiffHunk[] = [];
  let x = n;
  let y = m;
  for (let step = foundD; step >= 1; step--) {
    const vPrev = trace[step];
    const base = step - 1;
    const k = x - y;
    const moveDown = k === -step || (k !== step && vPrev[k - 1 + base] < vPrev[k + 1 + base]);
    const prevK = moveDown ? k + 1 : k - 1;
    const startX = vPrev[prevK + base];
    const startY = startX - prevK;
    const midX = moveDown ? startX : startX + 1;
    const midY = moveDown ? startY + 1 : startY;
    rawEdits.push({
      oldStart: prefix + startX,
      oldEnd: prefix + midX,
      newStart: prefix + startY,
      newEnd: prefix + midY,
    });
    x = startX;
    y = startY;
  }

  rawEdits.reverse();
  const merged: LineDiffHunk[] = [];
  for (const ed of rawEdits) {
    const prev = merged[merged.length - 1];
    if (prev && prev.oldEnd === ed.oldStart && prev.newEnd === ed.newStart) {
      prev.oldEnd = ed.oldEnd;
      prev.newEnd = ed.newEnd;
    } else {
      merged.push({ ...ed });
    }
  }
  return merged;
}

function normalizeLineMatchKey(line: string): string {
  return line.trim().replace(/\s+/g, ' ');
}

/**
 * Refine coarse replacement hunks by pairing non-empty lines whose whitespace-
 * normalized text matches (e.g. trailing-space trims or compacted table rows),
 * isolating pure blank-line insertions/deletions from intra-line edits.
 */
function refineReplacementHunks(
  hunks: readonly LineDiffHunk[],
  oldLines: readonly string[],
  newLines: readonly string[]
): LineDiffHunk[] {
  const refined: LineDiffHunk[] = [];

  for (const h of hunks) {
    const oldLen = h.oldEnd - h.oldStart;
    const newLen = h.newEnd - h.newStart;
    if (oldLen === 0 || newLen === 0 || (oldLen === 1 && newLen === 1)) {
      refined.push(h);
      continue;
    }

    const oldKeys = new Array<string>(oldLen);
    for (let i = 0; i < oldLen; i++) {
      oldKeys[i] = normalizeLineMatchKey(oldLines[h.oldStart + i]);
    }
    const newKeys = new Array<string>(newLen);
    for (let j = 0; j < newLen; j++) {
      newKeys[j] = normalizeLineMatchKey(newLines[h.newStart + j]);
    }

    let curOld = 0;
    let curNew = 0;
    for (let i = 0; i < oldLen; i++) {
      const key = oldKeys[i];
      if (!key) continue;
      let matchJ = -1;
      for (let j = curNew; j < newLen; j++) {
        if (newKeys[j] === key) {
          matchJ = j;
          break;
        }
      }
      if (matchJ < 0) continue;

      if (i > curOld || matchJ > curNew) {
        refined.push({
          oldStart: h.oldStart + curOld,
          oldEnd: h.oldStart + i,
          newStart: h.newStart + curNew,
          newEnd: h.newStart + matchJ,
        });
      }
      refined.push({
        oldStart: h.oldStart + i,
        oldEnd: h.oldStart + i + 1,
        newStart: h.newStart + matchJ,
        newEnd: h.newStart + matchJ + 1,
      });
      curOld = i + 1;
      curNew = matchJ + 1;
    }

    if (curOld < oldLen || curNew < newLen) {
      refined.push({
        oldStart: h.oldStart + curOld,
        oldEnd: h.oldEnd,
        newStart: h.newStart + curNew,
        newEnd: h.newEnd,
      });
    }
  }

  return refined;
}

export interface MinimalTextChange {
  from: number;
  to: number;
  insert: string;
}

/**
 * Compute minimal ordered character-range changes transforming `oldText` into
 * `newText` (both normalized to `\n`), preserving unchanged lines and trimming
 * common character prefixes/suffixes within modified lines so CodeMirror's
 * `ChangeSet.mapPos` tracks cursor positions accurately across Pretty/Compact.
 */
export function computeMinimalLineChanges(oldText: string, newText: string): MinimalTextChange[] {
  if (oldText === newText) return [];

  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const N = oldLines.length;
  const M = newLines.length;

  let prefix = 0;
  while (prefix < N && prefix < M && oldLines[prefix] === newLines[prefix]) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < N - prefix &&
    suffix < M - prefix &&
    oldLines[N - 1 - suffix] === newLines[M - 1 - suffix]
  ) {
    suffix++;
  }

  const n = N - prefix - suffix;
  const m = M - prefix - suffix;
  if (n === 0 && m === 0) return [];

  const lineStarts = new Int32Array(N);
  for (let i = 1; i < N; i++) {
    lineStarts[i] = lineStarts[i - 1] + oldLines[i - 1].length + 1;
  }

  const hunks = refineReplacementHunks(
    computeLineDiffHunks(oldLines, newLines, prefix, n, m),
    oldLines,
    newLines
  );
  const changes: MinimalTextChange[] = [];

  for (const { oldStart, oldEnd, newStart, newEnd } of hunks) {
    const oldCount = oldEnd - oldStart;
    const newCount = newEnd - newStart;

    if (oldCount > 0 && newCount > 0) {
      let from = lineStarts[oldStart];
      let to = lineStarts[oldEnd - 1] + oldLines[oldEnd - 1].length;
      let insert = newLines.slice(newStart, newEnd).join('\n');
      const oldSlice = oldText.slice(from, to);

      let cp = 0;
      while (
        cp < oldSlice.length &&
        cp < insert.length &&
        oldSlice.charCodeAt(cp) === insert.charCodeAt(cp)
      ) {
        cp++;
      }
      let cs = 0;
      while (
        cs < oldSlice.length - cp &&
        cs < insert.length - cp &&
        oldSlice.charCodeAt(oldSlice.length - 1 - cs) === insert.charCodeAt(insert.length - 1 - cs)
      ) {
        cs++;
      }

      from += cp;
      to -= cs;
      insert = insert.slice(cp, insert.length - cs);
      if (from < to || insert.length > 0) {
        changes.push({ from, to, insert });
      }
    } else if (oldCount > 0 && newCount === 0) {
      if (oldEnd < N) {
        changes.push({ from: lineStarts[oldStart], to: lineStarts[oldEnd], insert: '' });
      } else if (oldStart > 0) {
        const beforeNewline = lineStarts[oldStart - 1] + oldLines[oldStart - 1].length;
        changes.push({ from: beforeNewline, to: oldText.length, insert: '' });
      } else {
        changes.push({ from: 0, to: oldText.length, insert: '' });
      }
    } else if (oldCount === 0 && newCount > 0) {
      const insText = newLines.slice(newStart, newEnd).join('\n');
      if (oldStart > 0) {
        const beforeNewline = lineStarts[oldStart - 1] + oldLines[oldStart - 1].length;
        changes.push({ from: beforeNewline, to: beforeNewline, insert: '\n' + insText });
      } else {
        changes.push({ from: 0, to: 0, insert: insText + '\n' });
      }
    }
  }

  return changes;
}

function mapPosWithChanges(
  clampedOldPos: number,
  changes: readonly MinimalTextChange[],
  changeSet: ChangeSet,
  newDocLength: number
): number {
  for (const ch of changes) {
    if (
      ch.from < ch.to &&
      ch.insert.length > 0 &&
      clampedOldPos > ch.from &&
      clampedOldPos <= ch.to
    ) {
      const mappedStart = changeSet.mapPos(ch.from, -1);
      const offsetInOld = clampedOldPos - ch.from;
      const clampedInInsert = Math.min(offsetInOld, ch.insert.length);
      return Math.min(Math.max(0, mappedStart + clampedInInsert), newDocLength);
    }
    if (ch.from >= clampedOldPos) break;
  }
  const assoc = clampedOldPos === 0 && changes[0]?.from === 0 && changes[0]?.to === 0 ? 1 : -1;
  return Math.min(Math.max(0, changeSet.mapPos(clampedOldPos, assoc)), newDocLength);
}

/**
 * Map a cursor offset from `oldDoc` onto the corresponding semantic position in
 * `newDoc` across line insertions, deletions, and intra-line formatting edits.
 */
export function computePreservedCursor(oldDoc: Text, oldHead: number, newDoc: Text): number {
  if (newDoc.length === 0) return 0;
  const clampedOldPos = Math.min(Math.max(0, oldHead), oldDoc.length);
  const oldText = oldDoc.toString();
  const newText = newDoc.toString();
  if (oldText === newText) return clampedOldPos;

  const changes = computeMinimalLineChanges(oldText, newText);
  const changeSet = ChangeSet.of(changes as ChangeSpec[], oldDoc.length);
  return mapPosWithChanges(clampedOldPos, changes, changeSet, newDoc.length);
}

// --- Singleton module state — one editor instance per page ---
let editorView: EditorView | null = null;
let themeObserver: MutationObserver | null = null;
let updateCallbacks: Array<(value: string, meta: EditorUpdateMeta) => void> = [];
let scrollCallbacks: Array<
  (info: { scrollTop: number; scrollHeight: number; clientHeight: number }) => void
> = [];
let pasteCallback: ((html: string, plain: string) => string | null) | null = null;

/**
 * Create and mount the CodeMirror editor.
 */
export function createEditor(parent: HTMLElement): EditorView {
  themeObserver?.disconnect();

  const state = EditorState.create({
    doc: '',
    extensions: [
      baseTheme,
      highlightCompartment.of(getHighlightExtensions()),
      readOnlyCompartment.of(EditorState.readOnly.of(false)),
      historyCompartment.of(history()),
      lineNumbers(),
      highlightActiveLineGutter(),
      drawSelection(),
      rectangularSelection(),
      highlightActiveLine(),
      indentOnInput(),
      bracketMatching(),
      highlightSelectionMatches(),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const value = update.state.doc.toString();
          const meta: EditorUpdateMeta = {
            isPaste: update.transactions.some((tr) => tr.isUserEvent('input.paste')),
            isComposing: update.view.composing,
          };
          for (const cb of updateCallbacks) cb(value, meta);
        }
      }),
      // Listen for paste events — route through our converter
      EditorView.domEventHandlers({
        paste: (e: ClipboardEvent, view: EditorView) => {
          if (!pasteCallback) return false;
          const clipboard = e.clipboardData;
          if (!clipboard) return false;

          const html = clipboard.types.includes('text/html') ? clipboard.getData('text/html') : '';
          const plain = clipboard.types.includes('text/plain')
            ? clipboard.getData('text/plain')
            : '';
          const result = pasteCallback(html, plain);
          if (result === null || view.state.readOnly) return false;

          e.preventDefault();
          view.dispatch(view.state.replaceSelection(result), {
            scrollIntoView: true,
            userEvent: 'input.paste',
          });
          return true;
        },
      }),
      // Listen for scroll events
      EditorView.domEventHandlers({
        scroll: () => {
          if (!editorView) return;
          const scroller = editorView.scrollDOM;
          for (const cb of scrollCallbacks) {
            cb({
              scrollTop: scroller.scrollTop,
              scrollHeight: scroller.scrollHeight,
              clientHeight: scroller.clientHeight,
            });
          }
        },
      }),
      EditorView.lineWrapping,
    ],
  });

  editorView = new EditorView({ state, parent });

  // Watch for dark mode changes to update highlighting
  themeObserver = new MutationObserver(() => {
    if (editorView) {
      editorView.dispatch({
        effects: highlightCompartment.reconfigure(getHighlightExtensions()),
      });
    }
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });

  return editorView;
}

/** Get current editor content. */
export function getValue(): string {
  return editorView?.state.doc.toString() ?? '';
}

function purgeEditorHistory(view: EditorView): void {
  view.dispatch({ effects: historyCompartment.reconfigure([]) });
  view.dispatch({ effects: historyCompartment.reconfigure(history()) });
}

/** Set editor content (replaces all or applies minimal diff for transforms). */
export function setValue(text: string, options: SetValueOptions = {}): void {
  if (!editorView) return;

  const preservePosition = options.preservePosition ?? true;
  const resetHistory = options.resetHistory ?? false;
  const scroller = editorView.scrollDOM;
  const normalizedText = text.replace(/\r\n?/g, '\n');
  const currentText = editorView.state.doc.toString();

  if (normalizedText === currentText) {
    if (resetHistory) {
      purgeEditorHistory(editorView);
    }
    if (!preservePosition) {
      scroller.scrollTop = 0;
      scroller.scrollLeft = 0;
    }
    return;
  }

  if (!preservePosition || normalizedText.length === 0) {
    if (resetHistory) {
      editorView.dispatch({
        changes: { from: 0, to: editorView.state.doc.length, insert: normalizedText },
        selection: { anchor: 0 },
        annotations: Transaction.addToHistory.of(false),
        effects: historyCompartment.reconfigure([]),
      });
      editorView.dispatch({
        effects: historyCompartment.reconfigure(history()),
      });
    } else {
      editorView.dispatch({
        changes: { from: 0, to: editorView.state.doc.length, insert: normalizedText },
        selection: { anchor: 0 },
        annotations: [isolateHistory.of('full'), Transaction.userEvent.of('delete')],
      });
    }
    scroller.scrollTop = 0;
    scroller.scrollLeft = 0;
    return;
  }

  const top = scroller.scrollTop;
  const left = scroller.scrollLeft;
  const padTop = editorView.documentPadding.top;
  const oldSel = editorView.state.selection.main;
  const cursorBlock = editorView.lineBlockAt(oldSel.head);
  const cursorVisible =
    cursorBlock.bottom + padTop > top && cursorBlock.top + padTop < top + scroller.clientHeight;

  const changes = computeMinimalLineChanges(currentText, normalizedText);
  if (changes.length === 0) return;

  const changeSet = ChangeSet.of(changes as ChangeSpec[], editorView.state.doc.length);

  let refOffset: number;
  let refMappedPos: number;
  let nextSelection: EditorSelection;

  if (cursorVisible || !oldSel.empty) {
    refOffset = cursorBlock.top - top;
    if (oldSel.empty) {
      refMappedPos = mapPosWithChanges(oldSel.head, changes, changeSet, normalizedText.length);
      nextSelection = EditorSelection.single(refMappedPos);
    } else {
      nextSelection = editorView.state.selection.map(changeSet, -1);
      refMappedPos = nextSelection.main.head;
    }
  } else {
    // Cursor was left off-screen while the user scrolled elsewhere before
    // clicking Pretty/Compact: anchor both viewport and cursor to the first
    // non-blank visible line comfortably inside CodeMirror's scroll margin so
    // neither the screen nor the next keystroke jumps.
    const docHeightAtTop = Math.max(0, top - padTop + 28);
    let anchorBlock = editorView.lineBlockAtHeight(docHeightAtTop);
    const maxVisibleDocY = Math.max(docHeightAtTop, top - padTop + scroller.clientHeight - 28);
    const startLine = editorView.state.doc.lineAt(anchorBlock.from);
    for (let ln = startLine.number; ln <= editorView.state.doc.lines; ln++) {
      const candidateLine = editorView.state.doc.line(ln);
      const blk = editorView.lineBlockAt(candidateLine.from);
      if (blk.top > maxVisibleDocY) break;
      if (candidateLine.text.trim().length > 0) {
        anchorBlock = blk;
        break;
      }
    }
    refOffset = anchorBlock.top - top;
    refMappedPos = mapPosWithChanges(anchorBlock.from, changes, changeSet, normalizedText.length);
    nextSelection = EditorSelection.single(refMappedPos);
  }

  editorView.dispatch({
    changes: changes as ChangeSpec[],
    selection: nextSelection,
    annotations: [isolateHistory.of('full'), Transaction.userEvent.of('format')],
  });

  const applyAnchoredScroll = (view: EditorView): void => {
    const clampedPos = Math.min(Math.max(0, refMappedPos), view.state.doc.length);
    const newBlock = view.lineBlockAt(clampedPos);
    view.scrollDOM.scrollTop = Math.max(0, newBlock.top - refOffset);
    view.scrollDOM.scrollLeft = left;
  };

  applyAnchoredScroll(editorView);
  requestAnimationFrame(() => {
    if (editorView) {
      applyAnchoredScroll(editorView);
    }
  });
}

/** Register a callback for content changes. */
export function onUpdate(callback: (value: string, meta: EditorUpdateMeta) => void): void {
  updateCallbacks.push(callback);
}

/**
 * Register a paste handler. The callback receives (html, plain) clipboard strings
 * and should return the markdown string to insert, or null to let CodeMirror
 * handle the paste natively.
 * CodeMirror automatically places the result at the current cursor / replaces
 * any active selection — no manual cursor logic needed.
 */
export function onPaste(callback: (html: string, plain: string) => string | null): void {
  pasteCallback = callback;
}

/** Register a callback for scroll events. */
export function onScroll(
  callback: (info: { scrollTop: number; scrollHeight: number; clientHeight: number }) => void
): void {
  scrollCallbacks.push(callback);
}

/** Get the scroll DOM element for synchronized scrolling. */
export function getScrollDOM(): HTMLElement | null {
  return editorView?.scrollDOM ?? null;
}

/** Get the editable content DOM element (for IME compositionend listeners). */
export function getContentDOM(): HTMLElement | null {
  return editorView?.contentDOM ?? null;
}

/** Whether an IME composition session is currently active in the editor. */
export function isComposing(): boolean {
  return editorView?.composing ?? false;
}

/** Set scroll position. */
export function scrollTo(top: number): void {
  if (!editorView) return;
  editorView.scrollDOM.scrollTop = top;
}

/** Focus the editor. */
export function focus(): void {
  editorView?.focus();
}

/** Toggle read-only mode in the editor. */
export function setReadOnly(readOnly: boolean): void {
  if (!editorView) return;
  editorView.dispatch({
    effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly)),
  });
}
