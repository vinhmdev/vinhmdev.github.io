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
  thresholds: ReadonlyArray<{ minSize: number; tag: string }>,
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

  // Remove <meta>, <style>, <script>, comments
  doc.querySelectorAll('meta, style, script, link').forEach((el) => el.remove());

  // --- Helper: check if element is inside a table cell ---
  function isInsideTableCell(el: Element): boolean {
    return !!el.closest('td, th');
  }

  // --- Google Docs / Web: Clean up tables for Turndown GFM ---
  // Unwrap <p> inside <td>/<th> → inline content separated by <br>
  doc.querySelectorAll('td, th').forEach((cell) => {
    const paragraphs = cell.querySelectorAll('p');
    if (paragraphs.length === 0) return;

    const fragment = doc.createDocumentFragment();
    paragraphs.forEach((p, i) => {
      // Move children of <p> into the cell directly
      while (p.firstChild) {
        fragment.appendChild(p.firstChild);
      }
      // Add <br> between paragraphs (not after the last one)
      if (i < paragraphs.length - 1) {
        fragment.appendChild(doc.createElement('br'));
      }
      p.remove();
    });
    cell.appendChild(fragment);

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

// @ts-ignore
const originalEscape = TurndownService.prototype.escape;

// @ts-ignore
TurndownService.prototype.escape = function (string: string) {
  const mathRegex = /(\$\$.+?\$\$|\$.+?\$)/gs;

  let result = '';
  let lastIndex = 0;
  let match;

  while ((match = mathRegex.exec(string)) !== null) {
    // Escape the text before the math block natively
    const before = string.slice(lastIndex, match.index);
    if (before) {
      result += originalEscape.call(this, before);
    }

    // Append the math block exactly as is, completely un-escaped
    result += match[0];
    lastIndex = mathRegex.lastIndex;
  }

  // Escape any remaining text at the end of the string
  const remaining = string.slice(lastIndex);
  if (remaining) {
    result += originalEscape.call(this, remaining);
  }

  return result;
};

/**
 * Create and configure Turndown instance with custom rules.
 * Singleton — created once and reused.
 */
function createInstance(): any {
  // @ts-ignore — loaded via CDN
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    hr: '---',
    strongDelimiter: '**',
    emDelimiter: '*',
  });

  // @ts-ignore — loaded via CDN
  if (typeof turndownPluginGfm !== 'undefined') {
    // @ts-ignore
    service.use(turndownPluginGfm.gfm);
  }

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
let turndownInstance: any = null;

function getInstance(): any {
  if (!turndownInstance) {
    turndownInstance = createInstance();
  }
  return turndownInstance;
}

/**
 * Convert HTML to Markdown (full pipeline).
 */
export function convert(html: string): string {
  const cleanedHTML = preprocessHTML(html);
  const instance = getInstance();
  const rawMD = instance.turndown(cleanedHTML);
  return rawMD.trim();
}
