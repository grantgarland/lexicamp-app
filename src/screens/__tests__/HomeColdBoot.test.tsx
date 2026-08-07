// @ts-nocheck — jest mock-factory hoisting forbids identifiers in factories.
//
// COLD-BOOT guard for Home (2026-08-05).
//
// The hole: the nightly Maestro smoke has been red since 3cdb738 — 40+ commits —
// with both smoke.yaml and word-capture.yaml dying on their FIRST assertion,
// `'(?i)Word Mastery'`, after the full 20s wait. No crash, no ANR, app alive in
// logcat. Every existing guard passed the whole time:
//   maestroStrings   — `masteryCard.eyebrow` exists in en.json and is referenced.
//   a11yCollapse     — the eyebrow is a plain RNText sibling, not collapsed.
//   maestroScreens   — renders Progress and Search, and mocks `@/query/hooks`
//                      WHOLESALE, so it cannot see a data-layer boot problem.
// That last one is the gap this file closes. maestroScreens says so itself:
// "Home / Word List / Settings are not rendered here either — add them the same
// way when one of them next drifts." Home has now drifted.
//
// What makes this different from every other screen test in the repo: it does
// NOT mock @/query/hooks. It boots the REAL hook graph against the REAL mock
// DataSource through a REAL QueryClient with an empty cache — which is what
// `launchApp: clearState: true` actually produces on the emulator. If Home
// cannot reach its first paint from a cold cache, this fails in 2 seconds
// locally instead of 20 minutes into a nightly.
jest.mock('react-native-unistyles', () => {
  const { lightTheme } = require('@/theme/theme');
  return {
    StyleSheet: {
      create: (styles) => (typeof styles === 'function' ? styles(lightTheme) : styles),
      configure: () => {},
    },
    createUnistylesElement: (c) => c,
    useUnistyles: () => ({ theme: lightTheme }),
    UnistylesRuntime: { setRootViewBackgroundColor: () => {} },
  };
});

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  const builder = () => {
    const b = {};
    const chain = () => b;
    b.duration = chain;
    b.delay = chain;
    b.springify = chain;
    return b;
  };
  const entering = new Proxy({}, { get: () => builder });
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (c) => c },
    FadeIn: builder(),
    FadeInDown: builder(),
    FadeOut: builder(),
    ZoomIn: builder(),
    Easing: { linear: (x) => x, out: () => (x) => x, in: () => (x) => x, cubic: (x) => x },
    useSharedValue: (v) => ({ value: v }),
    useAnimatedStyle: () => ({}),
    useAnimatedKeyboard: () => ({ height: { value: 0 }, state: { value: 0 } }),
    withTiming: (v) => v,
    withSpring: (v) => v,
    runOnJS: (fn) => fn,
    interpolate: () => 0,
    ...entering,
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: (props) => props.children,
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/',
}));

// The tour must stay inert: an active walkthrough changes what Home renders,
// and this guard is about the cold DATA path, not the tour.
// The tour must stay inert (an active walkthrough changes what Home renders, and
// this guard is about the cold DATA path). But `tourTargets` is spread REAL via
// requireActual on purpose: Home does `tourTargets.studyCard.current = node` in a
// ref callback, so a hand-written subset throws "Cannot set properties of
// undefined (setting 'current')" the moment the real object grows a key this file
// did not predict — which is exactly what the first draft of this test did, and
// it masqueraded as the very failure it was written to diagnose.
jest.mock('@/tour/walkthrough', () => ({
  ...jest.requireActual('@/tour/walkthrough'),
  useWalkthroughActive: () => false,
  WalkthroughOverlayHost: () => null,
  WalkthroughController: () => null,
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import * as React from 'react';

import i18n from '@/i18n';
import { HomeScreen } from '@/screens/HomeScreen';

function coldClient() {
  // retry:false so a rejected query surfaces as a failure here rather than
  // being retried into the timeout the way it would be on the emulator.
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

// React swallows render errors into a console.warn ("An error occurred in the
// <View> component") and the actual exception never reaches the assertion, which
// is why the first version of this test reported only a timeout. Capture it.
const caught = [];
class Boundary extends React.Component {
  static getDerivedStateFromError(error) {
    caught.push(error);
    return { dead: true };
  }
  constructor(props) {
    super(props);
    this.state = { dead: false };
  }
  render() {
    return this.state.dead ? null : this.props.children;
  }
}

function renderCold() {
  const client = coldClient();
  return render(
    <QueryClientProvider client={client}>
      <Boundary>
        <HomeScreen />
      </Boundary>
    </QueryClientProvider>,
  );
}

describe('Home cold boot (mock DataSource, empty cache)', () => {
  it('paints the Word Mastery card — the first thing smoke.yaml asserts', async () => {
    renderCold();
    // The exact string the flow waits on, read from i18n rather than hand-copied
    // so a copy change moves this guard with it.
    const eyebrow = i18n.t('masteryCard.eyebrow');
    expect(eyebrow).toBeTruthy();
    // Surface the real exception rather than letting it time out as a mystery.
    if (caught.length > 0) throw new Error(`HomeScreen threw during render: ${caught[0]?.stack ?? caught[0]}`);
    await screen.findByText(eyebrow, {}, { timeout: 3000 });
  });

  it('resolves an active language from the mock profile', async () => {
    // Every language-scoped read is gated `enabled: activeLang != null`. If the
    // profile query cannot produce targetLang, Home's snapshot stays null
    // forever and the card above never mounts — silently, with no error.
    const { getProfile } = require('@/data/mock').mockDataSource;
    const profile = await getProfile();
    expect(profile.targetLang).toBeTruthy();
    expect(profile.onboardingComplete).toBe(true);
  });
});
