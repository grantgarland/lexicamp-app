// Push client (2.5 app-half). The server scheduler (run_push_scheduler) does
// the deciding; this module only (a) registers the device token after the user
// opts in, and (b) routes notification taps to the deep link the server sends
// (data.url = '/quiz'). No-ops on simulators and in mock mode.
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import { dataSource, USE_SUPABASE } from '@/data';

/** Foreground presentation + tap routing. Called once from the entry shim. */
export function initNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  Notifications.addNotificationResponseReceivedListener((response) => {
    const url = response.notification.request.content.data?.url;
    if (typeof url === 'string' && url.startsWith('/')) {
      // Server sends '/quiz' — typed-routes accept known paths only.
      router.push(url as '/quiz');
    }
  });
}

/** Ask the OS for notification permission. Split out of registerForPush so the
 *  onboarding O-06 step can raise the system prompt AT the moment the user taps
 *  "Enable notifications" — token registration needs a session, but the
 *  permission prompt does not, and deferring both until after auth meant the
 *  prompt appeared unexplained on the Home screen (reported 2026-08-01).
 *  Safe to call repeatedly: iOS only ever shows the sheet once. */
export async function requestPushPermission(): Promise<boolean> {
  if (!Device.isDevice) return false; // simulators have no APNs
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  // canAskAgain === false means the user previously denied; requesting is a
  // silent no-op, so don't pretend it succeeded.
  if (!existing.canAskAgain) return false;
  const status = await Notifications.requestPermissionsAsync();
  return status.granted;
}

/** Register this device's Expo token with the backend. Assumes permission was
 *  already granted (see requestPushPermission) but re-checks defensively, so the
 *  post-auth call path is still correct for users who came in another way. */
export async function registerForPush(): Promise<boolean> {
  if (!USE_SUPABASE || !Device.isDevice) return false; // mock mode / simulator

  if (!(await requestPushPermission())) return false;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Review reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const token = await expoPushToken();
  if (token == null) return false;
  await dataSource.registerPushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
  return true;
}

/**
 * Re-assert THIS device's token for the account currently signed in — without
 * ever raising the OS permission prompt.
 *
 * `registerForPush` is the opt-in action: it asks. This is the maintenance pass
 * that runs on every session start, so it stays silent and returns early unless
 * permission is ALREADY granted.
 *
 * It exists because a push token identifies a DEVICE, not an account, and the
 * server keys `push_tokens` by token — whoever registered last owns the phone.
 * Registration used to happen only at onboarding and on a Settings → Reminders
 * save, so signing into another account left the device registered to the
 * PREVIOUS one indefinitely. Reminders then arrived on that account's schedule,
 * carrying its due-count, while Settings showed the signed-in account's time
 * (diagnosed 2026-08-12 — see the migration of the same date).
 */
export async function syncPushRegistration(): Promise<boolean> {
  if (!USE_SUPABASE || !Device.isDevice) return false; // mock mode / simulator
  // Deliberately NOT requestPushPermission(): that one asks. A background sync
  // must never surface a system prompt the user did not trigger.
  if (!(await Notifications.getPermissionsAsync()).granted) return false;
  const token = await expoPushToken();
  if (token == null) return false;
  await dataSource.registerPushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
  return true;
}

/** This device's Expo push token, or null when it cannot be obtained. */
async function expoPushToken(): Promise<string | null> {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  try {
    return (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  } catch {
    return null;
  }
}

/**
 * Drop this account's registration for this device. MUST run while the session
 * is still valid — the delete is RLS-scoped to auth.uid(), so calling it after
 * `supabase.auth.signOut()` silently does nothing.
 *
 * Best-effort by design: a failure here must never block sign-out. The server
 * also de-duplicates per device (run_push_scheduler), so a token that survives
 * an offline sign-out costs at most a stale row, not a duplicate notification.
 */
export async function unregisterForPush(): Promise<void> {
  if (!USE_SUPABASE || !Device.isDevice) return;
  try {
    const token = await expoPushToken();
    if (token != null) await dataSource.unregisterPushToken(token);
  } catch {
    /* never block sign-out */
  }
}
