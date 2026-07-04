// Jest setup — mocks for native modules the pure-logic suites touch transitively.
// `@/i18n` calls expo-localization's getLocales() at import time; pin it to 'en'
// so i18n-dependent derivations (languageName etc.) are deterministic in tests.
// `virtual: true` lets the mock resolve even in environments without the real
// native package (e.g. the sandbox scratch runner).
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }), {
  virtual: true,
});
