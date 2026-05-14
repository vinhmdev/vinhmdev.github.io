/**
 * Turndown Configuration — HTML to Markdown conversion.
 * Custom rules for Google Docs, Word, and web content.
 */

// --- Heading size thresholds ---
const HEADING_PT_THRESHOLDS = [
  { minSize: 26, tag: 'h1' },
  { minSize: 20, tag: 'h2' },
  { minSize: 16, tag: 'h3' },
  { minSize: 14, tag: 'h4' },
] as const;

const HEADING_PX_THRESHOLDS = [
  { minSize: 34, tag: 'h1' },
  { minSize: 26, tag: 'h2' },
  { minSize: 21, tag: 'h3' },
  { minSize: 18, tag: 'h4' },
] as const;

/**
 * Match a font-size value against a threshold table and return the heading tag.
 */
function matchHeadingTag(
  size: number,
  thresholds: ReadonlyArray<{ minSize: number; tag: string }>
): string | null {
  for (const { minSize, tag } of thresholds) {
    if (size >= minSize) return tag;
  }
  return null;
}

/**
 * Pre-process HTML before Turndown conversion.
 * Cleans up Google Docs / Word artifacts.
 */
function preprocessHTML(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // --- Extract math BEFORE removing scripts (MathJax v2 uses <script> tags) ---

  // KaTeX display math: .katex-display wraps the outer span
  doc.querySelectorAll('.katex-display').forEach((el) => {
    const latex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim();
    if (!latex) return;
    const span = doc.createElement('span');
    span.textContent = `$$${latex}$$`;
    el.replaceWith(span);
  });

  // KaTeX inline math: .katex not already replaced above
  doc.querySelectorAll('.katex').forEach((el) => {
    const latex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim();
    if (!latex) return;
    const span = doc.createElement('span');
    span.textContent = `$${latex}$`;
    el.replaceWith(span);
  });

  // MathJax v2 — display math
  doc.querySelectorAll('script[type="math/tex; mode=display"]').forEach((el) => {
    const latex = el.textContent?.trim();
    if (!latex) return;
    const span = doc.createElement('span');
    span.textContent = `$$${latex}$$`;
    el.replaceWith(span);
  });

  // MathJax v2 — inline math
  doc.querySelectorAll('script[type="math/tex"]').forEach((el) => {
    const latex = el.textContent?.trim();
    if (!latex) return;
    const span = doc.createElement('span');
    span.textContent = `$${latex}$`;
    el.replaceWith(span);
  });

  // Remove <meta>, <style>, <script>, comments
  doc.querySelectorAll('meta, style, script, link').forEach((el) => el.remove());

  // --- Helper: check if element is inside a table cell ---
  function isInsideTableCell(el: Element): boolean {
    return !!el.closest('td, th');
  }

  // --- 1. GLOBAL UI CRUFT REMOVAL ---
  // Core issue: App-generated HTML (Confluence, Notion) contains UI chrome
  // like copy buttons, sort icons, and tooltips. These turn into garbage text in Markdown.
  // Solution: Globally remove elements marked as decorative or known UI classes.
  const uiCruftSelectors = [
    '[aria-hidden="true"]', // Standard way to hide decorative icons globally
    '.ak-renderer-tableHeader-sorting-icon__wrapper', // Atlassian specific UI cruft
  ];
  doc.querySelectorAll(uiCruftSelectors.join(', ')).forEach((el) => el.remove());

  // --- 2. TABLE STRUCTURE FLATTENING ---
  // Core issue: Markdown table syntax (| cell | cell |) breaks if there are newlines.
  // Turndown will insert newlines for block elements (<div>, <p>, <ul>, <li>).
  // Solution: We must completely flatten everything inside <th> and <td> into inline content.

  // Remove duplicate sticky header tables from Atlassian
  // Confluence creates a duplicate sticky table header before the actual wrapper
  doc.querySelectorAll('table[data-testid="renderer-table"]').forEach((table) => {
    // If table has only headers and no data cells, it's a sticky header artifact
    if (!table.querySelector('td')) {
      table.remove();
    }
  });

  doc.querySelectorAll('td, th').forEach((cell) => {
    // 1. Remove empty block elements that add spacing
    cell.querySelectorAll('p, div, ul, ol, li, h1, h2, h3, h4, h5, h6').forEach((el) => {
      if (!el.textContent?.trim() && !el.querySelector('img')) {
        el.remove();
      }
    });

    // 2. Convert list items to inline with <br>•
    cell.querySelectorAll('li').forEach((li) => {
      const isOrdered = li.closest('ol');
      const bullet = isOrdered ? '1. ' : '• ';
      li.replaceWith(
        doc.createElement('br'),
        doc.createTextNode(bullet),
        ...Array.from(li.childNodes)
      );
    });
    // Unwrap ul/ol containers
    cell
      .querySelectorAll('ul, ol')
      .forEach((list) => list.replaceWith(...Array.from(list.childNodes)));

    // 3. Convert other blocks to content + <br>
    cell.querySelectorAll('p, h1, h2, h3, h4, h5, h6, blockquote, pre').forEach((block) => {
      block.replaceWith(...Array.from(block.childNodes), doc.createElement('br'));
    });

    // 4. Unwrap divs
    cell.querySelectorAll('div').forEach((div) => div.replaceWith(...Array.from(div.childNodes)));

    // 5. Clean up the resulting HTML
    let html = cell.innerHTML;
    // Replace literal newlines with space to prevent Markdown table break
    html = html.replace(/\n/g, ' ');
    // Remove leading/trailing <br> and spaces
    html = html.replace(/^(?:<br\s*\/?>|\s|&nbsp;)+/gi, '');
    html = html.replace(/(?:<br\s*\/?>|\s|&nbsp;)+$/gi, '');
    // Collapse multiple <br> into one
    html = html.replace(/(?:<br\s*\/?>\s*){2,}/gi, '<br>');

    cell.innerHTML = html;

    // Clean inline styles on the cell itself (keep only basic structure)
    cell.removeAttribute('style');
  });

  // Remove inline styles from table structural elements
  doc.querySelectorAll('table, thead, tbody, tr, colgroup, col').forEach((el) => {
    el.removeAttribute('style');
  });

  // --- Google Docs: Convert styled <p> with large font-size to headings ---
  // Skip <p> inside table cells
  doc.querySelectorAll('p').forEach((p) => {
    if (isInsideTableCell(p)) return;

    const style = p.getAttribute('style') || '';
    const text = p.textContent?.trim();
    if (!text) return;

    const ptMatch = style.match(/font-size:\s*([\d.]+)\s*pt/i);
    if (ptMatch) {
      const tag = matchHeadingTag(parseFloat(ptMatch[1]), HEADING_PT_THRESHOLDS);
      if (tag) {
        const heading = doc.createElement(tag);
        heading.innerHTML = p.innerHTML;
        p.replaceWith(heading);
        return;
      }
    }

    const pxMatch = style.match(/font-size:\s*([\d.]+)\s*px/i);
    if (pxMatch) {
      const tag = matchHeadingTag(parseFloat(pxMatch[1]), HEADING_PX_THRESHOLDS);
      if (tag) {
        const heading = doc.createElement(tag);
        heading.innerHTML = p.innerHTML;
        p.replaceWith(heading);
        return;
      }
    }
  });

  // --- Google Docs: Convert bold/italic <span> to <strong>/<em> ---
  doc.querySelectorAll('span').forEach((span) => {
    const style = span.getAttribute('style') || '';
    const isBold = /font-weight:\s*(bold|[7-9]00)/i.test(style);
    const isItalic = /font-style:\s*italic/i.test(style);

    if (isBold && isItalic) {
      const strong = doc.createElement('strong');
      const em = doc.createElement('em');
      em.innerHTML = span.innerHTML;
      strong.appendChild(em);
      span.replaceWith(strong);
    } else if (isBold) {
      const strong = doc.createElement('strong');
      strong.innerHTML = span.innerHTML;
      span.replaceWith(strong);
    } else if (isItalic) {
      const em = doc.createElement('em');
      em.innerHTML = span.innerHTML;
      span.replaceWith(em);
    }
  });

  // --- Google Docs: Unwrap <a id="..."><h1-6> anchored headings ---
  doc.querySelectorAll('a').forEach((a) => {
    if (a.getAttribute('id') && !a.getAttribute('href') && a.children.length > 0) {
      a.replaceWith(...a.childNodes);
    }
  });

  // Remove empty <p> tags (skip those inside table cells)
  doc.querySelectorAll('p').forEach((p) => {
    if (isInsideTableCell(p)) return;
    if (!p.textContent?.trim() && !p.querySelector('img, br')) {
      p.remove();
    }
  });

  // Remove Google Docs tracking params from links
  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (!href) return;
    try {
      const url = new URL(href);
      if (url.hostname.includes('google.com') && url.pathname === '/url') {
        const realUrl = url.searchParams.get('q') || url.searchParams.get('url');
        if (realUrl) a.setAttribute('href', realUrl);
      }
    } catch {
      /* ignore invalid URLs */
    }
  });

  // --- Ensure tables without <thead> get a proper header row ---
  // Turndown GFM plugin requires <thead> to convert tables properly.
  doc.querySelectorAll('table').forEach((table) => {
    if (table.querySelector('thead')) return;

    const tbody = table.querySelector('tbody');
    const firstRow = tbody?.querySelector('tr') || table.querySelector('tr');
    if (!firstRow) return;

    const thead = doc.createElement('thead');
    thead.appendChild(firstRow);
    table.insertBefore(thead, table.firstChild);
  });

  return doc.body.innerHTML;
}

