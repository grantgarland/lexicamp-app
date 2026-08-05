// @ts-nocheck — jest mock-factory hoisting forbids identifiers inside the
// factories (see QuizScreen.test.tsx), so this file is excluded from tsc.
//
// The Home study card is the app's primary CTA and the surface where its one
// real differentiator — scheduling each word to the moment it is about to slip —
// has to be legible. Redesigned 2026-07-30 to show PERISHABILITY from real
// snapshot numbers. These tests pin the behaviour that carries that meaning:
// the backlog line, the next-up fallback, and the whole card being tappable.

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
    b.duration = chain; b.delay = chain; b.springify = chain;
    return b;
  };
  const entering = new Proxy({}, { get: () => builder });
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (c) => c },
    FadeIn: builder(), FadeOut: builder(), FadeInDown: builder(), ZoomIn: builder(),
    Easing: { out: () => () => 0, in: () => () => 0, cubic: () => 0 },
    useSharedValue: (v) => ({ value: v }),
    useAnimatedStyle: () => ({}),
    useAnimatedKeyboard: () => ({ height: { value: 0 }, state: { value: 0 } }),
    withTiming: (v) => v, withSpring: (v) => v, runOnJS: (fn) => fn, interpolate: () => 0,
    ...entering,
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: (props) => props.children,
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }) }));

const mockSnapshot = {
  tierCounts: [3, 2, 1, 0, 0],
  wordsSaved: 6,
  masteredCount: 0,
  needRecallTotal: 9,
  needRecallToday: 7,
  dueTomorrow: 4,
  addedToday: 2,
  isEmpty: false,
};

// Pace is nullable by design: null = "not enough timed sessions" = hide the
// estimate. Tests drive both sides of that.
const mockPace = { value: null };

// Pull-to-refresh reaches for the real QueryClient; this suite mocks the data
// layer wholesale and mounts no provider. Refresh has its own tests.
jest.mock('@/query/usePullToRefresh', () => ({
  usePullToRefresh: () => ({ refreshing: false, onRefresh: jest.fn() }),
  REFRESH_THROTTLE_MS: 5000,
}));

jest.mock('@/query/hooks', () => ({
  useHomeData: () => ({ snapshot: mockSnapshot, streakDays: 3, isLoading: false }),
  useProgressData: () => ({ bestStreak: 5, isLoading: false }),
  useSessionPace: () => mockPace.value,
}));

// The language switcher is a whole feature of its own (entitlement, language
// list, switch mutation). Stub the module rather than mocking its hook tree —
// none of it is under test here.
jest.mock('@/screens/shared/LanguageSwitcher', () => ({ LanguageIndicator: () => null }));

import { fireEvent, render, screen } from '@testing-library/react-native';
import { HomeScreen } from '@/screens/HomeScreen';
import i18n from '@/i18n';

const t = (k, o) => i18n.t(k, o);

const reset = (over) => Object.assign(mockSnapshot, {
  needRecallTotal: 9, needRecallToday: 7, dueTomorrow: 4, masteredCount: 0, isEmpty: false,
}, over);

beforeEach(() => { mockPush.mockClear(); reset({}); mockPace.value = null; });

