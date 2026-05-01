/**
 * app.ts — Entry point for clipboard2markdown.
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
import { init as initI18n, t } from './i18n-client';
import { showToast, copyToClipboard, downloadBlob } from './utils';
import { initTheme } from './theme';
import { initTabs } from './tabs';
import {
  createEditor,
  getValue,
  setValue,
  onUpdate,
  onPaste,
  onScroll,
  getScrollDOM,
  scrollTo,
} from './codemirror-editor';
import { initSettings } from './settings';
import {
  initPreview,
  renderPreview,
  syncPreviewTheme,
  invalidateParser,
  getRenderer,
} from './preview';
import { initExportPDF } from './export-pdf';
import { initExportDocx } from './export-docx';

document.addEventListener('DOMContentLoaded', () => {
  // @ts-ignore — CDN global
  window.lucide.createIcons();

  // ─── Initialize core modules ────────────────────────────────────────────────
  createEditor(document.getElementById('codemirror-host') as HTMLDivElement);

  const settings = initSettings();

  const previewHostEl = document.getElementById('preview-host') as HTMLDivElement;
  const preview = initPreview(previewHostEl);

  const isDark = (): boolean => document.documentElement.classList.contains('dark');

  // ─── Empty-state visibility helpers ─────────────────────────────────────────
  const emptyState = document.getElementById('empty-state') as HTMLDivElement;
  const previewEmptyState = document.getElementById('preview-empty-state') as HTMLDivElement;

  function updateEmptyStates(val: string): void {
    emptyState.style.opacity = val ? '0' : '1';
    previewEmptyState.style.opacity = val ? '0' : '1';
  }

  // ─── Render helper (shared options) ─────────────────────────────────────────
  function getRenderOpts() {
    return {
      renderMermaid: settings.get('renderMermaid'),
      renderLatex: settings.get('renderLatex'),
      isDark: isDark(),
    };
  }

  // ─── Paste handler ───────────────────────────────────────────────────────────
  onPaste((html, plain) => {
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

  // ─── Live preview ────────────────────────────────────────────────────────────
  onUpdate(async (val) => {
    updateEmptyStates(val);
    await renderPreview(val, getRenderOpts());
  });

  // Re-render when toggle settings change
  settings.onChange('renderLatex', () => {
    invalidateParser();
    renderPreview(getValue(), getRenderOpts());
  });
  settings.onChange('renderMermaid', () => renderPreview(getValue(), getRenderOpts()));

  // ─── Theme change ────────────────────────────────────────────────────────────
  window.addEventListener('themechange', (e: Event) => {
    // Use detail.theme from the event — it carries the NEW theme value
    const newThemeIsDark = (e as CustomEvent).detail?.theme === 'dark';
    syncPreviewTheme(newThemeIsDark);
    // Re-render Mermaid in new theme if content exists
    if (settings.get('renderMermaid') && getValue()) {
      renderPreview(getValue(), {
        renderMermaid: settings.get('renderMermaid'),
        renderLatex: settings.get('renderLatex'),
        isDark: newThemeIsDark,
      });
    }
  });

  // ─── Synchronized scrolling ───────────────────────────────────────────────────
  const previewScrollEl = preview.getScrollEl();
  let isSyncingScroll = false;

  onScroll((info) => {
    if (!settings.get('syncScroll') || isSyncingScroll) return;
    isSyncingScroll = true;
    const ratio = info.scrollTop / (info.scrollHeight - info.clientHeight || 1);
    previewScrollEl.scrollTop =
      ratio * (previewScrollEl.scrollHeight - previewScrollEl.clientHeight);
    requestAnimationFrame(() => {
      isSyncingScroll = false;
    });
  });

  previewScrollEl.addEventListener('scroll', () => {
    if (!settings.get('syncScroll') || isSyncingScroll) return;
    isSyncingScroll = true;
    const ratio =
      previewScrollEl.scrollTop /
      (previewScrollEl.scrollHeight - previewScrollEl.clientHeight || 1);
    const scrollDOM = getScrollDOM();
    if (scrollDOM) scrollTo(ratio * (scrollDOM.scrollHeight - scrollDOM.clientHeight));
    requestAnimationFrame(() => {
      isSyncingScroll = false;
    });
  });

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
  document.getElementById('copy-md-btn')?.addEventListener('click', () => {
    const text = getValue();
    if (!text) return showToast('alert-triangle', t('toast_nothing_to_copy'));
    copyToClipboard(text);
    showToast('check-circle', t('toast_copied'));
  });

  // ─── Format Markdown (Prettier — lazy loaded) ────────────────────────────────
  const loadedScripts = new Set<string>();
  async function loadScript(url: string): Promise<void> {
    if (loadedScripts.has(url)) return;
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.onload = () => {
        loadedScripts.add(url);
        resolve();
      };
      script.onerror = () => reject(new Error(`Failed to load script ${url}`));
      document.head.appendChild(script);
    });
  }

  document.getElementById('format-md-btn')?.addEventListener('click', async () => {
    const text = getValue();
    if (!text) return showToast('alert-triangle', t('toast_nothing_to_copy'));
    showToast('loader', 'Formatting...');
    try {
      // @ts-ignore
      if (typeof window.prettier === 'undefined') {
        await loadScript('https://unpkg.com/prettier@3.2.5/standalone.js');
        await loadScript('https://unpkg.com/prettier@3.2.5/plugins/markdown.js');
      }
      // @ts-ignore
      const formatted = await window.prettier.format(text, {
        parser: 'markdown',
        plugins: window.prettierPlugins,
      });
      setValue(formatted);
      showToast('wand-sparkles', t('toast_formatted'));
    } catch (err) {
      console.error('Prettier format error:', err);
      showToast('alert-triangle', 'Failed to format Markdown');
    }
  });

  // ─── Clear ───────────────────────────────────────────────────────────────────
  document.getElementById('clear-btn')?.addEventListener('click', () => {
    setValue('');
    getRenderer()?.clear();
    emptyState.style.opacity = '1';
    previewEmptyState.style.opacity = '1';
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
});
