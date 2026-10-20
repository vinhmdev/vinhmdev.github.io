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
import { initShare, notifyChange as shareNotify, hasShareLink } from '@shared/paste-share/share';

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

  // Keep char count + height in sync, and refresh the share bar's dirty state.
  input.addEventListener('input', () => {
    if (charCount) charCount.textContent = String(input.value.length);
    autoGrow(input);
    shareNotify();
  });
  title.addEventListener('input', shareNotify);
  autoGrow(input);

  // Ctrl/Cmd+Enter opens the share dialog.
  const openShare = (): void => document.getElementById('share-btn')?.click();
  input.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') openShare();
  });

  // Share layer (encrypt + share link, open shared pastes, local history).
  initShare({
    getValue,
    setValue,
    getTitle,
    setTitle,
    showToast,
    t,
    linkBase: '/paste/',
    storageKey: 'paste:docs',
    setReadOnly,
  });

  // Nothing to restore on a fresh page — a share link (if present) is loaded
  // by initShare() into the editor.
  if (!hasShareLink()) title.focus();
});
