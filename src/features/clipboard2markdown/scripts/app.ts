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
import { createEditor, getValue, setValue, onUpdate, onPaste, onScroll, getScrollDOM, scrollTo } from './codemirror-editor';
// Import the native ESM bundler-compatible markdown to docx handler
import markdownDocx, { Packer } from 'markdown-docx';

import JSZip from 'jszip';

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

// @ts-ignore
const prettier = window.prettier;
// @ts-ignore
const prettierPlugins = window.prettierPlugins;

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

  // --- Toggle state (shared for all boolean localStorage settings) ---
  function loadToggleState(key: string): boolean {
    const saved = localStorage.getItem(key);
    return saved === null ? true : saved === 'true';
  }

  autoConvertToggle.checked = loadToggleState(AUTOCONVERT_KEY);
  autoConvertToggle.addEventListener('change', () => {
    localStorage.setItem(AUTOCONVERT_KEY, String(autoConvertToggle.checked));
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

  // --- Paste handler (scoped to editor via CodeMirror domEventHandlers) ---
  // Return the markdown string to insert, or null to let CodeMirror handle natively.
  // Cursor placement and selection replacement are handled automatically by CodeMirror.
  onPaste((html, plain) => {
    if (autoConvertToggle.checked && html) {
      showToast('clipboard', t('toast_html_success'));
      return convert(html);
    }
    if (plain) {
      showToast('type', t('toast_plain_text'));
      return plain;
    }
    return null;
  });


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

  // --- Format Markdown using Prettier (Standalone) ---
  document.getElementById('format-md-btn')?.addEventListener('click', async () => {
    const text = getValue();
    if (!text) return showToast('alert-triangle', t('toast_nothing_to_copy'));
    
    try {
      const formatted = await prettier.format(text, {
        parser: "markdown",
        plugins: prettierPlugins,
      });
      setValue(formatted);
      showToast('wand-sparkles', t('toast_formatted'));
    } catch (err) {
      console.error('Prettier format error:', err);
      showToast('alert-triangle', 'Failed to format Markdown');
    }
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

  // --- Mermaid to PNG Interceptor for DOCX ---
  const convertMermaidToImageText = async (markdownText: string): Promise<string> => {
    const mermaidRegex = /```mermaid\n([\s\S]*?)\n```/g;
    if (!mermaidRegex.test(markdownText)) return markdownText;
    mermaidRegex.lastIndex = 0;

    let processedText = markdownText;
    const replacements: { oldMatch: string, newImage: string }[] = [];

    // @ts-ignore
    if (!window.mermaid) return markdownText;
    // Disable HTML labels to prevent <foreignObject> tags which taint HTML canvases
    // @ts-ignore
    window.mermaid.initialize({ startOnLoad: false, htmlLabels: false });

    let match;
    let i = 0;
    while ((match = mermaidRegex.exec(markdownText)) !== null) {
      const fullMatch = match[0];
      const mermaidCode = match[1];

      try {
        const id = `mermaid-export-${Date.now()}-${i++}`;
        // @ts-ignore
        const { svg } = await window.mermaid.render(id, mermaidCode);

        const imgBase64 = await new Promise<string>((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous'; // Prevent canvas tainting
          
          // Encode SVG natively to base64 Data URI instead of blob to improve security context handling
          const svgBase64 = btoa(unescape(encodeURIComponent(svg)));
          
          img.onload = () => {
             const canvas = document.createElement('canvas');
             // Scale up 2x to ensure high-resolution rendering inside DOCX
             const pixelRatio = 2;
             const realWidth = img.width || 800;
             const realHeight = img.height || 600;
             
             canvas.width = realWidth * pixelRatio;
             canvas.height = realHeight * pixelRatio;
             
             const ctx = canvas.getContext('2d');
             if(ctx) {
               ctx.fillStyle = 'white'; 
               ctx.fillRect(0, 0, canvas.width, canvas.height);
               // Explicitly tell drawImage to draw with the scaled dimensions
               ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
               try {
                 resolve(canvas.toDataURL('image/png'));
               } catch (err) {
                 reject(new Error('Canvas tainted or export failed: ' + err));
               }
             } else {
               reject(new Error('Canvas context failed'));
             }
          };
          img.onerror = () => {
             reject(new Error('Image failed to load SVG'));
          };
          
          img.src = `data:image/svg+xml;base64,${svgBase64}`;
        });

        replacements.push({
          oldMatch: fullMatch,
          newImage: `![Mermaid Diagram](${imgBase64})`
        });
      } catch (err) {
        console.error('Failed to parse a Mermaid diagram for export:', err);
      }
    }

    for (const r of replacements) {
      processedText = processedText.replace(r.oldMatch, r.newImage);
    }
    return processedText;
  };

  // --- Export Word (DOCX) ---
  document.getElementById('export-doc-btn')?.addEventListener('click', async () => {
    let text = getValue();
    if (!text) return showToast('alert-triangle', t('toast_nothing_to_copy'));

    try {
      showToast('loader', 'Generating DOCX...');
      // Substitute Mermaid Blocks to Inline PNGs natively
      text = await convertMermaidToImageText(text);
      // Prevent `markdown-docx` from failing to parse `$$` blocks that are glued to Headings or Paragraphs.
      // We safely pad `$$` with empty lines, ONLY if it starts on a new line, to force block-parsing, without touching inner equation lines.
      text = text.replace(/(^#+[^\n]+)\n+(^\$\$)/gm, '$1\n\n$2'); 
      text = text.replace(/(?<!\n\n)(^\$\$)/gm, '\n\n$1');

      const doc = await markdownDocx(text, {
        document: {
          title: 'Exported Document',
        },
        math: {
          engine: 'katex',
        },
        imageAdapter: async (token) => {
          return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = async () => {
              // Word page standard text width is ~600px
              const MAX_WIDTH = 600; 
              let finalWidth = img.width;
              let finalHeight = img.height;

              // Enforce scale down if the fetched image is larger than word page width
              if (finalWidth > MAX_WIDTH) {
                const ratio = MAX_WIDTH / finalWidth;
                finalWidth = MAX_WIDTH;
                finalHeight = img.height * ratio;
              }

              // Handle fetching data securely for DOCX packing
              try {
                // Determine format
                let typeStr = 'png';
                if (token.href.endsWith('.jpg') || token.href.endsWith('.jpeg')) typeStr = 'jpg';
                if (token.href.endsWith('.gif')) typeStr = 'gif';
                // Data URIs are inherently parsed automatically by fetch 
                const rsp = await fetch(token.href);
                const buf = await rsp.arrayBuffer();
                resolve({
                  type: typeStr as any,
                  data: buf,
                  width: finalWidth,
                  height: finalHeight
                });
              } catch (e) {
                 console.warn("Failed to fetch image for DOCX export", token.href, e);
                 resolve(null);
              }
            };
            img.onerror = () => resolve(null);
            img.src = token.href;
          });
        }
      });
      // ============================================================
      // Post-serialization: Fix structural issues in the DOCX XML
      // ============================================================
      // The markdown-docx library generates structurally broken OOXML:
      //   1) Heading paragraphs have duplicate <w:pStyle> → invalid OOXML
      //   2) Custom Md* styles cause style inheritance bugs in Word
      //   3) Block math uses <m:oMath> (inline) instead of <m:oMathPara> (block)
      //   4) No <m:mathPr> in settings.xml → Word has no math defaults
      // User doesn't need complex styling — just correct content with defaults.
      let blob = await Packer.toBlob(doc);
      const zip = await JSZip.loadAsync(blob);

      // --- Fix document.xml ---
      let docXml = await zip.file('word/document.xml')!.async('string');

      // 1) Remove duplicate <w:pStyle> in heading paragraphs
      //    Keep only the standard Heading style, remove Md-prefixed duplicates
      docXml = docXml.replace(
        /<w:pStyle w:val="Heading(\d+)"\/><w:pStyle w:val="Md[^"]*"\/>/g,
        '<w:pStyle w:val="Heading$1"/>'
      );

      // 2) Strip all custom Md* styles — use standard Word defaults instead
      docXml = docXml.replace(/<w:pStyle w:val="MdParagraph"\/>/g, '');
      docXml = docXml.replace(/<w:pStyle w:val="MdSpace"\/>/g, '');
      docXml = docXml.replace(
        /<w:pStyle w:val="ListParagraph"\/><w:pStyle w:val="MdListItem"\/>/g,
        '<w:pStyle w:val="ListParagraph"/>'
      );
      docXml = docXml.replace(/<w:pStyle w:val="MdListItem"\/>/g, '<w:pStyle w:val="ListParagraph"/>');
      docXml = docXml.replace(/<w:rStyle w:val="MdStrong"\/>/g, '');

      // 3) Remove empty <w:pPr></w:pPr> left after stripping styles
      docXml = docXml.replace(/<w:pPr><\/w:pPr>/g, '');

      // 4) Wrap BLOCK math in <m:oMathPara>
      //    Block = <m:oMath>...</m:oMath> is the ONLY content in a <w:p>
      //    This does NOT touch inline math mixed with text runs
      docXml = docXml.replace(
        /<w:p>(<m:oMath>[\s\S]*?<\/m:oMath>)<\/w:p>/g,
        '<w:p><m:oMathPara>$1</m:oMathPara></w:p>'
      );
      docXml = docXml.replace(
        /(<w:p><w:pPr>[\s\S]*?<\/w:pPr>)(<m:oMath>[\s\S]*?<\/m:oMath>)<\/w:p>/g,
        '$1<m:oMathPara>$2</m:oMathPara></w:p>'
      );

      // 5) Deduplicate oMathPara wrappers (safety net)
      docXml = docXml.replace(/<m:oMathPara><m:oMathPara>/g, '<m:oMathPara>');
      docXml = docXml.replace(/<\/m:oMathPara><\/m:oMathPara>/g, '</m:oMathPara>');

      zip.file('word/document.xml', docXml);

      // --- Fix 2: Add <m:mathPr> to word/settings.xml ---
      const settingsXml = await zip.file('word/settings.xml')!.async('string');
      if (!settingsXml.includes('m:mathPr')) {
        const mathPr = '<m:mathPr xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">'
          + '<m:mathFont m:val="Cambria Math"/>'
          + '<m:brkBin m:val="before"/>'
          + '<m:defJc m:val="centerGroup"/>'
          + '<m:lMargin m:val="0"/>'
          + '<m:rMargin m:val="0"/>'
          + '<m:wrapIndent m:val="1440"/>'
          + '</m:mathPr>';
        zip.file('word/settings.xml', settingsXml.replace('</w:settings>', mathPr + '</w:settings>'));
      }

      blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

      downloadBlob(blob, 'document.docx');
      showToast('file-text', t('toast_exported_doc'));
    } catch (err) {
      console.error('DOCX export error:', err);
      showToast('alert-triangle', 'Failed to export DOCX');
    }
  });

  // --- Clear ---
  document.getElementById('clear-btn')?.addEventListener('click', () => {
    setValue('');
    previewContent.innerHTML = '';
    emptyState.style.opacity = '1';
    previewEmptyState.style.opacity = '1';
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
