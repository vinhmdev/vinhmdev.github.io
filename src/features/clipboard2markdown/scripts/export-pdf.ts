/**
 * export-pdf.ts — PDF export via browser print dialog.
 *
 * Opens a print-ready window with the rendered preview HTML,
 * styled with github-markdown-light.css (always light for print clarity).
 * Handles Mermaid re-render in light theme if the app was in dark mode.
 */
// PDF always uses light theme for print quality
const PDF_GITHUB_MD_URL =
  'https://cdn.jsdelivr.net/npm/github-markdown-css@5.8.1/github-markdown-light.css';
const PDF_KATEX_URL = 'https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css';
// Syntax highlighting theme — without it every code block prints as flat black text.
const PDF_HLJS_URL = 'https://cdn.jsdelivr.net/npm/highlight.js@11.11.1/styles/github.min.css';

/**
 * Delay before triggering print() in the popup window. Gives the browser
 * time to fetch external stylesheets (github-markdown-css, KaTeX, Inter font)
 * so the printed output isn't a flash of unstyled content.
 */
const PRINT_DIALOG_DELAY_MS = 600;

function buildPrintDocument(content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Markdown Export</title>
  <link rel="stylesheet" href="${PDF_GITHUB_MD_URL}">
  <link rel="stylesheet" href="${PDF_KATEX_URL}">
  <link rel="stylesheet" href="${PDF_HLJS_URL}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    body {
      margin: 2rem auto;
      max-width: 800px;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      line-height: 1.7;
    }
    .markdown-body code, .markdown-body pre {
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .markdown-body img { max-width: 100%; }
    .markdown-body svg { max-width: 100%; height: auto; }
    /* Links — Academic Cinnabar, never GitHub blue */
    .markdown-body a {
      color: #c2410c;
      text-decoration: underline;
      text-decoration-color: rgba(234, 88, 12, 0.4);
      text-underline-offset: 3px;
    }
    /* Center mermaid diagrams */
    .mermaid-wrapper {
      display: flex;
      justify-content: center;
      margin: 1.2em 0;
    }

    /* Code blocks — hljs theme supplies the token colors, this supplies the frame */
    .markdown-body pre,
    .markdown-body pre.hljs {
      padding: 1.1em 1em;
      background-color: #f5f5f5 !important;
      color: #262626;
      border: 1px solid #e5e5e5;
      border-radius: 6px;
      page-break-inside: avoid;
    }
    .markdown-body pre .hljs { padding: 0; background: transparent; color: #262626; }
    /* Inline code only — the :not(pre) child combinator keeps fenced blocks out */
    .markdown-body :not(pre) > code {
      background-color: #f5f5f5;
      color: #c2410c;
      border: 1px solid #e5e5e5;
      padding: 0.2em 0.4em;
      border-radius: 4px;
    }
    /* Copy buttons are screen-only UI and never belong in a PDF */
    .code-copy-btn { display: none !important; }

    /* Blockquote — brand accent, matching the live preview */
    .markdown-body blockquote {
      border-left: 4px solid #ea580c;
      padding: 0.5em 1em;
      color: #57534e;
      background: rgba(234, 88, 12, 0.05);
      border-radius: 0 6px 6px 0;
    }

    /* Tables — clinical precision */
    .markdown-body table { border: 1px solid #e5e5e5; border-collapse: collapse; }
    .markdown-body table th, .markdown-body table td {
      padding: 0.6em 0.9em;
      border: 1px solid #e5e5e5;
    }
    .markdown-body table th { background-color: #f5f5f5; color: #262626; text-align: left; }

    /* GitHub alerts — the color variables live on :root in the source stylesheet */
    :root {
      --color-note: #ea580c;
      --color-tip: #1a7f37;
      --color-warning: #9a6700;
      --color-severe: #bc4c00;
      --color-caution: #d1242f;
      --color-important: #8250df;
    }
    .markdown-alert {
      padding: 0.5rem 1rem;
      margin-bottom: 16px;
      border-left: 0.25em solid #888;
    }
    .markdown-alert > :first-child { margin-top: 0; }
    .markdown-alert > :last-child { margin-bottom: 0; }
    .markdown-alert .markdown-alert-title {
      display: flex;
      align-items: center;
      font-weight: 600;
      line-height: 1;
    }
    .markdown-alert .markdown-alert-title .octicon {
      margin-right: 0.5rem;
      fill: currentColor;
      vertical-align: text-bottom;
    }
    .markdown-alert-note { border-left-color: var(--color-note); }
    .markdown-alert-note .markdown-alert-title { color: var(--color-note); }
    .markdown-alert-tip { border-left-color: var(--color-tip); }
    .markdown-alert-tip .markdown-alert-title { color: var(--color-tip); }
    .markdown-alert-warning { border-left-color: var(--color-warning); }
    .markdown-alert-warning .markdown-alert-title { color: var(--color-warning); }
    .markdown-alert-caution { border-left-color: var(--color-caution); }
    .markdown-alert-caution .markdown-alert-title { color: var(--color-caution); }
    .markdown-alert-important { border-left-color: var(--color-important); }
    .markdown-alert-important .markdown-alert-title { color: var(--color-important); }

    /* Containers :::info / :::warning / :::danger / :::success / :::details */
    .markdown-body .info,
    .markdown-body .warning,
    .markdown-body .danger,
    .markdown-body .success {
      padding: 0.8em 1em;
      margin: 1em 0;
      border-left: 4px solid transparent;
      border-radius: 0 6px 6px 0;
      page-break-inside: avoid;
    }
    .markdown-body .info > :first-child,
    .markdown-body .warning > :first-child,
    .markdown-body .danger > :first-child,
    .markdown-body .success > :first-child { margin-top: 0; }
    .markdown-body .info > :last-child,
    .markdown-body .warning > :last-child,
    .markdown-body .danger > :last-child,
    .markdown-body .success > :last-child { margin-bottom: 0; }
    .markdown-body .info { border-left-color: #ea580c; background: rgba(234, 88, 12, 0.05); }
    .markdown-body .warning { border-left-color: #9a6700; background: rgba(154, 103, 0, 0.05); }
    .markdown-body .danger { border-left-color: #d1242f; background: rgba(209, 36, 47, 0.05); }
    .markdown-body .success { border-left-color: #1a7f37; background: rgba(26, 127, 55, 0.05); }
    .markdown-body .details {
      padding: 0.8em 1em;
      margin: 1em 0;
      border: 1px solid #ea580c44;
      border-radius: 6px;
      background: rgba(234, 88, 12, 0.03);
    }
    .markdown-body .details summary { font-weight: 600; }

    @media print {
      body { margin: 0; }
      /* Ensure background colors are printed */
      .markdown-body table th,
      .markdown-body table tr:nth-child(2n),
      .markdown-body pre.hljs,
      .markdown-body pre.hljs *,
      .markdown-body blockquote,
      .markdown-alert,
      .markdown-body .info,
      .markdown-body .warning,
      .markdown-body .danger,
      .markdown-body .success,
      .markdown-body .details {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  </style>
</head>
<body class="markdown-body">
  ${content}
  <script>setTimeout(() => { window.print(); window.close(); }, ${PRINT_DIALOG_DELAY_MS});<\/script>
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

    // Re-render Mermaid diagrams in light theme if currently in dark mode.
    // Mermaid is loaded via CDN — typed in src/shared/globals.d.ts.
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
