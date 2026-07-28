// @ts-nocheck — jest mock factories forbid out-of-scope identifiers, which
// conflicts with TS annotations here. Tests run through babel (types stripped).
//
// Quiz auto-traversal (2026-07-28). The grading rule itself is covered by
// domain/__tests__/answer.test.ts; THIS suite covers the part that can silently
// commit a wrong review: the override window (AUTO_ADVANCE_MS — read from the
// component, never hardcoded here, so retuning the duration can't quietly
// invalidate these). The failure modes it
// guards are (a) the timer firing for a card the user already rated, and (b) the
// timer firing after the component is gone — both write FSRS state for the wrong
// card, and neither is visible in a screenshot.

// unistyles is NitroModule-backed (no native binary under jest) — resolve
// StyleSheet.create/useUnistyles against the real theme tokens.
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

// Reanimated stand-in: withTiming schedules its completion callback on a real
// timer so jest's fake clock can drive the countdown deterministically, and
// cancelAnimation clears it — exactly the contract RatingButtons relies on.
jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  const handles = new Map();
  let nextId = 1;
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (c) => c },
    View,
    Easing: { linear: (x) => x, out: () => (x) => x, in: () => (x) => x, cubic: (x) => x },
    useSharedValue: (initial) => ({ value: initial, __id: nextId++ }),
    useAnimatedStyle: (fn) => fn(),
    withTiming: (to, config, cb) => {
      const id = setTimeout(() => cb?.(true), config?.duration ?? 0);
      handles.set('last', id);
      return to;
    },
    cancelAnimation: () => {
      const id = handles.get('last');
      if (id != null) clearTimeout(id);
      handles.delete('last');
    },
    runOnJS: (fn) => fn,
  };
});

import { fireEvent, render, screen } from '@testing-library/react-native';
import { AUTO_ADVANCE_MS, RatingButtons } from '@/ui/RatingButtons';
import i18n from '@/i18n';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('no highlight → nothing self-commits (the manual reveal path is unchanged)', () => {
  const onRate = jest.fn();
  const onAuto = jest.fn();
  render(<RatingButtons onRate={onRate} onAutoSelect={onAuto} />);
  jest.advanceTimersByTime(AUTO_ADVANCE_MS * 3);
  expect(onAuto).not.toHaveBeenCalled();
  expect(onRate).not.toHaveBeenCalled();
});

test('the graded button is marked selected and auto-commits when the window closes', () => {
  const onAuto = jest.fn();
  render(<RatingButtons onRate={jest.fn()} highlighted="almost" onAutoSelect={onAuto} />);

  expect(screen.getByTestId('rating-almost').props.accessibilityState.selected).toBe(true);
  expect(screen.getByTestId('rating-got_it').props.accessibilityState.selected).toBe(false);

  // Still the user's window a beat before the timer expires.
  jest.advanceTimersByTime(AUTO_ADVANCE_MS - 1);
  expect(onAuto).not.toHaveBeenCalled();

  jest.advanceTimersByTime(1);
  expect(onAuto).toHaveBeenCalledTimes(1);
  expect(onAuto).toHaveBeenCalledWith('almost');
});

test('a manual tap wins and cancels the timer — even when it disagrees with the grade', () => {
  const onRate = jest.fn();
  const onAuto = jest.fn();
  render(<RatingButtons onRate={onRate} highlighted="got_it" onAutoSelect={onAuto} />);

  fireEvent.press(screen.getByTestId('rating-again'));
  expect(onRate).toHaveBeenCalledWith('again');

  jest.advanceTimersByTime(AUTO_ADVANCE_MS * 2);
  expect(onAuto).not.toHaveBeenCalled(); // must NOT also rate the card "got it"
  expect(onRate).toHaveBeenCalledTimes(1);
});

test('unmounting mid-window never commits a rating for the card that left', () => {
  const onAuto = jest.fn();
  const view = render(<RatingButtons onRate={jest.fn()} highlighted="again" onAutoSelect={onAuto} />);
  view.unmount();
  jest.advanceTimersByTime(AUTO_ADVANCE_MS * 2);
  expect(onAuto).not.toHaveBeenCalled();
});

test('labels are the real localized CTAs (Limited / Almost / Got it)', () => {
  render(<RatingButtons onRate={jest.fn()} highlighted="again" onAutoSelect={jest.fn()} />);
  expect(screen.getByText(i18n.t('rating.again'))).toBeTruthy();
  expect(screen.getByText(i18n.t('rating.almost'))).toBeTruthy();
  expect(screen.getByText(i18n.t('rating.gotIt'))).toBeTruthy();
});
