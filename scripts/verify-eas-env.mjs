#!/usr/bin/env node
// Proves the `production` EAS environment actually holds the variables a
// production build needs — and none of the ones it must not.
//
// WHY THIS EXISTS: on 2026-08-31 we found that
// EXPO_PUBLIC_REVENUECAT_IOS_API_KEY had NEVER been in any EAS environment. It
// lived only in one developer's `.env.local`, so every EAS-built binary --
// including a TestFlight build -- shipped with `configure()` skipped and
// `purchasesStatus = 'disabled-no-key'`: offerings never load, prices never
// render, the paywall cannot transact. That is App Store guideline 3.1
// rejection territory, and it is exactly the gap `21` P0-2 described.
//
// ⚠️ IT WAS INVISIBLE FOR A STRUCTURAL REASON, which is what makes a guard
// worth having. A `development` build reads `EXPO_PUBLIC_*` from the local
// `.env.local` through Metro, NOT from the build environment. So every manual
// purchase test passed on the one machine that happened to hold the key, while
// the artifact EAS produced had none. `eas env:list` looked healthy because the
// missing name simply was not there to notice. Nothing fails loudly on its own:
// not typecheck, not jest, not the bundle grep. Hence this.
//
// Run: npm run verify:eas-env   (needs EXPO_TOKEN; the release workflow has it)
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const ENVIRONMENT = 'production';

/** EAS CLI pin — major only, so patches are absorbed and a breaking major is
 *  not (nightly-smoke.yml's invariant 3: no unpinned external tools). Held at
 *  the CURRENT major rather than nightly's `eas-cli@20`, for the reason
 *  release-ios.yml gives for its own `eas-version: latest`: on the release
 *  path, a CLI lagging Expo's server-side API is its own failure mode. The
 *  `Name  VALUE` shape this script parses is identical on 20.5.1 and 23.2.0.
 *  Overridable so a workflow can hand down its own pin. */
const EAS_CLI_SPEC = process.env.EAS_CLI_SPEC ?? 'eas-cli@23';

/** Must be present, or the shipped binary is broken in a way no test catches.
 *  Each entry names the symptom, because "a variable is missing" is not
 *  actionable and "the paywall is dead" is. */
const REQUIRED = [
  { name: 'EXPO_PUBLIC_REVENUECAT_IOS_API_KEY', breaks: 'paywall cannot transact (purchasesStatus=disabled-no-key) — guideline 3.1 rejection' },
  { name: 'EXPO_PUBLIC_SUPABASE_URL', breaks: 'no backend: every query fails' },
  { name: 'EXPO_PUBLIC_SUPABASE_ANON_KEY', breaks: 'no backend: every query fails' },
  { name: 'EXPO_PUBLIC_SENTRY_DSN', breaks: 'crash reporting silently disabled in release — exactly when it is needed' },
];

/** Must NOT be present. `EXPO_PUBLIC_*` is INLINED into the JS bundle, so
 *  anything here ships to the App Store as a readable string. */
const FORBIDDEN = [
  { name: 'EXPO_PUBLIC_DEV_SCENARIO_PASSWORD', why: 'the seeded dev-account password would be a literal string in the shipped bundle' },
];

/** Every .ts/.tsx under src/, so the self-check can read real call sites. */
function sourceFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(full) && statSync(full).isFile()) out.push(full);
  }
  return out;
}

