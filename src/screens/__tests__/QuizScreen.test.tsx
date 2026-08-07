// @ts-nocheck — jest's mock-factory hoisting forbids identifiers (incl. type-annotation
// param names) inside jest.mock() factories, which conflicts with TS annotations. Tests
// run through babel (types stripped), so this file is deliberately excluded from tsc.
//
// Regression test for the "quiz close button does nothing" bug.
//
// Root cause: the quiz is a fullScreenModal; the exit-confirm sheet was rendered via the
// root Portal, which on iOS sits BEHIND that modal — so pressing × fired but its dialog
// was invisible, making the button look dead. The fix renders the confirm IN-TREE.
//
// This test proves both halves on the same rendered tree: the close button registers a
// press, AND its result (the exit confirm + Exit action) is actually present in the
// screen and calls router.back(). It fails on the old Portal-based version because the
// confirm text never appears in this tree.

// react-native-unistyles v3 is NitroModule-backed (no native binary in jest); mock it so
// StyleSheet.create/useUnistyles resolve against the real theme tokens.
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

// Reanimated layout-animation builders (FadeIn/FadeInDown/ZoomIn) + Animated.View → no-ops.
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
    // Needed once a test renders the RATING gutter (the w6 scene override) —
    // RatingButtons drives its auto-select timer off shared values.
    useSharedValue: (initial) => ({ value: initial }),
    useAnimatedStyle: (fn) => fn(),
    withTiming: (to) => to,
    cancelAnimation: () => {},
    runOnJS: (fn) => fn,
    ...entering,
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: (props) => props.children,
}));

const mockBack = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }));

const mockCard = {
  id: 'c1',
  tierId: 'bc',
  mode: 'recognition',
  content: { frontWord: 'hola', frontPrompt: 'Translate', backWord: 'hello' },
  // Real FSRS state: the results phases run `sessionPromotions` over these cards,
  // and `tierTransition` reads stability/difficulty straight off them.
  fsrs: {
    cardId: 'c1',
    userId: 'u1',
    stability: 2.4,
    difficulty: 5.1,
    dueAt: new Date('2026-08-03T00:00:00Z'),
    lastReviewAt: null,
    state: 2,
    reps: 2,
    lapses: 0,
    learningSteps: 0,
  },
};
// Mutable so the repeat-bug test can model a stale cache being replaced by a
// fresh fetch mid-mount (see the bottom of this file).
let mockDue = { cards: [], isLoading: false, isFetching: false };
jest.mock('@/query/hooks', () => ({
  useDueCards: () => mockDue,
  useHomeData: () => ({ streakDays: 3 }),
  useCommitQuizSession: () => ({ mutate: jest.fn() }),
  useEntitlement: () => ({ entitlement: undefined, isPaid: false, isLoading: false }), // 17 §S2: session cap read
}));

// The tour drives this screen through `useTourScene` (a real zustand store, safe to
// drive directly) plus `useWalkthroughActive`, which needs a provider it will not have
// here — mock the module and keep the overlay host inert.
jest.mock('@/tour/walkthrough', () => ({
  // Derived from the scene store, NOT a bare `true`: a hardcoded true would put
  // the two pre-existing tests on the tour path as well, quietly changing what
  // they exercise. Reading `getState()` without subscribing is fine here — every
  // test sets its step BEFORE render.
  useWalkthroughActive: () => require('@/tour/tourScene').useTourScene.getState().stepId != null,
  WalkthroughOverlayHost: () => null,
  tourTargets: { quizGutter: { current: null } },
}));

import { fireEvent, render, screen } from '@testing-library/react-native';
import { QuizScreen } from '@/screens/QuizScreen';
import { useTourScene } from '@/tour/tourScene';
import i18n from '@/i18n';

const CARD_A = mockCard;
const CARD_B = { ...mockCard, id: 'c2', fsrs: { ...mockCard.fsrs, cardId: 'c2' } };

beforeEach(() => {
  mockBack.mockClear();
  mockDue = { cards: [CARD_A, CARD_B], isLoading: false, isFetching: false };
  useTourScene.getState().setStepId(null);
});
afterAll(() => useTourScene.getState().setStepId(null));

test('close button registers a press and shows the in-tree exit confirm', () => {
  render(<QuizScreen />);

  // Exit confirm must NOT be present before the button is pressed.
  expect(screen.queryByText(i18n.t('quiz.exitTitle'))).toBeNull();

  // Press the close (×) button — found by its accessibility label.
  fireEvent.press(screen.getByLabelText(i18n.t('quiz.closeQuiz')));

  // Fix: the confirm dialog now renders inside THIS screen's tree (was portalled away).
  expect(screen.getByText(i18n.t('quiz.exitTitle'))).toBeTruthy();
  expect(screen.getByText(i18n.t('quiz.exitConfirm'))).toBeTruthy();
});

