/**
 * app.ts — Entry point for Paste to Markdown (paste2md).
 *
 * Wires up all modules:
 *   - CodeMirror editor (codemirror-editor.ts)
 *   - Settings toggles (settings.ts)
 *   - Preview renderer — Shadow DOM (preview.ts + preview-renderer.ts)
 *   - Export PDF (export-pdf.ts)
 *   - Export DOCX (export-docx.ts)
 *   - Theme toggle (theme.ts)
 *   - Mobile tabs (tabs.ts)
 *   - i18n (i18n-client.ts)
 */
import { convert } from './turndown-config';
import { normalizeTableColumns } from './markdown-tables';
import { init as initI18n, t } from './i18n-client';
import { showToast, copyToClipboard, downloadBlob } from './utils';
import { initTheme } from '@shared/theme/toggle';
import { initTabs } from './tabs';
import {
  createEditor,
  getValue,
  setValue,
  onUpdate,
  onPaste,
  onScroll,
  getScrollDOM,
  getContentDOM,
  isComposing,
  scrollTo,
  focus,
  setReadOnly,
} from './codemirror-editor';
import { initSettings } from './settings';
import {
  initPreview,
  renderPreview,
  cancelPendingRender,
  syncPreviewTheme,
  invalidateParser,
  getRenderer,
} from './preview';
import { createScrollSyncController } from './scroll-sync';
import { initExportPDF } from './export-pdf';
import { initExportDocx } from './export-docx';
import {
  initShare,
  notifyChange as shareNotify,
  hasShareLink,
  hasActiveSharedDoc,
} from '@shared/paste-share/share';
import { createDualDraftStore } from '@shared/paste-share/draft-store';

const LIVE_PREVIEW_DEBOUNCE_MS = 80;

function initViewportHeightSync(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const syncViewportHeight = (): void => {
    // Ignore pinch-zoom scaling so desktop/mobile zoom does not shrink the shell
    if (Math.abs(vv.scale - 1) > 0.05) return;
    document.documentElement.style.setProperty('--c2md-vvh', `${Math.round(vv.height)}px`);
    if (vv.offsetTop > 0 || window.scrollY > 0) {
      window.scrollTo(0, 0);
    }
  };
  vv.addEventListener('resize', syncViewportHeight, { passive: true });
  vv.addEventListener('scroll', syncViewportHeight, { passive: true });
  syncViewportHeight();
}

