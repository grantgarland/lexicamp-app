#!/usr/bin/env node
// Publishes an OTA update (EAS Update) AND uploads its source maps to Sentry,
// as one step that cannot half-happen silently.
//
// WHY THIS EXISTS: store builds upload source maps during `eas build` (the
// Sentry Expo plugin's Xcode/Gradle phase). An OTA update is never built
// that way. `eas update` only runs `expo export` and uploads to Expo, so
// unless someone remembers a second command, every crash in that update
// reaches Sentry as minified Hermes frames. Nothing fails when the step is
// skipped; the gap only shows up while you're triaging a production crash.
//
// HOW SENTRY MATCHES THEM: the Metro config (`getSentryExpoConfig`) stamps a
// debug ID into each bundle and its .map. Sentry pairs events to maps by that
// ID, not by release name, which is what an OTA needs: one update can run on
// several store releases. Uploaded maps therefore show no release in Sentry,
// and that is expected. OTA metadata (update ID, channel, runtime version)
// already rides on every event as the SDK's built-in `ota_updates` context.
//
// ORDER OF OPERATIONS, and why:
//   1. Preflight BEFORE publishing (clean tree, SENTRY_AUTH_TOKEN present).
//      An update that is live with no maps is the failure this script prevents,
//      so anything that would stop the upload must stop the publish first.
//   2. Empty dist/ so no stale bundle from an earlier export gets uploaded
//      under a debug ID that no live update carries.
//   3. `eas update` (writes dist/ with --dump-sourcemap by default).
//   4. Upload dist/. If THIS fails, the update is already live, so say so
//      loudly and leave dist/ in place: re-running the upload is safe.
//
// Run: npm run update:ota -- --message "Explain breached-password errors"
//      [--channel production] [--environment production] [--platform ios]
// Needs: EXPO_TOKEN or `eas login`; SENTRY_AUTH_TOKEN (read from .env.local
// if present, the same file Expo loads).
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');

/** Same pin and override as verify-eas-env.mjs, so the release path uses one
 *  eas-cli major. */
const EAS_CLI_SPEC = process.env.EAS_CLI_SPEC ?? 'eas-cli@23';

const { values } = parseArgs({
  options: {
    message: { type: 'string', short: 'm' },
    channel: { type: 'string', default: 'production' },
    // Every shipping profile in eas.json reads the `production` EAS
    // environment, so this is the right default for the `preview` channel too.
    environment: { type: 'string', default: 'production' },
    platform: { type: 'string' },
  },
});

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function run(cmd, args, env = process.env) {
  execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env });
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

// ── 1. Preflight ────────────────────────────────────────────────────────────
if (!values.message) fail('Pass --message "…": it is what you will see in `eas update:list` and the Expo dashboard.');

// An update must correspond to a commit, or the debug IDs in Sentry point at
// code nobody can check out again.
if (git(['status', '--porcelain']) !== '') {
  fail('Working tree has uncommitted changes. Commit or stash them first: an OTA must be a reproducible commit.');
}

// The uploader loads .env.local itself, so a token there counts. Only LOOK for
// it here, and never load the file into this process: everything in
// process.env is inherited by `eas update` (see step 3 for why that matters).
function sentryTokenAvailable() {
  if (process.env.SENTRY_AUTH_TOKEN) return true;
  return ['.env.local', '.env'].some((file) => {
    try {
      return Boolean(parseEnv(readFileSync(join(ROOT, file), 'utf8')).SENTRY_AUTH_TOKEN);
    } catch {
      return false;
    }
  });
}
if (!sentryTokenAvailable()) {
  fail('SENTRY_AUTH_TOKEN is not set (env or .env.local). Refusing to publish an update whose crashes Sentry could not symbolicate.');
}

// Org/project come from the Sentry Expo plugin in app.json, the same source
// store builds use, and are passed explicitly so they beat anything in the
// environment. The uploader otherwise PREFERS SENTRY_ORG/SENTRY_PROJECT env
// vars and loads .env.local itself. On 2026-10-14 that file said
// SENTRY_PROJECT=react-native, a project that does not exist (the only one is
// `lexicamp`). The upload would have failed after the update was already live.
const sentryPlugin = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')).expo.plugins?.find(
  (p) => Array.isArray(p) && p[0] === '@sentry/react-native/expo',
)?.[1];
if (!sentryPlugin?.organization || !sentryPlugin?.project) {
  fail('app.json has no @sentry/react-native/expo plugin with organization + project; cannot tell where source maps go.');
}

const sha = git(['rev-parse', '--short', 'HEAD']);
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
console.log(`Publishing ${branch}@${sha} → channel "${values.channel}" (environment "${values.environment}")`);
if (branch !== 'main') console.warn(`⚠ Not on main. Make sure ${branch} is what users should run.`);

// ── 2. Clean output dir ─────────────────────────────────────────────────────
rmSync(DIST, { recursive: true, force: true });

// ── 3. Publish ──────────────────────────────────────────────────────────────
// EXPO_NO_DOTENV: build the bundle from the EAS environment ONLY, exactly like
// a store build (which never sees the gitignored .env.local). Without it,
// `expo export` loads .env.local, and any EXPO_PUBLIC_* that exists locally
// but not in EAS (EXPO_PUBLIC_APP_ENV=development, the dev-scenario password)
// gets inlined into what every user downloads.
run('npx', [
  '--yes',
  EAS_CLI_SPEC,
  'update',
  '--channel',
  values.channel,
  '--environment',
  values.environment,
  '--message',
  `${values.message} (${sha})`,
  '--non-interactive',
  ...(values.platform ? ['--platform', values.platform] : []),
], { ...process.env, EXPO_NO_DOTENV: '1' });

// ── 4. Upload source maps ───────────────────────────────────────────────────
try {
  run('npx', ['sentry-expo-upload-sourcemaps', 'dist'], {
    ...process.env,
    SENTRY_ORG: sentryPlugin.organization,
    SENTRY_PROJECT: sentryPlugin.project,
    SENTRY_URL: sentryPlugin.url ?? 'https://sentry.io/',
  });
} catch {
  fail(
    'The update IS LIVE, but its source maps did not reach Sentry.\n' +
      '  dist/ was left in place. Retry with:\n' +
      `  SENTRY_ORG=${sentryPlugin.organization} SENTRY_PROJECT=${sentryPlugin.project} npx sentry-expo-upload-sourcemaps dist`,
  );
}
console.log(`\n✔ Update published and source maps uploaded (${sha}).`);
