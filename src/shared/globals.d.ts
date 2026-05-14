/**
 * Type declarations for libraries loaded via CDN (UMD bundles).
 *
 * These libraries are intentionally not installed via npm to keep the
 * production bundle small — see clipboard2markdown/page.astro for the
 * per-library rationale (no ESM build, too large to bundle, etc.).
 *
 * The minimal interfaces below cover only the surface actually used in
 * this project. They centralize the "this comes from a CDN UMD" contract
 * in one place so feature code can drop `@ts-ignore` and `(window as any)`.
 *
 * All declarations live inside `declare global` so they're available as
 * ambient types throughout the project without needing imports.
 */

declare global {
  interface LucideGlobal {
    createIcons(): void;
  }

  interface MermaidConfig {
    startOnLoad?: boolean;
    theme?: 'default' | 'dark' | 'forest' | 'neutral' | 'base' | 'null';
    securityLevel?: 'strict' | 'loose' | 'antiscript' | 'sandbox';
    htmlLabels?: boolean;
  }

  interface MermaidGlobal {
    initialize(config: MermaidConfig): void;
    render(
      id: string,
      code: string
    ): Promise<{ svg: string; bindFunctions?: (el: Element) => void }>;
  }

  interface PrettierStandalone {
    format(
      source: string,
      options: { parser: string; plugins?: unknown[] }
    ): Promise<string>;
  }

  interface TurndownOptions {
    headingStyle?: 'setext' | 'atx';
    codeBlockStyle?: 'indented' | 'fenced';
    bulletListMarker?: '-' | '+' | '*';
    hr?: string;
    strongDelimiter?: '__' | '**';
    emDelimiter?: '_' | '*';
  }

  interface TurndownRule {
    filter:
      | string
      | string[]
      | ((node: HTMLElement, options?: TurndownOptions) => boolean);
    replacement: (
      content: string,
      node: HTMLElement,
      options?: TurndownOptions
    ) => string;
  }

  interface TurndownServiceInstance {
    use(plugin: unknown): TurndownServiceInstance;
    addRule(key: string, rule: TurndownRule): TurndownServiceInstance;
    turndown(input: string | HTMLElement): string;
    escape: (input: string) => string;
  }

  interface TurndownServiceConstructor {
    new (options?: TurndownOptions): TurndownServiceInstance;
  }

  interface TurndownPluginGfm {
    gfm: (service: TurndownServiceInstance) => void;
    tables: (service: TurndownServiceInstance) => void;
    strikethrough: (service: TurndownServiceInstance) => void;
    taskListItems: (service: TurndownServiceInstance) => void;
  }

  interface Window {
    lucide: LucideGlobal;
    mermaid: MermaidGlobal;
    prettier: PrettierStandalone;
    prettierPlugins: Record<string, unknown>;
  }

  // UMD bundles also expose these as bare identifiers (not just on window).
  // eslint-disable-next-line no-var
  var TurndownService: TurndownServiceConstructor;
  // eslint-disable-next-line no-var
  var turndownPluginGfm: TurndownPluginGfm;
}

export {};
