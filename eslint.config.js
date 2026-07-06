// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const globals = require('globals');

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
]);
