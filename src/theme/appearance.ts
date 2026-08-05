// Manual adaptive theming — replaces Unistyles `adaptiveThemes`.
//
// WHY: on iOS, backgrounding the app makes the OS render app-switcher snapshots in
// BOTH appearances, so RN fires a rapid dark→light Appearance flap. With
// `adaptiveThemes: true` Unistyles chases both flips and can leave the Fabric
// ShadowTree partially updated (jpudysz/react-native-unistyles#1170) — the app
// comes back as a patchwork of light- and dark-styled nodes (seen on the
// 1.0.0 (2) TestFlight build, 2026-08-01).
//
// Instead: adaptiveThemes stays OFF (see unistyles.ts) and this listener applies
// the system scheme itself — debounced, and only while the app is active — so the
// runtime sees at most ONE switch per real appearance change and none during the
// snapshot flap.
import { Appearance, AppState } from 'react-native';
import { UnistylesRuntime, useUnistyles } from 'react-native-unistyles';

const DEBOUNCE_MS = 300;

export function systemScheme(): 'light' | 'dark' {
  return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
}

let timer: ReturnType<typeof setTimeout> | null = null;

function scheduleSync() {
  if (timer != null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    // Mid-snapshot the app is 'inactive'/'background' — skip; the AppState
    // listener below re-syncs the real scheme on foreground.
    if (AppState.currentState !== 'active') return;
    const scheme = systemScheme();
    if (UnistylesRuntime.themeName !== scheme) UnistylesRuntime.setTheme(scheme);
  }, DEBOUNCE_MS);
}

/**
 * "Is the app in dark mode?" — the ONLY correct way to ask, for logic that picks
 * an asset, a shadow or a tier palette rather than a themed style.
 *
 * Do NOT use RN's `useColorScheme()` for this. Since adaptiveThemes was turned
 * off (above), the app has had two independent notions of the scheme, and they
 * do not agree (audit, 2026-08-04):
 *
 *  • The Unistyles theme is applied HERE — debounced, and skipped entirely while
 *    the app is not `active`, then re-synced on foreground. That is what makes
 *    the app immune to the iOS app-switcher snapshot flap.
 *  • `useColorScheme()` subscribes to the raw `Appearance` event with none of
 *    those guards. It follows every flip of the flap, and whatever value the
 *    last flip left behind is what it keeps returning — no further event is
 *    coming, so it never self-corrects.
 *
 * The result was a half-switched screen after every light↔dark change (changing
 * appearance backgrounds the app, so the flap is on the normal path, not an edge
 * case): Unistyles-styled surfaces correct, `useColorScheme()`-derived colors,
 * icons and tier palettes stale. It survived re-renders — the hook's subscribed
 * value doesn't change — and cleared on REMOUNT, because mounting re-reads
 * `Appearance.getColorScheme()` fresh. Hence "a manual refresh fixes it".
 *
 * Reading `theme.isDark` instead means there is one value, switched at one
 * moment, by the code that owns the guards.
 */
export function useIsDark(): boolean {
  const { theme } = useUnistyles();
  return theme.isDark;
}

/** Start syncing the Unistyles theme to the OS color scheme. Returns a cleanup fn. */
export function startAppearanceSync(): () => void {
  const appearanceSub = Appearance.addChangeListener(scheduleSync);
  const appStateSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') scheduleSync();
  });
  return () => {
    appearanceSub.remove();
    appStateSub.remove();
    if (timer != null) clearTimeout(timer);
    timer = null;
  };
}
