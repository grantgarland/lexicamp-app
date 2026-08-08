// @ts-nocheck — jest mock-factory hoisting forbids identifiers inside the
// factories, so this file is excluded from tsc (see QuizScreen.test.tsx).
//
// Theme cache-invalidation audit (2026-08-04). Symptom: after a light↔dark
// switch, parts of an open screen kept the old mode until the screen was left
// and re-entered.
//
// Cause: two sources of truth. `theme/appearance.ts` applies the Unistyles theme
// itself (debounced, foreground-only) because adaptiveThemes flap-corrupts the
// ShadowTree on iOS — but ~15 call sites read RN's `useColorScheme()`, which has
// none of those guards and keeps whatever value the app-switcher snapshot flap
// left it on. It survives re-renders (the subscribed value never changes) and
// clears on remount (mounting re-reads `Appearance.getColorScheme()`), which is
// exactly the "stale until you navigate away and back" shape reported.
//
// So the test that matters flips the theme on an ALREADY-MOUNTED component. A
// fresh-mount test passes either way and proves nothing.

let mockTheme;

jest.mock('react-native-unistyles', () => {
  return {
    StyleSheet: {
      // Module-scope `StyleSheet.create` calls run at IMPORT time, before any
      // beforeEach sets `mockTheme` — fall back to the real light theme so a
      // component can be imported at all.
      create: (styles) => (typeof styles === 'function' ? styles(mockTheme ?? require('@/theme/theme').lightTheme) : styles),
      configure: () => {},
    },
    createUnistylesElement: (c) => c,
    useUnistyles: () => ({ theme: mockTheme }),
    UnistylesRuntime: { themeName: 'light', setTheme: jest.fn(), setRootViewBackgroundColor: () => {} },
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: (props) => props.children,
}));

import { render, screen } from '@testing-library/react-native';
import { readFileSync } from 'fs';
import { join } from 'path';

import { darkTheme, lightTheme } from '@/theme/theme';
import { useAppearanceStore } from '@/store/appearanceStore';
import { Wordmark } from '@/ui/Wordmark';

/** Move the app to a scheme the way `applyScheme` does: the Unistyles theme AND
 *  the store's `resolved` are two halves of one switch. */
const applyScheme = (scheme) => {
  mockTheme = scheme === 'dark' ? darkTheme : lightTheme;
  useAppearanceStore.getState().setResolved(scheme);
};

beforeEach(() => {
  applyScheme('light');
  useAppearanceStore.setState({ mode: 'system' });
});

describe('useIsDark', () => {
  it('reports the mode of the theme actually applied', () => {
    // One value, switched at one moment, by the code that owns the guards.
    expect(lightTheme.isDark).toBe(false);
    expect(darkTheme.isDark).toBe(true);
  });

  it('repaints a MOUNTED component when the theme flips under it', () => {
    // Wordmark swaps to the knockout lockup in dark mode. Same element, same
    // position ⇒ React updates the existing instance rather than remounting it,
    // which is the condition the bug survived.
    const { rerender } = render(<Wordmark width={200} />);
    const lightXml = screen.UNSAFE_getByType(require('react-native-svg').SvgXml).props.xml;

    applyScheme('dark');
    rerender(<Wordmark width={200} />);
    const darkXml = screen.UNSAFE_getByType(require('react-native-svg').SvgXml).props.xml;

    expect(darkXml).not.toBe(lightXml);
  });

  it('flips back on the return trip', () => {
    applyScheme('dark');
    const { rerender } = render(<Wordmark width={200} />);
    const darkXml = screen.UNSAFE_getByType(require('react-native-svg').SvgXml).props.xml;

    applyScheme('light');
    rerender(<Wordmark width={200} />);
    expect(screen.UNSAFE_getByType(require('react-native-svg').SvgXml).props.xml).not.toBe(darkXml);
  });
});

// The behavioral test above only covers the components it renders. This one
// covers the whole tree, and is the guard that actually holds: the bug was never
// a broken component, it was a second source of truth being reachable at all.
describe('no second source of truth for the color scheme', () => {
  it('leaves RN useColorScheme unused outside theme/', () => {
    const files = require('glob').sync('src/**/*.{ts,tsx}', { cwd: join(__dirname, '../../..'), absolute: true });
    const offenders = files
      .filter((f) => !f.includes('/__tests__/') && !f.includes('/src/theme/'))
      .filter((f) => /\buseColorScheme\b/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(f.indexOf('src/')));

    // If this fails: use `useIsDark()` from '@/theme/appearance' instead.
    // `useColorScheme()` tracks the raw Appearance event, NOT the theme the app
    // has actually applied, and the two diverge for the whole time a snapshot
    // flap leaves it stranded.
    expect(offenders).toEqual([]);
  });
});

// Unistyles applies theme changes by writing to native ShadowNodes rather than
// re-rendering, and it misses nodes: after a light↔dark flip some rows kept the
// previous canvas and some titles the previous ink. The cure is a REMOUNT, and
// the BOUNDARY was found by experiment on the simulator (2026-08-04):
//
//   ui/Screen (per-screen body) ....... did NOT fix it
//   (tabs)/_layout <Tabs> ............. did NOT fix it
//   app/_layout, above the Stack ...... fixed it, both directions
//
// So the key in app/_layout.tsx is load-bearing and is NOT a stylistic choice.
// This guard exists because it looks exactly like the kind of line someone
// "cleans up", and the two cheaper-looking places have already been tried.
describe('the theme remount boundary stays at the root', () => {
  it('keys the root layout on the applied scheme', () => {
    const src = readFileSync(join(__dirname, '../../app/_layout.tsx'), 'utf8');
    expect(src).toMatch(/useAppliedScheme\(\)/);
    expect(src).toMatch(/key=\{rebuildKey\}/);
  });

  it('defers the rebuild while a quiz holds unsaved ratings', () => {
    // Verified on the simulator: flipping appearance mid-session unmounted the
    // navigator, ejected the user to Home and discarded the batch (ratings only
    // persist on completion). iOS "Automatic" flips at sunset, so an evening
    // study session would lose its answers.
    const src = readFileSync(join(__dirname, '../../app/_layout.tsx'), 'utf8');
    expect(src).toMatch(/quizInProgress/);
    expect(src).toMatch(/quizBusy \|\| overlayOpen/);
    expect(src).toMatch(/!holdRebuild && rebuildKey !== scheme/);
  });

  it('also defers the rebuild while a sheet or dialog is open', () => {
    // Same class of bug, different victim: the rebuild resets the screen state
    // that says a sheet is open, so a scheme change threw an open sheet off
    // screen in one frame — no slide-down, user dumped back on the screen
    // behind it. Settings → Edit Profile hosts the appearance picker, so this
    // was the ordinary path, not an edge case (2026-08-08).
    const src = readFileSync(join(__dirname, '../../app/_layout.tsx'), 'utf8');
    expect(src).toMatch(/useOverlayOpen\(\)/);
  });

  it('does not re-add a key on Screen, which was measured not to work', () => {
    const src = readFileSync(join(__dirname, '../../ui/Screen.tsx'), 'utf8');
    expect(src).not.toMatch(/key=/);
  });
});
