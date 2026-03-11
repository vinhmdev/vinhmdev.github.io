import en from './translations/en.json';
import vi from './translations/vi.json';

export const languages = {
  en: 'English',
  vi: 'Tiếng Việt',
};

export const defaultLang = 'en';

type Lang = keyof typeof languages;

const translations: Record<Lang, Record<string, string>> = { en, vi };

/**
 * Get a translated string by key.
 * Falls back to English, then returns the key itself.
 */
export function t(lang: string, key: string): string {
  const l = (lang in languages ? lang : defaultLang) as Lang;
  return translations[l]?.[key] ?? translations[defaultLang]?.[key] ?? key;
}

/**
 * Merge tool-specific translations with site-wide ones.
 * Tool translations override site-wide ones.
 */
export function mergeTranslations(
  lang: string,
  toolStrings: Record<string, Record<string, string>>,
): Record<string, string> {
  const l = (lang in languages ? lang : defaultLang) as Lang;
  return {
    ...translations[l],
    ...(toolStrings[l] ?? toolStrings[defaultLang] ?? {}),
  };
}
