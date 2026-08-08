// @ts-nocheck — see WordListScreen.test.tsx: jest mock-factory hoisting forbids
// identifiers inside the factories, so this file is excluded from tsc.
//
// Appearance is edited in Settings → Edit Profile, and until 2026-08-08 it was
// the one control in that sheet that wrote through on tap. Two things came of
// that: it was inconsistent (every other field waits for Save), and applying a
// scheme rebuilds the app tree — which resets the state holding "this sheet is
// open", so the picker destroyed its own host in a single frame and dumped the
// user back on the Settings hub.
//
// So the tap now only moves a DRAFT. What these tests hold in place is the
// contract that follows: nothing reaches `appearanceStore` before Save, Save
// applies it and closes the sheet, and dismissing throws the draft away.

jest.mock('react-native-unistyles', () => {
  const { lightTheme } = require('@/theme/theme');
  return {
    StyleSheet: {
      create: (styles) => (typeof styles === 'function' ? styles(lightTheme) : styles),
      configure: () => {},
    },
    createUnistylesElement: (c) => c,
    useUnistyles: () => ({ theme: lightTheme }),
    UnistylesRuntime: { themeName: 'light', setTheme: jest.fn(), setRootViewBackgroundColor: () => {} },
  };
});

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (c) => c },
    Easing: { out: () => () => 0, in: () => () => 0, cubic: () => 0 },
    useSharedValue: (v) => ({ value: v }),
    useAnimatedStyle: () => ({}),
    useAnimatedKeyboard: () => ({ height: { value: 0 }, state: { value: 0 } }),
    withTiming: (v) => v,
    runOnJS: (fn) => fn,
    interpolate: () => 0,
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: (props) => props.children,
}));

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));

const mockSetUsername = { mutate: jest.fn(), isPending: false };
jest.mock('@/query/hooks', () => ({
  useAccountIdentity: () => ({ email: 'a@b.com', provider: 'email' }),
  useSetUsername: () => mockSetUsername,
  useNotificationPrefs: () => ({ prefs: null, isLoading: false }),
  useUpdateNotificationPrefs: () => ({ mutate: jest.fn(), isPending: false }),
  useUpdateProfile: () => ({ mutate: jest.fn(), isPending: false }),
}));

import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';
import { EditProfileSheet } from '@/screens/settings/sheets';
import { useAppearanceStore } from '@/store/appearanceStore';
import { PortalHost } from '@/ui/Portal';

const t = (k) => i18n.t(k);
const PROFILE = { username: 'brave-otter', usernameChanges: 0, nativeLang: 'en', targetLang: 'es' };

const onClose = jest.fn();
const show = (props = {}) =>
  render(
    <>
      <EditProfileSheet visible profile={PROFILE} isPaid onClose={onClose} onUpgrade={jest.fn()} {...props} />
      <PortalHost />
    </>,
  );

const saveButton = () => screen.getByText(t('settings.save'));
const selected = (m) => screen.getByTestId(`appearance-${m}`).props.accessibilityState?.selected === true;
const mode = () => useAppearanceStore.getState().mode;

beforeEach(() => {
  jest.clearAllMocks();
  useAppearanceStore.setState({ mode: 'system', resolved: 'light' });
});

describe('appearance is saved, not applied on tap', () => {
  it('starts with Save inert and the store untouched', () => {
    show();
    expect(saveButton()).toBeDisabled();
    expect(mode()).toBe('system');
  });

  it('enables Save on a change without applying it', () => {
    show();
    fireEvent.press(screen.getByTestId('appearance-dark'));

    // The choice is visibly selected...
    expect(selected('dark')).toBe(true);
    // ...but nothing has been applied: the app is still in the old scheme, so
    // the tree rebuild that would tear this sheet down has not fired.
    expect(mode()).toBe('system');
    expect(saveButton()).toBeEnabled();
  });

  it('applies the choice and closes the sheet on Save', () => {
    show();
    fireEvent.press(screen.getByTestId('appearance-dark'));
    fireEvent.press(saveButton());

    expect(mode()).toBe('dark');
    expect(onClose).toHaveBeenCalled();
    // Appearance-only: the username RPC is never called.
    expect(mockSetUsername.mutate).not.toHaveBeenCalled();
  });

  it('discards the draft when the sheet is dismissed unsaved', () => {
    const view = show();
    fireEvent.press(screen.getByTestId('appearance-dark'));

    // Close, then reopen — the picker re-seeds from the store, like every other
    // field in this sheet.
    view.rerender(
      <>
        <EditProfileSheet visible={false} profile={PROFILE} isPaid onClose={onClose} onUpgrade={jest.fn()} />
        <PortalHost />
      </>,
    );
    expect(mode()).toBe('system');

    view.rerender(
      <>
        <EditProfileSheet visible profile={PROFILE} isPaid onClose={onClose} onUpgrade={jest.fn()} />
        <PortalHost />
      </>,
    );
    expect(selected('system')).toBe(true);
    expect(saveButton()).toBeDisabled();
  });

  it('returning to the applied mode is not a change', () => {
    show();
    fireEvent.press(screen.getByTestId('appearance-dark'));
    fireEvent.press(screen.getByTestId('appearance-system'));

    expect(saveButton()).toBeDisabled();
  });

  it("lets a free user who has spent their username change still save appearance", () => {
    // `canCycle` gates the username half only — an exhausted name change must
    // not lock the appearance control out of Save.
    show({ isPaid: false, profile: { ...PROFILE, usernameChanges: 1 } });
    fireEvent.press(screen.getByTestId('appearance-light'));

    expect(saveButton()).toBeEnabled();
    fireEvent.press(saveButton());
    // ...and straight through: the one-free-change interstitial belongs to the
    // username, so an appearance-only save never meets it.
    expect(mode()).toBe('light');
    expect(onClose).toHaveBeenCalled();
  });
});
