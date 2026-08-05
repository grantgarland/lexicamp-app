// @ts-nocheck — jest mock-factory hoisting forbids identifiers inside the
// factories, so this file is excluded from tsc (see QuizScreen.test.tsx).
//
// The type-to-confirm gate on ConfirmDialog. It exists for exactly one caller —
// account deletion, which has no undo and no recovery window — so "the button
// was disabled" is the whole feature, and the localization rule below is the
// part most likely to be quietly broken by a later refactor.

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
import { ConfirmDialog, matchesConfirmWord } from '@/ui/ConfirmDialog';
import { PortalHost } from '@/ui/Portal';

const onConfirm = jest.fn();
const onClose = jest.fn();

const GATE = { word: 'delete', label: 'Type “delete” to confirm', placeholder: 'delete' };

const show = (props = {}) =>
  render(
    <>
      <ConfirmDialog visible title="Delete your account?" confirmLabel="Yes, delete my account" destructive typeToConfirm={GATE} onConfirm={onConfirm} onClose={onClose} {...props} />
      <PortalHost />
    </>,
  );

const type = (text) => fireEvent.changeText(screen.getByTestId('confirm-type-gate'), text);
const confirmButton = () => screen.getByTestId('confirm-accept');
// A disabled Button carries no onPress at all, so `fireEvent.press` would THROW
// rather than no-op. Assert the disabled state, and only press when it's live.
const expectGated = () => {
  expect(confirmButton()).toBeDisabled();
  expect(onConfirm).not.toHaveBeenCalled();
};
const pressConfirm = () => {
  expect(confirmButton()).toBeEnabled();
  fireEvent.press(confirmButton());
};

describe('ConfirmDialog type-to-confirm gate', () => {
  it('will not fire until the word is typed', () => {
    show();
    expectGated();

    type('del');
    expectGated();

    type('delete');
    pressConfirm();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('forgives casing and stray whitespace', () => {
    // Autocapitalize is off, but a keyboard suggestion or a trailing space from
    // a paste should not read as "wrong word" to someone who did the right thing.
    show();
    type('  DeLeTe ');
    pressConfirm();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('gates on the word the user was SHOWN, not on the English one', () => {
    // The rule that makes this translatable: whatever `t()` returned is both the
    // rendered instruction and the compared value. If a later refactor compares
    // to a hardcoded 'delete', this test fails — and so would every Spanish,
    // Japanese or Turkish user, silently, with a button that never enables.
    show({ typeToConfirm: { word: 'eliminar', label: 'Escribe “eliminar” para confirmar' } });

    type('delete');
    expectGated();

    type('eliminar');
    pressConfirm();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('starts empty again when the dialog is reopened', () => {
    // Otherwise the previous attempt's text is still in the field and the
    // destructive button is live the instant the sheet reappears.
    const { rerender } = show();
    type('delete');

    const dialog = (visible) => (
      <>
        <ConfirmDialog visible={visible} title="Delete your account?" confirmLabel="Yes, delete my account" destructive typeToConfirm={GATE} onConfirm={onConfirm} onClose={onClose} />
        <PortalHost />
      </>
    );
    rerender(dialog(false));
    rerender(dialog(true));

    expectGated();
  });

  it('leaves every other confirm dialog ungated', () => {
    // Delete-word, delete-deck, sign-out etc. pass no `typeToConfirm` and must
    // keep firing on the first press.
    show({ typeToConfirm: undefined });
    expect(screen.queryByTestId('confirm-type-gate')).toBeNull();
    pressConfirm();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('matchesConfirmWord', () => {
  it('compares two arbitrary strings, not a known constant', () => {
    expect(matchesConfirmWord('Törlés', 'törlés')).toBe(true);
    expect(matchesConfirmWord('削除', '削除')).toBe(true);
    expect(matchesConfirmWord('', '')).toBe(true); // degenerate, but consistent
    expect(matchesConfirmWord('delete', 'eliminar')).toBe(false);
  });
});
