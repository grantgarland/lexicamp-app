// i18n — app UI localization (react-i18next + expo-localization). Initialized for
// its side effects from `_layout.tsx` (like `@/theme/unistyles`) before any component
// renders. This is the UI LOCALE (app chrome language), which is distinct from the
// user's LEARNING-LANGUAGE pair (profile.nativeLang / targetLang, see `domain/derive`).
// Add a locale by dropping a `locales/<code>.json` next to en/es and registering it below.
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import es from './locales/es.json';

export const SUPPORTED_LOCALES = ['en', 'es'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export const FALLBACK_LOCALE: AppLocale = 'en';

const isSupported = (code: string | undefined | null): code is AppLocale =>
  code != null && (SUPPORTED_LOCALES as readonly string[]).includes(code);

/** Device language (e.g. 'es') if we ship it, else the fallback. */
function detectLocale(): AppLocale {
  const code = getLocales()[0]?.languageCode?.toLowerCase();
  return isSupported(code) ? code : FALLBACK_LOCALE;
}

if (!i18n.isInitialized) {
  // `i18n.use()` is the documented i18next builder API; the lint rule mistakes it for the
  // named `use` export. Safe to ignore here.
  // eslint-disable-next-line import/no-named-as-default-member
  i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      es: { translation: es },
    },
    lng: detectLocale(),
    fallbackLng: FALLBACK_LOCALE,
    supportedLngs: SUPPORTED_LOCALES as unknown as string[],
    // RN has no HTML sink, and interpolated values (words, language names) must pass
    // through verbatim — so disable i18next's default HTML escaping.
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

export default i18n;
export { useTranslation } from 'react-i18next';
