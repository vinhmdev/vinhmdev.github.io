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
import { copyToClipboard } from './utils';

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

export interface SetSafeHTMLOptions {
  renderMermaid?: boolean;
  isDark?: boolean;
}

const MAX_MERMAID_CACHE_ENTRIES = 100;

export class PreviewRenderer {
  private readonly shadow: ShadowRoot;
  private readonly bodyEl: HTMLElement;
  private readonly githubMdStyle: HTMLStyleElement;
  private readonly hljsStyle: HTMLStyleElement;
  private readonly alertColorsStyle: HTMLStyleElement;

  private isDarkMode = false;
  private mermaidIdCounter = 0;
  /** Serializes `mermaid.initialize` + `mermaid.render` calls on the global singleton. */
  private mermaidQueue: Promise<void> = Promise.resolve();
  /** Bounded LRU cache of rendered Mermaid SVGs keyed by `(theme, source)`. */
  private readonly mermaidSvgCache = new Map<string, string>();
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
    this.isDarkMode = isDark;
    this.githubMdStyle.textContent = isDark ? githubMdDark : githubMdLight;
    this.hljsStyle.textContent = isDark ? hljsDark : hljsLight;
    // GitHub alert colors ship scoped to `:root` / `.dark` — neither of which
    // matches inside a shadow root, so they are re-scoped on every swap.
    this.alertColorsStyle.textContent = scopeAlertColors(isDark ? alertsDark : alertsLight);
    this.bodyEl.classList.toggle('dark', isDark);
  }

  /**
   * Inject pre-sanitized HTML into the shadow DOM while preserving scroll
   * position, already-decoded images, and cached Mermaid diagrams so typing
   * in the editor never triggers layout collapse or scroll thrashing.
   *
   * SAFETY CONTRACT: the caller MUST sanitize before passing here.
   * The custom DOMPurify config used by preview.ts allows SVG/MathML for
   * Mermaid + KaTeX output, so this method cannot do a second sanitization
   * pass with default config without stripping those legitimate elements.
   */
  setSafeHTML(sanitizedHtml: string, opts: SetSafeHTMLOptions = {}): void {
    const savedScrollTop = this.bodyEl.scrollTop;
    const savedScrollLeft = this.bodyEl.scrollLeft;
    const renderMermaid = opts.renderMermaid ?? true;
    const isDark = opts.isDark ?? this.isDarkMode;

    const prevMermaidHeights = Array.from(
      this.bodyEl.querySelectorAll<HTMLElement>(
        '.mermaid-wrapper, pre.mermaid-source, [data-mermaid-error]'
      )
    ).map((node) => node.offsetHeight);

    const decodedImagesBySrc = this._collectDecodedImages();

    this.bodyEl.innerHTML = sanitizedHtml;

    this._reuseDecodedImages(decodedImagesBySrc);
    this._prepareMermaidBlocks(renderMermaid, isDark, prevMermaidHeights);
    this._enhanceCodeBlocks();

    this.bodyEl.scrollTop = savedScrollTop;
    this.bodyEl.scrollLeft = savedScrollLeft;
  }

  /**
   * Render uncached Mermaid diagrams via mermaid.render() — the SVG string API.
   * Cached diagrams are already injected synchronously during setSafeHTML().
   * Uses mermaid.render() (not mermaid.run()) — correct approach for Shadow DOM.
   * Mermaid is loaded via CDN — typed in src/shared/globals.d.ts.
   */
  async renderMermaid(isDark: boolean, isCancelled?: () => boolean): Promise<void> {
    if (isCancelled?.()) return;

    const blocks = Array.from(
      this.bodyEl.querySelectorAll('pre.mermaid-source > code.language-mermaid')
    );
    if (blocks.length === 0) return;

    const mermaid = window.mermaid;
    if (typeof mermaid === 'undefined') {
      // CDN never arrived — reveal the raw source instead of showing nothing.
      this._revealMermaidSources();
      return;
    }

    const runPass = async (): Promise<void> => {
      if (isCancelled?.()) return;

      for (const code of blocks) {
        if (isCancelled?.()) return;
        const pre = code.parentElement;
        if (!pre || pre.tagName !== 'PRE' || !pre.isConnected) continue;

        const codeText = code.textContent || '';
        const cacheKey = this._mermaidCacheKey(isDark, codeText);
        const cachedSvg = this._getCachedMermaidSvg(cacheKey);
        if (cachedSvg !== undefined) {
          const beforeTop = this.bodyEl.scrollTop;
          pre.replaceWith(this._createMermaidWrapper(codeText, cachedSvg));
          this.bodyEl.scrollTop = beforeTop;
          continue;
        }

        const id = `mermaid-sdom-${this.mermaidIdCounter++}`;
        try {
          // Configure theme inside the serialized queue immediately before render
          // so concurrent theme toggles never mutate global Mermaid state mid-flight
          // or poison `mermaidSvgCache` with wrong-theme SVGs.
          mermaid.initialize({
            startOnLoad: false,
            theme: isDark ? 'dark' : 'default',
            securityLevel: 'loose',
          });
          const { svg } = await mermaid.render(id, codeText);
          this._rememberMermaidSvg(cacheKey, svg);
          if (isCancelled?.() || !pre.isConnected) return;
          const beforeTop = this.bodyEl.scrollTop;
          pre.replaceWith(this._createMermaidWrapper(codeText, svg));
          this.bodyEl.scrollTop = beforeTop;
        } catch (err: unknown) {
          if (isCancelled?.() || !pre.isConnected) return;
          console.warn('[preview-renderer] Mermaid render failed:', err);
          // Show an error alert instead of silently hiding so the user can see their code
          const wrapper = document.createElement('div');
          wrapper.className = 'markdown-alert markdown-alert-warning';
          wrapper.setAttribute('data-mermaid-error', 'true');
          wrapper.style.margin = '1.2em 0';
          wrapper.innerHTML = `
            <p class="markdown-alert-title">
              <svg class="octicon octicon-alert" viewBox="0 0 16 16" version="1.1" width="16" height="16" aria-hidden="true"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"></path></svg>
              Mermaid Render Error
            </p>
            <pre class="hljs" style="margin-top: 0.5em; background: transparent; padding: 0;"><code>${codeText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
          `;
          const beforeTop = this.bodyEl.scrollTop;
          pre.replaceWith(wrapper);
          this.bodyEl.scrollTop = beforeTop;
        } finally {
          // Clean up any temporary measurement/error nodes Mermaid may leave on document
          document.getElementById(id)?.remove();
          document.getElementById(`d${id}`)?.remove();
        }
      }
    };

    const next = this.mermaidQueue.then(runPass, runPass);
    this.mermaidQueue = next.catch(() => {});
    await next;
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
    this.bodyEl.scrollTop = 0;
    this.bodyEl.scrollLeft = 0;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private _mkStyle(css: string): HTMLStyleElement {
    const el = document.createElement('style');
    el.textContent = css;
    return el;
  }

  private _mermaidCacheKey(isDark: boolean, codeText: string): string {
    return `${isDark ? 'dark' : 'light'}\0${codeText}`;
  }

  private _getCachedMermaidSvg(key: string): string | undefined {
    const val = this.mermaidSvgCache.get(key);
    if (val !== undefined) {
      // Refresh LRU insertion order
      this.mermaidSvgCache.delete(key);
      this.mermaidSvgCache.set(key, val);
    }
    return val;
  }

  private _rememberMermaidSvg(key: string, svg: string): void {
    if (this.mermaidSvgCache.has(key)) {
      this.mermaidSvgCache.delete(key);
    } else if (this.mermaidSvgCache.size >= MAX_MERMAID_CACHE_ENTRIES) {
      const oldestKey = this.mermaidSvgCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.mermaidSvgCache.delete(oldestKey);
      }
    }
    this.mermaidSvgCache.set(key, svg);
  }

  private _createMermaidWrapper(codeText: string, svg: string): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'mermaid-wrapper';
    wrapper.setAttribute('data-original-code', codeText);
    wrapper.innerHTML = svg;
    return wrapper;
  }

  private _collectDecodedImages(): Map<string, HTMLImageElement[]> {
    const buckets = new Map<string, HTMLImageElement[]>();
    this.bodyEl.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
      const src = img.getAttribute('src');
      if (!src || !img.complete || img.naturalWidth === 0) return;
      const list = buckets.get(src);
      if (list) list.push(img);
      else buckets.set(src, [img]);
    });
    return buckets;
  }

  private _reuseDecodedImages(buckets: Map<string, HTMLImageElement[]>): void {
    if (buckets.size === 0) return;
    this.bodyEl.querySelectorAll<HTMLImageElement>('img[src]').forEach((freshImg) => {
      const src = freshImg.getAttribute('src');
      if (!src) return;
      const list = buckets.get(src);
      const reused = list?.shift();
      if (!reused) return;

      // Sync sanitized attributes from freshImg onto reused image element
      const nextNames = new Set(freshImg.getAttributeNames());
      for (const attrName of Array.from(reused.getAttributeNames())) {
        if (!nextNames.has(attrName)) reused.removeAttribute(attrName);
      }
      for (const attrName of nextNames) {
        if (attrName === 'src') continue;
        const val = freshImg.getAttribute(attrName);
        if (val !== null) reused.setAttribute(attrName, val);
      }
      freshImg.replaceWith(reused);
    });
  }

  /**
   * Inject cached Mermaid SVGs synchronously and reserve height for uncached
   * fences when mermaid is available to replace them asynchronously.
   */
  private _prepareMermaidBlocks(
    renderMermaid: boolean,
    isDark: boolean,
    prevHeights: readonly number[]
  ): void {
    if (!renderMermaid) return;
    const hasMermaidGlobal = typeof window.mermaid !== 'undefined';

    let slotIndex = 0;
    this.bodyEl.querySelectorAll<HTMLElement>('pre.mermaid-source').forEach((pre) => {
      const currentSlot = slotIndex++;
      const code = pre.querySelector('code.language-mermaid');
      const codeText = code?.textContent || '';
      const cachedSvg = this._getCachedMermaidSvg(this._mermaidCacheKey(isDark, codeText));
      if (cachedSvg !== undefined) {
        pre.replaceWith(this._createMermaidWrapper(codeText, cachedSvg));
        return;
      }

      if (!hasMermaidGlobal) return;
      pre.classList.add('mermaid-rendered-hide');
      const prevH = prevHeights[currentSlot];
      if (typeof prevH === 'number' && prevH > 0) {
        pre.style.minHeight = `${prevH}px`;
      }
    });
  }

  /** Undo _prepareMermaidBlocks() when mermaid turns out to be unavailable. */
  private _revealMermaidSources(): void {
    this.bodyEl.querySelectorAll<HTMLElement>('pre.mermaid-rendered-hide').forEach((pre) => {
      pre.classList.remove('mermaid-rendered-hide');
      pre.style.removeProperty('min-height');
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
    const text =
      code instanceof HTMLElement
        ? code.innerText || code.textContent || ''
        : code.textContent || '';
    const copied = await copyToClipboard(text);
    this._flashCopyState(btn, copied);
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