/**
 * Create and configure Turndown instance with custom rules.
 * Singleton — created once and reused.
 *
 * TurndownService and turndownPluginGfm are loaded via CDN UMD bundles
 * (see clipboard2markdown/page.astro) and typed in src/shared/globals.d.ts.
 */
function createInstance(): TurndownServiceInstance {
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    hr: '---',
    strongDelimiter: '**',
    emDelimiter: '*',
  });

  if (typeof turndownPluginGfm !== 'undefined') {
    service.use(turndownPluginGfm.gfm);
  }

  // Step 2: override escape() after all plugins — protects $latex$ text nodes
  // placed by preprocessHTML() from having _, \, ^ etc. escaped.
  installLatexEscape(service);

  service.addRule('lineBreak', {
    filter: 'br',
    replacement: (_content: string, node: HTMLElement) => {
      return node.parentElement?.tagName === 'TD' ? '<br>' : '\n';
    },
  });

  service.addRule('codeBlock', {
    filter: (node: HTMLElement) => {
      return node.nodeName === 'PRE' && !!node.querySelector('code');
    },
    replacement: (_content: string, node: HTMLElement) => {
      const code = node.querySelector('code');
      const lang = (code?.className.match(/language-(\w+)/) || [])[1] || '';
      const text = code?.textContent?.replace(/\n+$/, '') || '';
      return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
    },
  });

  service.addRule('googleDocsImage', {
    filter: (node: HTMLElement) => {
      return node.nodeName === 'IMG' && !!node.getAttribute('src');
    },
    replacement: (_content: string, node: HTMLElement) => {
      const alt = node.getAttribute('alt') || '';
      const src = node.getAttribute('src') || '';
      if (!src || src.startsWith('data:')) return '';
      return `![${alt}](${src})`;
    },
  });

  return service;
}

