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
 *   renderer.setSafeHTML(sanitizedHtml);
 *   await renderer.renderMermaid(isDark);
 */

// ─── CSS imports (bundled by Vite as inline strings) ─────────────────────────
// These are injected into the shadow root — global CSS cannot affect them.
import githubMdLight from 'github-markdown-css/github-markdown-light.css?inline';
import githubMdDark from 'github-markdown-css/github-markdown-dark.css?inline';
import hljsLight from 'highlight.js/styles/github.min.css?inline';
import hljsDark from 'highlight.js/styles/github-dark.min.css?inline';
import katexCss from 'katex/dist/katex.min.css?inline';
import alertsCss from 'markdown-it-github-alerts/styles/github-base.css?inline';
import alertsLight from 'markdown-it-github-alerts/styles/github-colors-light.css?inline';
import alertsDark from 'markdown-it-github-alerts/styles/github-colors-dark-class.css?inline';
import previewOverridesCss from '../styles/preview-overrides.css?inline';

// ─────────────────────────────────────────────────────────────────────────────

/** Copy-button labels + how long the confirmation state sticks around. */
const COPY_LABEL = 'Copy';
const COPIED_LABEL = 'Copied!';
const COPY_FAILED_LABEL = 'Failed';
const COPY_FEEDBACK_MS = 2000;

/**
 * Re-scope the GitHub alert color variables for the shadow root.
 *
 * The upstream stylesheets declare their custom properties on `:root`
 * (light) and `.dark` (dark-class). `:root` resolves to <html>, which lives
 * outside the shadow boundary, so `var(--color-note)` & friends would fall
 * back to `currentColor` and every alert would render grey. Rewriting the
 * selector to `:host, .markdown-body` puts the variables on the shadow host
 * itself, where the alert rules can actually see them.
 *
 * `--color-note` also gets retinted on the way through: upstream ships GitHub
 * blue (#0969da light / #2f81f7 dark), which clashes with the vinhmetal
 * palette, so NOTE alerts run on the same Academic Cinnabar accent as the rest
 * of the preview.
 */