describe('Home study card (primary CTA)', () => {
  it('shows the carried-over backlog when words came due on an earlier day', () => {
    // 9 due, 7 of which came due today → 2 have been waiting.
    render(<HomeScreen />);
    expect(screen.getByText(t('home.studyBacklog', { count: 2 }))).toBeTruthy();
  });

  it('falls back to what the scheduler has queued next when there is no backlog', () => {
    reset({ needRecallTotal: 7, needRecallToday: 7, dueTomorrow: 4 });
    render(<HomeScreen />);
    expect(screen.queryByText(t('home.studyBacklog', { count: 2 }))).toBeNull();
    expect(screen.getByText(t('home.studyNextUp', { count: 4 }))).toBeTruthy();
  });

  it('shows no schedule note at all when there is nothing to say', () => {
    reset({ needRecallTotal: 5, needRecallToday: 5, dueTomorrow: 0 });
    render(<HomeScreen />);
    expect(screen.queryByText(t('home.studyNextUp', { count: 0 }))).toBeNull();
    expect(screen.queryByText(t('home.studyBacklog', { count: 0 }))).toBeNull();
  });

  it('never renders a negative backlog if the two counts disagree', () => {
    // Defensive: a clock change between the two derivations must degrade to the
    // next-up line, not to "-1 have been waiting since yesterday".
    reset({ needRecallTotal: 5, needRecallToday: 8, dueTomorrow: 2 });
    render(<HomeScreen />);
    expect(screen.getByText(t('home.studyNextUp', { count: 2 }))).toBeTruthy();
    expect(screen.queryByText(/-\d/)).toBeNull();
  });

  it('makes the WHOLE card the tap target, not just the button', () => {
    render(<HomeScreen />);
    // The card's own accessibility label carries the count, so pressing the
    // element that owns that label must start the quiz.
    const card = screen.getByLabelText(new RegExp(t('home.studyNow')));
    fireEvent.press(card);
    expect(mockPush).toHaveBeenCalledWith('/quiz');
  });

  it('announces the count and the backlog in one label for screen readers', () => {
    render(<HomeScreen />);
    const card = screen.getByLabelText(new RegExp(t('home.studyNow')));
    expect(card.props.accessibilityLabel).toContain(t('home.wordsReadyA11y', { count: 9 }));
    expect(card.props.accessibilityLabel).toContain(t('home.studyBacklog', { count: 2 }));
  });

  it('hides the time estimate until the server has a measured pace', () => {
    // Null pace must render NOTHING — not "0 min", not a guessed constant.
    // Anchored to a NUMBER + "min": a bare /min/ also matched the Mastery card's
    // "memories forming" (2026-08-05), so it would have failed on unrelated copy.
    mockPace.value = null;
    render(<HomeScreen />);
    expect(screen.queryByText(/\d+\s*min/)).toBeNull();
  });

  it('shows a measured estimate once pace is available', () => {
    mockPace.value = 8; // seconds per card, measured server-side
    reset({ needRecallTotal: 9, needRecallToday: 7 });
    render(<HomeScreen />);
    // 9 cards x 8s = 72s -> 1 min (rounded, floored at 1).
    expect(screen.getByText(t('home.studyEta', { count: 1 }))).toBeTruthy();
  });

  it('never renders a zero-minute estimate', () => {
    mockPace.value = 0.5;
    reset({ needRecallTotal: 1, needRecallToday: 1 });
    render(<HomeScreen />);
    expect(screen.queryByText(t('home.studyEta', { count: 0 }))).toBeNull();
    expect(screen.getByText(t('home.studyEta', { count: 1 }))).toBeTruthy();
  });

  it('gives the hero number a clip-proof line box and compensates its leading', () => {
    // Two failure modes, one test.
    //
    // CLIP: a tight lineHeight cuts the digits. The design system's `tight`
    // leading (1.12) is 49px at 44px, which Spectral Bold overflows — that is
    // exactly what clipped "30". The line box must be comfortably above the
    // face's natural height.
    //
    // UNEVEN RHYTHM: a generous line box adds leading above AND below that no
    // margin accounts for, which is what made the gap under the number the
    // biggest on the card. So its margin must be REDUCED to compensate — i.e.
    // strictly smaller than the gap every other row uses.
    const styleOf = (node) => {
      const flat = [node.props.style].flat(Infinity).filter(Boolean);
      return Object.assign({}, ...flat);
    };

    render(<HomeScreen />);
    const num = styleOf(screen.getByText(String(9)));
    const label = styleOf(screen.getByText(t('home.wordsReady')));

    expect(num.lineHeight / num.fontSize).toBeGreaterThanOrEqual(1.4);
    expect(num.marginBottom).toBeLessThan(label.marginBottom);
    expect(num.marginBottom).toBeGreaterThanOrEqual(0);

    // The compensation should land the VISUAL gap near the others, not wipe it
    // out: margin + the half-leading the box already contributes.
    const visualUnderNumber = num.marginBottom + (num.lineHeight - num.fontSize) / 2;
    const visualUnderLabel = label.marginBottom + (label.lineHeight - label.fontSize) / 2;
    expect(Math.abs(visualUnderNumber - visualUnderLabel)).toBeLessThanOrEqual(4);
  });

  it('always leaves a gap above the CTA, with or without the schedule note', () => {
    // The original bug: the ONLY gap above the button was the marginBottom of a
    // sibling that later got deleted. Whichever element precedes the button must
    // supply it, in BOTH states.
    const bottomMarginOf = (node) => {
      const flat = [node.props.style].flat(Infinity).filter(Boolean);
      const m = flat.find((x) => x && typeof x.marginBottom === 'number');
      return m ? m.marginBottom : 0;
    };

    // With a note, the note is the last thing before the button.
    render(<HomeScreen />);
    expect(screen.getByTestId('studyCtaButton')).toBeTruthy();
    expect(bottomMarginOf(screen.getByTestId('studyScheduleNote'))).toBeGreaterThan(0);
    screen.unmount();

    // Without a note, the unit label is.
    reset({ needRecallTotal: 5, needRecallToday: 5, dueTomorrow: 0 });
    render(<HomeScreen />);
    expect(bottomMarginOf(screen.getByText(t('home.wordsReady')))).toBeGreaterThan(0);
  });

  it('caught-up state is tappable as a whole card too', () => {
    reset({ needRecallTotal: 0, needRecallToday: 0, dueTomorrow: 4 });
    render(<HomeScreen />);
    const card = screen.getByLabelText(new RegExp(t('home.studyAhead')));
    fireEvent.press(card);
    expect(mockPush).toHaveBeenCalledWith('/quiz');
  });
});
