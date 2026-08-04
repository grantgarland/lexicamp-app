// devStore persistence contract.
//
// Why this suite exists: `badgeHidden` is the ONLY field that survives a
// relaunch, and both halves of that statement are load-bearing.
//
//  • It MUST persist, because the only consumer that needs it —
//    `.maestro/capture-onboarding-shots.yaml` — relaunches the app. A
//    session-only flag would be back to `false` before the first screenshot and
//    the DEV pill would sit on top of the Home header in every piece of
//    onboarding art.
//  • userState/plan MUST NOT persist. They drive query keys, and in live mode
//    the scenario chip signs into a real account. A stale persisted scenario
//    would come back on the next launch describing a session that no longer
//    exists — the chips would claim `summit` while the app is signed in as
//    whoever GoTrue actually restored.
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useDevStore } from '../devStore';

const STORAGE_KEY = 'lexicamp-dev';

// zustand/persist writes on a microtask after set(); let it land.
const flush = () => new Promise((r) => setTimeout(r, 0));

async function persisted(): Promise<Record<string, unknown>> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw == null ? {} : ((JSON.parse(raw) as { state?: Record<string, unknown> }).state ?? {});
}

describe('devStore', () => {
  beforeEach(async () => {
    useDevStore.setState({ badgeHidden: false, userState: 'summit', plan: 'paid' });
    await AsyncStorage.removeItem(STORAGE_KEY);
  });

  test('badgeHidden defaults to visible', () => {
    expect(useDevStore.getState().badgeHidden).toBe(false);
  });

  test('setBadgeHidden flips it and the flag reaches storage', async () => {
    useDevStore.getState().setBadgeHidden(true);
    expect(useDevStore.getState().badgeHidden).toBe(true);
    await flush();
    expect((await persisted()).badgeHidden).toBe(true);
  });

  test('un-hiding persists too (the pill comes back after a relaunch)', async () => {
    useDevStore.getState().setBadgeHidden(true);
    await flush();
    useDevStore.getState().setBadgeHidden(false);
    await flush();
    expect((await persisted()).badgeHidden).toBe(false);
  });

  test('scenario + plan knobs are NOT persisted', async () => {
    useDevStore.getState().setUserState('bc');
    useDevStore.getState().setPlan('free');
    useDevStore.getState().setBadgeHidden(true); // force a write
    await flush();
    const state = await persisted();
    expect(state.badgeHidden).toBe(true);
    expect(state).not.toHaveProperty('userState');
    expect(state).not.toHaveProperty('plan');
  });
});
