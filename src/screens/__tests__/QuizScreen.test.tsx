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
jest.mock('@/query/hooks', () => ({
  useDueCards: () => ({ cards: [mockCard, { ...mockCard, id: 'c2', fsrs: { ...mockCard.fsrs, cardId: 'c2' } }], isLoading: false }),
  useHomeData: () => ({ streakDays: 3 }),
  useCommitQuizSession: () => ({ mutate: jest.fn() }),
  useEntitlement: () => ({ entitlement: undefined, isPaid: false, isLoading: false }), // 17 §S2: session cap read
}));

// The tour drives this screen through `useTourScene` (a real zustand store, safe to
// drive directly) plus `useWalkthroughActive`, which needs a provider it will not have
// here — mock the module and keep the overlay host inert.
jest.mock('@/tour/walkthrough', () => ({
  useWalkthroughActive: () => true,
  WalkthroughOverlayHost: () => null,
  tourTargets: { quizGutter: { current: null } },
}));

import { fireEvent, render, screen } from '@testing-library/react-native';
import { QuizScreen } from '@/screens/QuizScreen';
import { useTourScene } from '@/tour/tourScene';
import i18n from '@/i18n';

beforeEach(() => {
  mockBack.mockClear();
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

// The capture-flow path (2026-08-04): `.maestro/capture-onboarding-shots.yaml`
// taps × AFTER revealing a card, not on the front. On device that tap registered
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
