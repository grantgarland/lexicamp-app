#!/usr/bin/env node
// Proves the DEV scenario switcher is absent from a real production bundle.
//
// WHY A BUNDLE GREP AND NOT A UNIT TEST: metro/__tests__/excludedModules.test.js
// checks the DECISION (given a file and a dev flag, which file loads). It cannot
// see whether metro.config.js still wires that decision up, whether an upgrade
// changed `resolveRequest`'s contract, or whether someone re-imported the badge
// from a module that is not on the list. Only the artifact can answer that, so
// this exports one with `expo export` and searches the Hermes bytecode's string
// table for text that exists nowhere but the dev surface.
//
// Run: npm run verify:bundle   (~1-2 min — it is a full production export)
//
// The markers are deliberately specific. `dev` or `mock` alone would false-
// positive on ordinary copy; these are strings that only the badge or its
// scenario vocabulary can produce. If a marker's source text is legitimately
// renamed, update it HERE in the same commit — a marker that no longer exists
// anywhere makes this check silently vacuous, which the self-check below
// catches by requiring each one to be present in the source tree.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/** Strings that must NOT appear in a production bundle, and where they come from.
 *  Two families: the DEV badge (stripped from every non-dev bundle) and the mock
 *  DataSource (stripped when EXPO_PUBLIC_USE_SUPABASE=1). See
 *  metro/excludedModules.js for why those axes differ. */
const FORBIDDEN = [
  { text: 'reset_dev_scenario', from: 'DevBadge — is_dev-guarded RPC name' },
  { text: 'set_dev_plan', from: 'DevBadge — is_dev-guarded RPC name' },
  { text: 'seed_dev_veteran', from: 'DevBadge — is_dev-guarded RPC name' },
  { text: 'Hide badge', from: 'DevBadge — screenshot chip label' },
  { text: 'Dev state toggle', from: 'DevBadge — the pill a11y label' },
  { text: 'Dismiss dev panel', from: 'DevBadge — panel scrim a11y label' },
  { text: 'Scenario account', from: 'DevBadge — live-mode section label' },
  { text: 'Veteran 4k', from: 'DevBadge — scenario chip label' },
  // The mock DataSource, stripped whenever EXPO_PUBLIC_USE_SUPABASE=1 (which is
  // what this script exports with). These are reserved lookup tokens and seeded
  // fixture values — a live build has no use for any of them.
  { text: 'fly123456', from: 'data/mock — MOCK_MISS reserved token' },
  { text: 'echoword', from: 'data/mock — MOCK_ECHO reserved token' },
  { text: 'fluent-marmot', from: 'data/mock — seeded profile username' },
  { text: 'q_serendipity', from: 'data/mock — QUIZ_SESSION fixture id' },
  { text: 'd_favorites', from: 'data/mock — DECK_FIXTURES id' },
];

// ⚠️ MARKERS MUST BE UNIQUE TO THE DEV SURFACE, not merely typical of it. The
// first draft of this list included "Adv. Base" — a scenario chip label — and it
// failed against a correctly-stubbed bundle, because it is also a prefix of the
// real tier name "Adv. Base Camp" (theme/tiers.ts, en.json) that every build
// legitimately ships. Prefer RPC names and a11y labels: strings the product
// itself has no reason to contain.

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) out.push(full);
  }
  return out;
}

// Self-check: every marker must still exist SOMEWHERE in the source, or this
// script is asserting the absence of text that was renamed out of existence.
const sources = walk(join(ROOT, 'src')).map((f) => readFileSync(f, 'utf8')).join('\n');
const orphans = FORBIDDEN.filter((m) => !sources.includes(m.text));
if (orphans.length > 0) {
  console.error(
    `✗ These markers no longer exist in src/, so checking for them proves nothing:\n` +
      orphans.map((m) => `    "${m.text}"  (${m.from})`).join('\n') +
      `\n  Update FORBIDDEN in scripts/verify-production-bundle.mjs to match the new text.`,
  );
  process.exit(1);
}

const outDir = mkdtempSync(join(tmpdir(), 'lexicamp-bundle-'));
try {
  console.log('Exporting a production iOS bundle (this is a real export, give it a minute)…');
  execFileSync(
    'npx',
    ['expo', 'export', '--platform', 'ios', '--output-dir', outDir],
    // USE_SUPABASE=1 mirrors the `production` EAS profile. EXPO_NO_DOTENV keeps
    // a developer's .env.local out of the artifact under test.
    { cwd: ROOT, stdio: 'inherit', env: { ...process.env, EXPO_NO_DOTENV: '1', EXPO_PUBLIC_USE_SUPABASE: '1' } },
  );

  const found = [];
  const stack = [outDir];
  const files = [];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (/\.(hbc|js|json)$/.test(e.name)) files.push(full);
    }
  }
  if (files.length === 0) throw new Error(`No bundle found under ${outDir}`);

  for (const file of files) {
    // Hermes bytecode keeps its strings in a table; reading as latin1 finds them
    // without needing `strings(1)`.
    const contents = readFileSync(file, 'latin1');
    for (const marker of FORBIDDEN) {
      if (contents.includes(marker.text)) found.push({ ...marker, file: file.slice(outDir.length + 1) });
    }
  }

  const totalMb = (files.reduce((n, f) => n + statSync(f).size, 0) / 1e6).toFixed(1);
  if (found.length > 0) {
    console.error(`\n✗ DEV-ONLY CONTENT IS IN THE PRODUCTION BUNDLE (${files.length} files, ${totalMb} MB):`);
    for (const f of found) console.error(`    "${f.text}"  ${f.from}\n      → ${f.file}`);
    console.error(
      `\n  The badge is meant to be swapped for a stub at resolution time.\n` +
        `  Check metro.config.js still installs resolveRequest, and that whatever\n` +
        `  module re-introduced these strings is listed in metro/excludedModules.js.`,
    );
    process.exit(1);
  }
  console.log(`\n✓ No dev-only markers in the production bundle (${files.length} files, ${totalMb} MB scanned).`);
} finally {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
}
