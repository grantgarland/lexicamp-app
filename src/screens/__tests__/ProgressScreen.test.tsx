// @ts-nocheck — see QuizScreen.test.tsx: jest mock-factory hoisting forbids
// identifiers inside the factories, so this file is excluded from tsc.
//
// Covers the 2026-07-30 Progress redesign:
//   - Route lost the "You are here" hero; the ladder's current row carries it.
//   - Inventory is GONE, replaced by Projection (card + forecast curve).
//   - The projection card is themed by the tier it points at, not brand blue.
// These are structural claims a unit test can't make, and the kind of thing a
// later refactor silently undoes.

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
    // The CEFR Sheet is mounted by this screen even when closed, and it reaches
    // for the worklet hooks QuizScreen's mock never needed.
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

const DAY = 24 * 60 * 60 * 1000;
const buildLibrary = (n, stability) => {
  const cards = [];
  const states = [];
  for (let i = 0; i < n; i += 1) {
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
      stability,
      difficulty: 5,
      dueAt: new Date(Date.now() + stability * DAY),
      lastReviewAt: new Date(Date.now() - DAY),
      state: 2,
      reps: 6,
      lapses: 0,
      learningSteps: 0,
    });
  }
  return { cards, states };
};

// Name MUST start with `mock`: babel-plugin-jest-hoist lifts jest.mock() above
// the imports and rejects any other out-of-scope reference from a factory.
const mockLib = buildLibrary(40, 12);
const mockProgressData = {
  tierCounts: [5, 10, 15, 10, 0],
  totalSaved: 40,
  totalMastered: 0,
  streakDays: 4,
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

import { fireEvent, render, screen } from '@testing-library/react-native';
import { ProgressScreen } from '@/screens/ProgressScreen';
import i18n from '@/i18n';

const t = (k, o) => i18n.t(k, o);

describe('Progress redesign (2026-07-30)', () => {
  it('offers Route / Projection / Leaders — Inventory is gone', () => {
    render(<ProgressScreen />);
    expect(screen.getByText(t('progress.tabRoute'))).toBeTruthy();
    expect(screen.getByText(t('progress.tabProjection'))).toBeTruthy();
    expect(screen.getByText(t('progress.tabLeaders'))).toBeTruthy();
    // The Inventory tab and its headline are retired, not merely hidden.
    expect(screen.queryByText('Inventory')).toBeNull();
    expect(screen.queryByText('Words by Tier')).toBeNull();
  });

  // The three hooks `.maestro/capture-onboarding-shots.yaml` selects by on this
  // screen. Text selectors are NOT an option for the pill: SegmentedPills sets
  // accessibilityLabel ("Projection to your next camp"), which collapses the
  // Pressable into one iOS a11y element and hides the visible "Next camp" text
  // from Maestro entirely. This asserts the ids exist on rendered elements —
  // the failure mode it catches is someone dropping a testID prop while the
  // screen still looks perfect.
  it('exposes the projection testIDs the capture flow taps', () => {
    render(<ProgressScreen />);
    fireEvent.press(screen.getByTestId('progressTabProjection'));
    expect(screen.getByTestId('projPillNext')).toBeTruthy();
    fireEvent.press(screen.getByTestId('projPillNext'));
    // Status-independent: both ProjectionCard branches carry this id.
    expect(screen.getByTestId('projectionCard')).toBeTruthy();
  });

  it('Route drops the "You are here" hero but keeps its content on the ladder', () => {
    render(<ProgressScreen />);
    // The hero's own label is gone...
    expect(screen.queryByText(t('progress.youAreHere'))).toBeNull();
    // ...while the ladder and All-Time both survive.
    expect(screen.getByText(t('progress.fullRoute'))).toBeTruthy();
    expect(screen.getByText(t('progress.allTime'))).toBeTruthy();
    // The current row still carries the distance-to-next readout the hero had.
    expect(screen.getByText(t('progress.toNext', { count: 100, tier: t('tier.abc.name') }))).toBeTruthy();
  });

  it('Route no longer renders the projection — it moved to its own tab', () => {
    render(<ProgressScreen />);
    expect(screen.queryByText(t('progress.proj.heading'))).toBeNull();
    fireEvent.press(screen.getByText(t('progress.tabProjection')));
    expect(screen.getByText(t('progress.proj.heading'))).toBeTruthy();
  });

  it('Projection tab shows the card and the forecast curve together', () => {
    render(<ProgressScreen />);
    fireEvent.press(screen.getByText(t('progress.tabProjection')));
    expect(screen.getByText(t('progress.forecast.title'))).toBeTruthy();
    expect(screen.getByText(t('progress.forecast.today'))).toBeTruthy();
  });

  it('defaults to the next camp and switches to Summit on toggle', () => {
    render(<ProgressScreen />);
    fireEvent.press(screen.getByText(t('progress.tabProjection')));
    // Assert the heading node exactly. `getByText('Summit')` would be ambiguous
    // once the toggle pill is on screen with the same word.
    // 0 mastered → next camp is Adv. Base Camp.
    expect(screen.getByTestId('projectionTargetTier').props.children).toBe(t('tier.abc.name'));
    fireEvent.press(screen.getByLabelText(t('progress.proj.viewSummitA11y')));
    expect(screen.getByTestId('projectionTargetTier').props.children).toBe(t('tier.summit.name'));
  });

  it('themes the Summit view with Summit tokens, not the brand blue', () => {
    // The nit that prompted this pass: the card hardcoded color.brand, so Summit
    // rendered in Base Camp's blue. Assert against the REGISTRY so a token
    // rename can't quietly reintroduce it.
    const { TIERS } = require('@/theme/tiers');
    const summit = TIERS[TIERS.length - 1];
    render(<ProgressScreen />);
    fireEvent.press(screen.getByText(t('progress.tabProjection')));
    fireEvent.press(screen.getByLabelText(t('progress.proj.viewSummitA11y')));

    const heading = screen.getByTestId('projectionTargetTier');
    const flat = [heading.props.style].flat(Infinity).filter(Boolean);
    expect(flat.some((x) => x && x.color === summit.text)).toBe(true);
    // And explicitly NOT the brand blue it used to hardcode.
    const { lightTheme } = require('@/theme/theme');
    expect(flat.some((x) => x && x.color === lightTheme.color.brand)).toBe(false);
  });

  it('the forecast curve follows the toggle, not just the card', () => {
    // The chart used to pick the next camp independently, so switching to
    // Summit relabelled the card and left the curve pointing somewhere else.
    render(<ProgressScreen />);
    fireEvent.press(screen.getByText(t('progress.tabProjection')));

    // The SVG only draws once it knows its width (onLayout) — the fix for the
    // squashed plot and the elliptical crossing dot.
    const layout = () =>
      fireEvent(screen.getByTestId('forecastChart'), 'layout', {
        nativeEvent: { layout: { width: 320, height: 148, x: 0, y: 0 } },
      });
    layout();

    // The axis label lives in an <SvgText>, which RNTL does not treat as a text
    // host, and react-native-svg wraps the string in a <TSpan> — so walk down
    // to the first string rather than reading `children` directly.
    const deepText = (node) => {
      let n = node;
      while (n != null && typeof n !== 'string') n = n.props?.children;
      return n;
    };
    const axis = () => deepText(screen.getByTestId('forecastAxisLabel'));

    // Next camp (100) is the default target...
    expect(axis()).toBe(t('progress.forecast.axisWords', { count: (100).toLocaleString() }));

    fireEvent.press(screen.getByLabelText(t('progress.proj.viewSummitA11y')));
    layout();

    // ...and Summit re-scales the curve to 3,000.
    expect(axis()).toBe(t('progress.forecast.axisWords', { count: (3000).toLocaleString() }));
  });

  it('renders the empty state instead of a chart for a brand-new user', () => {
    mockProgressData.totalSaved = 0;
    try {
      render(<ProgressScreen />);
      fireEvent.press(screen.getByText(t('progress.tabProjection')));
      expect(screen.getByText(t('progress.emptyProjectionTitle'))).toBeTruthy();
      expect(screen.queryByText(t('progress.forecast.title'))).toBeNull();
    } finally {
      mockProgressData.totalSaved = 40;
    }
  });
});

// A summited user used to be handed the plainest screen in the app: a "Reached —
// keep reviewing" panel that restated the tier they could already see, and a Route
// tab captioned "Summit at the top. Keep climbing." Both were removed (Casey,
// 2026-08-05), and the journey card that replaced the panel is built from the SAME
// parts as ProjectionCard so the two slots don't diverge again.
describe('past the Summit', () => {
  const saved = { ...mockProgressData };
  beforeAll(() => {
    // Stability 60 > MASTERY_STABILITY, and enough of them that no camp is left.
    const lib = buildLibrary(3100, 60);
    Object.assign(mockProgressData, {
      tierCounts: [0, 0, 0, 0, 3100], totalSaved: 3100, totalMastered: 3100,
      cards: lib.cards, states: lib.states,
    });
  });
  afterAll(() => Object.assign(mockProgressData, saved));

  const openProjection = () => {
    render(<ProgressScreen />);
    fireEvent.press(screen.getByText(t('progress.tabProjection')));
  };

  it('wears the same card treatment as ProjectionCard, not a plain word dump', () => {
    openProjection();
    // Same testID => same tinted, bordered surface both branches render into.
    expect(screen.getByTestId('projectionCard')).toBeTruthy();
    expect(screen.getByText(t('progress.proj.journeyEyebrow'))).toBeTruthy();
    // The big tier-coloured number + unit label, mirroring the ETA slot.
    expect(screen.getByText('3,100')).toBeTruthy();
    expect(screen.getByText(t('progress.proj.journeyBigLabel'))).toBeTruthy();
  });

  it('drops the ETA sentence — the chart caption is where that number lives', () => {
    openProjection();
    expect(screen.queryByText(/At this pace/i)).toBeNull();
    // ...and the dead "Reached" panel it replaced is gone with it.
    expect(screen.queryByText(t('progress.proj.reachedTitle'))).toBeNull();
  });

  it('no longer captions the Route ladder', () => {
    render(<ProgressScreen />);
    expect(screen.getByText(t('progress.fullRoute'))).toBeTruthy();
    expect(screen.queryByText(/Summit at the top/i)).toBeNull();
  });
});

// All-Time grid refactor (Casey, 2026-08-05): Reviews · Avg accuracy · Days
// active · Time invested. The two streak tiles left — Home already carries a
// live streak badge, so the grid was spending half its space restating it.
describe('All-Time grid', () => {
  const saved = { ...mockProgressData };
  afterEach(() => Object.assign(mockProgressData, saved));

  it('shows the four metrics and no longer restates the streak', () => {
    render(<ProgressScreen />);
    expect(screen.getByText(t('progress.reviews'))).toBeTruthy();
    expect(screen.getByText(t('progress.avgAccuracy'))).toBeTruthy();
    expect(screen.getByText(t('progress.daysActive'))).toBeTruthy();
    expect(screen.getByText(t('progress.timeInvested'))).toBeTruthy();
    // Home owns the streak now. Sessions gave way to Reviews.
    expect(screen.queryByText('Current Streak')).toBeNull();
    expect(screen.queryByText('Best Streak')).toBeNull();
    expect(screen.queryByText('Sessions')).toBeNull();
  });

  it('reports reviews and active days from the stats, thousands-separated', () => {
    Object.assign(mockProgressData, { reviewsTotal: 18400, daysActive: 1024 });
    render(<ProgressScreen />);
    expect(screen.getByText('18,400')).toBeTruthy();
    expect(screen.getByText('1,024')).toBeTruthy();
  });

  it('reports measured time plainly — no tilde, because nothing is inferred', () => {
    // Time invested sums RECORDED durations only (2026-08-05). The earlier
    // revision modelled untimed sessions from the user's median pace and had to
    // mark the result approximate; that model is gone, so the number stands on
    // its own.
    Object.assign(mockProgressData, { timeInvestedMs: 3 * 60 * 60 * 1000 + 25 * 60 * 1000 });
    render(<ProgressScreen />);
    expect(screen.getByText('3h 25m')).toBeTruthy();
    expect(screen.queryByText('~3h 25m')).toBeNull();
  });

  it('shows an em dash, never "0m", when there is no timing at all', () => {
    // Every session predates duration recording. We know nothing — which is not
    // the same claim as "you have studied for zero minutes".
    Object.assign(mockProgressData, { timeInvestedMs: 0, reviewsTotal: 0 });
    render(<ProgressScreen />);
    expect(screen.queryByText('0m')).toBeNull();
    expect(screen.queryByText('~0m')).toBeNull();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
