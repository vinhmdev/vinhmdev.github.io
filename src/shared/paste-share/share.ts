/**
 * Shared share layer for the encrypted paste tools (Markdown + Encrypted
 * Paste). One implementation, two tools — the logic is identical.
 *
 * Lets the user save the current content as an end-to-end encrypted paste
 * and share a link. The creator chooses the mode:
 *   - editable : opening the link and saving updates the SAME link in place.
 *   - readonly : the shared content is frozen; editing forks a new link.
 *
 * Content is encrypted client-side (shared/paste/*) — Firestore only ever
 * holds ciphertext, and the key lives in the link fragment. "My docs" and
 * per-doc version snapshots are kept locally (history.ts); no account.
 *
 * The UI (modal, status bar, docs drawer) is built here in JS to stay a
 * self-contained slice; a host page only needs #share-btn and #mydocs-btn.
 *
 * Host tools plug in their editor via `ShareDeps`:
 *   - getValue/setValue  : read/write the body text.
 *   - getTitle/setTitle  : optional explicit title field (Markdown derives
 *                          the title from the first line instead).
 *   - linkBase           : URL path prefix, e.g. '/paste/'.
 *   - storageKey         : localStorage key for this tool's doc history.
 *   - langChangeEvent    : the tool's language-switch event name.
 */
import { encrypt, decrypt, generateKey, keyToString, keyFromString } from '@shared/paste/crypto';
import { createPaste, updatePaste, fetchPaste, type PasteMode } from '@shared/paste/store';
import { encodePayload, decodePayload } from '@shared/paste/payload';
import { isFirebaseConfigured } from '@shared/firebase/config';
import { createDocStore, type MyDoc, type DocStore } from './history';

const lucide = window.lucide ?? { createIcons: () => {} };
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
  /** Language-switch event this tool dispatches (to re-translate JS-built UI). */
  langChangeEvent?: string;
}

let deps: ShareDeps;
let store: DocStore;
let current: { id: string; key: Uint8Array<ArrayBuffer>; mode: PasteMode; title: string } | null =
  null;
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
  const line = md.split('\n').map((s) => s.trim()).find((s) => s.length > 0) ?? '';
  return line.replace(/^#+\s*/, '').replace(/[*_`>#[\]]/g, '').trim().slice(0, 80);
}

