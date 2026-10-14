// @ts-nocheck — jest mock-factory hoisting forbids identifiers inside the
// factories, so this file is excluded from tsc (see QuizScreen.test.tsx).
//
// The password reveal toggle on Input. Prod 2026-10-14: a new user retried a
// refused password five times with no way to see what they had typed. The
// a11y label is the part a refactor is most likely to break silently — it must
// name the action a tap performs, not the current state.

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

import '@/i18n';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Input } from '@/ui/Input';

describe('Input password reveal', () => {
  it('starts masked and toggles masking from the eye button', () => {
    render(<Input testID="pw" value="hunter22" onChangeText={() => {}} secureTextEntry />);
    expect(screen.getByTestId('pw').props.secureTextEntry).toBe(true);

    fireEvent.press(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByTestId('pw').props.secureTextEntry).toBe(false);

    fireEvent.press(screen.getByRole('button', { name: 'Hide password' }));
    expect(screen.getByTestId('pw').props.secureTextEntry).toBe(true);
  });

  it('keeps an unmasked password away from autocorrect and autocapitalisation', () => {
    render(<Input testID="pw" value="" onChangeText={() => {}} secureTextEntry />);
    fireEvent.press(screen.getByTestId('pwReveal'));
    const field = screen.getByTestId('pw');
    expect(field.props.autoCorrect).toBe(false);
    expect(field.props.autoCapitalize).toBe('none');
    expect(field.props.spellCheck).toBe(false);
  });

  it('adds no toggle to an ordinary field', () => {
    render(<Input testID="email" value="" onChangeText={() => {}} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTestId('email').props.secureTextEntry).toBe(false);
  });
});
