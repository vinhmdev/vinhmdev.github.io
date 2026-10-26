/**
 * Shared share layer for the encrypted paste tools (Markdown + Encrypted
 * Paste). One implementation, two tools — the logic is identical.
 *
 * Lets the user save the current content as an end-to-end encrypted paste
 * and share a link. The creator chooses the mode:
 *   - editable : opening the link and saving updates the SAME link in place.
 *   - readonly : the shared content is frozen; editing forks a new link.
 *
 * Supports Dual Independent Storage:
 *   - Logged Out (Anonymous Workspace): doc history lives in `localStorage`.
 *   - Logged In (Google Account Workspace): doc history lives in Firestore
 *     under `/users/{uid}/{md_docs|paste_docs}`.
 *   - Both workspaces are strictly isolated with zero cross-mode merging.
 */
import { encrypt, decrypt, generateKey, keyToString, keyFromString } from '@shared/paste/crypto';
import {
  createPaste,
  updatePaste,
  fetchPaste,
  deletePaste,
  extendPasteExpiry,
  type PasteMode,
} from '@shared/paste/store';
import { encodePayload, decodePayload } from '@shared/paste/payload';
import { isFirebaseConfigured } from '@shared/firebase/config';
import {
  waitForAuthInit,
  signInWithGoogle,
  signOutUser,
  onAuthChange,
  type AuthUser,
} from '@shared/firebase/auth';
import {
  createDualDocStore,
  type MyDoc,
  type DualDocStore,
  type CloudDocCollection,
} from './history';

const DAY_MS = 86400_000;

export interface ShareDeps {
  getValue: () => string;
  setValue: (s: string) => void;
  getTitle?: () => string;
  setTitle?: (s: string) => void;
  showToast: (icon: string, msg: string) => void;
  t: (key: string) => string;
  /** URL path prefix for share links, e.g. '/clipboard2markdown/' or '/paste/'. */
  linkBase: string;
  /** localStorage key for this tool's "my docs" history. */
  storageKey: string;
  /** Firestore subcollection name under `/users/{uid}/` for cloud doc history. */
  cloudCollection?: CloudDocCollection;
  /** Language-switch event this tool dispatches (to re-translate JS-built UI). */
  langChangeEvent?: string;
  /** Toggle editor read-only state based on shared paste permissions. */
  setReadOnly?: (readOnly: boolean) => void;
  /**
   * Invoked when the active workspace switches (initial auth resolution, sign-in,
   * or sign-out) so the host tool can switch and hydrate its `DualDraftStore`.
   */
  onAuthWorkspaceSwitch?: (user: AuthUser | null) => Promise<void>;
  /**
   * Invoked right before signing out so the host tool can flush any debounced
   * cloud draft while still authenticated.
   */
  onBeforeSignOut?: () => Promise<void>;
  /**
   * Invoked when the user detaches from an active shared link (`#id.key`).
   */
  onDetach?: () => Promise<void> | void;
}

let deps: ShareDeps;
let store: DualDocStore;
let current: {
  id: string;
  key: Uint8Array<ArrayBuffer>;
  mode: PasteMode;
  title: string;
  expireAt: number | null;
  ownerUid: string | null;
} | null = null;
let lastSaved = '';
let lastSavedTitle = '';

// ─── helpers ────────────────────────────────────────────────────────────────
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  html?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

const t = (k: string): string => deps.t(k);
const locale = (): string => (document.documentElement.lang === 'en' ? 'en-US' : 'vi-VN');

/** Translate [data-i18n] nodes inside a JS-built subtree (i18n's applyToDOM
 * only runs over nodes that existed at init, so built UI translates itself). */
function translateTree(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((node) => {
    const key = node.getAttribute('data-i18n');
    if (!key) return;
    const attr = node.getAttribute('data-i18n-attr');
    if (attr) node.setAttribute(attr, t(key));
    else node.textContent = t(key);
  });
}

