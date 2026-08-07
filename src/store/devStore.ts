// Dev-only state knobs (drives the mock data source so DevBadge can flip the app
// into any variant). The mock DataSource reads this via `useDevStore.getState()`;
// query keys include these values so toggling auto-refetches. Not used in prod.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** 'empty' = brand-new user; the rest are mastery-tier scenarios (registry ids).
 *  'veteran' is the one that is NOT a tier: a library PAST the summit (3,000+
 *  mastered), for validating the late-stage experience — projection horizons,
 *  the mastery forecast, list performance and any copy that assumes the summit
 *  is still ahead of you. */
export type DevUserState = 'empty' | 'bc' | 'abc' | 'hc' | 'sr' | 'summit' | 'veteran';
export type DevPlan = 'free' | 'paid';

interface DevState {
  userState: DevUserState;
  plan: DevPlan;
  /** Hide the floating DEV pill (see dev/DevBadge). PERSISTED, unlike the knobs
   *  above: it is used when cutting the onboarding instructional screenshots, and
   *  the pill sits on top of the Home header in every one of them. A
   *  session-only flag would be back to `false` after the first relaunch, i.e.
   *  part-way through a capture session. Hiding the pill does NOT remove its hit
   *  target — see DevBadge for how you get it back. */
  badgeHidden: boolean;
  setUserState: (u: DevUserState) => void;
  setPlan: (p: DevPlan) => void;
  setBadgeHidden: (v: boolean) => void;
}

export const useDevStore = create<DevState>()(
  persist(
    (set) => ({
      userState: 'summit',
      plan: 'paid',
      badgeHidden: false,
      setUserState: (userState) => set({ userState }),
      setPlan: (plan) => set({ plan }),
      setBadgeHidden: (badgeHidden) => set({ badgeHidden }),
    }),
    {
      name: 'lexicamp-dev',
      storage: createJSONStorage(() => AsyncStorage),
      // ONLY the badge flag persists. userState/plan deliberately do not: they
      // drive query keys and (in live mode) which account is signed in, and a
      // stale persisted scenario would silently contradict the real session on
      // the next launch. They reset to the defaults above every time.
      partialize: (s) => ({ badgeHidden: s.badgeHidden }),
    },
  ),
);

// Every scenario here has BOTH a mock fixture and a live
// `dev-<scenario>@lexicamp.app` account, so the chips behave identically in
// either mode. `veteran` was mock-only until 2026-08-05 — a live one looked to
// need 4,300 gate-approved translations_cache rows in production, which is not
// a trade worth making for a fixture. It is live now because the cards carry
// their own mocked pair in custom_front/custom_back (see the
// dev_veteran_4k_library migration), so the shared dictionary stays untouched.
export const USER_STATE_LABELS: { value: DevUserState; label: string }[] = [
  { value: 'empty', label: 'New' },
  { value: 'bc', label: 'Base Camp' },
  { value: 'abc', label: 'Adv. Base' },
  { value: 'hc', label: 'High Camp' },
  { value: 'sr', label: 'Summit Ridge' },
  { value: 'summit', label: 'Summit' },
  { value: 'veteran', label: 'Veteran 4k' },
];
