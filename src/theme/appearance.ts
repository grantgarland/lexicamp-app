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
import { UnistylesRuntime } from 'react-native-unistyles';

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