/** Singleton Turndown instance — created on first use. */
let turndownInstance: TurndownServiceInstance | null = null;

function getInstance(): TurndownServiceInstance {
  if (!turndownInstance) {
    turndownInstance = createInstance();
  }
  return turndownInstance;
}

// ─── LaTeX-aware escape override ─────────────────────────────────────────────
// Step 1 (preprocessHTML) extracts KaTeX/MathJax elements → places $latex$ text.
// Step 2 (here) overrides Turndown's escape() so those text nodes are not
// corrupted (Turndown would otherwise escape _, \, * inside them).
//
// Technique: String.split(captureRegex) keeps captured groups at odd indices,
// giving alternating [prose, latex, prose, latex, …] — escape only prose parts.

/**
 * Regex for LaTeX delimiter pairs used in split().
 *
 * Inline $...$ heuristic (avoids false-positives on currency like $1,200):
 *   - Not followed by space or digit
 *   - Content must contain at least one LaTeX-specific char: \ ^ _ { }
 *     → "$1,200 revenue" never matches; "$x^2 + y_1$" always matches
 *   - Closing $ not preceded by space
 *
 * No /g flag — split() handles all occurrences; /g would corrupt lastIndex
 * across repeated escape() calls on different text nodes.
 */
const LATEX_DELIMITERS_RE =
  /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<!\$)\$(?![\s\d])(?=[^\n$]*?[\\^_{}])[^\n$]+?(?<!\s)\$(?!\$))/;

/** Override Turndown's escape() to pass LaTeX delimiters through verbatim. */
function installLatexEscape(service: TurndownServiceInstance): void {
  const defaultEscape: (s: string) => string = service.escape.bind(service);
  service.escape = (input: string): string =>
    input
      .split(LATEX_DELIMITERS_RE)
      .map((part, i) => (i % 2 === 1 ? part : defaultEscape(part)))
      .join('');
}

/**
 * Convert HTML to Markdown (full pipeline).
 *
 *   Step 1 — preprocessHTML(): semantic math extraction
 *     KaTeX  → <annotation encoding="application/x-tex"> → $latex$ / $$latex$$
 *     MathJax v2 → <script type="math/tex">             → $latex$ / $$latex$$
 *
 *   Step 2 — installLatexEscape(): protect extracted math from Turndown escaping
 *     Turndown calls escape() on every text node; without this, _ and \ inside
 *     $latex$ would be escaped to \_ and \\ in the Markdown output.
 */
export function convert(html: string): string {
  const cleanedHTML = preprocessHTML(html);
  return getInstance().turndown(cleanedHTML).trim();
}
