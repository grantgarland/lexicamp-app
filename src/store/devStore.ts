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
   *  above, because the thing that needs it is `.maestro/capture-onboarding-shots
   *  .yaml`: the flow relaunches the app, so a session-only flag would be back to
   *  `false` before the first screenshot and the pill would sit on top of the
   *  Home header in every piece of onboarding art. Hiding the pill does NOT
   *  remove its hit target — see DevBadge for how you get it back. */
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

export const USER_STATE_LABELS: { value: DevUserState; label: string; mockOnly?: true }[] = [
  { value: 'empty', label: 'New' },
  { value: 'bc', label: 'Base Camp' },
  { value: 'abc', label: 'Adv. Base' },
  { value: 'hc', label: 'High Camp' },
  { value: 'sr', label: 'Summit Ridge' },
  { value: 'summit', label: 'Summit' },
  // MOCK ONLY. Live mode switches scenarios by signing into a seeded
  // `dev-<scenario>@lexicamp.app` account, and there is no dev-veteran: seeding
  // one means 4,300 real cards, and therefore 4,300 gate-approved
  // translations_cache rows, in the production database. The fixture exists to
  // exercise the late-stage UI, which the mock source does offline and
  // deterministically — so the chip is hidden in live mode rather than offering
  // a sign-in that can only fail. (DevBadge filters on this flag.)
  { value: 'veteran', label: 'Veteran 3k', mockOnly: true },
];
