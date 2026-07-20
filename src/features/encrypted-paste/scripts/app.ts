/**
 * app.ts — entry point for the encrypted-paste tool.
 *
 * One page, four views driven by the URL fragment:
 *   - no fragment            → CREATE  (compose title + note, encrypt)
 *   - after create           → RESULT  (share link with the key in `#`)
 *   - fragment `#id.key`      → VIEW    (fetch, decrypt, display)
 *   - loading / errors        → STATUS
 *
 * Title + note are encrypted together (payload.ts) so the title is E2E
 * encrypted too but still reaches whoever opens the link. Created links are
 * remembered locally (recents.ts) — no account needed. The key lives ONLY
 * in the fragment and never reaches any server.
 */
import { encrypt, decrypt, generateKey, keyToString, keyFromString } from '@shared/paste/crypto';
import { createPaste, fetchPaste } from '@shared/paste/store';
import { encodePayload, decodePayload } from '@shared/paste/payload';
import { getRecents, addRecent, removeRecent, clearRecents, type RecentPaste } from './recents';
import { initTheme } from './theme';
import { init as initI18n, t, getCurrentLang } from './i18n-client';
import { isFirebaseConfigured } from '@shared/firebase/config';

// Lucide is loaded via CDN — typed in src/shared/globals.d.ts. Fall back to a
// no-op if the CDN failed to load so a missing icon library can't take down
// the whole tool.
const lucide = window.lucide ?? { createIcons: () => {} };

type ViewName = 'create' | 'result' | 'view' | 'status';

/** Show exactly one top-level view; recents only ride along with CREATE. */
function showView(name: ViewName): void {
  for (const v of ['create', 'result', 'view', 'status'] as ViewName[]) {
    document.getElementById(`${v}-view`)?.toggleAttribute('hidden', v !== name);
  }
  if (name === 'create') refreshRecents();
  else document.getElementById('recents')?.setAttribute('hidden', '');
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

const locale = (): string => (getCurrentLang() === 'vi' ? 'vi-VN' : 'en-US');

/** Absolute expiry string, or a fallback when there is none. */
function formatExpiry(expireAt: Date | null): string {
  if (!expireAt) return t('meta_no_expiry');
  const dateStr = expireAt.toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });
  return `${t('meta_expires')} ${dateStr}`;
}

/** Coarse relative time ("3 minutes ago") for the recents list. */
function relativeTime(ms: number): string {
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const diff = ms - Date.now();
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86400_000],
    ['hour', 3600_000],
    ['minute', 60_000],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(diff) >= size) return rtf.format(Math.round(diff / size), unit);
  }
  return rtf.format(0, 'minute');
}

