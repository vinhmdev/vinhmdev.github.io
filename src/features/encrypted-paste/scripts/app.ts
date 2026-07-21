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

// Lucide is loaded via CDN — typed in src/shared/globals.d.ts. Fall back to a
// no-op if the CDN failed to load so a missing icon library can't take down
// the whole tool.
const lucide = window.lucide ?? { createIcons: () => {} };

// ─── Toast ──────────────────────────────────────────────────────────────────
let toastTimer: number | undefined;
function showToast(icon: string, message: string): void {
  const toast = document.getElementById('toast');
  const iconEl = document.getElementById('toast-icon');
  const msgEl = document.getElementById('toast-msg');
  if (!toast || !iconEl || !msgEl) return;
  iconEl.innerHTML = `<i data-lucide="${icon}" class="w-4 h-4"></i>`;
  msgEl.textContent = message;
  lucide.createIcons();
  toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2400);
}

// ─── Editor ──────────────────────────────────────────────────────────────────
/** Auto-grow the editor so the page scrolls instead of an inner box. */
function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

// ─── Bootstrap ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
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
  });

  // Nothing to restore on a fresh page — a share link (if present) is loaded
  // by initShare() into the editor.
  if (!hasShareLink()) title.focus();
});