// The device-observed path (2026-08-04): a flow tapped × AFTER revealing a card,
// not on the front. On device that tap registered
// and the exit sheet never appeared; this proves the difference is NOT the
// revealed state / rating gutter, and that both testIDs the flow selects by are
// actually on rendered elements.
test('close opens the exit confirm after the card is revealed, and both flow testIDs exist', () => {
  render(<QuizScreen />);
  fireEvent.press(screen.getByTestId('quizRevealButton'));
  fireEvent.press(screen.getByTestId('quizClose'));
  expect(screen.getByTestId('quizExitConfirm')).toBeTruthy();
});

test('confirming exit calls router.back()', () => {
  render(<QuizScreen />);
  fireEvent.press(screen.getByLabelText(i18n.t('quiz.closeQuiz')));
  fireEvent.press(screen.getByText(i18n.t('quiz.exitConfirm')));
  expect(mockBack).toHaveBeenCalledTimes(1);
});

// ── Walkthrough scene overrides ─────────────────────────────────────────────
// Both of these regressed by pointing a step at the wrong thing, which no test
// could see because the COPY still read fine. See tour/tourScene.ts.

test('w6 shows the card flipped, so the three rating buttons the step describes are on screen', () => {
  useTourScene.getState().setStepId('w6');
  render(<QuizScreen />);

  // The gutter is the step's anchor. Face-down it holds one reveal button; the
  // step's copy ("grade yourself honestly") only makes sense with all three.
  expect(screen.queryByText(i18n.t('quiz.tapToReveal'))).toBeNull();
  expect(screen.getByText(i18n.t('rating.prompt'))).toBeTruthy();
  expect(screen.getByText(i18n.t('rating.again'))).toBeTruthy();
  expect(screen.getByText(i18n.t('rating.almost'))).toBeTruthy();
  expect(screen.getByText(i18n.t('rating.gotIt'))).toBeTruthy();
});

test('w7 shows the per-word results LIST, not the "Great session!" splash', () => {
  useTourScene.getState().setStepId('w7');
  render(<QuizScreen />);

  // The tooltip promises "how far each word moved and when it returns" — only the
  // stats list shows that. It used to render the end splash instead.
  expect(screen.getByText(i18n.t('quiz.sessionResults'))).toBeTruthy();
  expect(screen.queryByText(i18n.t('quiz.endGreat'))).toBeNull();
});

// ── Quiz-repeat bug (Casey, 2026-08-04) ─────────────────────────────────────
// Reported: finishing a session and starting another served the SAME words.
// Confirmed in production review_logs — the 16:06 and 16:12 sessions were the
// same ten card ids, the second one logged at elapsed_days = 0.
//
// Cause: the session snapshot fired on the first render with ANY cards. TanStack
// hands back a cached list synchronously on mount and refetches in the
// background, so entering the quiz right after a commit froze the queue to the
// PREVIOUS session — and the snapshot is deliberately never re-read, so the
// fresh list that arrived milliseconds later was ignored for the whole session.

const STALE = [
  { ...mockCard, id: 'stale1', fsrs: { ...mockCard.fsrs, cardId: 'stale1' } },
  { ...mockCard, id: 'stale2', fsrs: { ...mockCard.fsrs, cardId: 'stale2' } },
];
const FRESH = [
  { ...mockCard, id: 'fresh1', fsrs: { ...mockCard.fsrs, cardId: 'fresh1' } },
  { ...mockCard, id: 'fresh2', fsrs: { ...mockCard.fsrs, cardId: 'fresh2' } },
];

test('does not snapshot a cached queue while a fresh one is still being fetched', () => {
  // Mount exactly as it happens after a commit: cached data present, refetch in
  // flight. The old code froze the session to STALE right here.
  mockDue = { cards: STALE, isLoading: false, isFetching: true };
  const { rerender } = render(<QuizScreen />);
  expect(screen.queryByText('hola')).toBeNull(); // holding, not showing a card

  // Refetch lands.
  mockDue = { cards: FRESH, isLoading: false, isFetching: false };
  rerender(<QuizScreen />);

  // The session runs on the FRESH queue. `1 / 2` proves a session started at all.
  expect(screen.getByText('1')).toBeTruthy();
  expect(screen.getByText('hola')).toBeTruthy();
});

test('snapshots immediately when the cached queue is not being refetched', () => {
  // The common case must not regress into an extra spinner frame.
  mockDue = { cards: FRESH, isLoading: false, isFetching: false };
  render(<QuizScreen />);
  expect(screen.getByText('hola')).toBeTruthy();
});

test('holds the session on the snapshot once taken, ignoring later refetches', () => {
  // The reason the snapshot exists: committing invalidates ['dueCards'] and the
  // refetch comes back re-scheduled, which must not reshuffle the results the
  // user is reading.
  mockDue = { cards: FRESH, isLoading: false, isFetching: false };
  const { rerender } = render(<QuizScreen />);
  expect(screen.getByText('1')).toBeTruthy();

  mockDue = { cards: [], isLoading: false, isFetching: false };
  rerender(<QuizScreen />);
  expect(screen.getByText('hola')).toBeTruthy(); // still mid-session, not "All caught up"
});
