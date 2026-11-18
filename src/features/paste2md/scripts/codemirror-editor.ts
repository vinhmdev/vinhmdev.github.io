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
import { EditorState, Compartment, Text } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
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
    padding: '1.25rem 0',
    overflow: 'auto',
    scrollbarGutter: 'stable',
    overscrollBehavior: 'contain',
  },
  '.cm-content': {
    padding: '0 1.25rem 0 0.5rem',
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
    minWidth: '3.25rem',
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
   * When true (default), preserves cursor line/column and scroll position
   * across full-document transforms (e.g. Pretty / Compact) so the next
   * keystroke does not teleport back to line 1.
   * When false, resets cursor and scroll to the top (e.g. Clear / Load doc).
   */
  preservePosition?: boolean;
}

/**
 * Map a cursor offset from `oldDoc` onto the corresponding `(line, col)` in
 * `newDoc`, clamping safely when lines or columns shrink.
 */
export function computePreservedCursor(oldDoc: Text, oldHead: number, newDoc: Text): number {
  if (newDoc.length === 0) return 0;
  const clampedOldPos = Math.min(Math.max(0, oldHead), oldDoc.length);
  const oldLine = oldDoc.lineAt(clampedOldPos);
  const col = clampedOldPos - oldLine.from;
  const targetLineNumber = Math.min(oldLine.number, newDoc.lines);
  const targetLine = newDoc.line(targetLineNumber);
  return targetLine.from + Math.min(col, targetLine.length);
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
      history(),
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

/** Set editor content (replaces all). */
export function setValue(text: string, options: SetValueOptions = {}): void {
  if (!editorView) return;

  const preservePosition = options.preservePosition ?? true;
  const scroller = editorView.scrollDOM;
  const currentText = editorView.state.doc.toString();

  if (text === currentText) {
    if (!preservePosition) {
      scroller.scrollTop = 0;
      scroller.scrollLeft = 0;
    }
    return;
  }

  if (!preservePosition || text.length === 0) {
    editorView.dispatch({
      changes: { from: 0, to: editorView.state.doc.length, insert: text },
      selection: { anchor: 0 },
    });
    scroller.scrollTop = 0;
    scroller.scrollLeft = 0;
    return;
  }

  const top = scroller.scrollTop;
  const left = scroller.scrollLeft;
  const nextDoc = Text.of(text.split(/\r\n|\r|\n/));
  const nextAnchor = computePreservedCursor(
    editorView.state.doc,
    editorView.state.selection.main.head,
    nextDoc
  );

  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: text },
    selection: { anchor: nextAnchor },
  });

  // Preserve scroll position across full document replacements
  scroller.scrollTop = top;
  scroller.scrollLeft = left;
  requestAnimationFrame(() => {
    if (editorView) {
      editorView.scrollDOM.scrollTop = top;
      editorView.scrollDOM.scrollLeft = left;
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
