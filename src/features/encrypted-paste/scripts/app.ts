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

// ─── Editor ──────────────────────────────────────────────────────────────────
/** Auto-grow the editor so the page scrolls instead of an inner box. */
function autoGrow(el: HTMLTextAreaElement): void {
  // When empty or cleared, let flex: 1 naturally fill the viewport height
  if (!el.value) {
    el.style.height = '';
    el.scrollTop = 0;
    return;
  }

  // If native field-sizing is supported, the browser handles height natively without scroll jumps.
  if (typeof CSS !== 'undefined' && CSS.supports && CSS.supports('field-sizing', 'content')) {
    el.scrollTop = 0;
    return;
  }

  const currentHeight = el.offsetHeight;
  // If content grew, expand directly without collapsing first — prevents scroll clamping.
  if (el.scrollHeight > currentHeight) {
    el.style.height = `${el.scrollHeight}px`;
    el.scrollTop = 0;
    return;
  }

  // If content might have shrunk (e.g. deletion):
  // Lock parent min-height temporarily during measurement so the document doesn't collapse
  // and force window.scrollY to clamp to the top.
  const parent = el.parentElement;
  const savedScrollY = window.scrollY;
  if (parent) {
    parent.style.minHeight = `${parent.offsetHeight}px`;
  }
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
  el.scrollTop = 0;
  if (parent) {
    parent.style.minHeight = '';
  }
  if (window.scrollY !== savedScrollY) {
    window.scrollTo({ top: savedScrollY, behavior: 'instant' as ScrollBehavior });
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  window.lucide?.createIcons();
  initTheme();
  initI18n();

  const title = document.getElementById('paste-title') as HTMLInputElement;
  const input = document.getElementById('paste-input') as HTMLTextAreaElement;
  const charCount = document.getElementById('char-count');
  const draftStore = createDualDraftStore('paste');

  const getValue = (): string => input.value;
  const setValue = (s: string): void => {
    input.value = s;
    if (charCount) charCount.textContent = String(s.length);
    autoGrow(input);
  };
  const getTitle = (): string => title.value;
  const setTitle = (s: string): void => {
    title.value = s;
  };

  let isReadOnly = false;
  const setReadOnly = (ro: boolean): void => {
    isReadOnly = ro;
    title.readOnly = ro;
    input.readOnly = ro;
    document.body.classList.toggle('paste-is-readonly', ro);
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
  title.addEventListener('keydown', handleReadOnlyAttempt);
  input.addEventListener('keydown', handleReadOnlyAttempt);

  function persistDraftIfUnshared(): void {
    if (!hasActiveSharedDoc()) {
      draftStore.save({ title: title.value, content: input.value });
    }
  }

  // Keep char count + height in sync, persist working draft, and refresh the share bar's dirty state.
  input.addEventListener('input', () => {
    if (charCount) charCount.textContent = String(input.value.length);
    autoGrow(input);
    persistDraftIfUnshared();
    shareNotify();
  });
  title.addEventListener('input', () => {
    persistDraftIfUnshared();
    shareNotify();
  });
  autoGrow(input);

  // Ctrl/Cmd+Enter opens the share dialog.
  const openShare = (): void => document.getElementById('share-btn')?.click();
  input.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') openShare();
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
