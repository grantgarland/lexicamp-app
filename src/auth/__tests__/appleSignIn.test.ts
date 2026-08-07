// signInWithApple — the native Sign in with Apple exchange (2026-08-01).
// Covers the three behaviours that actually bite in the field: the first-sign-in
// name (Apple sends it exactly once), the cancel path (must NOT surface as an
// error), and a failed metadata write (must NOT sink a good session).
import * as AppleAuthentication from 'expo-apple-authentication';

import { supabase } from '@/data/supabase/client';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { unregisterForPush } from '@/notifications/push';

import { AppleSignInCancelled, isAppleSignInAvailable, signInWithApple, signOut } from '../session';

// session.ts reaches for the push module on sign-out (2026-08-05) to drop this
// device's token while the session is still valid. That module pulls in
// expo-notifications/expo-device, which are untransformed ESM under jest and
// have nothing to do with the Apple exchange under test here.
jest.mock('@/notifications/push', () => ({ unregisterForPush: jest.fn().mockResolvedValue(undefined) }));

jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: jest.fn(),
  signInAsync: jest.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/data/supabase/client', () => ({
  AUTH_STORAGE_KEY: 'sb-test-auth-token',
  supabase: {
    auth: {
      signInWithIdToken: jest.fn(),
      updateUser: jest.fn(),
      signOut: jest.fn(),
    },
  },
}));

const appleAuth = AppleAuthentication as jest.Mocked<typeof AppleAuthentication>;
const auth = supabase.auth as unknown as {
  signInWithIdToken: jest.Mock;
  updateUser: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
  auth.signInWithIdToken.mockResolvedValue({ data: {}, error: null });
  auth.updateUser.mockResolvedValue({ data: {}, error: null });
});

