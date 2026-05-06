/**
 * i18n-client.ts — Client-side i18n for LLM Hardware Profiler.
 * Handles dynamic language switching at runtime.
 */
import toolEn from '../i18n/en.json';
import toolVi from '../i18n/vi.json';

const SUPPORTED_LANGS = ['vi', 'en'] as const;
type Lang = (typeof SUPPORTED_LANGS)[number];
const STORAGE_KEY = 'llm-profiler-lang';

const translations: Record<Lang, Record<string, string>> = {
  en: toolEn,
  vi: toolVi,
};

let currentLang: Lang = 'en';
let strings: Record<string, string> = {};

function detectLang(): Lang {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && (SUPPORTED_LANGS as readonly string[]).includes(saved)) return saved as Lang;
  const browserLang = (navigator.language || 'en').slice(0, 2);
  return (SUPPORTED_LANGS as readonly string[]).includes(browserLang)
    ? (browserLang as Lang)
    : 'en';
}

export function t(key: string): string {
  return strings[key] || key;
}

function applyToDOM(): void {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    const attr = el.getAttribute('data-i18n-attr');
    if (attr) {
      el.setAttribute(attr, t(key));
    } else {
      el.textContent = t(key);
    }
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

export function setLang(lang: Lang): void {
  if (!(SUPPORTED_LANGS as readonly string[]).includes(lang)) return;
  strings = translations[lang];
  currentLang = lang;
  localStorage.setItem(STORAGE_KEY, lang);
  applyToDOM();
  updateSwitcherUI();
}

export function toggle(): void {
  const next: Lang = currentLang === 'vi' ? 'en' : 'vi';
  setLang(next);
}

export function init(): void {
  currentLang = detectLang();
  setLang(currentLang);
  const btn = document.getElementById('lang-switch-btn');
  if (btn) btn.addEventListener('click', toggle);
}

export function getCurrentLang(): Lang {
  return currentLang;
}
