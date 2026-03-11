/**
 * Main application logic for Clipboard2Markdown.
 * Features: Auto-convert toggle, paste handling, live preview,
 * split-screen, Export MD/PDF, theme toggle, i18n.
 *
 * Uses CodeMirror 6 for the Markdown editor with syntax highlighting.
 */
import { convert } from './turndown-config';
import { init as initI18n, t } from './i18n-client';
import { showToast, copyToClipboard, downloadBlob } from './utils';
import { initTheme } from './theme';
import { initTabs } from './tabs';
import { createEditor, getValue, setValue, insertAtCursor, onUpdate, onScroll, getScrollDOM, scrollTo } from './codemirror-editor';

// @ts-ignore — loaded via CDN
const lucide = window.lucide;
// @ts-ignore
const marked = window.marked;
// @ts-ignore
const DOMPurify = window.DOMPurify;
// @ts-ignore
const mermaid = window.mermaid;
// @ts-ignore
const renderMathInElement = window.renderMathInElement;

document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();

  // --- Initialize Mermaid (manual rendering, not on load) ---
  if (typeof mermaid !== 'undefined') {
    mermaid.initialize({
      startOnLoad: false,
      theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
      securityLevel: 'loose',
    });
  }

  // --- DOM Elements ---
  const editorHost = document.getElementById('codemirror-host') as HTMLDivElement;
  const previewContent = document.getElementById('preview-content') as HTMLDivElement;
  const emptyState = document.getElementById('empty-state') as HTMLDivElement;
  const previewEmptyState = document.getElementById('preview-empty-state') as HTMLDivElement;
  const previewPane = document.getElementById('preview-pane') as HTMLDivElement;
  const autoConvertToggle = document.getElementById('auto-convert-toggle') as HTMLInputElement;
  const renderMermaidToggle = document.getElementById('render-mermaid-toggle') as HTMLInputElement;
  const renderLatexToggle = document.getElementById('render-latex-toggle') as HTMLInputElement;
  const syncScrollToggle = document.getElementById('sync-scroll-toggle') as HTMLInputElement;

  // --- Initialize CodeMirror ---
  const editor = createEditor(editorHost);

  const AUTOCONVERT_KEY = 'c2md-autoconvert';
  const RENDER_MERMAID_KEY = 'c2md-render-mermaid';
  const RENDER_LATEX_KEY = 'c2md-render-latex';
  const SYNC_SCROLL_KEY = 'c2md-sync-scroll';

  // --- State ---
  let lastPasteCache = { html: '', plain: '', converted: '' };

  // --- Toggle state (shared for all boolean localStorage settings) ---
  function loadToggleState(key: string): boolean {
    const saved = localStorage.getItem(key);
    return saved === null ? true : saved === 'true';
  }

  autoConvertToggle.checked = loadToggleState(AUTOCONVERT_KEY);
  autoConvertToggle.addEventListener('change', () => {
    const isOn = autoConvertToggle.checked;
    localStorage.setItem(AUTOCONVERT_KEY, String(isOn));

    if (lastPasteCache.html || lastPasteCache.plain) {
      if (isOn && lastPasteCache.html) {
        const result = convert(lastPasteCache.html);
        lastPasteCache.converted = result;
        updateContent(result);
      } else if (!isOn && lastPasteCache.plain) {
        updateContent(lastPasteCache.plain);
      }
    }
  });

  renderMermaidToggle.checked = loadToggleState(RENDER_MERMAID_KEY);
  renderLatexToggle.checked = loadToggleState(RENDER_LATEX_KEY);

  renderMermaidToggle.addEventListener('change', () => {
    localStorage.setItem(RENDER_MERMAID_KEY, String(renderMermaidToggle.checked));
    renderPreview(getValue());
  });

  renderLatexToggle.addEventListener('change', () => {
    localStorage.setItem(RENDER_LATEX_KEY, String(renderLatexToggle.checked));
    renderPreview(getValue());
  });

  syncScrollToggle.checked = loadToggleState(SYNC_SCROLL_KEY);
  syncScrollToggle.addEventListener('change', () => {
    localStorage.setItem(SYNC_SCROLL_KEY, String(syncScrollToggle.checked));
  });

  // --- DOMPurify config ---
  // Allow SVG elements for Mermaid + KaTeX rendering
  const DOMPURIFY_CONFIG = {
    ADD_TAGS: ['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
      'text', 'tspan', 'defs', 'marker', 'foreignObject', 'use', 'clipPath', 'style',
      'span', 'math', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'mover',
      'munder', 'msqrt', 'mtext', 'semantics', 'annotation'],
    ADD_ATTR: ['viewBox', 'xmlns', 'fill', 'stroke', 'stroke-width', 'd', 'transform',
      'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height',
      'points', 'marker-end', 'refX', 'refY', 'orient', 'markerWidth', 'markerHeight',
      'text-anchor', 'dominant-baseline', 'font-size', 'font-family', 'font-weight',
      'class', 'id', 'style', 'clip-path', 'aria-label', 'role', 'tabindex',
      'xmlns:xlink', 'xlink:href', 'href', 'overflow', 'preserveAspectRatio'],
  };

  DOMPurify.addHook('afterSanitizeAttributes', (node: Element) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });

  // --- Paste handler ---
  document.addEventListener('paste', (e: ClipboardEvent) => {
    e.preventDefault();
    const clipboard = e.clipboardData;
    if (!clipboard) return;

    const types = clipboard.types;
    const isAutoConvert = autoConvertToggle.checked;

    const htmlData = types.includes('text/html') ? clipboard.getData('text/html') : '';
    const plainData = types.includes('text/plain') ? clipboard.getData('text/plain') : '';

    lastPasteCache.html = htmlData;
    lastPasteCache.plain = plainData;

    const hasExistingContent = getValue().length > 0;

    if (isAutoConvert && htmlData) {
      const result = convert(htmlData);
      lastPasteCache.converted = result;
      showToast('clipboard', t('toast_html_success'));
      if (hasExistingContent) {
        insertAtCursor(result);
      } else {
        updateContent(result);
      }
    } else if (plainData) {
      showToast('type', t('toast_plain_text'));
      if (hasExistingContent) {
        insertAtCursor(plainData);
      } else {
        updateContent(plainData);
      }
    }
  });

  // --- Content update ---
  function updateContent(md: string): void {
    setValue(md);
    emptyState.style.opacity = '0';
    previewEmptyState.style.opacity = '0';
    renderPreview(md);
  }

  // --- Preview rendering ---
  let mermaidIdCounter = 0;

  async function renderPreview(md: string): Promise<void> {
    if (typeof marked === 'undefined') return;
    const rawHtml = marked.parse(md || '');
    const cleanHtml = DOMPurify.sanitize(rawHtml, DOMPURIFY_CONFIG);
    previewContent.innerHTML = cleanHtml;

    // --- Mermaid: find ```mermaid code blocks and render them ---
    if (renderMermaidToggle.checked && typeof mermaid !== 'undefined') {
      const mermaidBlocks = previewContent.querySelectorAll('code.language-mermaid');
      for (const codeEl of mermaidBlocks) {
        const pre = codeEl.parentElement;
        if (!pre || pre.tagName !== 'PRE') continue;

        const container = document.createElement('div');
        container.className = 'mermaid';
        container.id = `mermaid-${mermaidIdCounter++}`;
        container.textContent = codeEl.textContent || '';
        pre.replaceWith(container);
      }

      // Update mermaid theme based on current mode
      const isDark = document.documentElement.classList.contains('dark');
      mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? 'dark' : 'default',
        securityLevel: 'loose',
      });

      const mermaidNodes = previewContent.querySelectorAll('.mermaid');
      if (mermaidNodes.length > 0) {
        try {
          await mermaid.run({ nodes: mermaidNodes });
        } catch (_) {
          // Silently handle mermaid parse errors (user may still be typing)
        }
      }
    }

    // --- KaTeX: render LaTeX math expressions ---
    if (renderLatexToggle.checked && typeof renderMathInElement !== 'undefined') {
      renderMathInElement(previewContent, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true },
        ],
        throwOnError: false,
      });
    }
  }

  // --- Live preview (CodeMirror update listener) ---
  onUpdate((val: string) => {
    emptyState.style.opacity = val ? '0' : '1';
    previewEmptyState.style.opacity = val ? '0' : '1';
    renderPreview(val);
  });

  // --- Synchronized scrolling ---
  const previewBody = previewPane.querySelector('.pane-body') as HTMLDivElement;
  let isSyncingScroll = false;

  onScroll((info) => {
    if (!syncScrollToggle.checked || isSyncingScroll) return;
    isSyncingScroll = true;
    const ratio = info.scrollTop / (info.scrollHeight - info.clientHeight || 1);
    previewBody.scrollTop = ratio * (previewBody.scrollHeight - previewBody.clientHeight);
    requestAnimationFrame(() => {
      isSyncingScroll = false;
    });
  });

  previewBody.addEventListener('scroll', () => {
    if (!syncScrollToggle.checked || isSyncingScroll) return;
    isSyncingScroll = true;
    const ratio =
      previewBody.scrollTop / (previewBody.scrollHeight - previewBody.clientHeight || 1);
    const scrollDOM = getScrollDOM();
    if (scrollDOM) {
      scrollTo(ratio * (scrollDOM.scrollHeight - scrollDOM.clientHeight));
    }
    requestAnimationFrame(() => {
      isSyncingScroll = false;
    });
  });

  // --- Copy Markdown ---
  document.getElementById('copy-md-btn')?.addEventListener('click', () => {
    const text = getValue();
    if (!text) return showToast('alert-triangle', t('toast_nothing_to_copy'));
    copyToClipboard(text);
    showToast('check-circle', t('toast_copied'));
  });

  // --- Format Markdown ---
  function formatMarkdown(md: string): string {
    const lines = md.split('\n');
    const out: string[] = [];
    let prevWasBlank = false;
    let inFence = false;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

      // Detect fenced code block boundaries (``` or ~~~)
      if (/^(`{3,}|~{3,})/.test(line.trimStart())) {
        inFence = !inFence;
        out.push(line);
        prevWasBlank = false;
        continue;
      }

      // Don't touch content inside code blocks
      if (inFence) {
        out.push(line);
        continue;
      }

      // Strip trailing whitespace
      line = line.trimEnd();

      // Blank line: collapse multiple consecutive blanks into one
      if (line === '') {
        if (!prevWasBlank && out.length > 0) out.push('');
        prevWasBlank = true;
        continue;
      }

      // Fix ATX headings: ensure exactly one space after #'s (e.g. "#Heading" → "# Heading")
      const headingHashMatch = line.match(/^(#{1,6})([^#\s].*)?$/);
      if (headingHashMatch) {
        const hashes = headingHashMatch[1];
        const rest = line.slice(hashes.length).trimStart();
        line = `${hashes} ${rest}`;
      }

      // Normalise unordered bullet markers to "-" (preserve indentation)
      line = line.replace(/^(\s*)[*+](\s+)/, '$1-$2');

      const isHeading = /^#{1,6}\s/.test(line);
      const isHR = /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line);

      // Ensure a blank line before headings and HRs
      if ((isHeading || isHR) && !prevWasBlank && out.length > 0) {
        out.push('');
      }

      out.push(line);
      prevWasBlank = false;

      // Ensure a blank line after headings and HRs (peek ahead)
      if ((isHeading || isHR) && i + 1 < lines.length && lines[i + 1].trim() !== '') {
        out.push('');
        prevWasBlank = true;
      }
    }

    // Remove trailing blank lines, end with single newline
    while (out.length > 0 && out[out.length - 1] === '') out.pop();
    return out.join('\n') + '\n';
  }

  document.getElementById('format-md-btn')?.addEventListener('click', () => {
    const text = getValue();
    if (!text) return showToast('alert-triangle', t('toast_nothing_to_copy'));
    const formatted = formatMarkdown(text);
    setValue(formatted);
    showToast('wand-sparkles', t('toast_formatted'));
  });


  // --- Export MD file ---
  document.getElementById('export-md-btn')?.addEventListener('click', () => {
    const text = getValue();
    if (!text) return showToast('alert-triangle', t('toast_nothing_to_copy'));
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    downloadBlob(blob, 'document.md');
    showToast('file-down', t('toast_exported_md'));
  });

  // --- Export PDF ---
  document.getElementById('export-pdf-btn')?.addEventListener('click', () => {
    const content = previewContent.innerHTML;
    if (!content) return showToast('alert-triangle', t('toast_nothing_to_copy'));

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Markdown Export</title>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css" crossorigin="anonymous">
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
        <style>
          body { font-family: 'Inter', 'Segoe UI', sans-serif; padding: 2rem; max-width: 800px; margin: 0 auto; color: #1e293b; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <div id="preview-content">${content}</div>
        <script>setTimeout(() => { window.print(); window.close(); }, 500);<\/script>
      </body>
      </html>
    `);
    printWindow.document.close();
    showToast('printer', t('toast_exported_pdf'));
  });

  // --- Export Word (DOC) ---
  document.getElementById('export-doc-btn')?.addEventListener('click', () => {
    const content = previewContent.innerHTML;
    if (!content) return showToast('alert-triangle', t('toast_nothing_to_copy'));

    const htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset='utf-8'>
        <title>Exported Document</title>
        <style>
          body { font-family: 'Inter', 'Segoe UI', sans-serif; padding: 2rem; max-width: 800px; margin: 0 auto; color: #000; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; }
          th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
          blockquote { border-left: 4px solid #ccc; padding-left: 1rem; color: #666; font-style: italic; }
          pre { background-color: #f3f4f6; padding: 1rem; border-radius: 4px; font-family: monospace; white-space: pre-wrap; }
          code { font-family: monospace; background-color: #f3f4f6; padding: 0.2rem 0.4rem; border-radius: 3px; }
          img { max-width: 100%; height: auto; }
        </style>
      </head>
      <body>
        ${content}
      </body>
      </html>
    `;

    const blob = new Blob(['\ufeff', htmlContent], { type: 'application/msword;charset=utf-8' });
    downloadBlob(blob, 'document.doc');
    showToast('file-text', t('toast_exported_doc'));
  });

  // --- Clear ---
  document.getElementById('clear-btn')?.addEventListener('click', () => {
    setValue('');
    previewContent.innerHTML = '';
    emptyState.style.opacity = '1';
    previewEmptyState.style.opacity = '1';
    lastPasteCache = { html: '', plain: '', converted: '' };
    showToast('trash', t('toast_cleared'));
  });

  // --- Settings dropdown toggle ---
  const settingsBtn = document.getElementById('settings-btn');
  const settingsPanel = document.getElementById('settings-panel');
  if (settingsBtn && settingsPanel) {
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      settingsPanel.classList.toggle('open');
    });
    // Prevent clicks inside panel from closing it
    settingsPanel.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    // Close on click outside
    document.addEventListener('click', () => {
      settingsPanel.classList.remove('open');
    });
  }

  // --- Initialize modules ---
  initTheme();
  initTabs();
  initI18n();
});