describe('signInWithApple', () => {
  it('exchanges the identity token and persists the first-sign-in name', async () => {
    (appleAuth.signInAsync as jest.Mock).mockResolvedValue({
      identityToken: 'tok123',
      fullName: { givenName: 'Casey', familyName: 'Garland' },
    });

    await expect(signInWithApple()).resolves.toEqual({ displayName: 'Casey Garland' });

    expect(auth.signInWithIdToken).toHaveBeenCalledWith({ provider: 'apple', token: 'tok123' });
    expect(auth.updateUser).toHaveBeenCalledWith({ data: { full_name: 'Casey Garland' } });
  });

  it('returns a null name on later sign-ins (Apple omits it) without writing metadata', async () => {
    (appleAuth.signInAsync as jest.Mock).mockResolvedValue({ identityToken: 'tok123', fullName: null });

    await expect(signInWithApple()).resolves.toEqual({ displayName: null });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('maps a dismissed sheet to AppleSignInCancelled', async () => {
    (appleAuth.signInAsync as jest.Mock).mockRejectedValue(
      Object.assign(new Error('cancelled'), { code: 'ERR_REQUEST_CANCELED' }),
    );

    await expect(signInWithApple()).rejects.toBeInstanceOf(AppleSignInCancelled);
    expect(auth.signInWithIdToken).not.toHaveBeenCalled();
  });

  it('throws when Apple returns no identity token', async () => {
    (appleAuth.signInAsync as jest.Mock).mockResolvedValue({ identityToken: null, fullName: null });

    await expect(signInWithApple()).rejects.toThrow(/identity token/i);
    expect(auth.signInWithIdToken).not.toHaveBeenCalled();
  });

  it('surfaces a Supabase rejection as a readable Error', async () => {
    (appleAuth.signInAsync as jest.Mock).mockResolvedValue({ identityToken: 'tok123', fullName: null });
    auth.signInWithIdToken.mockResolvedValue({ data: {}, error: { message: 'Unacceptable audience' } });

    await expect(signInWithApple()).rejects.toThrow('Unacceptable audience');
  });

  it('still resolves when the metadata write fails (session already valid)', async () => {
    (appleAuth.signInAsync as jest.Mock).mockResolvedValue({
      identityToken: 'tok123',
      fullName: { givenName: 'Casey', familyName: null },
    });
    auth.updateUser.mockRejectedValue(new Error('network'));

    await expect(signInWithApple()).resolves.toEqual({ displayName: 'Casey' });
  });
});

describe('isAppleSignInAvailable', () => {
  it('reports false instead of throwing on non-Apple platforms', async () => {
    (appleAuth.isAvailableAsync as jest.Mock).mockRejectedValue(new Error('unavailable'));
    await expect(isAppleSignInAvailable()).resolves.toBe(false);
  });

  it('passes through a true availability result', async () => {
    (appleAuth.isAvailableAsync as jest.Mock).mockResolvedValue(true);
    await expect(isAppleSignInAvailable()).resolves.toBe(true);
  });
});


// Duplicate push notifications, 2026-08-05: one phone signed into two accounts
// received two identical reminders every morning, because `push_tokens` is keyed
// (user_id, token) and signing out never removed the row.
describe('signOut drops this device from the account', () => {
  it('unregisters BEFORE the session is torn down', async () => {
    // Ordering is the whole fix: the delete is RLS-scoped to auth.uid(), so
    // running it after signOut() silently deletes nothing and the duplicate
    // notification comes back.
    const order: string[] = [];
    (unregisterForPush as jest.Mock).mockImplementation(async () => { order.push('unregister'); });
    (supabase.auth.signOut as jest.Mock).mockImplementation(async () => { order.push('signOut'); return {}; });

    await signOut();

    expect(order).toEqual(['unregister', 'signOut']);
  });

  it('still signs out when unregistering fails', async () => {
    // A network blip must never trap someone in a session they asked to leave.
    (unregisterForPush as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    (supabase.auth.signOut as jest.Mock).mockResolvedValue({});
    await expect(signOut()).resolves.toBeUndefined();
    expect(supabase.auth.signOut).toHaveBeenCalled();
  });
});


// Account deletion left the user sitting in the app (Casey, 2026-08-05).
//
// supabase-js refreshes an expired token before signing out. Once the account is
// deleted that refresh can only fail, and `_signOut` then returns the error
// WITHOUT removing the stored session — so no SIGNED_OUT is emitted, `useSession`
// never updates, and the tabs guard never redirects.
describe('signOut recovers when the library refuses to clear the session', () => {
  beforeEach(() => {
    (unregisterForPush as jest.Mock).mockResolvedValue(undefined);
    (AsyncStorage.removeItem as jest.Mock).mockClear().mockResolvedValue(undefined);
  });

  it('does nothing extra on the happy path', async () => {
    (supabase.auth.signOut as jest.Mock).mockResolvedValue({ error: null });
    await signOut();
    expect(supabase.auth.signOut).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  });

  it('clears the stored session and signs out AGAIN when the first attempt errors', async () => {
    // The second call is the point: with storage empty it takes the
    // session-missing path, which DOES emit SIGNED_OUT — and that event is what
    // actually moves the UI. Clearing storage alone fixes only the next launch.
    (supabase.auth.signOut as jest.Mock)
      .mockResolvedValueOnce({ error: { message: 'Invalid Refresh Token' } })
      .mockResolvedValueOnce({ error: null });

    await signOut();

    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('sb-test-auth-token');
    expect(supabase.auth.signOut).toHaveBeenCalledTimes(2);
    // Order matters: clearing storage AFTER the retry would leave the retry
    // seeing the same dead session and taking the same early return.
    const clearOrder = (AsyncStorage.removeItem as jest.Mock).mock.invocationCallOrder[0];
    const secondSignOut = (supabase.auth.signOut as jest.Mock).mock.invocationCallOrder[1];
    expect(clearOrder).toBeLessThan(secondSignOut);
  });

  it('still resolves when even the storage clear fails', async () => {
    (supabase.auth.signOut as jest.Mock).mockResolvedValue({ error: { message: 'boom' } });
    (AsyncStorage.removeItem as jest.Mock).mockRejectedValueOnce(new Error('disk'));
    await expect(signOut()).resolves.toBeUndefined();
  });
});
