// Jest setup — mocks for native modules the pure-logic suites touch transitively.
// `@/i18n` calls expo-localization's getLocales() at import time; pin it to 'en'
// so i18n-dependent derivations (languageName etc.) are deterministic in tests.
// `virtual: true` lets the mock resolve even in environments without the real
// native package (e.g. the sandbox scratch runner).
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }), {
  virtual: true,
});

// In-memory AsyncStorage — outbox/persister tests exercise real read/write
// semantics without the native module (virtual → also works in the scratch env).
jest.mock(
  '@react-native-async-storage/async-storage',
  () => {
    let store: Record<string, string> = {};
    return {
      __esModule: true,
      default: {
        getItem: async (k: string) => store[k] ?? null,
        setItem: async (k: string, v: string) => {
          store[k] = v;
        },
        removeItem: async (k: string) => {
          delete store[k];
        },
        clear: async () => {
          store = {};
        },
      },
    };
  },
  { virtual: true },
);
