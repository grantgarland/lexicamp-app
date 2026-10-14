#!/usr/bin/env node
// Marketing-version bump for the iOS release workflow (release-ios.yml).
//
// WHY: App Store Connect closes a version's "train" once that version is
// approved. Build 17 (2026-10-14) was rejected with ITMS-90186/ITMS-90062 because
// it was still 1.0.0 after 1.0.0 had been approved. EAS (appVersionSource:
// remote) only auto-increments the BUILD number; the marketing version
// (CFBundleShortVersionString) is `expo.version` here, and nothing bumped it.
//
// Usage: node scripts/bump-version.js <patch|minor|major|none>
//   Rewrites expo.version in app.json in place (formatting untouched) and
//   prints the resulting version. `none` changes nothing. It exists for
//   re-submitting a version Apple has NOT approved yet, where the train is
//   still open and only the build number needs to move.
//   Inside GitHub Actions it also writes `version=` and `changed=` to
//   $GITHUB_OUTPUT.
//
// Plain CommonJS on purpose: jest requires it directly (see
// scripts/__tests__/bumpVersion.test.js), like metro/excludedModules.js.
const fs = require('node:fs');
const path = require('node:path');

const BUMPS = ['patch', 'minor', 'major', 'none'];
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** Next marketing version. Strict X.Y.Z only, because App Store Connect
 *  compares CFBundleShortVersionString numerically per component, and a
 *  pre-release suffix would be rejected there anyway. */
function nextVersion(current, bump) {
  if (!BUMPS.includes(bump)) throw new Error(`bump must be one of ${BUMPS.join('|')}, got "${bump}"`);
  const m = SEMVER.exec(current);
  if (!m) throw new Error(`expo.version "${current}" is not plain X.Y.Z`);
  const [major, minor, patch] = m.slice(1).map(Number);
  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      return current;
  }
}

/** Replace expo.version in the raw app.json text, touching nothing else so the
 *  release commit diff is exactly one line. */
function rewriteAppJson(text, from, to) {
  const pattern = new RegExp(`("version"\\s*:\\s*")${from.replace(/\./g, '\\.')}(")`);
  if (JSON.parse(text).expo.version !== from || !pattern.test(text)) {
    throw new Error(`could not locate "version": "${from}" in app.json`);
  }
  const out = text.replace(pattern, `$1${to}$2`);
  if (JSON.parse(out).expo.version !== to) throw new Error('rewrite did not land on expo.version');
  return out;
}

function main() {
  const bump = process.argv[2];
  const file = path.join(__dirname, '..', 'app.json');
  const text = fs.readFileSync(file, 'utf8');
  const current = JSON.parse(text).expo.version;
  const next = nextVersion(current, bump);
  if (next !== current) fs.writeFileSync(file, rewriteAppJson(text, current, next));
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${next}\nchanged=${next !== current}\n`);
  }
  console.log(next);
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(`✖ ${e.message}`);
    process.exit(1);
  }
}

module.exports = { nextVersion, rewriteAppJson };
