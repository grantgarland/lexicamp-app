// Dev-only state knobs (drives the mock data source so DevBadge can flip the app
// into any variant). The mock DataSource reads this via `useDevStore.getState()`;
// query keys include these values so toggling auto-refetches. Not used in prod.
import { create } from 'zustand';

/** 'empty' = brand-new user; the rest are mastery-tier scenarios (registry ids). */
export type DevUserState = 'empty' | 'bc' | 'abc' | 'hc' | 'sr' | 'summit';
export type DevPlan = 'free' | 'paid';

interface DevState {
  userState: DevUserState;
  plan: DevPlan;
  setUserState: (u: DevUserState) => void;
  setPlan: (p: DevPlan) => void;
}

export const useDevStore = create<DevState>((set) => ({
  userState: 'summit',
  plan: 'paid',
  setUserState: (userState) => set({ userState }),
  setPlan: (plan) => set({ plan }),
}));

export const USER_STATE_LABELS: { value: DevUserState; label: string }[] = [
  { value: 'empty', label: 'New' },
  { value: 'bc', label: 'Base Camp' },
  { value: 'abc', label: 'Adv. Base' },
  { value: 'hc', label: 'High Camp' },
  { value: 'sr', label: 'Summit Ridge' },
  { value: 'summit', label: 'Summit' },
];
