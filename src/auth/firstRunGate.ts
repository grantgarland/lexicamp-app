// The first-run routing decision (3.5, spec `24`), as a pure function.
//
// Extracted from (tabs)/_layout.tsx because it is three-state logic that is
// invisible to typecheck, awkward to reach from a render test, and expensive to
// get wrong — a mistake here either strands a user in a redirect loop or flashes
// onboarding at someone who finished it months ago.
//
// The three states, and what distinguishes them:
//   no session          → 'value'  the one-screen pitch, which leads to auth
//   session, no profile → 'pair'   the language pair, which onboarding needs
//   session + profile   → 'app'    the tabs
//
// ⚠️ There is no trigger on `auth.users`, so no `profiles` row exists until
// `complete_onboarding` inserts one. That ABSENCE is the signal — not a flag.
export type FirstRunRoute = 'wait' | 'value' | 'pair' | 'app';

export interface FirstRunInput {
  /** Live backend? Mock mode keeps the old profile-flag behaviour so the Maestro
   *  suite still boots straight to Home (see .maestro/smoke.yaml's mode gate). */
  useSupabase: boolean;
  /** The async session restore from AsyncStorage is still in flight. */
  sessionLoading: boolean;
  hasSession: boolean;
  /** react-query `isPending` — no data has EVER loaded for this key. */
  profilePending: boolean;
  /** react-query `isFetching` — a request is in flight right now, which may be a
   *  refetch over stale cached data. */
  profileFetching: boolean;
  profile: { onboardingComplete: boolean } | null | undefined;
}

export function firstRunRoute(input: FirstRunInput): FirstRunRoute {
  const { useSupabase, sessionLoading, hasSession, profilePending, profileFetching, profile } = input;

  if (useSupabase) {
    if (sessionLoading) return 'wait'; // one frame while AsyncStorage restores
    if (!hasSession) return 'value';
    if (profilePending) return 'wait';

    if (profile == null) {
      // ⚠️ THE BUG THIS EXISTS TO PREVENT (found on device 2026-08-20, the pair
      // screen rendering twice). `isPending` is FALSE once any value is cached —
      // including a cached `null` from before onboarding. Right after
      // `complete_onboarding`, the profile query is INACTIVE (the tabs layout is
      // unmounted while the user is on the pair screen), so an
      // `invalidateQueries` there marks it stale WITHOUT refetching and resolves
      // instantly. Remounting the gate then read that stale `null` as a settled
      // answer and bounced the user straight back to the pair screen.
      //
      // A null that is currently being refetched is not an answer yet. The pair
      // screen also now forces an awaited refetch before it navigates — this is
      // the second line of defence, and the one that survives someone changing
      // the navigation.
      if (profileFetching) return 'wait';
      return 'pair';
    }
  }

  // Mock mode, and the belt-and-braces case for a row that exists but was never
  // finished (an interrupted legacy onboarding).
  if (profile != null && !profile.onboardingComplete) return 'pair';
  return 'app';
}
