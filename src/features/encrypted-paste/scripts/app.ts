/**
 * app.ts — entry point for the encrypted-paste tool.
 *
 * One page, three views driven by the URL fragment:
 *   - no fragment            → CREATE  (compose + encrypt a new paste)
 *   - after create           → RESULT  (share link with the key in `#`)
 *   - fragment `#id.key`      → VIEW    (fetch, decrypt, display)
 *
 * The decryption key lives ONLY in the fragment and never reaches any
 * server. See crypto.ts / firestore.ts for the storage + crypto details.
 */
import { encrypt, decrypt, generateKey, keyToString, keyFromString } from './crypto';
import { createPaste, fetchPaste } from './firestore';
import { initTheme } from './theme';
import { init as initI18n, t, getCurrentLang } from './i18n-client';
import { isFirebaseConfigured } from '@shared/firebase/config';

// Lucide is loaded via CDN — typed in src/shared/globals.d.ts.
const lucide = window.lucide;

type ViewName = 'create' | 'result' | 'view' | 'status';

/** Show exactly one top-level view, hide the rest. */
function showView(name: ViewName): void {
  for (const v of ['create', 'result', 'view', 'status'] as ViewName[]) {
    document.getElementById(`${v}-view`)?.toggleAttribute('hidden', v !== name);
  }
}

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

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Format an expiry date for display, or a fallback when there is none. */
function formatExpiry(expireAt: Date | null): string {
  if (!expireAt) return t('meta_no_expiry');
  const dateStr = expireAt.toLocaleString(getCurrentLang() === 'vi' ? 'vi-VN' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return `${t('meta_expires')} ${dateStr}`;
}

// State needed to re-render language-dependent text after a language switch.
let currentStatus: { icon: string; key: string } | null = null;
let viewedExpiry: Date | null = null;

function renderStatus(icon: string, key: string): void {
  currentStatus = { icon, key };
  const el = document.getElementById('status-body');
  if (el) el.innerHTML = `<i data-lucide="${icon}" class="w-8 h-8"></i><p>${t(key)}</p>`;
  lucide.createIcons();
  showView('status');
}

// ─── CREATE ───────────────────────────────────────────────────────────────
function initCreate(): void {
  const input = document.getElementById('paste-input') as HTMLTextAreaElement;
  const expiry = document.getElementById('expiry-select') as HTMLSelectElement;
  const createBtn = document.getElementById('create-btn') as HTMLButtonElement;
  const charCount = document.getElementById('char-count');

  const updateCount = (): void => {
    if (charCount) charCount.textContent = String(input.value.length);
  };
  input.addEventListener('input', updateCount);
  updateCount();

  createBtn.addEventListener('click', async () => {
    const text = input.value;
    if (!text.trim()) {
      showToast('alert-triangle', t('toast_empty'));
      return;
    }
    if (!isFirebaseConfigured) {
      showToast('alert-triangle', t('toast_not_configured'));
      return;
    }

    createBtn.disabled = true;
    createBtn.classList.add('is-loading');
    try {
      const key = generateKey();
      const enc = await encrypt(text, key);
      const id = await createPaste(enc, Number(expiry.value));

      const url = `${location.origin}/paste/#${id}.${keyToString(key)}`;
      showResult(url);
      showToast('check-circle', t('toast_created'));
    } catch (err) {
      console.error('[paste] create failed:', err);
      showToast('alert-triangle', t('toast_create_failed'));
    } finally {
      createBtn.disabled = false;
      createBtn.classList.remove('is-loading');
    }
  });
}

// ─── RESULT ───────────────────────────────────────────────────────────────
function showResult(url: string): void {
  const urlInput = document.getElementById('share-url') as HTMLInputElement;
  const openLink = document.getElementById('open-url-btn') as HTMLAnchorElement;
  urlInput.value = url;
  openLink.href = url;
  showView('result');
  lucide.createIcons();
  urlInput.focus();
  urlInput.select();
}

function initResult(): void {
  document.getElementById('copy-url-btn')?.addEventListener('click', async () => {
    const urlInput = document.getElementById('share-url') as HTMLInputElement;
    const ok = await copyText(urlInput.value);
    urlInput.select();
    showToast(ok ? 'check-circle' : 'alert-triangle', ok ? t('toast_copied') : t('toast_copy_failed'));
  });
  document.getElementById('new-btn')?.addEventListener('click', () => {
    (document.getElementById('paste-input') as HTMLTextAreaElement).value = '';
    document.getElementById('char-count')!.textContent = '0';
    showView('create');
  });
}

// ─── VIEW (open an existing paste) ────────────────────────────────────────
function initView(): void {
  document.getElementById('copy-content-btn')?.addEventListener('click', async () => {
    const output = document.getElementById('paste-output') as HTMLElement;
    const ok = await copyText(output.textContent ?? '');
    showToast(ok ? 'check-circle' : 'alert-triangle', ok ? t('toast_copied') : t('toast_copy_failed'));
  });
}

/** Parse `#<id>.<key>` from the fragment. Returns null if malformed. */
function parseFragment(hash: string): { id: string; key: string } | null {
  const raw = hash.replace(/^#/, '');
  const dot = raw.indexOf('.');
  if (dot <= 0 || dot === raw.length - 1) return null;
  return { id: raw.slice(0, dot), key: raw.slice(dot + 1) };
}

async function openPaste(hash: string): Promise<void> {
  const parsed = parseFragment(hash);
  if (!parsed) {
    renderStatus('link-2-off', 'status_bad_link');
    return;
  }
  if (!isFirebaseConfigured) {
    renderStatus('server-off', 'status_not_configured');
    return;
  }

  renderStatus('loader', 'status_loading');
  try {
    const stored = await fetchPaste(parsed.id);
    if (!stored) {
      renderStatus('file-x', 'status_not_found');
      return;
    }

    const key = keyFromString(parsed.key);
    const text = await decrypt(stored.enc, key);

    viewedExpiry = stored.expireAt;
    (document.getElementById('paste-output') as HTMLElement).textContent = text;
    document.getElementById('view-meta')!.textContent = formatExpiry(stored.expireAt);
    currentStatus = null;
    showView('view');
    lucide.createIcons();
  } catch (err) {
    console.error('[paste] open failed:', err);
    // A bad key or tampered ciphertext both surface as a decrypt failure.
    renderStatus('lock', 'status_decrypt_failed');
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  initTheme();
  initI18n();
  initCreate();
  initResult();
  initView();

  // Re-render language-dependent dynamic text on language switch.
  window.addEventListener('langchange', () => {
    if (currentStatus) renderStatus(currentStatus.icon, currentStatus.key);
    const meta = document.getElementById('view-meta');
    if (meta && !document.getElementById('view-view')?.hasAttribute('hidden')) {
      meta.textContent = formatExpiry(viewedExpiry);
    }
  });

  if (location.hash.length > 1) {
    void openPaste(location.hash);
  } else {
    showView('create');
  }
});
