/**
 * preview.ts — Markdown-it parser singleton + render pipeline.
 *
 * Responsibilities:
 * - Singleton markdown-it parser (rebuilt only when latex toggle changes)
 * - highlight.js syntax highlighting integration
 * - DOMPurify sanitization
 * - Delegates rendering to PreviewRenderer (Shadow DOM)
 *
 * Does NOT touch the DOM directly — all DOM operations go through PreviewRenderer.
 */
import { PreviewRenderer } from './preview-renderer';

// ─── DOMPurify config — allow SVG/math elements for Mermaid + KaTeX ──────────
const DOMPURIFY_CONFIG = {
  ADD_TAGS: [
    'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline',
    'polygon', 'text', 'tspan', 'defs', 'marker', 'foreignObject', 'use',
    'clipPath', 'style', 'span', 'math', 'mrow', 'mi', 'mo', 'mn', 'msup',
    'msub', 'mfrac', 'mover', 'munder', 'msqrt', 'mtext', 'semantics', 'annotation',
  ],
  ADD_ATTR: [
    'viewBox', 'xmlns', 'fill', 'stroke', 'stroke-width', 'd', 'transform',
    'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
    'width', 'height', 'points', 'marker-end', 'refX', 'refY', 'orient',
    'markerWidth', 'markerHeight', 'text-anchor', 'dominant-baseline',
    'font-size', 'font-family', 'font-weight', 'class', 'id', 'style',
    'clip-path', 'aria-label', 'role', 'tabindex', 'xmlns:xlink',
    'xlink:href', 'href', 'overflow', 'preserveAspectRatio',
  ],
};

// ─── Module state ─────────────────────────────────────────────────────────────
let renderer: PreviewRenderer | null = null;
let mdParser: any = null;
let latexEnabledState = true;

// ─── Plugin attachment (called once per parser instance) ──────────────────────
function attachPlugins(md: any, renderLatex: boolean): void {
  // @ts-ignore — CDN globals
  const {
    markdownitTaskLists, markdownitDeflist, markdownitFootnote,
    markdownitMark, markdownitSub, markdownitSup, markdownitIns,
    markdownitAbbr, markdownitContainer, markdownitEmoji,
    markdownItAnchor, markdownItTocDoneRight, texmath, katex,
  } = window as any;

  if (typeof markdownitTaskLists !== 'undefined')    md.use(markdownitTaskLists);
  if (typeof markdownitDeflist   !== 'undefined')    md.use(markdownitDeflist);
  if (typeof markdownitFootnote  !== 'undefined')    md.use(markdownitFootnote);
  if (typeof markdownitMark      !== 'undefined')    md.use(markdownitMark);
  if (typeof markdownitSub       !== 'undefined')    md.use(markdownitSub);
  if (typeof markdownitSup       !== 'undefined')    md.use(markdownitSup);
  if (typeof markdownitIns       !== 'undefined')    md.use(markdownitIns);
  if (typeof markdownitAbbr      !== 'undefined')    md.use(markdownitAbbr);
  if (typeof markdownitEmoji     !== 'undefined')    md.use(markdownitEmoji);

  if (typeof markdownitContainer !== 'undefined') {
    ['info', 'warning', 'danger', 'success', 'details'].forEach((type) => {
      md.use(markdownitContainer, type);
    });
  }
  if (typeof markdownItAnchor !== 'undefined') {
    md.use(markdownItAnchor, { permalink: markdownItAnchor.permalink.headerLink() });
  }
  if (typeof markdownItTocDoneRight !== 'undefined') {
    md.use(markdownItTocDoneRight);
  }
  if (renderLatex && typeof texmath !== 'undefined' && typeof katex !== 'undefined') {
    md.use(texmath, { engine: katex, delimiters: 'dollars' });
  }
}

// ─── Parser factory ───────────────────────────────────────────────────────────
function buildParser(renderLatex: boolean): any {
  // @ts-ignore — CDN global
  const markdownit = window.markdownit;
  if (typeof markdownit === 'undefined') return null;

  const md = markdownit({
    html: true,
    breaks: true,
    linkify: true,
    typographer: true,
    highlight: (str: string, lang: string): string => {
      // Mermaid blocks MUST keep the language-mermaid class so that
      // PreviewRenderer.renderMermaid() can find them via querySelectorAll.
      // Do NOT run them through hljs — mermaid.render() handles them separately.
      if (lang === 'mermaid') {
        return `<pre><code class="language-mermaid">${md.utils.escapeHtml(str)}</code></pre>`;
      }
      // @ts-ignore — CDN global
      const hljs = window.hljs;
      if (lang && hljs?.getLanguage(lang)) {
        try {
          return (
            '<pre class="hljs"><code>' +
            hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
            '</code></pre>'
          );
        } catch (_) {}
      }
      return '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + '</code></pre>';
    },
  });

  // Open links in new tab
  // @ts-ignore
  const DOMPurify = window.DOMPurify;
  if (DOMPurify) {
    DOMPurify.addHook('afterSanitizeAttributes', (node: Element) => {
      if (node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }

  attachPlugins(md, renderLatex);
  return md;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize the preview system with a shadow DOM host element.
 * Must be called once before renderPreview().
 */
export function initPreview(hostEl: HTMLElement): PreviewRenderer {
  renderer = new PreviewRenderer(hostEl);
  return renderer;
}

/**
 * Force the parser to rebuild on next render call.
 * Call this when the LaTeX toggle changes.
 */
export function invalidateParser(): void {
  mdParser = null;
}

export interface RenderOptions {
  renderMermaid: boolean;
  renderLatex: boolean;
  isDark: boolean;
}

/**
 * Render markdown to the preview pane.
 * Rebuilds the parser only when latex toggle changes.
 */
export async function renderPreview(markdown: string, opts: RenderOptions): Promise<void> {
  if (!renderer) return;

  // Rebuild parser only when latex setting changes
  if (opts.renderLatex !== latexEnabledState || !mdParser) {
    latexEnabledState = opts.renderLatex;
    mdParser = buildParser(opts.renderLatex);
  }
  if (!mdParser) return;

  const rawHtml = mdParser.render(markdown || '');

  // @ts-ignore — CDN global
  const DOMPurify = window.DOMPurify;
  const cleanHtml = DOMPurify
    ? DOMPurify.sanitize(rawHtml, DOMPURIFY_CONFIG)
    : rawHtml;

  renderer.setContent(cleanHtml);

  if (opts.renderMermaid) {
    await renderer.renderMermaid(opts.isDark);
  }
}

/**
 * Sync preview pane color mode when the app theme toggle fires.
 */
export function syncPreviewTheme(isDark: boolean): void {
  renderer?.setColorMode(isDark);
}

/** Get the renderer instance (for scroll sync, export, etc.). */
export function getRenderer(): PreviewRenderer | null {
  return renderer;
}
