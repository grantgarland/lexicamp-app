// Manual adaptive theming — replaces Unistyles `adaptiveThemes`.
//
// WHY: on iOS, backgrounding the app makes the OS render app-switcher snapshots in
// BOTH appearances, so RN fires a rapid dark→light Appearance flap. With
// `adaptiveThemes: true` Unistyles chases both flips and can leave the Fabric
// ShadowTree partially updated (jpudysz/react-native-unistyles#1170) — the app
// comes back as a patchwork of light- and dark-styled nodes (seen on the
// 1.0.0 (2) TestFlight build, 2026-08-01).
//
// Instead: adaptiveThemes stays OFF (see unistyles.ts) and this module applies the
// scheme itself — debounced, and only while the app is active — so the runtime
// sees at most ONE switch per real appearance change and none during the flap.
//
// As of 2026-08-04 this module is also the ONLY writer of the applied scheme
// (`appearanceStore.resolved`), and it honours the user's Settings preference:
// System follows the device, Light/Dark pin it.
import { Appearance, AppState } from 'react-native';
import { UnistylesRuntime } from 'react-native-unistyles';

import { type AppearanceMode, type Scheme, useAppearanceStore } from '@/store/appearanceStore';
import { useUiStore } from '@/store/uiStore';

const DEBOUNCE_MS = 300;

export function systemScheme(): Scheme {
  return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
}

/** What should be on screen for a given preference. */
export function effectiveScheme(mode: AppearanceMode): Scheme {
  return mode === 'system' ? systemScheme() : mode;
}

/** Apply a scheme to Unistyles AND publish it. The single write point — every
 *  `useIsDark()` and the root layout's rebuild key read what this records.
 *
 *  HELD DURING A QUIZ. A session buffers its ratings in memory and only persists
 *  them on completion, and the root rebuild that a scheme change triggers
 *  unmounts the navigator — which ejected the user to Home and threw the batch
 *  away (reproduced on the simulator, 2026-08-04). Deferring only the REBUILD
 *  saved the session but left the quiz half-painted, because Unistyles had
 *  already switched underneath it. So the whole switch waits: the session stays
 *  entirely in the scheme it started in — which is invisible to the user, since
 *  a quiz is a full-screen modal with no other UI to disagree with — and the
 *  moment it ends, the `quizInProgress` subscription below applies the held
 *  scheme, so theme and rebuild land together.
 *
 *  iOS "Automatic" flips at sunset, so this is an evening-study path, not an
 *  edge case. */
function applyScheme(scheme: Scheme): void {
  if (useUiStore.getState().quizInProgress) {
    heldScheme = scheme;
    return;
  }
  heldScheme = null;
  if (UnistylesRuntime.themeName !== scheme) UnistylesRuntime.setTheme(scheme);
  const store = useAppearanceStore.getState();
  if (store.resolved !== scheme) store.setResolved(scheme);
}

/** A scheme change that arrived mid-session, waiting for the session to end. */
let heldScheme: Scheme | null = null;

let timer: ReturnType<typeof setTimeout> | null = null;

/** Debounced OS-driven sync. Only meaningful while the preference is 'system'. */
function scheduleSync() {
  if (timer != null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    // Mid-snapshot the app is 'inactive'/'background' — skip; the AppState
    // listener below re-syncs on foreground.
    if (AppState.currentState !== 'active') return;
    applyScheme(effectiveScheme(useAppearanceStore.getState().mode));
  }, DEBOUNCE_MS);
}

/**
 * "Is the app in dark mode?" — the ONLY correct way to ask, for logic that picks
 * an asset, a shadow or a tier palette rather than a themed style.
 *
 * Do NOT use RN's `useColorScheme()` for this. Since adaptiveThemes was turned
 * off (above), the app has had two independent notions of the scheme, and they do
 * not agree (audit, 2026-08-04): the theme is applied HERE — debounced, skipped
 * while the app is not `active`, and now also overridable by a user preference —
 * while `useColorScheme()` subscribes to the raw `Appearance` event with none of
 * those guards. It follows every flip of the snapshot flap and keeps whatever the
 * last one left behind, because no further event is coming. It also knows nothing
 * about the Settings toggle, so it would be simply WRONG whenever the user has
 * pinned Light or Dark.
 *
 * Reads the applied scheme from the store rather than from Unistyles on purpose:
 * a store subscription is a React re-render we control, whereas Unistyles pushes
 * its updates straight to native ShadowNodes and can skip React entirely.
 */
export function useIsDark(): boolean {
  return useAppearanceStore((s) => s.resolved === 'dark');
}

/** The applied scheme, for callers that need the name rather than a boolean
 *  (e.g. `Screen`, which keys its subtree on it to force a clean repaint). */
export function useAppliedScheme(): Scheme {
  return useAppearanceStore((s) => s.resolved);
}

/** Start syncing the theme to the preference + OS scheme. Returns a cleanup fn. */
export function startAppearanceSync(): () => void {
  // Apply immediately so a persisted Light/Dark choice takes effect on launch
  // rather than one OS event later.
  applyScheme(effectiveScheme(useAppearanceStore.getState().mode));

  // A preference change is a deliberate tap, not a flap — apply it with no
  // debounce and no AppState gate. This also fires when zustand's async
  // rehydration lands, which is what applies a stored choice at cold start.
  const unsubMode = useAppearanceStore.subscribe((state, prev) => {
    if (state.mode !== prev.mode) applyScheme(effectiveScheme(state.mode));
  });

  // Release anything held back during a quiz the instant the session lets go.
  const unsubQuiz = useUiStore.subscribe((state, prev) => {
    if (prev.quizInProgress && !state.quizInProgress && heldScheme != null) {
      applyScheme(heldScheme);
    }
  });

  const appearanceSub = Appearance.addChangeListener(scheduleSync);
  const appStateSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') scheduleSync();
  });
  return () => {
    unsubQuiz();
    unsubMode();
    appearanceSub.remove();
    appStateSub.remove();
    if (timer != null) clearTimeout(timer);
    timer = null;
  };
}
