/**
 * Client-side i18n for clipboard2markdown — thin wrapper over the shared
 * runtime (@shared/i18n/runtime) with this tool's own string packs. The one
 * tool-specific bit is syncing the cookie banner's privacy-policy link to the
 * active language.
 */
import en from '../i18n/en.json';
import vi from '../i18n/vi.json';
import { createI18n, type Lang } from '@shared/i18n/runtime';

function updatePrivacyLink(lang: Lang): void {
  const link = document.getElementById('cookie-privacy-link') as HTMLAnchorElement | null;
  if (!link) return;
  link.href =
    lang === 'vi'
      ? 'https://vinhmdev.com/vi/privacy-policy/'
      : 'https://vinhmdev.com/privacy-policy/';
}

export const { t, init, setLang, toggle, getCurrentLang } = createI18n({
  translations: { en, vi },
  onApply: updatePrivacyLink,
});
