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

/** Request permission + register this device's Expo token with the backend.
 *  Returns whether push is active. Call after the user opts IN (onboarding
 *  O-06 "Enable notifications", or the Settings toggle) — never unprompted. */
export async function registerForPush(): Promise<boolean> {
  if (!USE_SUPABASE || !Device.isDevice) return false; // mock mode / simulator

  const existing = await Notifications.getPermissionsAsync();
  const status = existing.granted
    ? existing
    : await Notifications.requestPermissionsAsync();
  if (!status.granted) return false;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Review reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  await dataSource.registerPushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
  return true;
}
