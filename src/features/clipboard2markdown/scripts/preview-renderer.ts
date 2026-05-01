/**
 * PreviewRenderer — Shadow DOM wrapper for the preview pane.
 *
 * Provides full CSS isolation from the global website theme:
 * - All stylesheets are BUNDLED by Vite (?inline imports) and injected
 *   into the shadow root as <style> elements — zero CDN requests on mount.
 * - Preview styles cannot leak out to the rest of the page.
 * - Theme switching = swap <style> textContent, instant, no network.
 *
 * Usage:
 *   const renderer = new PreviewRenderer(hostEl);
 *   renderer.setColorMode(isDark);
 *   renderer.setContent(sanitizedHtml);
 *   await renderer.renderMermaid(isDark);
 */

// ─── CSS imports (bundled by Vite as inline strings) ─────────────────────────
// These are injected into the shadow root — global CSS cannot affect them.
import githubMdLight from 'github-markdown-css/github-markdown-light.css?inline';
import githubMdDark  from 'github-markdown-css/github-markdown-dark.css?inline';
import hljsLight     from 'highlight.js/styles/github.min.css?inline';
import hljsDark      from 'highlight.js/styles/github-dark.min.css?inline';
import katexCss      from 'katex/dist/katex.min.css?inline';
import alertsCss     from 'markdown-it-github-alerts/styles/github-base.css?inline';

// ─── Scoped overrides ─────────────────────────────────────────────────────────
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

  /* Dark mode: 'dark' class on .markdown-body drives all dark overrides */
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
  private readonly githubMdStyle: HTMLStyleElement;
  private readonly hljsStyle: HTMLStyleElement;

  private mermaidIdCounter = 0;

  constructor(hostEl: HTMLElement) {
    this.shadow = hostEl.attachShadow({ mode: 'open' });

    // Inject all styles as <style> elements (bundled CSS strings, zero CDN requests)
    this.githubMdStyle = this._mkStyle(githubMdLight);
    this.hljsStyle     = this._mkStyle(hljsLight);
    this.shadow.append(
      this.githubMdStyle,
      this.hljsStyle,
      this._mkStyle(katexCss),
      this._mkStyle(alertsCss),
      this._mkStyle(PREVIEW_OVERRIDES),
    );

    // Content container
    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'markdown-body';
    this.shadow.appendChild(this.bodyEl);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Sync preview color mode with the app theme toggle.
   * Swaps CSS content of the theme style elements — no network requests.
   * The 'dark' class on .markdown-body drives supplemental dark overrides.
   */
  setColorMode(isDark: boolean): void {
    this.githubMdStyle.textContent = isDark ? githubMdDark  : githubMdLight;
    this.hljsStyle.textContent     = isDark ? hljsDark      : hljsLight;
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
   * Uses mermaid.render() (not mermaid.run()) — correct approach for Shadow DOM.
   */
  async renderMermaid(isDark: boolean): Promise<void> {
    // @ts-ignore — Mermaid loaded via CDN (too large to bundle ~3MB)
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
   * .markdown-body handles its own overflow-y inside the shadow root.
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

  private _mkStyle(css: string): HTMLStyleElement {
    const el = document.createElement('style');
    el.textContent = css;
    return el;
  }
}