/** Auto-grow the editor so the page scrolls instead of an inner box. */
function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
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
  const title = document.getElementById('paste-title') as HTMLInputElement;
  const input = document.getElementById('paste-input') as HTMLTextAreaElement;
  const expiry = document.getElementById('expiry-select') as HTMLSelectElement;
  const createBtn = document.getElementById('create-btn') as HTMLButtonElement;
  const charCount = document.getElementById('char-count');

  const onInput = (): void => {
    if (charCount) charCount.textContent = String(input.value.length);
    autoGrow(input);
  };
  input.addEventListener('input', onInput);
  autoGrow(input);

  // Ctrl/Cmd+Enter to create.
  input.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') createBtn.click();
  });

  createBtn.addEventListener('click', async () => {
    const body = input.value;
    if (!body.trim()) {
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
      const ttlDays = Number(expiry.value);
      const key = generateKey();
      const enc = await encrypt(encodePayload(title.value.trim(), body), key);
      const id = await createPaste(enc, { ttlDays, mode: 'readonly' });

      const url = `${location.origin}/paste/#${id}.${keyToString(key)}`;
      addRecent({
        id,
        title: title.value.trim(),
        url,
        createdAt: Date.now(),
        expireAt: Date.now() + ttlDays * 86400_000,
      });
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

function resetCreate(): void {
  const title = document.getElementById('paste-title') as HTMLInputElement;
  const input = document.getElementById('paste-input') as HTMLTextAreaElement;
  title.value = '';
  input.value = '';
  document.getElementById('char-count')!.textContent = '0';
  autoGrow(input);
}

// ─── RECENTS (localStorage) ────────────────────────────────────────────────
function refreshRecents(): void {
  const section = document.getElementById('recents');
  const list = document.getElementById('recents-list');
  if (!section || !list) return;

  const items = getRecents();
  section.toggleAttribute('hidden', items.length === 0);
  list.replaceChildren(...items.map(renderRecentItem));
  lucide.createIcons();
}

function renderRecentItem(item: RecentPaste): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'paste-recents-item';

  const link = document.createElement('a');
  link.className = 'paste-recents-main';
  link.href = item.url;

  const titleEl = document.createElement('span');
  titleEl.className = 'paste-recents-link';
  titleEl.textContent = item.title || t('untitled');

  const sub = document.createElement('span');
  sub.className = 'paste-recents-sub';
  const exp = item.expireAt
    ? `${t('meta_expires')} ${new Date(item.expireAt).toLocaleDateString(locale())}`
    : t('meta_no_expiry');
  sub.textContent = `${relativeTime(item.createdAt)} · ${exp}`;

  link.append(titleEl, sub);

  const actions = document.createElement('div');
  actions.className = 'paste-recents-actions';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'paste-icon-btn';
  copyBtn.title = t('btn_copy_link');
  copyBtn.innerHTML = '<i data-lucide="copy" class="w-4 h-4"></i>';
  copyBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    const ok = await copyText(item.url);
    showToast(ok ? 'check-circle' : 'alert-triangle', ok ? t('toast_copied') : t('toast_copy_failed'));
  });

  const delBtn = document.createElement('button');
  delBtn.className = 'paste-icon-btn';
  delBtn.title = t('btn_remove');
  delBtn.innerHTML = '<i data-lucide="x" class="w-4 h-4"></i>';
  delBtn.addEventListener('click', (e) => {
    e.preventDefault();
    removeRecent(item.id);
    refreshRecents();
  });

  actions.append(copyBtn, delBtn);
  li.append(link, actions);
  return li;
}

function initRecents(): void {
  document.getElementById('recents-clear')?.addEventListener('click', () => {
    clearRecents();
    refreshRecents();
    showToast('trash-2', t('toast_recents_cleared'));
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
    resetCreate();
    showView('create');
    (document.getElementById('paste-title') as HTMLInputElement).focus();
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
    const { title, body } = decodePayload(await decrypt(stored.enc, key));

    viewedExpiry = stored.expireAt;
    const titleEl = document.getElementById('view-title') as HTMLElement;
    titleEl.textContent = title;
    titleEl.setAttribute('data-empty', t('untitled'));
    document.getElementById('paste-output')!.textContent = body;
    document.getElementById('view-meta')!.textContent = formatExpiry(stored.expireAt);
    document.title = title ? `${title} — ${t('heading')}` : t('page_title');
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
  initRecents();
  initResult();
  initView();

  // Re-render language-dependent dynamic text on language switch.
  window.addEventListener('langchange', () => {
    if (currentStatus) renderStatus(currentStatus.icon, currentStatus.key);
    const viewOpen = !document.getElementById('view-view')?.hasAttribute('hidden');
    if (viewOpen) {
      document.getElementById('view-meta')!.textContent = formatExpiry(viewedExpiry);
      document.getElementById('view-title')?.setAttribute('data-empty', t('untitled'));
    }
    if (!document.getElementById('recents')?.hasAttribute('hidden')) refreshRecents();
  });

  if (location.hash.length > 1) {
    void openPaste(location.hash);
  } else {
    showView('create');
  }
});
