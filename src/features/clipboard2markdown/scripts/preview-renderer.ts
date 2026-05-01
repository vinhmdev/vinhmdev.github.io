/**
 * PreviewRenderer — Shadow DOM wrapper for the preview pane.
 *
 * Provides full CSS isolation from the global website theme:
 * - Stylesheets are injected INSIDE the shadow root (global CSS cannot enter)
 * - Preview styles cannot leak out to the rest of the page
 * - Theme switching = swap link.href + toggle class, zero side-effects outside
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
  hljsLight:     'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.11.1/build/styles/github.min.css',
  hljsDark:      'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.11.1/build/styles/github-dark.min.css',
  katex:         'https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css',
} as const;

// ─── Scoped overrides inside shadow DOM ───────────────────────────────────────
// Uses literal color values — intentionally NOT using var(--color-*) from global.css.
// This is the CSS firewall between the preview and the website theme.
const PREVIEW_OVERRIDES = `
  .markdown-body {
    padding: 1.5rem;
    box-sizing: border-box;
    height: 100%;
    min-height: 100%;
    overflow-y: auto;
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

  /* Dark mode: toggle class 'dark' on .markdown-body drives all dark overrides */
  .markdown-body.dark {
    background-color: #0d1117;
    color: #e6edf3;
  }
  .markdown-body.dark .mermaid-wrapper {
    background: #161b22;
  }

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

    // Inject stylesheets INTO shadow root — fully isolated from global CSS.
    // Using explicit light/dark variants so JS controls the theme directly,
    // without relying on prefers-color-scheme (unreliable inside shadow roots).
    this.githubMdLink = this._mkLink(CDN.githubMdLight);
    this.shadow.appendChild(this.githubMdLink);
    this.hljsLink = this._mkLink(CDN.hljsLight);
    this.shadow.appendChild(this.hljsLink);
    this.shadow.appendChild(this._mkLink(CDN.katex));

    // Scoped overrides — self-contained, no dependency on outer page styles
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
   * Swaps both the GitHub Markdown and highlight.js theme stylesheets,
   * and toggles the 'dark' class on the content container.
   * The 'dark' class drives all dark overrides in PREVIEW_OVERRIDES.
   */
  setColorMode(isDark: boolean): void {
    this.githubMdLink.href = isDark ? CDN.githubMdDark  : CDN.githubMdLight;
    this.hljsLink.href     = isDark ? CDN.hljsDark      : CDN.hljsLight;
    this.bodyEl.classList.toggle('dark', isDark);
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
   * Return the scroll container for synchronized scrolling.
   * The .markdown-body element handles its own overflow-y inside the shadow root.
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
