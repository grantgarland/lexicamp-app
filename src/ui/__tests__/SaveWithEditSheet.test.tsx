// @ts-nocheck — jest mock-factory hoisting forbids identifiers inside the
// factories, so this file is excluded from tsc (see QuizScreen.test.tsx).
//
// Save-time translation edit (Premium, 2026-08-04). The feature exists because a
// dictionary that returns «годы» for "year" makes a user hesitate over Save, and
// a word not saved is a word never learned. So the rule that matters is that the
// sheet always ends in a SAVE: confirming an untouched field is not a no-op, it
// is a plain save. That is the opposite of the post-save editor next door, where
// an unchanged value is correctly rejected as a wasted write.

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

import { fireEvent, render, screen } from '@testing-library/react-native';
import { SaveWithEditSheet, TARGET_OVERRIDE_MAX } from '@/ui/SaveWithEditSheet';
import { PortalHost } from '@/ui/Portal';

const onConfirm = jest.fn();
const onClose = jest.fn();
const WORD = { headword: 'year', target: 'годы', pos: 'noun' };

const show = (props = {}) =>
  render(
    <>
      <SaveWithEditSheet word={WORD} onConfirm={onConfirm} onClose={onClose} {...props} />
      <PortalHost />
    </>,
  );

const field = () => screen.getByTestId('save-with-edit-input');
const confirm = () => screen.getByTestId('save-with-edit-confirm');

describe('SaveWithEditSheet', () => {
  it('opens pre-filled with what the dictionary returned', () => {
    show();
    expect(field().props.value).toBe('годы');
  });

  it('confirms the corrected lemma — the motivating case', () => {
    show();
    fireEvent.changeText(field(), 'год');
    fireEvent.press(confirm());
    expect(onConfirm).toHaveBeenCalledWith('год');
  });

  it('still saves when the user changes nothing', () => {
    // They opened the editor, read it, decided it was fine. That must save the
    // word, not silently do nothing — the whole feature is about removing
    // hesitation from Save.
    show();
    fireEvent.press(confirm());
    expect(onConfirm).toHaveBeenCalledWith('годы');
  });

  it('trims stray whitespace', () => {
    show();
    fireEvent.changeText(field(), '  год  ');
    fireEvent.press(confirm());
    expect(onConfirm).toHaveBeenCalledWith('год');
  });

  it('refuses an empty field', () => {
    show();
    fireEvent.changeText(field(), '   ');
    expect(confirm()).toBeDisabled();
  });

  it('refuses text past the column limit the DB enforces', () => {
    show();
    fireEvent.changeText(field(), 'я'.repeat(TARGET_OVERRIDE_MAX + 1));
    expect(confirm()).toBeDisabled();
  });

  it('is inert while the save is in flight', () => {
    show({ isSaving: true });
    expect(confirm()).toBeDisabled();
  });

  it('re-fills when opened for a different sense', () => {
    const { rerender } = show();
    fireEvent.changeText(field(), 'год');

    rerender(
      <>
        <SaveWithEditSheet word={{ headword: 'to go', target: 'ехать' }} onConfirm={onConfirm} onClose={onClose} />
        <PortalHost />
      </>,
    );
    // The previous sense's draft must not carry over onto a different word.
    expect(field().props.value).toBe('ехать');
  });
});
