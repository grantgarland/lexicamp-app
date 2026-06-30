// Dev-only app-state harness. Lets the floating DevBadge toggle the core states
// (plan, user tier) so every screen variant can be exercised without real data.
// The provider is harmless in production (just supplies defaults); the badge that
// mutates it is gated to __DEV__.
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';

export type Plan = 'free' | 'paid';
/** 'empty' = brand-new user; the rest are mastery tiers (registry ids). */
export type UserState = 'empty' | 'bc' | 'abc' | 'hc' | 'sr' | 'summit';

export const USER_STATE_LABELS: { value: UserState; label: string }[] = [
  { value: 'empty', label: 'New' },
  { value: 'bc', label: 'Base Camp' },
  { value: 'abc', label: 'Adv. Base' },
  { value: 'hc', label: 'High Camp' },
  { value: 'sr', label: 'Summit Ridge' },
  { value: 'summit', label: 'Summit' },
];

interface DevConfigValue {
  plan: Plan;
  userState: UserState;
  setPlan: (p: Plan) => void;
  setUserState: (u: UserState) => void;
}

const DevConfigContext = createContext<DevConfigValue | null>(null);

export function DevConfigProvider({ children }: { children: ReactNode }) {
  const [plan, setPlan] = useState<Plan>('paid');
  const [userState, setUserState] = useState<UserState>('summit');
  const value = useMemo<DevConfigValue>(() => ({ plan, userState, setPlan, setUserState }), [plan, userState]);
  return <DevConfigContext.Provider value={value}>{children}</DevConfigContext.Provider>;
}

export function useDevConfig(): DevConfigValue {
  const ctx = useContext(DevConfigContext);
  if (ctx == null) throw new Error('useDevConfig must be used within DevConfigProvider');
  return ctx;
}
