// Jest — CI-1 test foundation (see lexicamp-project/08 CI track).
// jest-expo handles Expo/RN transforms; the current suites are pure domain/data/i18n
// logic. Component (RTL) suites can be added under src/ui/__tests__ with no config change.
module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/src/test/setup.ts'],
  moduleNameMapper: {
    '^@/assets/(.*)$': '<rootDir>/assets/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['<rootDir>/src/**/*.test.@(ts|tsx)'],
  // jest-expo's default allowlist + @wrack (walkthrough lib ships untranspiled
  // ESM; QuizScreen imports it via the tour module — 18 §F2).
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@wrack/.*))',
  ],
  clearMocks: true,
};
