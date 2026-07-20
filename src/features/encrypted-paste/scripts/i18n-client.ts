/**
 * Client-side i18n for the encrypted-paste tool.
 * Mirrors the clipboard2markdown i18n approach: swap a flat string map at
 * runtime and re-apply it to `[data-i18n]` nodes.
 */
import toolEn from '../i18n/en.json';
import toolVi from '../i18n/vi.json';

const SUPPORTED_LANGS = ['vi', 'en'] as const;
type Lang = (typeof SUPPORTED_LANGS)[number];
const STORAGE_KEY = 'c2md-lang';

const translations: Record<Lang, Record<string, string>> = {
  en: toolEn,
  vi: toolVi,
};

let currentLang: Lang = 'vi';
let strings: Record<string, string> = translations.vi;

function isLang(value: string): value is Lang {
  return (SUPPORTED_LANGS as readonly string[]).includes(value);
}

function detectLang(): Lang {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && isLang(saved)) return saved;
  const browserLang = (navigator.language || 'vi').slice(0, 2);
  return isLang(browserLang) ? browserLang : 'en';
}

export function t(key: string): string {
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

export function setLang(lang: Lang): void {
  if (!isLang(lang)) return;
  currentLang = lang;
  strings = translations[lang];
  localStorage.setItem(STORAGE_KEY, lang);
  applyToDOM();
  updateSwitcherUI();
  // Let the app re-render dynamic (non-static) strings in the new language.
  window.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
}

export function toggle(): void {
  setLang(currentLang === 'vi' ? 'en' : 'vi');
}

export function init(): void {
  currentLang = detectLang();
  setLang(currentLang);
  document.getElementById('lang-switch-btn')?.addEventListener('click', toggle);
}

export function getCurrentLang(): Lang {
  return currentLang;
}
