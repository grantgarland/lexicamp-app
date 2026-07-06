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
    Easing: { out: () => () => 0, in: () => () => 0, cubic: () => 0 },
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
};
jest.mock('@/query/hooks', () => ({
  useDueCards: () => ({ cards: [mockCard, { ...mockCard, id: 'c2' }], isLoading: false }),
  useHomeData: () => ({ streakDays: 3 }),
  useCommitQuizSession: () => ({ mutate: jest.fn() }),
}));

import { fireEvent, render, screen } from '@testing-library/react-native';
import { QuizScreen } from '@/screens/QuizScreen';
import i18n from '@/i18n';

beforeEach(() => mockBack.mockClear());

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

test('confirming exit calls router.back()', () => {
  render(<QuizScreen />);
  fireEvent.press(screen.getByLabelText(i18n.t('quiz.closeQuiz')));
  fireEvent.press(screen.getByText(i18n.t('quiz.exitConfirm')));
  expect(mockBack).toHaveBeenCalledTimes(1);
});
