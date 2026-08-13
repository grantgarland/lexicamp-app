// syncPushRegistration — the session-start pass that keeps this device's push
// token pointing at the account currently signed in (2026-08-12).
//
// The contract worth testing is what it must NOT do. `registerForPush` is the
// opt-in action and is allowed to ask the OS for permission; this one runs
// unprompted on every session start and foreground, so raising a system
// permission sheet here would be a user-visible bug with no user action behind
// it. The "already granted" gate is the whole safety property.
const mockDeviceState = { isDevice: true };

jest.mock('expo-device', () => ({
  get isDevice() {
    return mockDeviceState.isDevice;
  },
}));

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
  AndroidImportance: { DEFAULT: 3 },
}));

jest.mock('expo-constants', () => ({ expoConfig: { extra: { eas: { projectId: 'proj-1' } } } }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const mockRegisterPushToken = jest.fn().mockResolvedValue(undefined);
jest.mock('@/data', () => ({
  USE_SUPABASE: true,
  get dataSource() {
    return { registerPushToken: mockRegisterPushToken };
  },
}));

import * as Notifications from 'expo-notifications';

import { syncPushRegistration } from '../push';

const getPermissions = Notifications.getPermissionsAsync as jest.Mock;
const requestPermissions = Notifications.requestPermissionsAsync as jest.Mock;
const getToken = Notifications.getExpoPushTokenAsync as jest.Mock;

beforeEach(() => {
  mockDeviceState.isDevice = true;
  mockRegisterPushToken.mockResolvedValue(undefined);
  getToken.mockResolvedValue({ data: 'ExponentPushToken[abc]' });
});

describe('syncPushRegistration', () => {
  it('claims the device for the signed-in account when permission is already granted', async () => {
    getPermissions.mockResolvedValue({ granted: true, canAskAgain: false });

    await expect(syncPushRegistration()).resolves.toBe(true);

    expect(mockRegisterPushToken).toHaveBeenCalledWith('ExponentPushToken[abc]', expect.stringMatching(/^(ios|android)$/));
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it('NEVER raises the OS prompt when permission has not been granted yet', async () => {
    // canAskAgain: true is the tempting case — the prompt WOULD succeed here.
    // Showing it is still wrong: nothing the user did asked for it.
    getPermissions.mockResolvedValue({ granted: false, canAskAgain: true });

    await expect(syncPushRegistration()).resolves.toBe(false);

    expect(requestPermissions).not.toHaveBeenCalled();
    expect(mockRegisterPushToken).not.toHaveBeenCalled();
  });

  it('no-ops on a simulator, which has no APNs token to claim', async () => {
    mockDeviceState.isDevice = false;
    getPermissions.mockResolvedValue({ granted: true, canAskAgain: false });

    await expect(syncPushRegistration()).resolves.toBe(false);

    expect(getPermissions).not.toHaveBeenCalled();
    expect(mockRegisterPushToken).not.toHaveBeenCalled();
  });

  it('does not register a null token (getExpoPushTokenAsync can fail offline)', async () => {
    getPermissions.mockResolvedValue({ granted: true, canAskAgain: false });
    getToken.mockRejectedValue(new Error('offline'));

    await expect(syncPushRegistration()).resolves.toBe(false);

    expect(mockRegisterPushToken).not.toHaveBeenCalled();
  });
});
