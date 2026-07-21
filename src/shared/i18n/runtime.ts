/**
 * Shared client-side i18n runtime for every tool.
 *
 * One engine, configured per tool with that tool's own string packs — the
 * feature slices keep their own i18n/{en,vi}.json (VSA), only the runtime is
 * shared. Unified across tools: storage key (`c2md-lang`), fallback language
 * (`en`), and the `langchange` event dispatched on every switch so JS-built
 * UI (e.g. the share layer) can re-translate itself.
 *
 * Usage in a tool's i18n-client.ts:
 *   import en from '../i18n/en.json';
 *   import vi from '../i18n/vi.json';
 *   import { createI18n } from '@shared/i18n/runtime';
 *   export const { t, init, setLang, toggle, getCurrentLang } =
 *     createI18n({ translations: { en, vi } });
 */
const SUPPORTED_LANGS = ['en', 'vi'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

const STORAGE_KEY = 'c2md-lang';
const FALLBACK_LANG: Lang = 'en';
const LANG_CHANGE_EVENT = 'langchange';

function isLang(value: string): value is Lang {
  return (SUPPORTED_LANGS as readonly string[]).includes(value);
}

export interface I18nOptions {
  /** Per-tool string packs, keyed by language code. */
  translations: Record<Lang, Record<string, string>>;
  /** Optional hook after each apply, for tool-specific dynamic text/links. */
  onApply?: (lang: Lang) => void;
}

export interface I18n {
  t(key: string): string;
  init(): void;
  setLang(lang: Lang): void;
  toggle(): void;
  getCurrentLang(): Lang;
}

export function createI18n(opts: I18nOptions): I18n {
  const { translations, onApply } = opts;
  let currentLang: Lang = FALLBACK_LANG;
  let strings: Record<string, string> = {};

  function detectLang(): Lang {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && isLang(saved)) return saved;
    const browserLang = (navigator.language || FALLBACK_LANG).slice(0, 2);
    return isLang(browserLang) ? browserLang : FALLBACK_LANG;
  }

  function t(key: string): string {
    return strings[key] || key;
  }

  function applyToDOM(): void {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      const attr = el.getAttribute('data-i18n-attr');
      if (attr) el.setAttribute(attr, t(key));
      else el.textContent = t(key);
    });
    document.title = t('page_title');
    document.documentElement.lang = currentLang;
  }

  function updateSwitcherUI(): void {
    const btn = document.getElementById('lang-switch-btn');
    if (!btn) return;
    const flag = currentLang === 'vi' ? '🇻🇳' : '🇬🇧';
    const label = currentLang === 'vi' ? 'VI' : 'EN';
    btn.innerHTML = `<span class="text-base">${flag}</span><span class="text-xs font-semibold">${label}</span>`;
  }

  function setLang(lang: Lang): void {
    if (!isLang(lang)) return;
    currentLang = lang;
    strings = translations[lang] ?? translations[FALLBACK_LANG] ?? {};
    localStorage.setItem(STORAGE_KEY, lang);
    applyToDOM();
    updateSwitcherUI();
    onApply?.(lang);
    window.dispatchEvent(new CustomEvent(LANG_CHANGE_EVENT, { detail: { lang } }));
  }

  function toggle(): void {
    setLang(currentLang === 'vi' ? 'en' : 'vi');
  }

  function init(): void {
    currentLang = detectLang();
    setLang(currentLang);
    document.getElementById('lang-switch-btn')?.addEventListener('click', toggle);
  }

  return { t, init, setLang, toggle, getCurrentLang: () => currentLang };
}
