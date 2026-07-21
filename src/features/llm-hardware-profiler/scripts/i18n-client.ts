/**
 * Client-side i18n for the LLM Hardware Profiler — thin wrapper over the
 * shared runtime (@shared/i18n/runtime) with this tool's own string packs.
 */
import en from '../i18n/en.json';
import vi from '../i18n/vi.json';
import { createI18n } from '@shared/i18n/runtime';

export const { t, init, setLang, toggle, getCurrentLang } = createI18n({
  translations: { en, vi },
});
