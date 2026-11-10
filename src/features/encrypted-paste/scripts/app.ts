/**
 * app.ts — entry point for the encrypted-paste tool.
 *
 * The tool is a single compose editor (title + note). Sharing, opening a
 * shared link, in-place saving, forking, and the local "My pastes" history
 * are all handled by the shared share layer (@shared/paste-share/share),
 * exactly like the Paste-to-Markdown tool — so both tools behave the same:
 *   - Share button        → dialog to pick editable / read-only + expiry.
 *   - editable link        → opening + saving updates the same link.
 *   - read-only link       → frozen; editing forks a new link.
 *   - bottom status bar     → mode + save/fork/copy/detach.
 *
 * Title + note are encrypted together in the browser (payload.ts) before
 * storage; the key lives only in the link fragment, so the server only ever
 * sees ciphertext.
 */
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  rectangularSelection,
  placeholder,
} from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { initTheme } from '@shared/theme/toggle';
import { init as initI18n, t } from './i18n-client';
import {
  initShare,
  notifyChange as shareNotify,
  hasShareLink,
  hasActiveSharedDoc,
} from '@shared/paste-share/share';
import { createDualDraftStore } from '@shared/paste-share/draft-store';

// ─── Toast ──────────────────────────────────────────────────────────────────
let toastTimer: number | undefined;
function showToast(icon: string, message: string): void {
  const toast = document.getElementById('toast');
  const iconEl = document.getElementById('toast-icon');
  const msgEl = document.getElementById('toast-msg');
  if (!toast || !iconEl || !msgEl) return;
  iconEl.textContent = '';
  const iEl = document.createElement('i');
  iEl.setAttribute('data-lucide', icon);
  iEl.className = 'w-4 h-4';
  iconEl.appendChild(iEl);
  msgEl.textContent = message;
  window.lucide?.createIcons();
  toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2400);
}

// ─── CodeMirror Theme & Compartments ────────────────────────────────────────
const readOnlyCompartment = new Compartment();
const placeholderCompartment = new Compartment();

const pasteEditorTheme = EditorView.theme({
  '&': {
    flex: '1',
    width: '100%',
    fontSize: '0.9375rem',
    backgroundColor: 'transparent',
  },
  '.cm-scroller': {
    fontFamily: "'JetBrains Mono', monospace",
    lineHeight: '1.7',
    padding: '1.5rem 0',
    overflow: 'visible',
  },
  '.cm-content': {
    padding: '0 clamp(1rem, 3vw, 2rem) 0 0.5rem',
    caretColor: '#f97316',
    minHeight: '100%',
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
    padding: '0 0.75rem 0 clamp(0.75rem, 2vw, 1.5rem)',
    minWidth: '2.75rem',
    textAlign: 'right',
    fontSize: '0.75rem',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: '#f97316',
    fontWeight: '600',
  },
  '.cm-line': {
    padding: '0 4px',
  },
  '.cm-placeholder': {
    color: 'var(--color-neutral-400)',
  },
  '&.cm-focused': {
    outline: 'none',
  },
});

// ─── Bootstrap ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  window.lucide?.createIcons();
  initTheme();
  initI18n();

  const title = document.getElementById('paste-title') as HTMLInputElement;
  const host = document.getElementById('paste-input') as HTMLDivElement;
  const charCount = document.getElementById('char-count');
  const draftStore = createDualDraftStore('paste');

  let isReadOnly = false;
  let isProgrammaticSet = false;

  const openShare = (): boolean => {
    document.getElementById('share-btn')?.click();
    return true;
  };

  // Warn with a friendly toast when typing is attempted while in read-only mode.
  const handleReadOnlyAttempt = (e: KeyboardEvent): void => {
    if (!isReadOnly) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (
      [
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Home',
        'End',
        'PageUp',
        'PageDown',
        'Tab',
        'Escape',
      ].includes(e.key)
    ) {
      return;
    }
    showToast('lock', t('toast_readonly_hint'));
  };

  function persistDraftIfUnshared(content: string): void {
    if (!hasActiveSharedDoc()) {
      draftStore.save({ title: title.value, content });
    }
  }

  const editorView = new EditorView({
    state: EditorState.create({
      doc: '',
      extensions: [
        pasteEditorTheme,
        readOnlyCompartment.of(EditorState.readOnly.of(false)),
        placeholderCompartment.of(placeholder(t('placeholder_input'))),
        history(),
        lineNumbers(),
        highlightActiveLineGutter(),
        drawSelection(),
        rectangularSelection(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        keymap.of([
          { key: 'Mod-Enter', run: openShare },
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const val = update.state.doc.toString();
            if (charCount) charCount.textContent = String(val.length);
            if (!isProgrammaticSet) {
              persistDraftIfUnshared(val);
            }
            shareNotify();
          }
        }),
        EditorView.domEventHandlers({
          keydown: (e: KeyboardEvent) => {
            handleReadOnlyAttempt(e);
            return false;
          },
          paste: () => {
            if (isReadOnly) {
              showToast('lock', t('toast_readonly_hint'));
              return true;
            }
            return false;
          },
        }),
      ],
    }),
    parent: host,
  });

  // Update placeholder text when language changes.
  window.addEventListener('langchange', () => {
    editorView.dispatch({
      effects: placeholderCompartment.reconfigure(placeholder(t('placeholder_input'))),
    });
  });

  const getValue = (): string => editorView.state.doc.toString();
  const setValue = (s: string): void => {
    isProgrammaticSet = true;
    try {
      editorView.dispatch({
        changes: { from: 0, to: editorView.state.doc.length, insert: s },
      });
      if (charCount) charCount.textContent = String(s.length);
    } finally {
      isProgrammaticSet = false;
    }
  };
  const getTitle = (): string => title.value;
  const setTitle = (s: string): void => {
    title.value = s;
  };

  const setReadOnly = (ro: boolean): void => {
    isReadOnly = ro;
    title.readOnly = ro;
    editorView.dispatch({
      effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(ro)),
    });
    document.body.classList.toggle('paste-is-readonly', ro);
  };

  title.addEventListener('keydown', handleReadOnlyAttempt);
  title.addEventListener('input', () => {
    persistDraftIfUnshared(getValue());
    shareNotify();
  });

  // Clear button resets title + content and clears working draft if unshared.
  document.getElementById('clear-btn')?.addEventListener('click', () => {
    if (isReadOnly) {
      showToast('lock', t('toast_readonly_hint'));
      return;
    }
    setTitle('');
    setValue('');
    if (!hasActiveSharedDoc()) {
      void draftStore.clear();
    }
    shareNotify();
    showToast('trash-2', t('toast_cleared'));
  });

  // Share layer (encrypt + share link, open shared pastes, Dual Local/Cloud history).
  initShare({
    getValue,
    setValue,
    getTitle,
    setTitle,
    showToast,
    t,
    linkBase: '/paste/',
    storageKey: 'paste:docs',
    cloudCollection: 'paste_docs',
    setReadOnly,
    onBeforeSignOut: () => draftStore.flush(),
    onAuthWorkspaceSwitch: async (user) => {
      const draft = await draftStore.switchUser(user?.uid ?? null);
      if (!hasShareLink()) {
        setTitle(draft.title);
        setValue(draft.content);
      }
    },
    onDetach: async () => {
      const draft = await draftStore.load();
      setTitle(draft.title);
      setValue(draft.content);
    },
  });

  if (!hasShareLink()) title.focus();
});
