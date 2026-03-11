/**
 * CodeMirror 6 wrapper for Clipboard2Markdown editor.
 * Provides a clean API for the main app to interact with.
 */
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection } from '@codemirror/view';
import { EditorState, Compartment, EditorSelection } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle, indentOnInput, bracketMatching } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';

// --- Custom highlight style factory ---
// Only theme-sensitive values differ between light and dark; everything else is shared.
interface HighlightColors {
  heading: string;
  link: string;
  monoBg: string;
  quote: string;
  meta: string;
}

function buildHighlightStyle(colors: HighlightColors) {
  return HighlightStyle.define([
    { tag: tags.heading1, fontWeight: '700', fontSize: '1.4em', color: colors.heading },
    { tag: tags.heading2, fontWeight: '700', fontSize: '1.25em', color: colors.heading },
    { tag: tags.heading3, fontWeight: '600', fontSize: '1.1em', color: colors.heading },
    { tag: tags.heading4, fontWeight: '600', color: colors.heading },
    { tag: tags.heading5, fontWeight: '600', color: colors.heading },
    { tag: tags.heading6, fontWeight: '600', color: colors.heading },
    { tag: tags.strong, fontWeight: '700' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    { tag: tags.link, color: colors.link, textDecoration: 'underline' },
    { tag: tags.url, color: colors.link },
    { tag: tags.monospace, fontFamily: "'JetBrains Mono', monospace", backgroundColor: colors.monoBg, borderRadius: '3px' },
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
  },
  '.cm-content': {
    padding: '0 1.25rem',
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
    display: 'none',
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

// --- Singleton module state — one editor instance per page ---
let editorView: EditorView | null = null;
let updateCallbacks: Array<(value: string) => void> = [];
let scrollCallbacks: Array<(info: { scrollTop: number; scrollHeight: number; clientHeight: number }) => void> = [];

/**
 * Create and mount the CodeMirror editor.
 */
export function createEditor(parent: HTMLElement): EditorView {
  const state = EditorState.create({
    doc: '',
    extensions: [
      baseTheme,
      highlightCompartment.of(getHighlightExtensions()),
      history(),
      drawSelection(),
      rectangularSelection(),
      highlightActiveLine(),
      indentOnInput(),
      bracketMatching(),
      highlightSelectionMatches(),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const value = update.state.doc.toString();
          for (const cb of updateCallbacks) cb(value);
        }
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
  const observer = new MutationObserver(() => {
    if (editorView) {
      editorView.dispatch({
        effects: highlightCompartment.reconfigure(getHighlightExtensions()),
      });
    }
  });
  observer.observe(document.documentElement, {
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
export function setValue(text: string): void {
  if (!editorView) return;
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: text },
  });
}

/**
 * Insert text at the current cursor/selection position.
 * If there is a selection, it will be replaced by the inserted text.
 * If there are multiple selections, all are replaced.
 */
export function insertAtCursor(text: string): void {
  if (!editorView) return;
  const { state } = editorView;
  const changes = state.changeByRange((range) => ({
    changes: { from: range.from, to: range.to, insert: text },
    range: EditorSelection.cursor(range.from + text.length),
  }));
  editorView.dispatch(state.update(changes, { scrollIntoView: true }));
}

/** Register a callback for content changes. */
export function onUpdate(callback: (value: string) => void): void {
  updateCallbacks.push(callback);
}

/** Register a callback for scroll events. */
export function onScroll(callback: (info: { scrollTop: number; scrollHeight: number; clientHeight: number }) => void): void {
  scrollCallbacks.push(callback);
}

/** Get the scroll DOM element for synchronized scrolling. */
export function getScrollDOM(): HTMLElement | null {
  return editorView?.scrollDOM ?? null;
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
