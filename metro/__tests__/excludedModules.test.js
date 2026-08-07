// Guards the module swap (metro/excludedModules.js) — what keeps the DEV
// scenario switcher out of App Store bundles and the mock DataSource out of
// live ones.
//
// This suite covers the DECISION only: given a resolved file, a dev flag and a
// backend flag, which file should Metro actually load. It cannot prove the
// shipped bundle is clean, because that depends on metro.config.js wiring the
// function up at all — that half is `npm run verify:bundle`, which exports a
// real production bundle and greps it. Keep both: this one fails in
// milliseconds on a bad edit, the other proves the outcome.
const fs = require('node:fs');
const path = require('node:path');
const { describe, expect, it } = require('@jest/globals');

const { DEV_ONLY_MODULES, LIVE_ONLY_MODULES, isLiveBuild, stubFor } = require('../excludedModules');

const ROOT = path.resolve(path.dirname(require.resolve('../excludedModules')), '..');
const abs = (p) => path.join(ROOT, p);

const BADGE = 'src/dev/DevBadge.tsx';
const MOCK = 'src/data/mock.ts';

describe('excluded module swap', () => {
  it('has both modules registered (guard is guarding)', () => {
    expect(DEV_ONLY_MODULES[BADGE]).toBe('src/dev/stubs/DevBadge.stub.tsx');
    expect(LIVE_ONLY_MODULES[MOCK]).toBe('src/data/stubs/mock.stub.ts');
  });

  it('every registered source and stub exists, and no stub lives in src/app', () => {
    for (const table of [DEV_ONLY_MODULES, LIVE_ONLY_MODULES]) {
      for (const [source, stub] of Object.entries(table)) {
        expect(fs.existsSync(abs(source))).toBe(true);
        expect(fs.existsSync(abs(stub))).toBe(true);
        // expo-router builds its route table from a require.context over
        // src/app, so a stub placed there would register as a route of its own.
        expect(stub.startsWith('src/app/')).toBe(false);
      }
    }
  });

  // ── The DEV axis: the badge, keyed on the bundle's dev flag ────────────────
  it('swaps the DEV badge in any non-dev bundle, live or mock', () => {
    for (const useSupabase of [true, false]) {
      expect(stubFor({ projectRoot: ROOT, filePath: abs(BADGE), dev: false, useSupabase })).toBe(
        abs('src/dev/stubs/DevBadge.stub.tsx'),
      );
    }
  });

  it('keeps the DEV badge in a dev bundle, live or mock', () => {
    for (const useSupabase of [true, false]) {
      expect(stubFor({ projectRoot: ROOT, filePath: abs(BADGE), dev: true, useSupabase })).toBeNull();
    }
  });

  // ── The LIVE axis: the mock source, keyed on the backend flag ─────────────
  // NOT on `dev`: the `smoke` EAS profile is a RELEASE build that runs entirely
  // on the mock, and the nightly Maestro suite is what tests it. Stripping the
  // mock from non-dev bundles would delete the data layer out from under it.
  it('swaps the mock DataSource in a live build, dev or not', () => {
    for (const dev of [true, false]) {
      expect(stubFor({ projectRoot: ROOT, filePath: abs(MOCK), dev, useSupabase: true })).toBe(
        abs('src/data/stubs/mock.stub.ts'),
      );
    }
  });

  it('keeps the mock DataSource in a mock build, RELEASE included', () => {
    for (const dev of [true, false]) {
      expect(stubFor({ projectRoot: ROOT, filePath: abs(MOCK), dev, useSupabase: false })).toBeNull();
    }
  });

  // ── The env read, and its failure direction ───────────────────────────────
  it('treats only an explicit "1" as a live build', () => {
    expect(isLiveBuild({ EXPO_PUBLIC_USE_SUPABASE: '1' })).toBe(true);
    for (const value of ['0', '', 'true', 'yes', undefined]) {
      expect(isLiveBuild({ EXPO_PUBLIC_USE_SUPABASE: value })).toBe(false);
    }
  });

  it('defaults to KEEPING the mock when the variable is absent', () => {
    // The safe direction. A build that cannot see the flag ships a bigger
    // bundle; the opposite default would ship an app that boots into a stubbed
    // data source.
    expect(stubFor({ projectRoot: ROOT, filePath: abs(MOCK), dev: false, useSupabase: isLiveBuild({}) })).toBeNull();
  });

  // ── General safety ────────────────────────────────────────────────────────
  it('does not touch ordinary app modules on either axis', () => {
    for (const dev of [true, false]) {
      for (const useSupabase of [true, false]) {
        for (const file of ['src/app/_layout.tsx', 'src/data/supabase/SupabaseDataSource.ts', 'src/store/devStore.ts']) {
          expect(stubFor({ projectRoot: ROOT, filePath: abs(file), dev, useSupabase })).toBeNull();
        }
      }
    }
  });

  it('does not swap a stub for itself (no resolution loop)', () => {
    expect(
      stubFor({ projectRoot: ROOT, filePath: abs('src/dev/stubs/DevBadge.stub.tsx'), dev: false, useSupabase: true }),
    ).toBeNull();
    expect(
      stubFor({ projectRoot: ROOT, filePath: abs('src/data/stubs/mock.stub.ts'), dev: false, useSupabase: true }),
    ).toBeNull();
  });

  it('matches on the resolved path, not the import spelling', () => {
    // `@/dev/DevBadge`, `../dev/DevBadge` and an absolute path all resolve to
    // the same file — which is why metro.config.js resolves FIRST and asks
    // afterwards. A same-named file outside the project must never match.
    expect(
      stubFor({ projectRoot: ROOT, filePath: '/somewhere/else/src/dev/DevBadge.tsx', dev: false, useSupabase: true }),
    ).toBeNull();
  });
});