const NOTE_ACCENT: ReadonlyArray<readonly [RegExp, string]> = [
  [/#0969da/gi, '#ea580c'],
  [/#2f81f7/gi, '#fb923c'],
];

function scopeAlertColors(css: string): string {
  const scoped = css.replace(/^[^{]*\{/, ':host, .markdown-body {');
  return NOTE_ACCENT.reduce((acc, [from, to]) => acc.replace(from, to), scoped);
}

export class PreviewRenderer {
  private readonly shadow: ShadowRoot;
  private readonly bodyEl: HTMLElement;
  private readonly githubMdStyle: HTMLStyleElement;
  private readonly hljsStyle: HTMLStyleElement;
  private readonly alertColorsStyle: HTMLStyleElement;

  private mermaidIdCounter = 0;
  /** Pending "Copied!" label restore timers, one per copy button. */
  private readonly copyResetTimers = new WeakMap<HTMLButtonElement, number>();

  constructor(hostEl: HTMLElement) {
    this.shadow = hostEl.attachShadow({ mode: 'open' });

    // Inject all styles as <style> elements (bundled CSS strings, zero CDN requests)
    this.githubMdStyle = this._mkStyle(githubMdLight);
    this.hljsStyle = this._mkStyle(hljsLight);
    this.alertColorsStyle = this._mkStyle(scopeAlertColors(alertsLight));
    this.shadow.append(
      this.githubMdStyle,
      this.hljsStyle,
      this._mkStyle(katexCss),
      this._mkStyle(alertsCss),
      this.alertColorsStyle,
      this._mkStyle(previewOverridesCss)
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
    this.githubMdStyle.textContent = isDark ? githubMdDark : githubMdLight;
    this.hljsStyle.textContent = isDark ? hljsDark : hljsLight;
    // GitHub alert colors ship scoped to `:root` / `.dark` — neither of which
    // matches inside a shadow root, so they are re-scoped on every swap.
    this.alertColorsStyle.textContent = scopeAlertColors(isDark ? alertsDark : alertsLight);
    this.bodyEl.classList.toggle('dark', isDark);
  }

  /**
   * Inject pre-sanitized HTML into the shadow DOM.
   *
   * SAFETY CONTRACT: the caller MUST sanitize before passing here.
   * The custom DOMPurify config used by preview.ts allows SVG/MathML for
   * Mermaid + KaTeX output, so this method cannot do a second sanitization
   * pass with default config without stripping those legitimate elements.
   */
  setSafeHTML(sanitizedHtml: string): void {
    this.bodyEl.innerHTML = sanitizedHtml;
    this._prepareMermaidBlocks();
    this._enhanceCodeBlocks();
  }

  /**
   * Render Mermaid diagrams via mermaid.render() — the SVG string API.
   * Uses mermaid.render() (not mermaid.run()) — correct approach for Shadow DOM.
   * Mermaid is loaded via CDN — typed in src/shared/globals.d.ts.
   */
  async renderMermaid(isDark: boolean): Promise<void> {
    const mermaid = window.mermaid;
    if (typeof mermaid === 'undefined') {
      // CDN never arrived — reveal the raw source instead of showing nothing.
      this._revealMermaidSources();
      return;
    }

    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'default',
      securityLevel: 'loose',
    });

    const blocks = this.bodyEl.querySelectorAll('pre.mermaid-source > code.language-mermaid');
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
      } catch (err: any) {
        // Show an error alert instead of silently hiding so the user can see their code
        const wrapper = document.createElement('div');
        wrapper.className = 'markdown-alert markdown-alert-warning';
        wrapper.style.margin = '1.2em 0';
        wrapper.innerHTML = `
          <p class="markdown-alert-title">
            <svg class="octicon octicon-alert" viewBox="0 0 16 16" version="1.1" width="16" height="16" aria-hidden="true"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"></path></svg>
            Mermaid Render Error
          </p>
          <pre class="hljs" style="margin-top: 0.5em; background: transparent; padding: 0;"><code>${codeText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
        `;
        pre.replaceWith(wrapper);
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

  /**
   * Get current rendered HTML (for PDF export).
   * Copy buttons are UI chrome — stripped so they never land in the PDF.
   */
  getHTML(): string {
    const clone = this.bodyEl.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.code-copy-btn').forEach((btn) => btn.remove());
    return clone.innerHTML;
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

  /**
   * Hide raw mermaid fences only when mermaid is actually available to replace
   * them. If the CDN is blocked or still loading, the source stays visible —
   * far better than a blank gap where a diagram should be.
   */
  private _prepareMermaidBlocks(): void {
    if (typeof window.mermaid === 'undefined') return;
    this.bodyEl.querySelectorAll('pre.mermaid-source').forEach((pre) => {
      pre.classList.add('mermaid-rendered-hide');
    });
  }

  /** Undo _prepareMermaidBlocks() when mermaid turns out to be unavailable. */
  private _revealMermaidSources(): void {
    this.bodyEl.querySelectorAll('pre.mermaid-rendered-hide').forEach((pre) => {
      pre.classList.remove('mermaid-rendered-hide');
    });
  }

  /**
   * Decorate every highlighted code block with a language badge and a
   * copy-to-clipboard button. The <pre> structure is left intact — the button
   * is absolutely positioned, so it never disturbs the code layout.
   */
  private _enhanceCodeBlocks(): void {
    this.bodyEl.querySelectorAll('pre').forEach((pre) => {
      if (pre.classList.contains('mermaid-source')) return;
      if (pre.querySelector('.code-copy-btn')) return;

      const code = pre.querySelector('code');
      if (!code) return;

      const lang = this._langOf(code);
      if (lang && lang !== 'plaintext') pre.setAttribute('data-lang', lang);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'code-copy-btn';
      btn.textContent = COPY_LABEL;
      btn.setAttribute('aria-label', lang ? `Copy ${lang} code` : 'Copy code');
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        void this._copyCode(code, btn);
      });

      pre.classList.add('has-copy-btn');
      pre.appendChild(btn);
    });
  }

  /** Read the `language-*` class markdown-it attached to a <code> element. */
  private _langOf(code: Element): string {
    const match = /(?:^|\s)language-([\w+#.-]+)/.exec(code.className);
    return match ? match[1] : '';
  }

  /** Copy a block's source, then flash the button label for two seconds. */
  private async _copyCode(code: Element, btn: HTMLButtonElement): Promise<void> {
    const text = (code as HTMLElement).innerText || code.textContent || '';
    let copied = false;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      } else {
        copied = this._legacyCopy(text);
      }
    } catch {
      // Clipboard API can reject on insecure origins or denied permission.
      copied = this._legacyCopy(text);
    }

    this._flashCopyState(btn, copied);
  }

  /** document.execCommand fallback for browsers without the async Clipboard API. */
  private _legacyCopy(text: string): boolean {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }

  private _flashCopyState(btn: HTMLButtonElement, copied: boolean): void {
    const pending = this.copyResetTimers.get(btn);
    if (pending !== undefined) window.clearTimeout(pending);

    btn.classList.toggle('is-copied', copied);
    btn.classList.toggle('is-failed', !copied);
    btn.textContent = copied ? COPIED_LABEL : COPY_FAILED_LABEL;

    const timer = window.setTimeout(() => {
      btn.classList.remove('is-copied', 'is-failed');
      btn.textContent = COPY_LABEL;
      this.copyResetTimers.delete(btn);
    }, COPY_FEEDBACK_MS);
    this.copyResetTimers.set(btn, timer);
  }
}
