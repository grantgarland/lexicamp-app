// @ts-nocheck — jest mock-factory hoisting forbids identifiers inside the
// factories, so this file is excluded from tsc (see QuizScreen.test.tsx).
//
// ResetPasswordScreen (DF-3), guarding the three things it got wrong.
//
// This screen is the ONLY one reached from outside the app (the emailed
// recovery link), and it is registered with `gestureEnabled: false` and no
// header — so nothing the navigator provides can get a user off it. It shipped
// with no exit at all, and the two dev overlays both sit in the top corners,
// which is exactly the kind of thing that gets "tidied" back out. Hence a test
// rather than a screenshot: the exit is load-bearing, and its sign-out doubly
// so — see `cancels ... signs the recovery session out` below.
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

// `@/ui`'s barrel reaches Sheet → reanimated, which has no native half here.
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
    Easing: { linear: (x) => x, out: () => (x) => x, in: () => (x) => x, cubic: (x) => x },
    useSharedValue: (v) => ({ value: v }),
    useAnimatedStyle: (fn) => fn(),
    useAnimatedKeyboard: () => ({ height: { value: 0 }, state: { value: 0 } }),
    withTiming: (to) => to,
    withDelay: (_ms, v) => v,
    withSpring: (v) => v,
    cancelAnimation: () => {},
    runOnJS: (fn) => fn,
    ...entering,
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: (props) => props.children,
}));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));

// Live-backend mode: the real recovery path, and the only one where the
// session/sign-out behaviour under test exists at all.
jest.mock('@/data', () => ({ USE_SUPABASE: true }));

const mockUpdatePassword = jest.fn();
const mockSignOut = jest.fn();
jest.mock('@/auth/session', () => ({
  updatePassword: (...a) => mockUpdatePassword(...a),
  signOut: (...a) => mockSignOut(...a),
  useSession: () => ({ session: { user: { id: 'u1' } }, isLoading: false }),
}));

// Assert on i18n KEYS, not copy: this suite is about which message is chosen,
// and the en/es wording is parity.test.ts's job.
jest.mock('@/i18n', () => ({ useTranslation: () => ({ t: (k) => k }) }));

jest.mock('@/theme/appearance', () => ({ useIsDark: () => false }));

const mockShowToast = jest.fn();
jest.mock('@/store/uiStore', () => ({
  useUiStore: { getState: () => ({ showToast: mockShowToast }) },
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ResetPasswordScreen } from '../ResetPasswordScreen';

beforeEach(() => {
  mockReplace.mockClear();
  mockUpdatePassword.mockReset().mockResolvedValue(undefined);
  mockSignOut.mockReset().mockResolvedValue(undefined);
  mockShowToast.mockClear();
});

const typeBoth = (password, confirm = password) => {
  fireEvent.changeText(screen.getByTestId('resetPassword'), password);
  fireEvent.changeText(screen.getByTestId('resetConfirm'), confirm);
};

describe('ResetPasswordScreen — the way out', () => {
  it('offers an exit that lands on the auth screen', () => {
    render(<ResetPasswordScreen />);
    fireEvent.press(screen.getByTestId('resetCancel'));
    expect(mockReplace).toHaveBeenCalledWith('/auth');
  });

  it('cancelling signs the recovery session out, not just navigates', async () => {
    // The recovery session is a REAL signed-in session — it is what authenticates
    // updatePassword. Leaving it alive behind the exit would turn the emailed
    // link into entry to the account WITHOUT ever setting a password: open link,
    // tap ×, walk in. Deleting the signOut call would still pass the test above.
    render(<ResetPasswordScreen />);
    fireEvent.press(screen.getByTestId('resetCancel'));
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  });

  it('a failing sign-out still lets the user leave', async () => {
    mockSignOut.mockRejectedValue(new Error('network request failed'));
    render(<ResetPasswordScreen />);
    fireEvent.press(screen.getByTestId('resetCancel'));
    expect(mockReplace).toHaveBeenCalledWith('/auth');
  });
});

describe('ResetPasswordScreen — telling the user what is wrong', () => {
  it('names the empty field instead of leaving a dead button', () => {
    // Was: `onPress={canSubmit ? submit : undefined}` — a full-strength amber
    // CTA that silently did nothing.
    render(<ResetPasswordScreen />);
    fireEvent.press(screen.getByTestId('resetSubmit'));
    expect(screen.getByText('auth.err.missingPassword')).toBeTruthy();
    expect(mockUpdatePassword).not.toHaveBeenCalled();
  });

  it('catches a too-short password without spending a round trip', () => {
    render(<ResetPasswordScreen />);
    typeBoth('abc');
    fireEvent.press(screen.getByTestId('resetSubmit'));
    expect(screen.getByText('auth.err.weakPassword')).toBeTruthy();
    expect(mockUpdatePassword).not.toHaveBeenCalled();
  });

  it('states the length rule up front, before anything is typed', () => {
    render(<ResetPasswordScreen />);
    expect(screen.getByText('auth.passwordHint')).toBeTruthy();
  });

  it('sanitizes what GoTrue sends back — never the raw English', async () => {
    mockUpdatePassword.mockRejectedValue(
      new Error('New password should be different from the old password.'),
    );
    render(<ResetPasswordScreen />);
    typeBoth('hunter2');
    fireEvent.press(screen.getByTestId('resetSubmit'));
    await waitFor(() => expect(screen.getByText('auth.err.samePassword')).toBeTruthy());
    expect(screen.queryByText(/should be different from the old/i)).toBeNull();
  });

  it('submits and enters the app once the form is valid', async () => {
    render(<ResetPasswordScreen />);
    typeBoth('hunter2');
    fireEvent.press(screen.getByTestId('resetSubmit'));
    await waitFor(() => expect(mockUpdatePassword).toHaveBeenCalledWith('hunter2'));
    expect(mockReplace).toHaveBeenCalledWith('/');
  });
});