function deriveTitle(md: string): string {
  const line =
    md
      .split('\n')
      .map((s) => s.trim())
      .find((s) => s.length > 0) ?? '';
  return line
    .replace(/^#+\s*/, '')
    .replace(/[*_`>#[\]]/g, '')
    .trim()
    .slice(0, 80);
}

/** The tool's explicit title field, trimmed (empty string if it has none). */
function explicitTitleOf(): string {
  return deps.getTitle?.()?.trim() ?? '';
}

function parseHash(): { id: string; key: string } | null {
  const raw = location.hash.replace(/^#/, '');
  const dot = raw.indexOf('.');
  if (dot <= 0 || dot === raw.length - 1) return null;
  return { id: raw.slice(0, dot), key: raw.slice(dot + 1) };
}

export function hasShareLink(): boolean {
  return parseHash() !== null;
}

/** True when a shared document is currently loaded or a valid share hash is in the URL. */
export function hasActiveSharedDoc(): boolean {
  return current !== null || parseHash() !== null;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function linkFor(id: string, key: Uint8Array<ArrayBuffer>): string {
  return `${location.origin}${deps.linkBase}#${id}.${keyToString(key)}`;
}

function formatExpiryStatus(expireAt: number | null): { text: string; expired: boolean } {
  if (expireAt === null || expireAt === undefined) {
    return { text: t('expiry_never'), expired: false };
  }
  if (expireAt <= Date.now()) {
    return { text: t('mydocs_expired'), expired: true };
  }
  const formatted = new Date(expireAt).toLocaleString(locale(), {
    dateStyle: 'short',
    timeStyle: 'short',
  });
  return { text: `${t('mydocs_expires')}: ${formatted}`, expired: false };
}

/** True when the editor content (or title) differs from the last saved state. */
function isDirty(): boolean {
  if (deps.getValue() !== lastSaved) return true;
  if (deps.getTitle && deps.getTitle().trim() !== lastSavedTitle) return true;
  return false;
}

function detachCurrentLink(): void {
  current = null;
  if (hasShareLink()) {
    history.replaceState(null, '', location.pathname + location.search);
  }
  deps.setReadOnly?.(false);
  updateBar();
}

async function extendSharedDocExpiry(id: string, rawMinutes: string): Promise<void> {
  if (!store.isCloud()) return;
  const ttlDays =
    rawMinutes === '0' || rawMinutes === 'never' ? null : Number(rawMinutes) / (60 * 24);
  const now = Date.now();
  let nextExpireMs = ttlDays !== null && ttlDays > 0 ? now + ttlDays * DAY_MS : null;
  if (isFirebaseConfigured) {
    try {
      const serverExpire = await extendPasteExpiry(id, ttlDays);
      nextExpireMs = serverExpire ? serverExpire.getTime() : null;
    } catch (err) {
      console.error(`[share] Failed to extend expiry for paste ${id} on server:`, err);
    }
  }
  const existing = store.getDoc(id);
  if (existing) {
    store.saveDoc({
      id: existing.id,
      key: existing.key,
      title: existing.title,
      url: existing.url,
      mode: existing.mode,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
      expireAt: nextExpireMs,
    });
  }
  if (current?.id === id) {
    current.expireAt = nextExpireMs;
    updateBar();
  }
  if (drawer && !drawer.hidden) {
    renderDocs();
  }
  deps.showToast('clock', t('toast_expiry_updated'));
}

async function revokeSharedDoc(id: string): Promise<void> {
  const isCloud = store.isCloud();
  if (isCloud && isFirebaseConfigured) {
    try {
      await deletePaste(id);
    } catch (err) {
      console.error(`[share] Failed to delete paste ${id} from server:`, err);
    }
  }
  store.removeDoc(id);
  if (current?.id === id) {
    detachCurrentLink();
    await deps.onDetach?.();
  }
  if (drawer && !drawer.hidden) {
    renderDocs();
  }
  if (isCloud) {
    deps.showToast('trash-2', t('toast_doc_revoked'));
  }
}

// ─── status bar (shown while a shared doc is active) ─────────────────────────
let bar: HTMLElement;

function buildBar(): void {
  bar = el('div', 'md-sharebar');
  bar.hidden = true;
  bar.innerHTML = `
    <span class="md-sharebar-info">
      <i data-lucide="link" class="w-4 h-4"></i>
      <span id="md-bar-mode"></span>
      <span id="md-bar-expiry" class="md-sharebar-expiry"></span>
      <span id="md-bar-state" class="md-sharebar-state"></span>
    </span>
    <span class="md-sharebar-actions">
      <select id="md-bar-extend" class="md-select md-bar-select" hidden>
        <option value="" selected disabled data-i18n="mydocs_extend">Extend…</option>
        <option value="60" data-i18n="expiry_1h">1 hour</option>
        <option value="1440" data-i18n="expiry_1d">1 day</option>
        <option value="10080" data-i18n="expiry_7d">1 week</option>
        <option value="43200" data-i18n="expiry_30d">1 month</option>
        <option value="525600" data-i18n="expiry_365d">1 year</option>
        <option value="0" data-i18n="expiry_never">Never expires</option>
      </select>
      <button id="md-bar-revoke" class="md-btn md-btn-danger-ghost" hidden>
        <i data-lucide="trash-2" class="w-4 h-4"></i><span data-i18n="bar_revoke">Revoke</span>
      </button>
      <button id="md-bar-copy" class="md-btn md-btn-ghost"><i data-lucide="copy" class="w-4 h-4"></i><span data-i18n="bar_copy">Copy link</span></button>
      <button id="md-bar-primary" class="md-btn md-btn-primary"></button>
      <button id="md-bar-detach" class="md-icon-btn" title=""><i data-lucide="x" class="w-4 h-4"></i></button>
    </span>`;
  document.body.appendChild(bar);
  translateTree(bar);

  bar.querySelector<HTMLSelectElement>('#md-bar-extend')?.addEventListener('change', (e) => {
    const sel = e.currentTarget as HTMLSelectElement;
    const val = sel.value;
    sel.value = '';
    if (val && current) {
      void extendSharedDocExpiry(current.id, val);
    }
  });
  bar.querySelector<HTMLButtonElement>('#md-bar-revoke')?.addEventListener('click', () => {
    if (!current) return;
    void revokeSharedDoc(current.id);
  });
  bar.querySelector<HTMLButtonElement>('#md-bar-copy')?.addEventListener('click', async () => {
    if (!current) return;
    const ok = await copy(linkFor(current.id, current.key));
    deps.showToast(
      ok ? 'check-circle' : 'alert-triangle',
      t(ok ? 'toast_copied' : 'toast_copy_failed')
    );
  });
  bar.querySelector<HTMLButtonElement>('#md-bar-primary')?.addEventListener('click', () => {
    if (!current) return;
    if (current.mode === 'editable') void saveInPlace();
    else openModal(); // readonly → fork into a new link
  });
  bar.querySelector<HTMLButtonElement>('#md-bar-detach')?.addEventListener('click', async () => {
    detachCurrentLink();
    await deps.onDetach?.();
    deps.showToast('unlink', t('toast_detached'));
  });
}

/** Reserve space at the bottom of the page so the fixed status bar doesn't
 * overlay the tool's own bottom controls. Measured after layout because the
 * bar's height depends on its (translated) content and can wrap on mobile. */
function syncBarSpacing(): void {
  if (!bar || bar.hidden) {
    document.body.classList.remove('md-has-sharebar');
    document.body.style.removeProperty('--md-sharebar-h');
    return;
  }
  document.body.classList.add('md-has-sharebar');
  requestAnimationFrame(() => {
    if (bar.hidden) return;
    document.body.style.setProperty('--md-sharebar-h', `${bar.offsetHeight}px`);
  });
}

function updateBar(): void {
  if (!current) {
    bar.hidden = true;
    syncBarSpacing();
    return;
  }
  bar.hidden = false;
  const modeEl = bar.querySelector<HTMLElement>('#md-bar-mode');
  if (modeEl) {
    modeEl.textContent = t(current.mode === 'editable' ? 'bar_editable' : 'bar_readonly');
  }

  const expiryEl = bar.querySelector<HTMLElement>('#md-bar-expiry');
  if (expiryEl) {
    const expiryInfo = formatExpiryStatus(current.expireAt);
    expiryEl.textContent = `• ${expiryInfo.text}`;
  }

  const dirty = isDirty();
  const stateEl = bar.querySelector<HTMLElement>('#md-bar-state');
  if (stateEl) {
    stateEl.textContent =
      current.mode === 'editable' ? (dirty ? `• ${t('bar_unsaved')}` : `• ${t('bar_saved')}`) : '';
    stateEl.classList.toggle('is-dirty', current.mode === 'editable' && dirty);
  }

  const canManageCloudDoc =
    store.isCloud() &&
    Boolean(
      (current.ownerUid && current.ownerUid === currentAuthUser?.uid) || store.getDoc(current.id)
    );

  const extendSelect = bar.querySelector<HTMLSelectElement>('#md-bar-extend');
  if (extendSelect) {
    extendSelect.hidden = !canManageCloudDoc;
    extendSelect.title = t('mydocs_extend_title');
    extendSelect.value = '';
  }

  const revokeBtn = bar.querySelector<HTMLButtonElement>('#md-bar-revoke');
  if (revokeBtn) {
    revokeBtn.hidden = !canManageCloudDoc;
    revokeBtn.title = t('bar_revoke_title');
  }

  const primary = bar.querySelector<HTMLButtonElement>('#md-bar-primary');
  if (primary) {
    primary.innerHTML =
      current.mode === 'editable'
        ? `<i data-lucide="save" class="w-4 h-4"></i><span>${t('bar_save')}</span>`
        : `<i data-lucide="git-fork" class="w-4 h-4"></i><span>${t('bar_fork')}</span>`;
    primary.disabled = current.mode === 'editable' && !dirty;
  }
  const detachBtn = bar.querySelector<HTMLButtonElement>('#md-bar-detach');
  if (detachBtn) {
    detachBtn.title = t('bar_detach');
  }
  window.lucide?.createIcons();
  syncBarSpacing();
}

/** Called by the host on every editor change to refresh the dirty indicator. */
export function notifyChange(): void {
  if (current) updateBar();
}

// ─── create / save ───────────────────────────────────────────────────────────
async function persistCreate(mode: PasteMode, ttlDays: number | null): Promise<MyDoc> {
  const body = deps.getValue();
  // The payload stores the EXPLICIT title (possibly empty) so reopening keeps
  // the title field exactly as the author left it. The resolved title (an
  // explicit one, else derived from the body) is only for local metadata.
  const explicitTitle = explicitTitleOf();
  const historyTitle = explicitTitle || deriveTitle(body);
  const key = generateKey();
  const enc = await encrypt(encodePayload(explicitTitle, body), key);
  const id = await createPaste(enc, { ttlDays, mode });
  const now = Date.now();
  const expireAt = ttlDays !== null && ttlDays > 0 ? now + ttlDays * DAY_MS : null;
  const doc: MyDoc = {
    id,
    key: keyToString(key),
    title: historyTitle,
    url: linkFor(id, key),
    mode,
    createdAt: now,
    updatedAt: now,
    expireAt,
    versions: [],
  };
  store.saveDoc({ ...doc }, body);
  current = {
    id,
    key,
    mode,
    title: historyTitle,
    expireAt,
    ownerUid: currentAuthUser?.uid ?? null,
  };
  lastSaved = body;
  lastSavedTitle = explicitTitle;
  if (mode === 'editable') history.replaceState(null, '', `#${id}.${keyToString(key)}`);
  deps.setReadOnly?.(mode === 'readonly');
  updateBar();
  return doc;
}

async function saveInPlace(): Promise<void> {
  if (!current) return;
  const primary = bar.querySelector<HTMLButtonElement>('#md-bar-primary');
  if (primary) primary.disabled = true;
  try {
    const body = deps.getValue();
    const explicitTitle = explicitTitleOf();
    const historyTitle = explicitTitle || deriveTitle(body);
    const enc = await encrypt(encodePayload(explicitTitle, body), current.key);
    await updatePaste(current.id, enc);
    lastSaved = body;
    lastSavedTitle = explicitTitle;
    current.title = historyTitle;
    const existing = store.getDoc(current.id);
    store.saveDoc(
      {
        id: current.id,
        key: keyToString(current.key),
        title: historyTitle,
        url: linkFor(current.id, current.key),
        mode: 'editable',
        createdAt: existing?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        expireAt: existing?.expireAt ?? current.expireAt ?? null,
      },
      body
    );
    updateBar();
    deps.showToast('check-circle', t('toast_saved'));
  } catch (err) {
    console.error('[share] save failed:', err);
    deps.showToast('alert-triangle', t('toast_save_failed'));
    updateBar();
  }
}

// ─── open a shared link ───────────────────────────────────────────────────────
async function loadShared(): Promise<void> {
  const parsed = parseHash();
  if (!parsed) return;
  if (!isFirebaseConfigured) {
    detachCurrentLink();
    await deps.onDetach?.();
    deps.showToast('alert-triangle', t('toast_not_configured'));
    return;
  }
  deps.showToast('loader', t('toast_loading'));
  try {
    const stored = await fetchPaste(parsed.id);
    if (!stored) {
      // Fallback: if the server paste expired or was deleted, check if the
      // active workspace (local or cloud) holds a saved content snapshot.
      const fallbackDoc = store.getDoc(parsed.id);
      const snapshot = fallbackDoc?.versions?.[0]?.content;
      if (typeof snapshot === 'string' && snapshot.length > 0) {
        deps.setValue(snapshot);
        deps.setTitle?.(fallbackDoc?.title ?? '');
        detachCurrentLink();
        deps.showToast('history', t('toast_restored_from_history'));
        return;
      }
      detachCurrentLink();
      await deps.onDetach?.();
      deps.showToast('file-x', t('toast_not_found'));
      return;
    }
    const key = keyFromString(parsed.key);
    const { title, body } = decodePayload(await decrypt(stored.enc, key));
    deps.setValue(body);
    deps.setTitle?.(title);
    deps.setReadOnly?.(stored.mode === 'readonly');
    lastSaved = body;
    // Match the (possibly empty) loaded title, not a derived one, so a paste
    // saved with a blank title doesn't read as dirty the moment it opens.
    lastSavedTitle = title.trim();
    const resolvedExpireAt = stored.expireAt?.getTime() ?? null;
    current = {
      id: parsed.id,
      key,
      mode: stored.mode,
      title: title || deriveTitle(body),
      expireAt: resolvedExpireAt,
      ownerUid: stored.ownerUid,
    };
    const existing = store.getDoc(parsed.id);
    store.saveDoc(
      {
        id: parsed.id,
        key: parsed.key,
        title: current.title,
        url: linkFor(parsed.id, key),
        mode: stored.mode,
        createdAt: existing?.createdAt ?? Date.now(),
        updatedAt: stored.updatedAt?.getTime() ?? Date.now(),
        expireAt: resolvedExpireAt,
      },
      body
    );
    updateBar();
    deps.showToast(
      'check-circle',
      t(stored.mode === 'editable' ? 'toast_loaded_editable' : 'toast_loaded_readonly')
    );
  } catch (err) {
    console.error('[share] load failed:', err);
    detachCurrentLink();
    await deps.onDetach?.();
    deps.showToast('lock', t('toast_decrypt_failed'));
  }
}

// ─── share modal ──────────────────────────────────────────────────────────────
let modal: HTMLElement;

function updateModalNote(): void {
  if (!modal) return;
  const noteText = modal.querySelector<HTMLElement>('#md-expiry-note-text');
  if (!noteText) return;
  const key = store.isCloud() ? 'share_expiry_note_cloud' : 'share_expiry_note';
  noteText.setAttribute('data-i18n', key);
  noteText.textContent = t(key);
}

function buildModal(): void {
  modal = el('div', 'md-overlay');
  modal.hidden = true;
  modal.innerHTML = `
    <div class="md-modal" role="dialog" aria-modal="true">
      <div class="md-modal-head">
        <h3 data-i18n="share_modal_title">Share this document</h3>
        <button class="md-icon-btn" id="md-modal-close"><i data-lucide="x" class="w-4 h-4"></i></button>
      </div>

      <div id="md-modal-form">
        <label class="md-field-label" data-i18n="share_mode_label">Who can edit?</label>
        <label class="md-radio">
          <input type="radio" name="md-mode" value="editable" checked />
          <span><b data-i18n="mode_editable">Anyone with the link can edit</b><small data-i18n="mode_editable_desc">Opening the link and saving updates this same link.</small></span>
        </label>
        <label class="md-radio">
          <input type="radio" name="md-mode" value="readonly" />
          <span><b data-i18n="mode_readonly">Read-only</b><small data-i18n="mode_readonly_desc">Content is frozen; editing creates a new link.</small></span>
        </label>

        <div class="md-row">
          <label class="md-field-label" data-i18n="share_expiry_label">Expires</label>
          <select id="md-expiry" class="md-select">
            <option value="60" data-i18n="expiry_1h">1 hour</option>
            <option value="1440" data-i18n="expiry_1d">1 day</option>
            <option value="10080" data-i18n="expiry_7d">1 week</option>
            <option value="43200" selected data-i18n="expiry_30d">1 month</option>
            <option value="525600" data-i18n="expiry_365d">1 year</option>
            <option value="0" data-i18n="expiry_never">Never expires</option>
          </select>
        </div>
        <p class="md-expiry-note">
          <i data-lucide="alert-circle" class="w-3.5 h-3.5"></i>
          <span id="md-expiry-note-text" data-i18n="share_expiry_note">Once shared, it stays live until it expires and can't be deleted manually — pick a lifetime that fits. For sensitive data, choose a short one (e.g. 1 hour).</span>
        </p>

        <button id="md-modal-create" class="md-btn md-btn-primary md-btn-block">
          <i data-lucide="lock" class="w-4 h-4"></i><span data-i18n="share_create">Encrypt &amp; create link</span>
        </button>
      </div>

      <div id="md-modal-result" hidden>
        <p class="md-result-hint" data-i18n="share_result_hint">Anyone with this link can open it. The key is in the link — share over a trusted channel.</p>
        <div class="md-row">
          <input id="md-result-url" class="md-url" readonly />
          <button id="md-result-copy" class="md-btn md-btn-primary"><i data-lucide="copy" class="w-4 h-4"></i></button>
        </div>
        <button id="md-modal-done" class="md-btn md-btn-ghost md-btn-block" data-i18n="share_done">Done</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  translateTree(modal);

  const close = (): void => {
    modal.hidden = true;
  };
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
  modal.querySelector('#md-modal-close')?.addEventListener('click', close);
  modal.querySelector('#md-modal-done')?.addEventListener('click', close);

  modal
    .querySelector<HTMLButtonElement>('#md-modal-create')
    ?.addEventListener('click', async () => {
      if (!deps.getValue().trim()) {
        deps.showToast('alert-triangle', t('toast_empty'));
        return;
      }
      if (!isFirebaseConfigured) {
        deps.showToast('alert-triangle', t('toast_not_configured'));
        return;
      }
      const checkedMode = modal.querySelector<HTMLInputElement>('input[name="md-mode"]:checked');
      const mode = (checkedMode?.value === 'readonly' ? 'readonly' : 'editable') as PasteMode;
      // Option values are in minutes so short lifetimes (1 hour) are exact. 0 / never means permanent.
      const expirySelect = modal.querySelector<HTMLSelectElement>('#md-expiry');
      const rawExpiry = expirySelect?.value ?? '43200';
      const ttlDays =
        rawExpiry === '0' || rawExpiry === 'never' ? null : Number(rawExpiry) / (60 * 24);
      const createBtn = modal.querySelector<HTMLButtonElement>('#md-modal-create');
      if (createBtn) {
        createBtn.disabled = true;
        createBtn.classList.add('is-loading');
      }
      try {
        const doc = await persistCreate(mode, ttlDays);
        const urlInput = modal.querySelector<HTMLInputElement>('#md-result-url');
        if (urlInput) {
          urlInput.value = doc.url;
          urlInput.focus();
          urlInput.select();
        }
        const formEl = modal.querySelector<HTMLElement>('#md-modal-form');
        if (formEl) formEl.hidden = true;
        const resultEl = modal.querySelector<HTMLElement>('#md-modal-result');
        if (resultEl) resultEl.hidden = false;
        deps.showToast('check-circle', t('toast_share_created'));
      } catch (err) {
        console.error('[share] create failed:', err);
        deps.showToast('alert-triangle', t('toast_save_failed'));
      } finally {
        if (createBtn) {
          createBtn.disabled = false;
          createBtn.classList.remove('is-loading');
        }
      }
    });

  modal.querySelector<HTMLButtonElement>('#md-result-copy')?.addEventListener('click', async () => {
    const urlInput = modal.querySelector<HTMLInputElement>('#md-result-url');
    if (!urlInput) return;
    const ok = await copy(urlInput.value);
    urlInput.select();
    deps.showToast(
      ok ? 'check-circle' : 'alert-triangle',
      t(ok ? 'toast_copied' : 'toast_copy_failed')
    );
  });
}

function openModal(): void {
  updateModalNote();
  const formEl = modal.querySelector<HTMLElement>('#md-modal-form');
  if (formEl) formEl.hidden = false;
  const resultEl = modal.querySelector<HTMLElement>('#md-modal-result');
  if (resultEl) resultEl.hidden = true;
  modal.hidden = false;
  window.lucide?.createIcons();
}

// ─── my docs drawer ───────────────────────────────────────────────────────────
let drawer: HTMLElement;

function updateDrawerNote(): void {
  if (!drawer) return;
  const noteEl = drawer.querySelector<HTMLElement>('#md-drawer-note');
  if (!noteEl) return;
  const key = store.isCloud() ? 'mydocs_note_cloud' : 'mydocs_note';
  noteEl.setAttribute('data-i18n', key);
  noteEl.textContent = t(key);
}

function buildDrawer(): void {
  drawer = el('div', 'md-overlay');
  drawer.hidden = true;
  drawer.innerHTML = `
    <div class="md-drawer" role="dialog" aria-modal="true">
      <div class="md-modal-head">
        <h3><span data-i18n="mydocs_title">My shared docs</span> <span id="md-drawer-note" class="md-note" data-i18n="mydocs_note">(saved on this device)</span></h3>
        <button class="md-icon-btn" id="md-drawer-close"><i data-lucide="x" class="w-4 h-4"></i></button>
      </div>
      <div class="md-drawer-actions"><button id="md-drawer-clear" class="md-link-btn" data-i18n="mydocs_clear">Clear all</button></div>
      <ul id="md-docs-list" class="md-docs-list"></ul>
      <p id="md-docs-empty" class="md-docs-empty" data-i18n="mydocs_empty" hidden>No shared docs yet.</p>
    </div>`;
  document.body.appendChild(drawer);
  translateTree(drawer);

  const close = (): void => {
    drawer.hidden = true;
  };
  drawer.addEventListener('click', (e) => {
    if (e.target === drawer) close();
  });
  drawer.querySelector('#md-drawer-close')?.addEventListener('click', close);
  drawer.querySelector('#md-drawer-clear')?.addEventListener('click', async () => {
    const isCloud = store.isCloud();
    const docs = store.getDocs();
    if (isCloud && isFirebaseConfigured && docs.length > 0) {
      await Promise.allSettled(docs.map((d) => deletePaste(d.id)));
    }
    if (isCloud && current && docs.some((d) => d.id === current?.id)) {
      detachCurrentLink();
      await deps.onDetach?.();
    }
    store.clearDocs();
    renderDocs();
    deps.showToast('trash-2', t(isCloud ? 'toast_docs_cleared_cloud' : 'toast_docs_cleared'));
  });
}

function renderDocs(): void {
  if (!drawer) return;
  updateDrawerNote();
  const list = drawer.querySelector<HTMLUListElement>('#md-docs-list');
  const empty = drawer.querySelector<HTMLElement>('#md-docs-empty');
  if (!list || !empty) return;
  const docs = store.getDocs();
  empty.hidden = docs.length > 0;
  list.replaceChildren(...docs.map(renderDocItem));
  window.lucide?.createIcons();
}

function renderDocItem(doc: MyDoc): HTMLLIElement {
  const li = el('li', 'md-doc-item');
  const isCloud = store.isCloud();
  const modeLabel = t(doc.mode === 'editable' ? 'bar_editable' : 'bar_readonly');
  const when = new Date(doc.updatedAt).toLocaleString(locale(), {
    dateStyle: 'short',
    timeStyle: 'short',
  });
  const expiryInfo = formatExpiryStatus(doc.expireAt);

  const main = el('button', 'md-doc-main');
  main.innerHTML = `<span class="md-doc-title"></span><span class="md-doc-sub"><span class="md-doc-badge md-doc-badge-${doc.mode}">${modeLabel}</span> · <span class="md-doc-expiry${expiryInfo.expired ? ' is-expired' : ''}">${expiryInfo.text}</span> · ${when} · ${doc.versions.length} ${t('mydocs_versions')}</span>`;
  const titleEl = main.querySelector<HTMLElement>('.md-doc-title');
  if (titleEl) titleEl.textContent = doc.title || t('untitled');
  main.addEventListener('click', () => {
    drawer.hidden = true;
    const targetHash = `#${doc.id}.${doc.key}`;
    if (location.hash === targetHash) {
      void loadShared();
    } else {
      location.hash = targetHash;
    }
  });

  const actions = el('div', 'md-doc-actions');

  if (isCloud) {
    const extendSelect = el('select', 'md-select md-doc-extend-select');
    extendSelect.title = t('mydocs_extend_title');
    extendSelect.innerHTML = `
      <option value="" selected disabled>${t('mydocs_extend')}</option>
      <option value="60">${t('expiry_1h')}</option>
      <option value="1440">${t('expiry_1d')}</option>
      <option value="10080">${t('expiry_7d')}</option>
      <option value="43200">${t('expiry_30d')}</option>
      <option value="525600">${t('expiry_365d')}</option>
      <option value="0">${t('expiry_never')}</option>`;
    extendSelect.addEventListener('click', (e) => e.stopPropagation());
    extendSelect.addEventListener('change', (e) => {
      e.stopPropagation();
      const val = extendSelect.value;
      extendSelect.value = '';
      if (val) {
        void extendSharedDocExpiry(doc.id, val);
      }
    });
    actions.appendChild(extendSelect);
  }

  const copyBtn = el('button', 'md-icon-btn', '<i data-lucide="copy" class="w-4 h-4"></i>');
  copyBtn.title = t('bar_copy');
  copyBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const ok = await copy(doc.url);
    deps.showToast(
      ok ? 'check-circle' : 'alert-triangle',
      t(ok ? 'toast_copied' : 'toast_copy_failed')
    );
  });

  const delBtn = el(
    'button',
    isCloud ? 'md-icon-btn md-icon-btn-danger' : 'md-icon-btn',
    '<i data-lucide="trash-2" class="w-4 h-4"></i>'
  );
  delBtn.title = t(isCloud ? 'mydocs_revoke' : 'mydocs_remove');
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    void revokeSharedDoc(doc.id);
  });
  actions.append(copyBtn, delBtn);
  li.append(main, actions);
  return li;
}

