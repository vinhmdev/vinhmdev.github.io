/**
 * PreviewRenderer — Shadow DOM wrapper for the preview pane.
 *
 * Provides full CSS isolation from the global website theme:
 * - Stylesheets are injected INSIDE the shadow root (global CSS cannot enter)
 * - Preview styles cannot leak out to the rest of the page
 * - Theme switching = swap link.href, zero side-effects outside this class
 *
 * Usage:
 *   const renderer = new PreviewRenderer(hostEl);
 *   renderer.setColorMode(isDark);
 *   renderer.setContent(sanitizedHtml);
 *   await renderer.renderMermaid(isDark);
 */

// ─── CDN URLs (pinned versions) ───────────────────────────────────────────────
const CDN = {
  // Use pinned light/dark variants — avoids prefers-color-scheme media query
  // which can't be controlled by JS inside a shadow root.
  githubMdLight: 'https://cdn.jsdelivr.net/npm/github-markdown-css@5.8.1/github-markdown-light.css',
  githubMdDark:  'https://cdn.jsdelivr.net/npm/github-markdown-css@5.8.1/github-markdown-dark.css',
  hljsLight: 'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.11.1/build/styles/github.min.css',
  hljsDark:  'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.11.1/build/styles/github-dark.min.css',
  katex:     'https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css',
} as const;

// ─── Scoped overrides inside shadow DOM ───────────────────────────────────────
// Uses literal values — intentionally NOT using var(--color-*) from global.css.
// This is the CSS firewall between preview and the website theme.
const PREVIEW_OVERRIDES = `
  .markdown-body {
    padding: 1.5rem;
    box-sizing: border-box;
    min-height: 100%;
    overflow-y: auto;
    height: 100%;
  }

  /* Mermaid diagram wrapper */
  .mermaid-wrapper {
    display: flex;
    justify-content: center;
    margin: 1.2em 0;
    padding: 1em;
    background: #f6f8fa;
    border-radius: 6px;
    overflow-x: auto;
  }
  .mermaid-wrapper svg {
    max-width: 100%;
    height: auto;
  }
  /* Dark mode wrapper: background set via JS inline style on bodyEl,
     which github-markdown-dark.css inherits via color-scheme vars */


  /* KaTeX block math */
  .katex-display {
    overflow-x: auto;
    overflow-y: hidden;
    margin: 1em 0;
    padding: 0.25em 0;
  }
  .katex { font-size: 1.1em; }

  /* highlight.js code blocks */
  pre.hljs { margin: 0; }
  pre .hljs { margin: 0; padding: 0; background: transparent; }

  /* Hide raw mermaid code blocks before renderMermaid() processes them */
  pre:has(> code.language-mermaid) { display: none; }
`;


// ─────────────────────────────────────────────────────────────────────────────

export class PreviewRenderer {
  private readonly shadow: ShadowRoot;
  private readonly bodyEl: HTMLElement;
  private readonly githubMdLink: HTMLLinkElement;
  private readonly hljsLink: HTMLLinkElement;

  private mermaidIdCounter = 0;

  constructor(hostEl: HTMLElement) {
    this.shadow = hostEl.attachShadow({ mode: 'open' });

    // Inject stylesheets INTO shadow root — fully isolated from global CSS
    // Using light/dark variants explicitly so JS can control theme without
    // relying on prefers-color-scheme media queries (unreliable in shadow roots).
    this.githubMdLink = this._mkLink(CDN.githubMdLight);
    this.shadow.appendChild(this.githubMdLink);
    this.hljsLink = this._mkLink(CDN.hljsLight);
    this.shadow.appendChild(this.hljsLink);
    this.shadow.appendChild(this._mkLink(CDN.katex));

    // Scoped overrides
    const style = document.createElement('style');
    style.textContent = PREVIEW_OVERRIDES;
    this.shadow.appendChild(style);

    // Content container
    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'markdown-body';
    this.shadow.appendChild(this.bodyEl);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Sync preview color mode with the app theme toggle.
   * Swaps highlight.js theme stylesheet + sets data-color-mode attribute.
   */
  setColorMode(isDark: boolean): void {
    // Swap both theme stylesheets for reliable dark/light mode control
    this.githubMdLink.href = isDark ? CDN.githubMdDark : CDN.githubMdLight;
    this.hljsLink.href     = isDark ? CDN.hljsDark     : CDN.hljsLight;
    // github-markdown-dark.css sets --color-canvas-default on :root,
    // but :root inside a shadow DOM is the shadow root, not document root.
    // Set the background explicitly to ensure it applies correctly.
    this.bodyEl.style.backgroundColor = isDark ? '#0d1117' : '';
    this.bodyEl.style.color           = isDark ? '#e6edf3' : '';
  }

  /**
   * Inject sanitized HTML into the shadow DOM.
   * Caller is responsible for sanitizing before passing here.
   */
  setContent(sanitizedHtml: string): void {
    this.bodyEl.innerHTML = sanitizedHtml;
  }

  /**
   * Render Mermaid diagrams via mermaid.render() — the SVG string API.
   * This is the correct approach for Shadow DOM: get SVG string, inject manually.
   * mermaid.run() (DOM scan) is NOT used — it has known issues inside shadow roots.
   */
  async renderMermaid(isDark: boolean): Promise<void> {
    // @ts-ignore — loaded via CDN
    const mermaid = window.mermaid;
    if (typeof mermaid === 'undefined') return;

    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'default',
      securityLevel: 'loose',
    });

    const blocks = this.bodyEl.querySelectorAll('code.language-mermaid');
    for (const code of blocks) {
      const pre = code.parentElement;
      if (!pre || pre.tagName !== 'PRE') continue;

      const codeText = code.textContent || '';
      try {
        const id = `mermaid-sdom-${this.mermaidIdCounter++}`;
        const { svg } = await mermaid.render(id, codeText);
        const wrapper = document.createElement('div');
        wrapper.className = 'mermaid-wrapper';
        wrapper.setAttribute('data-original-code', codeText);
        wrapper.innerHTML = svg;
        pre.replaceWith(wrapper);
      } catch (_) {
        // User may still be typing — silently ignore parse errors
      }
    }
  }

  /**
   * Return the markdown-body element for synchronized scrolling.
   * Scroll events on this element are accessible from outside the shadow root.
   */
  getScrollEl(): HTMLElement {
    return this.bodyEl;
  }

  /** Get current rendered HTML (for PDF export). */
  getHTML(): string {
    return this.bodyEl.innerHTML;
  }

  /** True if there is no visible content. */
  isEmpty(): boolean {
    return !this.bodyEl.textContent?.trim();
  }

  /** Clear the rendered content. */
  clear(): void {
    this.bodyEl.innerHTML = '';
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private _mkLink(href: string): HTMLLinkElement {
    const el = document.createElement('link');
    el.rel = 'stylesheet';
    el.href = href;
    return el;
  }
}
