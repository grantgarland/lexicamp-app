// firstRunRoute — the first-run routing decision (3.5, spec `24`).
//
// Worth exhausting because both failure modes are silent and expensive: a wrong
// answer either strands the user in a redirect loop or flashes onboarding at
// someone who finished it long ago. The regression case found on device
// (the pair screen rendering twice) has its own test at the bottom.
import { firstRunRoute, type FirstRunInput } from '../firstRunGate';

const ONBOARDED = { onboardingComplete: true };
const UNFINISHED = { onboardingComplete: false };

/** A settled, signed-in, onboarded live-backend user. Override per case. */
function input(over: Partial<FirstRunInput> = {}): FirstRunInput {
  return {
    useSupabase: true,
    sessionLoading: false,
    hasSession: true,
    profilePending: false,
    profileFetching: false,
    profile: ONBOARDED,
    ...over,
  };
}

describe('firstRunRoute — live backend', () => {
  it('waits while the session is still restoring from AsyncStorage', () => {
    // Deciding early here flashes onboarding at every returning user on cold start.
    expect(firstRunRoute(input({ sessionLoading: true, hasSession: false }))).toBe('wait');
  });

  it('sends a signed-out user to the value screen', () => {
    expect(firstRunRoute(input({ hasSession: false, profile: null }))).toBe('value');
  });

  it('waits while the profile has never loaded', () => {
    expect(firstRunRoute(input({ profilePending: true, profile: undefined }))).toBe('wait');
  });

  it('sends a signed-in user with no profile to the pair screen', () => {
    // No trigger on auth.users → no row until complete_onboarding inserts one.
    expect(firstRunRoute(input({ profile: null }))).toBe('pair');
  });

  it('lets a signed-in, onboarded user into the app', () => {
    expect(firstRunRoute(input())).toBe('app');
  });

  it('routes a row that exists but was never finished to the pair screen', () => {
    expect(firstRunRoute(input({ profile: UNFINISHED }))).toBe('pair');
  });
});

describe('firstRunRoute — the cached-null regression (device, 2026-08-20)', () => {
  it('does NOT treat a null that is being refetched as a settled answer', () => {
    // THE BUG: after complete_onboarding, the profile query is inactive (tabs are
    // unmounted while the user is on the pair screen), so invalidateQueries marked
    // it stale without refetching. Remounting the gate read the stale cached null —
    // isPending is false once anything is cached — and redirected back to the pair
    // screen, which is why it rendered twice.
    expect(firstRunRoute(input({ profile: null, profileFetching: true }))).toBe('wait');
  });

  it('still routes to pair once that refetch settles on null', () => {
    // The guard must not swallow the genuine case: a real un-onboarded user whose
    // fetch has finished belongs on the pair screen, not parked on a blank frame.
    expect(firstRunRoute(input({ profile: null, profileFetching: false }))).toBe('pair');
  });

  it('lets the user through once the refetch returns the real profile', () => {
    expect(firstRunRoute(input({ profile: ONBOARDED, profileFetching: false }))).toBe('app');
  });
});

describe('firstRunRoute — mock mode', () => {
  // The Maestro suite depends on this: mock getProfile() always returns
  // onboardingComplete=true, which is what boots smoke.yaml straight to Home.
  it('boots straight to the app with no session at all', () => {
    expect(
      firstRunRoute(input({ useSupabase: false, hasSession: false, profile: ONBOARDED })),
    ).toBe('app');
  });

  it('still honours an unfinished profile flag', () => {
    expect(
      firstRunRoute(input({ useSupabase: false, hasSession: false, profile: UNFINISHED })),
    ).toBe('pair');
  });

  it('does not gate on the live-backend session checks', () => {
    // sessionLoading is meaningless without USE_SUPABASE; it must not strand mock.
    expect(
      firstRunRoute(input({ useSupabase: false, sessionLoading: true, profile: ONBOARDED })),
    ).toBe('app');
  });
});
