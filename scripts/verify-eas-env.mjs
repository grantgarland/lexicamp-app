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
let raw;
try {
  raw = execFileSync('npx', ['eas', 'env:list', ENVIRONMENT, '--format', 'long'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (e) {
  console.error(`verify:eas-env — could not read the '${ENVIRONMENT}' EAS environment.`);
  console.error('Needs EXPO_TOKEN (or an interactive `eas login`).');
  console.error(String(e.stderr ?? e.message).trim().split('\n').slice(0, 4).join('\n'));
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