function openDrawer(): void {
  renderDocs();
  drawer.hidden = false;
  window.lucide?.createIcons();
}

// ─── auth UI (Google Sign-In / Sign-Out) ──────────────────────────────────────
let authWrap: HTMLElement | null = null;
let authMenuOpen = false;
let currentAuthUser: AuthUser | null = null;
let isHandlingAuthAction = false;

function buildAuthUI(): void {
  const slot = document.getElementById('auth-slot');
  if (slot) {
    authWrap = slot;
    authWrap.classList.add('md-auth-wrap');
  } else {
    const mydocsBtn = document.getElementById('mydocs-btn');
    if (!mydocsBtn || !mydocsBtn.parentElement) return;
    authWrap = el('div', 'md-auth-wrap');
    mydocsBtn.parentElement.appendChild(authWrap);
  }

  renderAuthUI(null);

  document.addEventListener('click', (e) => {
    if (!authMenuOpen || !authWrap) return;
    if (!authWrap.contains(e.target as Node)) {
      closeAuthMenu();
    }
  });
}

function closeAuthMenu(): void {
  authMenuOpen = false;
  const menu = authWrap?.querySelector<HTMLElement>('.md-auth-menu');
  if (menu) menu.hidden = true;
}

function renderAuthUI(user: AuthUser | null): void {
  currentAuthUser = user;
  if (!authWrap) return;
  authMenuOpen = false;

  if (!user) {
    authWrap.innerHTML = `
      <button id="auth-btn" class="md-auth-btn" type="button" data-i18n="auth_signin" data-i18n-attr="title" title="Sign in with Google">
        <i data-lucide="user" class="w-4 h-4"></i>
        <span class="md-auth-label" data-i18n="auth_signin">Sign in</span>
      </button>`;
    translateTree(authWrap);
    window.lucide?.createIcons();
    authWrap.querySelector<HTMLButtonElement>('#auth-btn')?.addEventListener('click', () => {
      void handleSignIn();
    });
    return;
  }

  const label = user.email || user.displayName || 'Google User';
  const initial = (user.displayName || user.email || 'U').trim().charAt(0).toUpperCase();

  authWrap.innerHTML = `
    <button id="auth-btn" class="md-auth-btn is-authed" type="button" title="">
      <span class="md-auth-avatar-wrap"></span>
      <span class="md-auth-cloud-dot" aria-hidden="true"></span>
    </button>
    <div class="md-auth-menu" hidden>
      <div class="md-auth-menu-head">
        <span class="md-auth-menu-sub" data-i18n="auth_signed_in_as">Signed in as</span>
        <strong class="md-auth-menu-user"></strong>
        <span class="md-auth-menu-badge" data-i18n="mydocs_note_cloud">(synced to Google account)</span>
      </div>
      <button id="auth-signout-btn" class="md-auth-menu-item" type="button">
        <i data-lucide="log-out" class="w-4 h-4"></i>
        <span data-i18n="auth_signout">Sign out</span>
      </button>
    </div>`;

  const btn = authWrap.querySelector<HTMLButtonElement>('#auth-btn');
  if (btn) btn.title = `${t('auth_signed_in_as')}: ${label}`;

  const avatarWrap = authWrap.querySelector<HTMLElement>('.md-auth-avatar-wrap');
  if (avatarWrap) {
    if (user.photoURL) {
      const img = document.createElement('img');
      img.src = user.photoURL;
      img.alt = initial;
      img.className = 'md-auth-avatar';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => {
        avatarWrap.textContent = initial;
        avatarWrap.classList.add('md-auth-initial');
      });
      avatarWrap.appendChild(img);
    } else {
      avatarWrap.textContent = initial;
      avatarWrap.classList.add('md-auth-initial');
    }
  }

  const userEl = authWrap.querySelector<HTMLElement>('.md-auth-menu-user');
  if (userEl) userEl.textContent = label;

  translateTree(authWrap);
  window.lucide?.createIcons();

  btn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = authWrap?.querySelector<HTMLElement>('.md-auth-menu');
    if (!menu) return;
    authMenuOpen = !authMenuOpen;
    menu.hidden = !authMenuOpen;
  });

  authWrap.querySelector<HTMLButtonElement>('#auth-signout-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAuthMenu();
    void handleSignOut();
  });
}

