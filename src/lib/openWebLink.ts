import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

/**
 * Opens an https URL in the in-app browser rather than handing off to the
 * standalone Safari/Chrome app. App Review devices commonly restrict the
 * browser app via Screen Time content controls, which makes `Linking.openURL`
 * reject even for a reachable link (seen on the legal Terms/Privacy links,
 * Sentry 2026-08-29/31) — the in-app browser isn't gated by that restriction.
 * Falls back to `Linking.openURL` if the in-app browser itself fails.
 */
export async function openWebLink(url: string): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    await Linking.openURL(url);
  }
}
