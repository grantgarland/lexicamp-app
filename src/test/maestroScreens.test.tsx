// @ts-nocheck — jest's mock-factory hoisting forbids identifiers (incl. type
// annotations) inside jest.mock() factories. Runs through babel.
//
// Maestro SCREEN-CHROME guard (2026-08-03) — the layer the other two can't reach.
//
// The three layers, and what each can actually prove:
//   maestroStrings.test.ts   — the selector matches a string that EXISTS in
//                              en.json / the mock fixtures, and (since today)
//                              that its key is still referenced by app source.
//   maestroSelectors.test.tsx— for COMPOSED surfaces (translation card, word
//                              row, dialogs), Maestro's matcher hits the text
//                              the real component actually emitted.
//   this file                — for the SCREENS `.maestro/smoke.yaml` tabs into,
//                              the asserted headline is emitted by the REAL
//                              screen, rendered.
//
// The gap that made this necessary: the 2026-07-30 Progress redesign (cbc5e57)
// deleted the "You are here" hero card but left `progress.youAreHere` in
// en.json. maestroStrings found the leaf and passed; smoke.yaml went red at 3am
// on 2026-08-03 asserting a string the app rendered nowhere.
//
// NOT COVERED, stated plainly: LAYOUT. This answers "does the screen emit this
// text", never "can Maestro see it" (on-screen, scrolled into view, behind the
// IME). Only a workflow_dispatch proves that. Home / Word List / Settings are
// not rendered here either — they are key-proven by maestroStrings only. Add
// them the same way when one of them next drifts.
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
    Easing: { out: () => () => 0, in: () => () => 0, cubic: () => 0 },
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

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }));

// Sized from the SAME fixture distribution the smoke APK boots with (the `smoke`
// EAS profile builds the mock DataSource in its summit scenario), so a fixture
// resize reaches this guard instead of only the emulator.
const { SMOKE_FIXTURES: mockFixtures } = require('@/data/mock');
const mockDist = mockFixtures.DISTRIBUTION.summit;
const mockSaved = mockDist.reduce((a, b) => a + b, 0);

const DAY = 24 * 60 * 60 * 1000;
const mockLib = (() => {
  const cards = [];
  const states = [];
  for (let i = 0; i < mockSaved; i += 1) {
    cards.push({
      id: `c${i}`,
      deckId: 'd',
      userId: 'u',
      translationId: 't',
      userNote: null,
      customFront: null,
      customBack: null,
      suspended: false,
      createdAt: new Date(Date.now() - (i + 1) * DAY),
    });
    states.push({
      cardId: `c${i}`,
      userId: 'u',
      stability: 12,
      difficulty: 5,
      dueAt: new Date(Date.now() + 12 * DAY),
      lastReviewAt: new Date(Date.now() - DAY),
      state: 2,
      reps: 6,
      lapses: 0,
      learningSteps: 0,
    });
  }
  return { cards, states };
})();

const mockProgressData = {
  tierCounts: mockDist,
  totalSaved: mockSaved,
  totalMastered: 0,
  streakDays: 14,
  sessionsTotal: 22,
  avgAccuracy: 85,
  bestStreak: 9,
  daysActive: 20,
  reviewsTotal: 384,
  timeInvestedMs: 3 * 60 * 60 * 1000 + 25 * 60 * 1000,

  cards: mockLib.cards,
  states: mockLib.states,
  isLoading: false,
};

// Pull-to-refresh reaches for the real QueryClient; this suite mocks the data
// layer wholesale and mounts no provider. Refresh has its own tests.
jest.mock('@/query/usePullToRefresh', () => ({
  usePullToRefresh: () => ({ refreshing: false, onRefresh: jest.fn() }),
  REFRESH_THROTTLE_MS: 5000,
}));

jest.mock('@/query/hooks', () => ({
  // Pulled in by the header's LanguageIndicator (2026-08-04), not by the screen.
  useProfile: () => ({ nativeLang: 'en', targetLang: 'es' }),
  useEntitlement: () => ({ entitlement: undefined, isPaid: true, isLoading: false }),
  useLearningLanguages: () => ({ languages: ['es'], isLoading: false }),
  useAddLanguage: () => ({ mutate: jest.fn(), isPending: false }),
  useSwitchLanguage: () => ({ mutate: jest.fn(), isPending: false }),
  useRemoveLanguage: () => ({ mutate: jest.fn(), isPending: false }),
  useProgressData: () => mockProgressData,
  useLeaderboard: () => ({ entries: [], isLoading: false }),
  useActiveLang: () => 'es',
}));

import { render, screen } from '@testing-library/react-native';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { ProgressScreen } from '@/screens/ProgressScreen';

import { maestroMatches } from './maestroMatch';

declare const __dirname: string;

const SMOKE = fs.readFileSync(path.resolve(__dirname, '../../.maestro/smoke.yaml'), 'utf8');

/**
 * The selector smoke.yaml asserts immediately after tapping a tab — read from
 * the flow, never hand-copied, so editing the flow moves this guard with it.
 */
function selectorAfterTab(tabId: string): string {
  const lines = SMOKE.split('\n').filter((l) => !/^\s*#/.test(l));
  const tapAt = lines.findIndex((l) => new RegExp(`id:\\s*['"]${tabId}['"]`).test(l));
  expect(tapAt).toBeGreaterThan(-1);
  for (const l of lines.slice(tapAt + 1)) {
    const m = /^\s*-?\s*(?:assertVisible|visible):\s*(['"])(.*)\1\s*$/.exec(l);
    if (m) return m[2];
  }
  throw new Error(`smoke.yaml taps ${tabId} but asserts nothing after it`);
}

/** Every string the rendered tree would expose to Maestro as an element `text`. */
function renderedTexts(): string[] {
  return screen.root == null
    ? []
    : screen
        .UNSAFE_getAllByType(require('react-native').Text)
        .map((n) => (Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children))
        .filter((c) => typeof c === 'string' && c.length > 0);
}

describe('smoke.yaml screen chrome is emitted by the real screens', () => {
  it("Progress: the flow's post-tap assertion matches text ProgressScreen renders", () => {
    const selector = selectorAfterTab('tab-progress');
    render(<ProgressScreen />);
    const texts = renderedTexts();
    const hit = texts.find((x) => maestroMatches(selector, x));
    if (hit == null) {
      throw new Error(
        `smoke.yaml asserts ${JSON.stringify(selector)} after tapping the Progress tab, ` +
          `but ProgressScreen renders no text Maestro would match.\n` +
          `Maestro matches the WHOLE element text — a substring needs an explicit '.*'.\n` +
          `Rendered: ${JSON.stringify(texts)}`,
      );
    }
    expect(hit).toBeTruthy();
  });

  it('Progress: the retired "You are here" hero is still gone', () => {
    // The 2026-08-03 regression, pinned. If the hero ever legitimately returns,
    // delete this test rather than working around it.
    render(<ProgressScreen />);
    expect(renderedTexts().some((x) => maestroMatches('(?i)You are here', x))).toBe(false);
  });

  it('the Progress assertion is not one the tab bar could satisfy on a blank screen', () => {
    // `progress.title` and `tabs.progress` are both "Progress"; asserting it
    // would pass against a dead Route tab and void the point of the flow.
    const selector = selectorAfterTab('tab-progress');
    const en = require('@/i18n/locales/en.json');
    expect(maestroMatches(selector, en.tabs.progress)).toBe(false);
  });
});