async function applyWorkspaceForUser(user: AuthUser | null): Promise<void> {
  await store.switchUser(user?.uid ?? null);
  renderAuthUI(user);
  updateModalNote();
  updateDrawerNote();
  if (!drawer.hidden) {
    renderDocs();
  }
  await deps.onAuthWorkspaceSwitch?.(user);
}

async function handleSignIn(): Promise<void> {
  if (!isFirebaseConfigured) {
    deps.showToast('alert-triangle', t('toast_not_configured'));
    return;
  }
  if (isHandlingAuthAction) return;
  isHandlingAuthAction = true;
  try {
    const user = await signInWithGoogle();
    if (!user) return;
    // Detach any active local shared document before switching to the Cloud workspace
    detachCurrentLink();
    await applyWorkspaceForUser(user);
    deps.showToast('check-circle', t('toast_signed_in'));
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
      if (code === 'auth/unauthorized-domain') {
        const host = window.location.hostname;
        console.error(
          `[share] Google sign-in failed (auth/unauthorized-domain): "${host}" is not an authorized domain. Add "${host}" in Firebase Console -> Authentication -> Settings -> Authorized domains.`,
          err
        );
      } else {
        console.error('[share] Google sign-in failed:', err);
      }
      deps.showToast('alert-triangle', t('toast_auth_failed'));
    }
  } finally {
    isHandlingAuthAction = false;
  }
}