const src = sourceFiles(join(ROOT, 'src'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

// ── Self-check ───────────────────────────────────────────────────────────────
// A guard that cannot fail is worse than none: it reads as coverage. If a
// REQUIRED variable is no longer referenced anywhere in src/, the list is stale
// and this check has quietly stopped protecting anything — so say so loudly
// rather than passing.
const unreferenced = REQUIRED.filter((v) => !src.includes(v.name));
if (unreferenced.length > 0) {
  console.error('verify:eas-env SELF-CHECK FAILED — these are required but no longer read anywhere in src/:');
  for (const v of unreferenced) console.error(`  ${v.name}`);
  console.error('Either the variable was renamed (update this list in the same commit) or it is genuinely dead (drop it).');
  process.exit(1);
}

// ── The actual check ─────────────────────────────────────────────────────────
// ⚠️ THE PACKAGE IS `eas-cli`; THE BINARY IT INSTALLS IS `eas`. Those are not
// interchangeable on an npx line: `npx eas` resolves to an unrelated registry
// package literally named `eas` (a templating library that ships no bin) and
// dies with npm's "could not determine executable to run". That is what
// red-lined the 2026-09-03 release dispatch, on this check's first real run —
// and the catch below then blamed EXPO_TOKEN, so the message ruled out the one
// thing that was actually fine. Name the package; never guess at the cause.
//
// Prefer an `eas` already on PATH (a global install locally; whatever
// expo/expo-github-action put there in CI) so a run does not refetch the CLI,
// and fall back to the pinned package otherwise.
function easInvocation() {
  try {
    execFileSync('eas', ['--version'], { stdio: 'ignore' });
    return { file: 'eas', lead: [], label: 'eas (on PATH)' };
  } catch {
    return { file: 'npx', lead: ['--yes', EAS_CLI_SPEC], label: `npx ${EAS_CLI_SPEC}` };
  }
}

/** Both streams, minus the noise. BOTH matters: eas-cli puts only the generic
 *  wrapper ("Error: env:list command failed.") on stderr and the line that
 *  actually names the cause — a config-plugin resolution failure, a missing
 *  login — on stdout, so reading stderr alone reports nothing useful. The
 *  filtered lines are the upgrade banner and node's deprecation warnings. */
function easFailureDetail(e) {
  const noise = [
    /^\u2605 eas-cli@/,
    /^To upgrade, run:/,
    /^npm install -g eas-cli$/,
    /^Proceeding with outdated version\.$/,
    /DeprecationWarning|--trace-deprecation/,
  ];
  const lines = [String(e.stdout ?? ''), String(e.stderr ?? ''), e.stdout || e.stderr ? '' : String(e.message)]
    .join('\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !noise.some((re) => re.test(l)));
  return (lines.length > 0 ? lines : ['(the CLI printed nothing)']).slice(0, 8).join('\n');
}

const eas = easInvocation();
let raw;
try {
  raw = execFileSync(eas.file, [...eas.lead, 'env:list', ENVIRONMENT, '--format', 'long'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (e) {
  console.error(`verify:eas-env — could not read the '${ENVIRONMENT}' EAS environment.`);
  console.error(`Ran: ${eas.label} env:list ${ENVIRONMENT} --format long\n`);
  console.error(easFailureDetail(e));
  console.error('\nUsual causes: EXPO_TOKEN missing or expired (locally: `eas login`); `npm ci`');
  console.error('not run, so the app config plugins do not resolve; the CLI could not be fetched.');
  process.exit(1);
}

// `--format long` prints one "Name<whitespace>VALUE_NAME" line per variable.
const present = new Set(
  raw
    .split('\n')
    .map((l) => l.match(/^Name\s+(\S+)/))
    .filter(Boolean)
    .map((m) => m[1]),
);

if (present.size === 0) {
  console.error(`verify:eas-env — parsed ZERO variables out of \`eas env:list ${ENVIRONMENT}\`.`);
  console.error('The CLI output format probably changed; this check would pass vacuously, so it fails instead.');
  process.exit(1);
}

const missing = REQUIRED.filter((v) => !present.has(v.name));
const leaked = FORBIDDEN.filter((v) => present.has(v.name));

if (missing.length > 0 || leaked.length > 0) {
  console.error(`\nverify:eas-env FAILED for the '${ENVIRONMENT}' environment.\n`);
  for (const v of missing) console.error(`  MISSING    ${v.name}\n             → ${v.breaks}`);
  for (const v of leaked) console.error(`  MUST NOT BE SET  ${v.name}\n             → ${v.why}`);
  console.error(`\nFix: eas env:create --environment ${ENVIRONMENT} --name <NAME> --value <value> --visibility plaintext`);
  console.error('(plaintext is correct for EXPO_PUBLIC_* — it is inlined into the bundle either way.)\n');
  process.exit(1);
}

console.error(
  `✓ '${ENVIRONMENT}' EAS environment has all ${REQUIRED.length} required variables ` +
    `and none of the ${FORBIDDEN.length} forbidden (${present.size} set in total).`,
);