/** The doc title: an explicit title field if the tool has one, else derived. */
function resolveTitle(body: string): string {
  const explicit = deps.getTitle?.().trim();
  return explicit || deriveTitle(body);
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

/** True when the editor content (or title) differs from the last saved state. */
function isDirty(): boolean {
  if (deps.getValue() !== lastSaved) return true;
  if (deps.getTitle && deps.getTitle().trim() !== lastSavedTitle) return true;
  return false;
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
      <span id="md-bar-state" class="md-sharebar-state"></span>
    </span>
    <span class="md-sharebar-actions">
      <button id="md-bar-copy" class="md-btn md-btn-ghost"><i data-lucide="copy" class="w-4 h-4"></i><span data-i18n="bar_copy">Copy link</span></button>
      <button id="md-bar-primary" class="md-btn md-btn-primary"></button>
      <button id="md-bar-detach" class="md-icon-btn" title=""><i data-lucide="x" class="w-4 h-4"></i></button>
    </span>`;
  document.body.appendChild(bar);
  translateTree(bar);

  bar.querySelector<HTMLButtonElement>('#md-bar-copy')!.addEventListener('click', async () => {
    if (!current) return;
    const ok = await copy(linkFor(current.id, current.key));
    deps.showToast(ok ? 'check-circle' : 'alert-triangle', t(ok ? 'toast_copied' : 'toast_copy_failed'));
  });
  bar.querySelector<HTMLButtonElement>('#md-bar-primary')!.addEventListener('click', () => {
    if (!current) return;
    if (current.mode === 'editable') void saveInPlace();
    else openModal(); // readonly → fork into a new link
  });
  bar.querySelector<HTMLButtonElement>('#md-bar-detach')!.addEventListener('click', () => {
    current = null;
    history.replaceState(null, '', location.pathname);
    updateBar();
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
  const modeEl = bar.querySelector<HTMLElement>('#md-bar-mode')!;
  modeEl.textContent = t(current.mode === 'editable' ? 'bar_editable' : 'bar_readonly');

  const dirty = isDirty();
  const stateEl = bar.querySelector<HTMLElement>('#md-bar-state')!;
  stateEl.textContent = current.mode === 'editable' ? (dirty ? `• ${t('bar_unsaved')}` : `• ${t('bar_saved')}`) : '';
  stateEl.classList.toggle('is-dirty', current.mode === 'editable' && dirty);

  const primary = bar.querySelector<HTMLButtonElement>('#md-bar-primary')!;
  primary.innerHTML =
    current.mode === 'editable'
      ? `<i data-lucide="save" class="w-4 h-4"></i><span>${t('bar_save')}</span>`
      : `<i data-lucide="git-fork" class="w-4 h-4"></i><span>${t('bar_fork')}</span>`;
  primary.disabled = current.mode === 'editable' && !dirty;
  bar.querySelector<HTMLButtonElement>('#md-bar-detach')!.title = t('bar_detach');
  lucide.createIcons();
  syncBarSpacing();
}

/** Called by the host on every editor change to refresh the dirty indicator. */
export function notifyChange(): void {
  if (current) updateBar();
}

// ─── create / save ───────────────────────────────────────────────────────────
async function persistCreate(mode: PasteMode, ttlDays: number): Promise<MyDoc> {
  const body = deps.getValue();
  // The payload stores the EXPLICIT title (possibly empty) so reopening keeps
  // the title field exactly as the author left it. The resolved title (an
  // explicit one, else derived from the body) is only for local metadata.
  const explicitTitle = deps.getTitle?.().trim() ?? '';
  const historyTitle = resolveTitle(body);
  const key = generateKey();
  const enc = await encrypt(encodePayload(explicitTitle, body), key);
  const id = await createPaste(enc, { ttlDays, mode });
  const now = Date.now();
  const doc: MyDoc = {
    id,
    key: keyToString(key),
    title: historyTitle,
    url: linkFor(id, key),
    mode,
    createdAt: now,
    updatedAt: now,
    expireAt: now + ttlDays * DAY_MS,
    versions: [],
  };
  store.saveDoc({ ...doc }, body);
  current = { id, key, mode, title: historyTitle };
  lastSaved = body;
  lastSavedTitle = explicitTitle;
  if (mode === 'editable') history.replaceState(null, '', `#${id}.${keyToString(key)}`);
  updateBar();
  return doc;
}

async function saveInPlace(): Promise<void> {
  if (!current) return;
  const primary = bar.querySelector<HTMLButtonElement>('#md-bar-primary')!;
  primary.disabled = true;
  try {
    const body = deps.getValue();
    const explicitTitle = deps.getTitle?.().trim() ?? '';
    const historyTitle = resolveTitle(body);
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
        expireAt: existing?.expireAt ?? null,
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
    deps.showToast('alert-triangle', t('toast_not_configured'));
    return;
  }
  deps.showToast('loader', t('toast_loading'));
  try {
    const stored = await fetchPaste(parsed.id);
    if (!stored) {
      deps.showToast('file-x', t('toast_not_found'));
      return;
    }
    const key = keyFromString(parsed.key);
    const { title, body } = decodePayload(await decrypt(stored.enc, key));
    deps.setValue(body);
    deps.setTitle?.(title);
    lastSaved = body;
    // Match the (possibly empty) loaded title, not a derived one, so a paste
    // saved with a blank title doesn't read as dirty the moment it opens.
    lastSavedTitle = title.trim();
    current = { id: parsed.id, key, mode: stored.mode, title: title || deriveTitle(body) };
    store.saveDoc(
      {
        id: parsed.id,
        key: parsed.key,
        title: current.title,
        url: linkFor(parsed.id, key),
        mode: stored.mode,
        createdAt: Date.now(),
        updatedAt: stored.updatedAt?.getTime() ?? Date.now(),
        expireAt: stored.expireAt?.getTime() ?? null,
      },
      body
    );
    updateBar();
    deps.showToast('check-circle', t(stored.mode === 'editable' ? 'toast_loaded_editable' : 'toast_loaded_readonly'));
  } catch (err) {
    console.error('[share] load failed:', err);
    deps.showToast('lock', t('toast_decrypt_failed'));
  }
}

// ─── share modal ──────────────────────────────────────────────────────────────
let modal: HTMLElement;

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
            <option value="1" data-i18n="expiry_1d">1 day</option>
            <option value="7" data-i18n="expiry_7d">1 week</option>
            <option value="30" selected data-i18n="expiry_30d">1 month</option>
            <option value="365" data-i18n="expiry_365d">1 year</option>
          </select>
        </div>

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
  modal.querySelector('#md-modal-close')!.addEventListener('click', close);
  modal.querySelector('#md-modal-done')!.addEventListener('click', close);

  modal.querySelector<HTMLButtonElement>('#md-modal-create')!.addEventListener('click', async () => {
    if (!deps.getValue().trim()) {
      deps.showToast('alert-triangle', t('toast_empty'));
      return;
    }
    if (!isFirebaseConfigured) {
      deps.showToast('alert-triangle', t('toast_not_configured'));
      return;
    }
    const mode = (modal.querySelector<HTMLInputElement>('input[name="md-mode"]:checked')!.value ===
    'readonly'
      ? 'readonly'
      : 'editable') as PasteMode;
    const ttlDays = Number(modal.querySelector<HTMLSelectElement>('#md-expiry')!.value);
    const createBtn = modal.querySelector<HTMLButtonElement>('#md-modal-create')!;
    createBtn.disabled = true;
    createBtn.classList.add('is-loading');
    try {
      const doc = await persistCreate(mode, ttlDays);
      const urlInput = modal.querySelector<HTMLInputElement>('#md-result-url')!;
      urlInput.value = doc.url;
      modal.querySelector<HTMLElement>('#md-modal-form')!.hidden = true;
      modal.querySelector<HTMLElement>('#md-modal-result')!.hidden = false;
      urlInput.focus();
      urlInput.select();
      deps.showToast('check-circle', t('toast_share_created'));
    } catch (err) {
      console.error('[share] create failed:', err);
      deps.showToast('alert-triangle', t('toast_save_failed'));
    } finally {
      createBtn.disabled = false;
      createBtn.classList.remove('is-loading');
    }
  });

  modal.querySelector<HTMLButtonElement>('#md-result-copy')!.addEventListener('click', async () => {
    const urlInput = modal.querySelector<HTMLInputElement>('#md-result-url')!;
    const ok = await copy(urlInput.value);
    urlInput.select();
    deps.showToast(ok ? 'check-circle' : 'alert-triangle', t(ok ? 'toast_copied' : 'toast_copy_failed'));
  });
}

