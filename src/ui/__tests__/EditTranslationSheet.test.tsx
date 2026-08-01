// @ts-nocheck — jest mock factories forbid out-of-scope identifiers, which
// conflicts with TS annotations. Tests run through babel (types stripped).
//
// Edit Translations sheet (Premium, 2026-07-28). Two things here are worth
// pinning: the CTAs must exist and be reachable with the keyboard open (they
// live in Sheet's pinned `footer`, which is why this renders the real Sheet
// rather than mocking it), and Confirm must refuse a no-op — a write that
// changes nothing still costs a round trip and reads to the user as though
// something happened.

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
    return b;
  };
  const entering = new Proxy({}, { get: () => builder });
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (c) => c },
    View,
    Easing: { out: () => () => 0, in: () => () => 0, linear: (x) => x, cubic: () => 0 },
    useSharedValue: (v) => ({ value: v }),
    useAnimatedStyle: (fn) => (typeof fn === 'function' ? fn() : {}),
    // Keyboard closed: the lift is a visual concern, but the sheet must still
    // mount and render its footer without a real NativeModule behind it.
    useAnimatedKeyboard: () => ({ height: { value: 0 }, state: { value: 0 } }),
    withTiming: (v) => v,
    runOnJS: (fn) => fn,
    cancelAnimation: () => {},
    ...entering,
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
  SafeAreaProvider: (props) => props.children,
}));

import { fireEvent, render, screen } from '@testing-library/react-native';
import { EditTranslationSheet } from '@/ui/EditTranslationSheet';
import { PortalHost } from '@/ui/Portal';
import i18n from '@/i18n';

const WORD = {
  id: 'c1',
  translationId: 't1',
  senseTarget: 'немой',
  native: 'numb',
  target: 'немой',
  originalTarget: 'немой',
  targetOverride: null,
  pos: 'adjective',
  example: '',
  exampleTranslation: '',
  provider: 'azure_dictionary' as const,
  stability: 4,
  reps: 3,
  createdAt: new Date('2026-07-01T00:00:00Z'),
  dueAt: new Date('2026-07-30T00:00:00Z'),
  suspended: false,
};

const setup = (props = {}) =>
  render(
    <>
      <EditTranslationSheet word={WORD} onClose={jest.fn()} onConfirm={jest.fn()} {...props} />
      <PortalHost />
    </>,
  );

test('renders the field, the original, and BOTH CTAs (pinned footer, not scrolled away)', () => {
  setup();
  expect(screen.getByDisplayValue('немой')).toBeTruthy();
  expect(screen.getByText(i18n.t('editTranslation.confirm'))).toBeTruthy();
  expect(screen.getByText(i18n.t('common.cancel'))).toBeTruthy();
});

const confirmBtn = () => screen.getByRole('button', { name: i18n.t('editTranslation.confirm') });
const confirmDisabled = () => confirmBtn().props.accessibilityState?.disabled === true;

test('Confirm is inert until the text actually changes (no no-op writes)', () => {
  const onConfirm = jest.fn();
  setup({ onConfirm });

  // Disabled is the assertion: RTL refuses to press a button with no handler,
  // which is precisely the guarantee — a no-op Confirm is not merely ignored,
  // it is untappable.
  expect(confirmDisabled()).toBe(true); // unchanged draft

  fireEvent.changeText(screen.getByDisplayValue('немой'), 'немая');
  expect(confirmDisabled()).toBe(false);
  fireEvent.press(confirmBtn());
  expect(onConfirm).toHaveBeenCalledWith('немая');
});

test('whitespace-only edits, pure re-spacing and an emptied field are all no-ops', () => {
  const onConfirm = jest.fn();
  setup({ onConfirm });
  const field = screen.getByDisplayValue('немой');

  fireEvent.changeText(field, '   немой  ');
  expect(confirmDisabled()).toBe(true); // trims to the same text

  fireEvent.changeText(field, '   ');
  expect(confirmDisabled()).toBe(true); // clearing is Reset's job, not Confirm's

  // ...and Return can't sneak past the gate either.
  fireEvent(field, 'submitEditing');
  expect(onConfirm).not.toHaveBeenCalled();
});

test('the keyboard return key commits, so a one-word edit never needs a reach past it', () => {
  const onConfirm = jest.fn();
  setup({ onConfirm });
  const field = screen.getByDisplayValue('немой');
  fireEvent.changeText(field, 'вода');
  fireEvent(field, 'submitEditing');
  expect(onConfirm).toHaveBeenCalledWith('вода');
});

test('an existing override offers a reset that clears it (null), and marks the card edited', () => {
  const onConfirm = jest.fn();
  setup({ word: { ...WORD, target: 'вода', targetOverride: 'вода' }, onConfirm });
  expect(screen.getByText(i18n.t('editTranslation.editedBadge'))).toBeTruthy();
  fireEvent.press(screen.getByTestId('edit-translation-reset'));
  expect(onConfirm).toHaveBeenCalledWith(null);
});

test('no override → no reset action', () => {
  setup();
  expect(screen.queryByTestId('edit-translation-reset')).toBeNull();
});
