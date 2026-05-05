/**
 * export-pdf.ts — PDF export via browser print dialog.
 *
 * Opens a print-ready window with the rendered preview HTML,
 * styled with github-markdown-light.css (always light for print clarity).
 * Handles Mermaid re-render in light theme if the app was in dark mode.
 */
import { downloadBlob } from './utils';

// PDF always uses light theme for print quality
const PDF_GITHUB_MD_URL =
  'https://cdn.jsdelivr.net/npm/github-markdown-css@5.8.1/github-markdown-light.css';
const PDF_KATEX_URL = 'https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css';

function buildPrintDocument(content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Markdown Export</title>
  <link rel="stylesheet" href="${PDF_GITHUB_MD_URL}">
  <link rel="stylesheet" href="${PDF_KATEX_URL}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body {
      margin: 2rem auto;
      max-width: 800px;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    }
    .markdown-body img { max-width: 100%; }
    .markdown-body svg { max-width: 100%; height: auto; }
    /* Center mermaid diagrams */
    .mermaid-wrapper {
      display: flex;
      justify-content: center;
      margin: 1.2em 0;
    }
    /* Subtle background for table headers */
    .markdown-body table th {
      background-color: #f6f8fa;
    }
    @media print {
      body { margin: 0; }
      /* Ensure background colors are printed */
      .markdown-body table th, .markdown-body table tr:nth-child(2n) {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  </style>
</head>
<body class="markdown-body">
  ${content}
  <script>setTimeout(() => { window.print(); window.close(); }, 600);<\/script>
</body>
</html>`;
}

/**
 * Initialize the PDF export button handler.
 *
 * @param getPreviewHTML - Returns current rendered HTML from the preview pane
 * @param isDark - Returns whether the app is currently in dark mode
 * @param showToast - Toast notification function
 * @param t - i18n translation function
 */
export function initExportPDF(
  getPreviewHTML: () => string,
  isDark: () => boolean,
  showToast: (icon: string, msg: string) => void,
  t: (key: string) => string
): void {
  document.getElementById('export-pdf-btn')?.addEventListener('click', async () => {
    const html = getPreviewHTML();
    if (!html) return showToast('alert-triangle', t('toast_nothing_to_copy'));

    // Open synchronously to avoid popup blockers
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    let content = html;

    // Re-render Mermaid diagrams in light theme if currently in dark mode
    // @ts-ignore — CDN global
    const mermaid = window.mermaid;
    if (isDark() && typeof mermaid !== 'undefined') {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = html;

      const wrappers = tempDiv.querySelectorAll('.mermaid-wrapper[data-original-code]');
      if (wrappers.length > 0) {
        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'loose',
        });
        let i = 0;
        for (const wrapper of wrappers) {
          const code = wrapper.getAttribute('data-original-code');
          if (code) {
            try {
              const { svg } = await mermaid.render(`mermaid-pdf-${Date.now()}-${i++}`, code);
              wrapper.innerHTML = svg;
            } catch (e) {
              console.error('Mermaid PDF re-render error', e);
            }
          }
        }
        // Restore dark theme for live preview
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          securityLevel: 'loose',
        });
        content = tempDiv.innerHTML;
      }
    }

    printWindow.document.write(buildPrintDocument(content));
    printWindow.document.close();
    showToast('printer', t('toast_exported_pdf'));
  });
}
