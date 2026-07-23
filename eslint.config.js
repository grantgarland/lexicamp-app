// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const globals = require('globals');
// eslint-plugin-react-native-a11y (3.5.1): last published against ESLint ^8 (old
// eslintrc format, no flat-config export) — its `peerDependencies` range predates
// ESLint 9, hence the `--legacy-peer-deps` install. The rule implementations only
// use `context.report`, no APIs ESLint 9 removed, so it runs fine wired in
// manually below; re-check this note if a future bump ever actually breaks.
const reactNativeA11y = require('eslint-plugin-react-native-a11y');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      'dist/*',
      '.expo/*',
      'android/*',
      'ios/*',
      'src/theme/tokens.generated.ts',
      // Deno runtime (Supabase Edge Functions) — linted by the Deno toolchain, not Node ESLint.
      'supabase/functions/*',
    ],
  },
  {
    // Node CLI scripts (CommonJS) — __dirname/require/etc. are real globals here.
    files: ['scripts/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    // 3.11: RN-specific a11y rules (missing labels/roles, unlabeled touchables,
    // nested touchables). "all" config = basic + iOS + Android extras — the app
    // ships both platforms. Scoped to app source only (not scripts/tests/config).
    files: ['src/**/*.tsx'],
    plugins: { 'react-native-a11y': reactNativeA11y },
    rules: {
      ...reactNativeA11y.configs.all.rules,
      // Off: mandates accessibilityHint on EVERY accessibilityLabel, but Apple/
      // Google guidance is the opposite — hints are for when the RESULT of an
      // action isn't obvious from the label, and over-using them adds
      // screen-reader verbosity. Blanket-enforcing this would fight, not help,
      // real a11y quality; add hints case-by-case where they genuinely clarify.
      'react-native-a11y/has-accessibility-hint': 'off',
    },
  },
  {
    // Tests: jest.mock() factories are hoisted above imports, so mocked modules must be
    // pulled in with require() inside the factory — ESM import can't be referenced there.
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      // Imports intentionally sit below jest.mock() blocks (which jest hoists anyway).
      'import/first': 'off',
    },
  },
]);
