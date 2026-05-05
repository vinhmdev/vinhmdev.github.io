/**
 * preview.ts — Markdown-it parser singleton + render pipeline.
 *
 * Responsibilities:
 * - Singleton markdown-it parser (rebuilt only when latex toggle changes)
 * - All plugins imported as npm packages — no window.xxx globals
 * - highlight.js syntax highlighting (bundled)
 * - DOMPurify sanitization (bundled)
 * - Delegates all DOM operations to PreviewRenderer (Shadow DOM)
 */
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';
import katex from 'katex';
import * as texmath from 'markdown-it-texmath';
import taskLists from 'markdown-it-task-lists';
import deflist from 'markdown-it-deflist';
import footnote from 'markdown-it-footnote';
import mark from 'markdown-it-mark';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import ins from 'markdown-it-ins';
import abbr from 'markdown-it-abbr';
import container from 'markdown-it-container';
import { full as emoji } from 'markdown-it-emoji';
import anchor from 'markdown-it-anchor';
import toc from 'markdown-it-toc-done-right';
import githubAlerts from 'markdown-it-github-alerts';
import attrs from 'markdown-it-attrs';
import { PreviewRenderer } from './preview-renderer';

// ─── DOMPurify config — allow SVG/math elements for Mermaid + KaTeX ──────────
const DOMPURIFY_CONFIG: Parameters<typeof DOMPurify.sanitize>[1] = {
  ADD_TAGS: [
    'svg',
    'g',
    'path',
    'rect',
    'circle',
    'ellipse',
    'line',
    'polyline',
    'polygon',
    'text',
    'tspan',
    'defs',
    'marker',
    'foreignObject',
    'use',
    'clipPath',
    'style',
    'span',
    'math',
    'mrow',
    'mi',
    'mo',
    'mn',
    'msup',
    'msub',
    'mfrac',
    'mover',
    'munder',
    'msqrt',
    'mtext',
    'semantics',
    'annotation',
  ],
  ADD_ATTR: [
    'viewBox',
    'xmlns',
    'fill',
    'stroke',
    'stroke-width',
    'd',
    'transform',
    'x',
    'y',
    'x1',
    'y1',
    'x2',
    'y2',
    'cx',
    'cy',
    'r',
    'rx',
    'ry',
    'width',
    'height',
    'points',
    'marker-end',
    'refX',
    'refY',
    'orient',
    'markerWidth',
    'markerHeight',
    'text-anchor',
    'dominant-baseline',
    'font-size',
    'font-family',
    'font-weight',
    'class',
    'id',
    'style',
    'clip-path',
    'aria-label',
    'role',
    'tabindex',
    'xmlns:xlink',
    'xlink:href',
    'href',
    'overflow',
    'preserveAspectRatio',
  ],
};

// Open all external links from preview in a new tab (skip internal anchors)
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    const href = node.getAttribute('href') || '';
    if (!href.startsWith('#')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  }
});

// ─── Module state ─────────────────────────────────────────────────────────────
let renderer: PreviewRenderer | null = null;
let mdParser: MarkdownIt | null = null;
let latexEnabledState = true;
let mermaidEnabledState = true;

// ─── Plugin attachment ────────────────────────────────────────────────────────
function attachPlugins(md: MarkdownIt, renderLatex: boolean): void {
  // Helper to safely resolve CJS/ESM interop differences
  const resolvePlugin = (p: any) => p.default || p;

  md.use(resolvePlugin(taskLists))
    .use(resolvePlugin(deflist))
    .use(resolvePlugin(footnote))
    .use(resolvePlugin(mark))
    .use(resolvePlugin(sub))
    .use(resolvePlugin(sup))
    .use(resolvePlugin(ins))
    .use(resolvePlugin(abbr))
    .use(resolvePlugin(emoji))
    .use(resolvePlugin(githubAlerts))
    .use(resolvePlugin(attrs))
    .use(resolvePlugin(container), 'info')
    .use(resolvePlugin(container), 'warning')
    .use(resolvePlugin(container), 'danger')
    .use(resolvePlugin(container), 'success')
    .use(resolvePlugin(container), 'details')
    .use(resolvePlugin(anchor))
    .use(resolvePlugin(toc));

  if (renderLatex) {
    md.use(resolvePlugin(texmath), { engine: katex, delimiters: 'dollars' });
  }
}

// ─── Parser factory ───────────────────────────────────────────────────────────
function buildParser(renderLatex: boolean, renderMermaid: boolean): MarkdownIt {
  const md = new MarkdownIt({
    html: true,
    breaks: true,
    linkify: true,
    typographer: true,
    highlight: (str: string, lang: string): string => {
      // Mermaid blocks must keep language-mermaid class so that
      // PreviewRenderer.renderMermaid() can find them via querySelectorAll.
      // Do NOT run through hljs — mermaid.render() handles them separately.
      if (lang === 'mermaid' && renderMermaid) {
        return `<pre><code class="language-mermaid">${md.utils.escapeHtml(str)}</code></pre>`;
      }
      if (lang && hljs.getLanguage(lang)) {
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
 * Rebuilds the parser only when the latex or mermaid setting changes.
 */
export async function renderPreview(markdown: string, opts: RenderOptions): Promise<void> {
  if (!renderer) return;

  try {
    // Rebuild parser only when the latex or mermaid setting changes
    if (
      opts.renderLatex !== latexEnabledState ||
      opts.renderMermaid !== mermaidEnabledState ||
      !mdParser
    ) {
      latexEnabledState = opts.renderLatex;
      mermaidEnabledState = opts.renderMermaid;
      mdParser = buildParser(opts.renderLatex, opts.renderMermaid);
    }

    const rawHtml = mdParser.render(markdown || '');
    const cleanHtml = DOMPurify.sanitize(rawHtml, DOMPURIFY_CONFIG) as string;

    renderer.setContent(cleanHtml);

    if (opts.renderMermaid) {
      await renderer.renderMermaid(opts.isDark);
    }
  } catch (error) {
    console.error('[preview] ERROR during render pipeline:', error);
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
