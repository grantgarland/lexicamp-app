// The Settings appearance preference (2026-08-04): System / Light / Dark.
//
// The rule that matters is which input wins. 'system' follows the device; Light
// and Dark pin the app regardless of what the OS is doing — including across the
// app-switcher appearance flap, which is the whole reason this module debounces
// and gates on AppState in the first place. A pinned choice that drifted back to
// the device scheme on the next flap would look exactly like the bug this
// preference was added on top of.
// `theme/appearance` imports Unistyles, which is NitroModule-backed and has no
// native binary under jest. Only `UnistylesRuntime.setTheme` is touched here, and
// this test is about the preference math, not the applying.
jest.mock('react-native-unistyles', () => ({
  UnistylesRuntime: { themeName: 'light', setTheme: jest.fn() },
}));

import { Appearance } from 'react-native';
import { UnistylesRuntime } from 'react-native-unistyles';

import { effectiveScheme, startAppearanceSync, systemScheme } from '@/theme/appearance';
import { useAppearanceStore } from '@/store/appearanceStore';
import { useUiStore } from '@/store/uiStore';

let osScheme: 'light' | 'dark' = 'light';

beforeEach(() => {
  osScheme = 'light';
  jest.spyOn(Appearance, 'getColorScheme').mockImplementation(() => osScheme);
  useAppearanceStore.setState({ mode: 'system', resolved: 'light' });
});
afterEach(() => jest.restoreAllMocks());

describe('effectiveScheme', () => {
  it('follows the device on System', () => {
    expect(effectiveScheme('system')).toBe('light');
    osScheme = 'dark';
    expect(effectiveScheme('system')).toBe('dark');
  });

  it('pins Light regardless of the device', () => {
    osScheme = 'dark';
    expect(effectiveScheme('light')).toBe('light');
  });

  it('pins Dark regardless of the device', () => {
    osScheme = 'light';
    expect(effectiveScheme('dark')).toBe('dark');
  });

  it('treats an unknown OS scheme as light, like the rest of the app', () => {
    // Appearance.getColorScheme() can return null (no preference expressed).
    jest.spyOn(Appearance, 'getColorScheme').mockReturnValue(null);
    expect(systemScheme()).toBe('light');
    expect(effectiveScheme('system')).toBe('light');
  });
});

describe('appearance store', () => {
  it('defaults to following the system', () => {
    expect(useAppearanceStore.getState().mode).toBe('system');
  });

  it('persists the CHOICE but not the resolved scheme', () => {
    // `resolved` is derived from the device at every launch; a stored copy could
    // contradict it and would paint the wrong theme for one frame on cold start.
    const persist = (useAppearanceStore as unknown as { persist: { getOptions: () => { partialize: (s: unknown) => object } } }).persist;
    const kept = persist.getOptions().partialize({ mode: 'dark', resolved: 'dark' });
    expect(kept).toEqual({ mode: 'dark' });
  });

  it('reports dark only when the APPLIED scheme is dark', () => {
    // Choosing 'dark' is a request; `resolved` is the fact. They differ for the
    // instant between the tap and the theme actually being applied.
    useAppearanceStore.setState({ mode: 'dark', resolved: 'light' });
    expect(useAppearanceStore.getState().resolved === 'dark').toBe(false);
    useAppearanceStore.getState().setResolved('dark');
    expect(useAppearanceStore.getState().resolved === 'dark').toBe(true);
  });
});

// A quiz buffers its ratings in memory and only persists them on completion,
// while a scheme change rebuilds the app tree (see app/_layout.tsx). Applying one
// mid-session ejected the user to Home and threw the batch away — reproduced on
// the simulator, and iOS "Automatic" flips at sunset, so it is an evening-study
// path rather than an edge case. The whole switch therefore waits for the
// session: deferring only the rebuild left the quiz half-painted.
describe('a scheme change is held for the duration of a quiz', () => {
  const setQuiz = (v: boolean) => useUiStore.getState().setQuizInProgress(v);

  afterEach(() => setQuiz(false));

  it('does not switch the theme while a session holds unsaved ratings', () => {
    setQuiz(true);
    useAppearanceStore.setState({ mode: 'system', resolved: 'light' });
    osScheme = 'dark';

    const stop = startAppearanceSync();
    // Neither half of the switch may land: not the Unistyles theme...
    expect(UnistylesRuntime.setTheme).not.toHaveBeenCalled();
    // ...nor the published scheme the rebuild key reads.
    expect(useAppearanceStore.getState().resolved).toBe('light');
    stop();
  });

  it('applies the held scheme the moment the session ends', () => {
    setQuiz(true);
    useAppearanceStore.setState({ mode: 'system', resolved: 'light' });
    osScheme = 'dark';

    const stop = startAppearanceSync();
    expect(useAppearanceStore.getState().resolved).toBe('light');

    setQuiz(false);
    expect(UnistylesRuntime.setTheme).toHaveBeenCalledWith('dark');
    expect(useAppearanceStore.getState().resolved).toBe('dark');
    stop();
  });

  it('switches immediately when no session is running', () => {
    useAppearanceStore.setState({ mode: 'system', resolved: 'light' });
    osScheme = 'dark';
    const stop = startAppearanceSync();
    expect(useAppearanceStore.getState().resolved).toBe('dark');
    stop();
  });
});
