// Modules that must NOT reach a shipped JS bundle, and the stubs Metro
// substitutes for them.
//
// WHY A BUILD-TIME SWAP AND NOT A RUNTIME GUARD (2026-08-06):
// `src/app/_layout.tsx` has always rendered the DEV badge behind
// `{__DEV__ ? <DevBadge /> : null}`, so it is INVISIBLE in a release build. That
// is a runtime guard, and it does nothing about the bundle: the module is still
// imported at the top of the file, so Metro walks it, and every line of it ships
// to the App Store. Metro collects `require`/`import` edges SYNTACTICALLY — it
// does not matter that the only call site is inside a branch the minifier later
// proves dead, and moving the import into `if (__DEV__) { require(...) }` does
// not help for the same reason. (CLAUDE.md already warns about this: "Metro
// resolves require() statically".) The same is true of
// `USE_SUPABASE ? supabaseDataSource : mockDataSource`.
//
// So the swap happens at RESOLUTION time: for the builds listed below the real
// file never enters the module graph at all, and the stub takes its place.
//
// ── The two axes, and why they are separate ─────────────────────────────────
//
// DEV_ONLY — keyed on Metro's per-bundle `dev` flag (the same thing the bundle
// sees as `__DEV__`). The DEV badge belongs here: it is for developers, in every
// mode, and no shipped build of any profile should carry it.
//
// What its inclusion actually leaked, before this existed: the scenario
// switcher's UI, the names of the `is_dev`-guarded RPCs it calls
// (`set_dev_plan`, `reset_dev_scenario`, `seed_dev_veteran`), the
// `dev-<scenario>@lexicamp.app` account convention, and
// `process.env.EXPO_PUBLIC_DEV_SCENARIO_PASSWORD` — which Expo INLINES at build
// time, so on any build whose env carried that value the seeded-account password
// was a literal string in the shipped bundle. None of it reachable; all of it
// readable.
//
// LIVE_ONLY — keyed on `EXPO_PUBLIC_USE_SUPABASE`, NOT on `dev`. The mock
// DataSource belongs here and could not use the `dev` axis: the `smoke` EAS
// profile builds a RELEASE bundle that runs entirely on the mock
// (EXPO_PUBLIC_USE_SUPABASE=0), and it is what the nightly Maestro suite tests.
// Keying the mock on `dev` would have stripped the data layer out from under
// that whole suite. The right question for the mock is not "is this a dev
// build?" but "is this build going to talk to Supabase?".
//
// ⚠️ THE DEFAULT MATTERS. `useSupabase` is true only on an explicit '1', so a
// build where Metro cannot see the variable keeps the mock — the app works and
// the bundle is merely larger. The opposite default would produce a build that
// boots into a stubbed data source, which is a far worse failure than a fat
// bundle.
//
// ADDING A MODULE: put the source path in the right table with a stub whose
// exports match the real module's. The stub must live OUTSIDE `src/app/`:
// expo-router builds its route table from a `require.context` over that
// directory, so a stub placed there would register as its own route.
const path = require('node:path');

/** Stripped from every non-dev bundle. repo-relative source → repo-relative stub. */
const DEV_ONLY_MODULES = {
  'src/dev/DevBadge.tsx': 'src/dev/stubs/DevBadge.stub.tsx',
};

/** Stripped whenever the build talks to Supabase (EXPO_PUBLIC_USE_SUPABASE=1). */
const LIVE_ONLY_MODULES = {
  'src/data/mock.ts': 'src/data/stubs/mock.stub.ts',
};

/** Normalise to repo-relative POSIX so the tables above are platform-agnostic. */
function toKey(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join('/');
}

/**
 * The stub that should replace `filePath`, or null to resolve it normally.
 *
 * @param dev          Metro's per-bundle dev flag — what `__DEV__` will be.
 * @param useSupabase  Whether this build runs against the live backend.
 */
function stubFor({ projectRoot, filePath, dev, useSupabase }) {
  const key = toKey(projectRoot, filePath);
  const stub = (!dev && DEV_ONLY_MODULES[key]) || (useSupabase && LIVE_ONLY_MODULES[key]) || null;
  return stub == null ? null : path.join(projectRoot, stub);
}

/** Reads the live-backend flag the same way `src/data/index.ts` does. */
function isLiveBuild(env = process.env) {
  return env.EXPO_PUBLIC_USE_SUPABASE === '1';
}

module.exports = { DEV_ONLY_MODULES, LIVE_ONLY_MODULES, isLiveBuild, stubFor };
