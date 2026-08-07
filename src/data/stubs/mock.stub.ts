// Live-build stand-in for `src/data/mock.ts`.
//
// Metro substitutes this file for the mock DataSource whenever
// EXPO_PUBLIC_USE_SUPABASE=1 — see `metro/excludedModules.js`. Nothing imports it
// directly; the swap happens at resolution time, so `import { mockDataSource }
// from './mock'` in `src/data/index.ts` lands here.
//
// What that removes from a live bundle: the whole scenario fixture set — the
// 60-word bank, the quiz session, the deck fixtures and their membership
// strides, the reserved lookup tokens (MOCK_MISS / MOCK_ECHO), the seeded
// profile — none of which a build talking to Supabase can ever reach, because
// `dataSource` resolves to `supabaseDataSource` in the same expression that
// mentions this one.
//
// ⚠️ EXPORT SHAPE: only `mockDataSource`, because that is all `src/data/index.ts`
// imports. `SMOKE_FIXTURES` / `FLY_EXAMPLE` are read exclusively by jest suites,
// and jest resolves the REAL module (this swap is Metro's, not Jest's), so they
// deliberately have no stand-in here. If app code ever imports one of them, add
// it here in the same commit or the live build breaks at import time.
import type { DataSource } from '../DataSource';

/**
 * Throws on any method access rather than returning empty data.
 *
 * A silent no-op source would surface as an app that renders zero words and no
 * due cards — indistinguishable from a real empty account, and diagnosed by
 * whoever finds it days later. This fails at the call site with the reason.
 *
 * Reaching it at all means `src/data/index.ts` picked the mock in a build where
 * the mock was stripped, i.e. `USE_SUPABASE` disagreed at runtime with the
 * EXPO_PUBLIC_USE_SUPABASE Metro saw at build time.
 */
export const mockDataSource: DataSource = new Proxy({} as DataSource, {
  get(_target, property) {
    // Symbols are how a runtime INSPECTS a value (Symbol.toPrimitive,
    // toStringTag, and `then` when something is awaited). Answering those with
    // `undefined` keeps an incidental console.log or promise-unwrap from
    // throwing a confusing error that has nothing to do with the real problem.
    if (typeof property === 'symbol') return undefined;
    throw new Error(
      `mockDataSource.${property}() was called, but the mock DataSource is not bundled in this build ` +
        `(EXPO_PUBLIC_USE_SUPABASE=1 strips it — see metro/excludedModules.js). ` +
        `Something selected the mock source in a live build.`,
    );
  },
});
