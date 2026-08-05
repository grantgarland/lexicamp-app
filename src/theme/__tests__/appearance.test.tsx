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

import React from 'react';
import { Text as RNText } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { readFileSync } from 'fs';
import { join } from 'path';

import { darkTheme, lightTheme } from '@/theme/theme';
import { Wordmark } from '@/ui/Wordmark';
import { Screen } from '@/ui/Screen';

beforeEach(() => {
  mockTheme = lightTheme;
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

    mockTheme = darkTheme;
    rerender(<Wordmark width={200} />);
    const darkXml = screen.UNSAFE_getByType(require('react-native-svg').SvgXml).props.xml;

    expect(darkXml).not.toBe(lightXml);
  });

  it('flips back on the return trip', () => {
    mockTheme = darkTheme;
    const { rerender } = render(<Wordmark width={200} />);
    const darkXml = screen.UNSAFE_getByType(require('react-native-svg').SvgXml).props.xml;

    mockTheme = lightTheme;
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

// Unistyles applies theme changes by writing to native ShadowNodes rather than by
// re-rendering, so any node missing from its ShadowRegistry never repaints — no
// matter how many times React renders it. Reproduced on the simulator
// (2026-08-04): after a cold launch in light mode, flipping to dark left the Home
// greeting and the How-it-works title rendering light-mode near-black ink on the
// dark canvas while everything around them switched. The only reliable cure is a
// REMOUNT, which re-registers every node — hence `Screen` keying its body on the
// theme. This test is what stops that key being "cleaned up" later.
describe('Screen remounts its body on a theme flip', () => {
  function Probe({ onMount }) {
    React.useEffect(() => onMount(), [onMount]);
    return <RNText>probe</RNText>;
  }

  it('rebuilds the subtree when light↔dark changes', () => {
    const onMount = jest.fn();
    // A FRESH element each time: React bails out of re-rendering a referentially
    // identical one, and the mocked `useUnistyles` is not real context, so it
    // would never notice the theme moved.
    const tree = () => (
      <Screen>
        <Probe onMount={onMount} />
      </Screen>
    );

    const { rerender } = render(tree());
    expect(onMount).toHaveBeenCalledTimes(1);

    mockTheme = darkTheme;
    rerender(tree());
    expect(onMount).toHaveBeenCalledTimes(2); // remounted, not merely re-rendered

    mockTheme = lightTheme;
    rerender(tree());
    expect(onMount).toHaveBeenCalledTimes(3);
  });

  it('does NOT remount on an unrelated re-render', () => {
    // The key must track the theme and nothing else, or every render churns the
    // screen and loses scroll position.
    const onMount = jest.fn();
    const tree = () => (
      <Screen>
        <Probe onMount={onMount} />
      </Screen>
    );
    const { rerender } = render(tree());
    rerender(tree());
    rerender(tree());
    expect(onMount).toHaveBeenCalledTimes(1);
  });
});