async function handleSignOut(): Promise<void> {
  if (isHandlingAuthAction) return;
  isHandlingAuthAction = true;
  try {
    // Flush any pending cloud draft while still authenticated
    await deps.onBeforeSignOut?.();
    await signOutUser();
    // Detach any active cloud shared document and switch back to the Local workspace
    detachCurrentLink();
    await applyWorkspaceForUser(null);
    deps.showToast('log-out', t('toast_signed_out'));
  } catch (err) {
    console.error('[share] sign-out failed:', err);
    deps.showToast('alert-triangle', t('toast_auth_failed'));
  } finally {
    isHandlingAuthAction = false;
  }
}

// ─── init ─────────────────────────────────────────────────────────────────────
export function initShare(d: ShareDeps): void {
  deps = d;
  const cloudCollection: CloudDocCollection =
    d.cloudCollection ?? (d.storageKey.startsWith('paste') ? 'paste_docs' : 'md_docs');

  store = createDualDocStore({
    localKey: d.storageKey,
    cloudCollection,
    onUpdate: () => {
      if (drawer && !drawer.hidden) {
        renderDocs();
      }
    },
  });

  buildBar();
  buildModal();
  buildDrawer();
  buildAuthUI();

  document.getElementById('share-btn')?.addEventListener('click', openModal);
  document.getElementById('mydocs-btn')?.addEventListener('click', openDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      modal.hidden = true;
      drawer.hidden = true;
      closeAuthMenu();
    }
  });

  // Re-translate all JS-built UI when the language switches.
  window.addEventListener(d.langChangeEvent ?? 'langchange', () => {
    translateTree(bar);
    updateModalNote();
    translateTree(modal);
    updateDrawerNote();
    translateTree(drawer);
    if (!drawer.hidden) {
      renderDocs();
    }
    if (authWrap) {
      renderAuthUI(currentAuthUser);
    }
    updateBar();
  });

  // The bar can wrap at narrow widths, changing its height.
  window.addEventListener('resize', syncBarSpacing);

  window.addEventListener('hashchange', () => {
    if (hasShareLink()) {
      void loadShared();
    } else if (current) {
      detachCurrentLink();
      void deps.onDetach?.();
    }
  });

  deps.setReadOnly?.(false);

  // Boot sequence: resolve initial Firebase Auth state, activate the matching
  // independent workspace (Cloud if signed in, Local if signed out), and then
  // load the shared link if a `#id.key` hash is present.
  void (async () => {
    const initialUser = await waitForAuthInit();
    await applyWorkspaceForUser(initialUser);

    if (hasShareLink()) {
      await loadShared();
    }

    // Listen for external auth state changes (e.g., token revocation or cross-tab sign-in/out).
    onAuthChange((user) => {
      if (isHandlingAuthAction) return;
      const prevUid = currentAuthUser?.uid ?? null;
      const nextUid = user?.uid ?? null;
      if (prevUid === nextUid) return;
      detachCurrentLink();
      void applyWorkspaceForUser(user);
    });
  })();
}