document.addEventListener('DOMContentLoaded', () => {
  // Lucide is loaded via CDN — typed in src/shared/globals.d.ts.
  window.lucide?.createIcons();
  initViewportHeightSync();

  // ─── Initialize core modules ────────────────────────────────────────────────
  createEditor(document.getElementById('codemirror-host') as HTMLDivElement);

  const settings = initSettings();
  const draftStore = createDualDraftStore('c2md');
  let isProgrammaticSet = false;
  let isImmediateTransform = false;
  let isEditorReadOnly = false;
  let hasUserEdited = false;
  let isInitialWorkspaceSwitch = true;
  let liveUpdateTimer: number | null = null;
  let hasPendingDraftSave = false;

  const previewHostEl = document.getElementById('preview-host') as HTMLDivElement;
  const preview = initPreview(previewHostEl);
  const previewScrollEl = preview.getScrollEl();

  const isDark = (): boolean => document.documentElement.classList.contains('dark');

  // ─── Empty-state visibility helpers ─────────────────────────────────────────
  const emptyState = document.getElementById('empty-state') as HTMLDivElement;
  const previewEmptyState = document.getElementById('preview-empty-state') as HTMLDivElement;
  let lastEmptyFlag: boolean | null = null;

  function updateEmptyStates(val: string): void {
    const isEmpty = val.length === 0;
    if (isEmpty === lastEmptyFlag) return;
    lastEmptyFlag = isEmpty;
    emptyState.classList.toggle('is-hidden', !isEmpty);
    previewEmptyState.classList.toggle('is-hidden', !isEmpty);
  }
  updateEmptyStates(getValue());

  // ─── Render helper (shared options) ─────────────────────────────────────────
  function getRenderOpts() {
    return {
      renderMermaid: settings.get('renderMermaid'),
      renderLatex: settings.get('renderLatex'),
      isDark: isDark(),
    };
  }

  // ─── Synchronized scrolling (driver-isolated, loop-free) ────────────────────
  const scrollSync = createScrollSyncController({
    isEnabled: () => settings.get('syncScroll'),
    getEditorMetrics: () => {
      const scrollDOM = getScrollDOM();
      if (!scrollDOM) return null;
      return {
        scrollTop: scrollDOM.scrollTop,
        scrollHeight: scrollDOM.scrollHeight,
        clientHeight: scrollDOM.clientHeight,
      };
    },
    getPreviewMetrics: () => ({
      scrollTop: previewScrollEl.scrollTop,
      scrollHeight: previewScrollEl.scrollHeight,
      clientHeight: previewScrollEl.clientHeight,
    }),
    scrollEditorTo: (top) => scrollTo(top),
    scrollPreviewTo: (top) => {
      previewScrollEl.scrollTop = top;
    },
  });

  const editorPaneEl = document.getElementById('editor-pane');
  const previewPaneEl = document.getElementById('preview-pane');
  const setEditorDriver = (): void => scrollSync.setActiveDriver('editor');
  const setPreviewDriver = (): void => scrollSync.setActiveDriver('preview');

  for (const evName of ['wheel', 'pointerdown', 'touchstart', 'keydown', 'focusin'] as const) {
    editorPaneEl?.addEventListener(evName, setEditorDriver, { passive: true });
  }
  for (const evName of ['wheel', 'pointerdown', 'touchstart', 'keydown'] as const) {
    previewPaneEl?.addEventListener(evName, setPreviewDriver, { passive: true });
    previewScrollEl.addEventListener(evName, setPreviewDriver, { passive: true });
  }

  async function runPreviewRender(md: string, opts = getRenderOpts()): Promise<void> {
    scrollSync.beginPreviewMutation();
    try {
      await renderPreview(md, opts);
    } finally {
      scrollSync.endPreviewMutation();
    }
  }

  function clearScheduledLiveUpdate(): void {
    if (liveUpdateTimer !== null) {
      window.clearTimeout(liveUpdateTimer);
      liveUpdateTimer = null;
    }
  }

  function flushPendingDraftSave(): void {
    if (!hasPendingDraftSave) return;
    hasPendingDraftSave = false;
    if (!hasActiveSharedDoc()) {
      draftStore.save({ content: getValue() });
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushPendingDraftSave();
    }
  });
  window.addEventListener('beforeunload', flushPendingDraftSave);

  function handleSetReadOnly(ro: boolean): void {
    isEditorReadOnly = ro;
    setReadOnly(ro);
  }

  function setProgrammaticValue(val: string): void {
    clearScheduledLiveUpdate();
    hasPendingDraftSave = false;
    isProgrammaticSet = true;
    try {
      setValue(val, { preservePosition: false });
      updateEmptyStates(val);
      if (!val) {
        cancelPendingRender();
        getRenderer()?.clear();
      }
    } finally {
      isProgrammaticSet = false;
    }
  }

  function applyInPlaceTransform(val: string): void {
    clearScheduledLiveUpdate();
    hasPendingDraftSave = false;
    isImmediateTransform = true;
    try {
      setValue(val, { preservePosition: true });
    } finally {
      isImmediateTransform = false;
    }
  }

  // ─── Paste handler ───────────────────────────────────────────────────────────
  onPaste((html, plain) => {
    if (isEditorReadOnly) {
      showToast('lock', t('toast_readonly_hint'));
      return null;
    }
    if (settings.get('autoConvert') && html) {
      showToast('clipboard', t('toast_html_success'));
      return convert(html);
    }
    if (plain) {
      showToast('type', t('toast_plain_text'));
      return plain;
    }
    return null;
  });

  // ─── Live preview (coalesced during typing / IME bursts) ─────────────────────
  function scheduleLivePreviewRender(): void {
    clearScheduledLiveUpdate();
    liveUpdateTimer = window.setTimeout(() => {
      liveUpdateTimer = null;
      if (isComposing()) return;
      flushPendingDraftSave();
      void runPreviewRender(getValue());
    }, LIVE_PREVIEW_DEBOUNCE_MS);
  }

  getContentDOM()?.addEventListener('compositionend', () => {
    scrollSync.markUserEditing();
    clearScheduledLiveUpdate();
    flushPendingDraftSave();
    void runPreviewRender(getValue());
  });

  onUpdate((val, meta) => {
    updateEmptyStates(val);

    if (isProgrammaticSet) {
      shareNotify();
      if (val) {
        void runPreviewRender(val);
      }
      return;
    }

    hasUserEdited = true;
    scrollSync.markUserEditing();
    shareNotify();

    if (meta.isPaste || isImmediateTransform) {
      clearScheduledLiveUpdate();
      hasPendingDraftSave = false;
      if (!hasActiveSharedDoc()) {
        draftStore.save({ content: val });
      }
      void runPreviewRender(val);
      return;
    }

    if (!hasActiveSharedDoc()) {
      hasPendingDraftSave = true;
    }
    if (meta.isComposing) return;
    scheduleLivePreviewRender();
  });

  // Re-render when toggle settings change
  settings.onChange('renderLatex', () => {
    invalidateParser();
    void runPreviewRender(getValue());
  });
  settings.onChange('renderMermaid', () => {
    void runPreviewRender(getValue());
  });

  // ─── Theme change ────────────────────────────────────────────────────────────
  window.addEventListener('themechange', (e: Event) => {
    // Use detail.theme from the event — it carries the NEW theme value
    const newThemeIsDark = (e as CustomEvent).detail?.theme === 'dark';
    syncPreviewTheme(newThemeIsDark);
    // Re-render Mermaid in new theme if content exists
    if (settings.get('renderMermaid') && getValue()) {
      void runPreviewRender(getValue(), {
        renderMermaid: settings.get('renderMermaid'),
        renderLatex: settings.get('renderLatex'),
        isDark: newThemeIsDark,
      });
    }
  });

  onScroll((info) => {
    scrollSync.handleEditorScroll(info);
  });

  previewScrollEl.addEventListener(
    'scroll',
    () => {
      scrollSync.handlePreviewScroll({
        scrollTop: previewScrollEl.scrollTop,
        scrollHeight: previewScrollEl.scrollHeight,
        clientHeight: previewScrollEl.clientHeight,
      });
    },
    { passive: true }
  );

  // ─── Export handlers ─────────────────────────────────────────────────────────
  initExportPDF(() => getRenderer()?.getHTML() ?? '', isDark, showToast, t);

  initExportDocx(getValue, showToast, t);

  // ─── Export MD file ──────────────────────────────────────────────────────────
  document.getElementById('export-md-btn')?.addEventListener('click', () => {
    const text = getValue();
    if (!text) return showToast('alert-triangle', t('toast_nothing_to_copy'));
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    downloadBlob(blob, 'document.md');
    showToast('file-down', t('toast_exported_md'));
  });

  // ─── Copy Markdown ────────────────────────────────────────────────────────────
  document.getElementById('copy-md-btn')?.addEventListener('click', async () => {
    const text = getValue();
    if (!text) return showToast('alert-triangle', t('toast_nothing_to_copy'));
    const ok = await copyToClipboard(text);
    showToast(ok ? 'check-circle' : 'alert-triangle', t(ok ? 'toast_copied' : 'toast_copy_failed'));
  });

  // ─── Format Markdown (Prettier — lazy loaded) ────────────────────────────────
  // Cache the in-flight load Promise per URL. A plain Set wouldn't help if the
  // user clicked "Pretty" twice before the first <script> finished loading —
  // we'd inject the tag a second time. With a Map<url, Promise>, repeated
  // calls await the same promise and the tag is appended exactly once.
  const scriptLoads = new Map<string, Promise<void>>();
  function loadScript(url: string): Promise<void> {
    const existing = scriptLoads.get(url);
    if (existing) return existing;
    const promise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.onload = () => resolve();
      script.onerror = () => {
        scriptLoads.delete(url); // Allow a retry after a transient failure.
        reject(new Error(`Failed to load script ${url}`));
      };
      document.head.appendChild(script);
    });
    scriptLoads.set(url, promise);
    return promise;
  }

  document.getElementById('format-md-btn')?.addEventListener('click', async () => {
    if (isEditorReadOnly) return showToast('lock', t('toast_readonly_hint'));
    const text = getValue();
    if (!text) return showToast('alert-triangle', t('toast_nothing_to_copy'));
    showToast('loader', t('toast_formatting'));
    try {
      if (typeof window.prettier === 'undefined') {
        await loadScript('https://unpkg.com/prettier@3.2.5/standalone.js');
        await loadScript('https://unpkg.com/prettier@3.2.5/plugins/markdown.js');
      }
      // Normalize table columns first: Prettier expands a table's delimiter/body
      // rows to the widest row but leaves the header untouched, so a body row
      // with extra cells yields a header≠delimiter mismatch that GFM refuses to
      // render. Pre-trimming to the header's column count keeps the rendered
      // output identical while giving Prettier a consistent table to format.
      const plugins = window.prettierPlugins ? Object.values(window.prettierPlugins) : [];
      const formatted = await window.prettier.format(normalizeTableColumns(text), {
        parser: 'markdown',
        plugins,
      });
      applyInPlaceTransform(formatted);
      focus();
      showToast('wand-sparkles', t('toast_formatted'));
    } catch (err) {
      console.error('Prettier format error:', err);
      showToast('alert-triangle', t('toast_format_failed'));
    }
  });

  // ─── Compact Markdown ──────────────────────────────────────────────────────────
  document.getElementById('compact-md-btn')?.addEventListener('click', () => {
    if (isEditorReadOnly) return showToast('lock', t('toast_readonly_hint'));
    const text = getValue();
    if (!text) return showToast('alert-triangle', t('toast_nothing_to_copy'));

    // Compact: remove trailing spaces, compact tables, replace 3+ newlines with 2 newlines
    let inCodeBlock = false;
    const compacted = text
      .split('\n')
      .map((line) => {
        const matchIndent = line.match(/^\s*/);
        const indent = matchIndent ? matchIndent[0] : '';
        const trimmed = line.trim();

        if (trimmed.startsWith('```')) {
          inCodeBlock = !inCodeBlock;
          return line.trimEnd();
        }
        if (inCodeBlock) return line.trimEnd();

        // Skip standard Markdown indented code blocks (>= 4 spaces or tab)
        if (indent.length >= 4 || indent.includes('\t')) return line.trimEnd();

        if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
          const cells = trimmed.split(/(?<!\\)\|/);
          // Ensure it's a valid table row format (at least 1 column -> 3 elements: ['', 'cell', ''])
          if (
            cells.length >= 3 &&
            cells[0].trim() === '' &&
            cells[cells.length - 1].trim() === ''
          ) {
            const compactedCells = cells.map((c) => {
              const tc = c.trim();
              return /^:?-+:?$/.test(tc) ? tc.replace(/-+/g, '---') : tc.replace(/ {2,}/g, ' ');
            });
            // Keep the original indentation
            return indent + compactedCells.join(' | ').trim();
          }
        }
        return line.trimEnd();
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    applyInPlaceTransform(compacted);
    focus();
    showToast('minimize', t('toast_compacted') || 'Compacted!');
  });

  // ─── Clear ───────────────────────────────────────────────────────────────────
  document.getElementById('clear-btn')?.addEventListener('click', () => {
    if (isEditorReadOnly) return showToast('lock', t('toast_readonly_hint'));
    setProgrammaticValue('');
    if (!hasActiveSharedDoc()) {
      void draftStore.clear();
    }
    showToast('trash', t('toast_cleared'));
  });

  // ─── Settings dropdown ────────────────────────────────────────────────────────
  const settingsBtn = document.getElementById('settings-btn');
  const settingsPanel = document.getElementById('settings-panel');
  if (settingsBtn && settingsPanel) {
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      settingsPanel.classList.toggle('open');
    });
    settingsPanel.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => settingsPanel.classList.remove('open'));
  }

  // ─── Initialize remaining modules ────────────────────────────────────────────
  initTheme();
  initTabs();
  initI18n();
  syncPreviewTheme(isDark()); // set initial preview color mode

  // Share layer (encrypt + share link, open shared docs, Dual Local/Cloud history).
  initShare({
    getValue,
    setValue: setProgrammaticValue,
    showToast,
    t,
    linkBase: '/paste2md/',
    storageKey: 'md:docs',
    cloudCollection: 'md_docs',
    setReadOnly: handleSetReadOnly,
    onBeforeSignOut: () => {
      flushPendingDraftSave();
      return draftStore.flush();
    },
    onAuthWorkspaceSwitch: async (user) => {
      const firstBoot = isInitialWorkspaceSwitch;
      isInitialWorkspaceSwitch = false;
      const draft = await draftStore.switchUser(user?.uid ?? null);
      if (hasShareLink()) return;
      if (firstBoot && hasUserEdited) {
        const liveVal = getValue();
        if (liveVal || !draft.content) {
          draftStore.save({ content: liveVal });
          return;
        }
      }
      setProgrammaticValue(draft.content);
    },
    onDetach: async () => {
      const draft = await draftStore.load();
      setProgrammaticValue(draft.content);
    },
  });
});