function openModal(): void {
  modal.querySelector<HTMLElement>('#md-modal-form')!.hidden = false;
  modal.querySelector<HTMLElement>('#md-modal-result')!.hidden = true;
  modal.hidden = false;
  lucide.createIcons();
}

// ─── my docs drawer ───────────────────────────────────────────────────────────
let drawer: HTMLElement;

function buildDrawer(): void {
  drawer = el('div', 'md-overlay');
  drawer.hidden = true;
  drawer.innerHTML = `
    <div class="md-drawer" role="dialog" aria-modal="true">
      <div class="md-modal-head">
        <h3><span data-i18n="mydocs_title">My shared docs</span> <span class="md-note" data-i18n="mydocs_note">(saved on this device)</span></h3>
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
  drawer.querySelector('#md-drawer-close')!.addEventListener('click', close);
  drawer.querySelector('#md-drawer-clear')!.addEventListener('click', () => {
    store.clearDocs();
    renderDocs();
    deps.showToast('trash-2', t('toast_docs_cleared'));
  });
}

function renderDocs(): void {
  const list = drawer.querySelector<HTMLUListElement>('#md-docs-list')!;
  const empty = drawer.querySelector<HTMLElement>('#md-docs-empty')!;
  const docs = store.getDocs();
  empty.hidden = docs.length > 0;
  list.replaceChildren(...docs.map(renderDocItem));
  lucide.createIcons();
}

function renderDocItem(doc: MyDoc): HTMLLIElement {
  const li = el('li', 'md-doc-item');
  const modeLabel = t(doc.mode === 'editable' ? 'bar_editable' : 'bar_readonly');
  const when = new Date(doc.updatedAt).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' });

  const main = el('button', 'md-doc-main');
  main.innerHTML = `<span class="md-doc-title"></span><span class="md-doc-sub"><span class="md-doc-badge md-doc-badge-${doc.mode}">${modeLabel}</span> · ${when} · ${doc.versions.length} ${t('mydocs_versions')}</span>`;
  main.querySelector<HTMLElement>('.md-doc-title')!.textContent = doc.title || t('untitled');
  main.addEventListener('click', () => {
    drawer.hidden = true;
    location.hash = `#${doc.id}.${doc.key}`;
    void loadShared();
  });

  const actions = el('div', 'md-doc-actions');
  const copyBtn = el('button', 'md-icon-btn', '<i data-lucide="copy" class="w-4 h-4"></i>');
  copyBtn.title = t('bar_copy');
  copyBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const ok = await copy(doc.url);
    deps.showToast(ok ? 'check-circle' : 'alert-triangle', t(ok ? 'toast_copied' : 'toast_copy_failed'));
  });
  const delBtn = el('button', 'md-icon-btn', '<i data-lucide="trash-2" class="w-4 h-4"></i>');
  delBtn.title = t('mydocs_remove');
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    store.removeDoc(doc.id);
    renderDocs();
  });
  actions.append(copyBtn, delBtn);
  li.append(main, actions);
  return li;
}

function openDrawer(): void {
  renderDocs();
  drawer.hidden = false;
  lucide.createIcons();
}

// ─── init ─────────────────────────────────────────────────────────────────────
export function initShare(d: ShareDeps): void {
  deps = d;
  store = createDocStore(d.storageKey);
  buildBar();
  buildModal();
  buildDrawer();

  document.getElementById('share-btn')?.addEventListener('click', openModal);
  document.getElementById('mydocs-btn')?.addEventListener('click', openDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      modal.hidden = true;
      drawer.hidden = true;
    }
  });

  // Re-translate all JS-built UI when the language switches.
  window.addEventListener(d.langChangeEvent ?? 'c2md:langchange', () => {
    translateTree(bar);
    translateTree(modal);
    translateTree(drawer);
    updateBar();
  });

  // The bar can wrap at narrow widths, changing its height.
  window.addEventListener('resize', syncBarSpacing);

  if (hasShareLink()) void loadShared();
}
