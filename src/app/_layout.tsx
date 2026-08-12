import '@/theme/unistyles'; // Configure Unistyles before any component renders.
import '@/i18n'; // Initialize i18n (UI locale) before any component renders.

import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import {
  Spectral_400Regular,
  Spectral_500Medium,
  Spectral_600SemiBold,
  Spectral_700Bold,
} from '@expo-google-fonts/spectral';
import { SpaceMono_400Regular, SpaceMono_700Bold } from '@expo-google-fonts/space-mono';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { useUnistyles } from 'react-native-unistyles';

import { useRecoveryLink } from '@/auth/useRecoveryLink';
import { USE_SUPABASE } from '@/data';
import { DevBadge } from '@/dev/DevBadge';
import { queryClient } from '@/query/queryClient';
import { startAppearanceSync, useAppliedScheme } from '@/theme/appearance';
import { useUiStore } from '@/store/uiStore';
import { PortalHost, Toast, useOverlayOpen } from '@/ui';
import { WalkthroughProvider } from '@/tour/walkthrough';

// Minimal root. Real navigation (NavShell / tabs) lands in P3–P4.
// Registered names MUST match `theme.fonts.*` in `@/theme/theme` — one family per
// weight (RN custom fonts don't select weight reliably via `fontWeight`).
// GestureHandlerRootView + BottomSheetModalProvider are required by the Sheet kit.
export default function RootLayout() {
  // DF-3: turn password-recovery deep links into a session + /reset-password.
  useRecoveryLink();
  // Follow the OS color scheme (manual, debounced — see theme/appearance.ts).
  useEffect(() => startAppearanceSync(), []);
  // Adaptive-theme aware: the nav scene background follows the canvas token so
  // transitions / behind-modal areas don't flash white in dark mode.
  const { theme } = useUnistyles();
  const scheme = useAppliedScheme();
  // Defer the rebuild below while a quiz holds unsaved ratings — see uiStore's
  // `quizInProgress`. The THEME still switches immediately (Unistyles handles
  // that natively); only the remount waits, so at worst a few nodes in the quiz
  // keep the old ink until the session ends, instead of the session being
  // thrown away mid-answer.
  const quizBusy = useUiStore((s) => s.quizInProgress);
  // Same deferral, second reason: an open sheet/dialog. The rebuild resets the
  // screen state that says a sheet is open, so a scheme change while one is up
  // made it vanish in one frame — no slide-down, user back on the screen behind
  // it. That is precisely what tapping Light/Dark in Settings → Edit Profile
  // does, i.e. the one place the app INVITES a mid-sheet scheme change
  // (2026-08-08). Holding here keeps the sheet on screen; PortalHost keys
  // overlays on the scheme so they still repaint cleanly, and the held rebuild
  // runs the instant the last overlay finishes closing.
  const overlayOpen = useOverlayOpen();
  const holdRebuild = quizBusy || overlayOpen;

  const [rebuildKey, setRebuildKey] = useState(scheme);
  if (!holdRebuild && rebuildKey !== scheme) setRebuildKey(scheme);
  const [fontsLoaded] = useFonts({
    Spectral: Spectral_400Regular,
    'Spectral-Medium': Spectral_500Medium,
    'Spectral-SemiBold': Spectral_600SemiBold,
    'Spectral-Bold': Spectral_700Bold,
    PlusJakartaSans: PlusJakartaSans_400Regular,
    'PlusJakartaSans-Medium': PlusJakartaSans_500Medium,
    'PlusJakartaSans-SemiBold': PlusJakartaSans_600SemiBold,
    'PlusJakartaSans-Bold': PlusJakartaSans_700Bold,
    'PlusJakartaSans-ExtraBold': PlusJakartaSans_800ExtraBold,
    SpaceMono: SpaceMono_400Regular,
    'SpaceMono-Bold': SpaceMono_700Bold,
  });

  if (!fontsLoaded) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        {/* SafeAreaProvider feeds insets to Screen/TabBar/DevBadge. Required for
            fullScreenModal routes (e.g. quiz), which cover the status-bar area and
            must inset content themselves. initialWindowMetrics avoids a first-frame flash. */}
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          {/* `style="auto"` flips status-bar glyphs to light in dark mode. */}
          <StatusBar style="auto" />
          {/* REBUILD THE APP TREE ON A LIGHT↔DARK CHANGE (Casey, 2026-08-04).
              Unistyles applies theme changes by writing to native ShadowNodes
              rather than re-rendering, and it misses nodes: after a flip, some
              rows kept the previous canvas and some titles the previous ink,
              while everything around them switched. The workaround everyone
              finds — leave the screen and come back — is a REMOUNT, which
              registers every node afresh.

              The boundary is load-bearing and was found by experiment, not
              taste. Keying each screen's body (ui/Screen) did NOT fix it.
              Keying the Tabs navigator did NOT fix it. Keying HERE, above the
              Stack, repaints cleanly — verified on the simulator by cold
              launching in light and flipping to dark. Do not "optimise" this
              down the tree; it has already been tried twice.

              It fires only when the applied scheme changes — a rare, already
              full-screen repaint — so the rebuild is invisible inside it. Cost:
              in-screen state resets. Because that reset also closes any open
              sheet (the "is it open" flag lives in the screen), the rebuild is
              HELD while an overlay is up — see `holdRebuild` above; PortalHost
              is still inside the key, and additionally keys its own items on the
              scheme so overlays repaint during that hold.
              Delete the key the day Unistyles registers every node reliably. */}
          <BottomSheetModalProvider key={rebuildKey}>
            {/* Walkthrough context at the ROOT: the quiz fullScreenModal mounts its
                own overlay host and must share the tabs layout's tour state. */}
            <WalkthroughProvider>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.color.canvas } }}>
              {/* Search is a route, presented as a slide-up modal sheet (from the Home FAB). */}
              <Stack.Screen name="search" options={{ presentation: 'modal' }} />
              {/* Quiz is an immersive full-screen modal (from Home "Study now"). */}
              <Stack.Screen name="quiz" options={{ presentation: 'fullScreenModal' }} />
              {/* Paywall is a modal, pushed from every Upgrade / Unlock CTA. */}
              <Stack.Screen name="paywall" options={{ presentation: 'modal' }} />
              {/* First-run + auth flows (no header, no back-swipe out). */}
              <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
              <Stack.Screen name="auth" options={{ gestureEnabled: false }} />
              {/* Recovery deep-link target (DF-3) — no back-swipe out mid-reset. */}
              <Stack.Screen name="reset-password" options={{ gestureEnabled: false }} />
            </Stack>
            </WalkthroughProvider>
            {/* In-app overlays (sheets/dialogs) + toasts render above everything, on top
                of the persistent nav — see ui/Portal + ui/Sheet + ui/Toast. */}
            <PortalHost />
            <Toast />
            {/* Mode beacon. Draws nothing (no backgroundColor) and
                pointerEvents="none" so it can never intercept a tap; present in
                EVERY build (not __DEV__-gated) — its whole job is to let a flow
                assert what it is running against BEFORE it asserts anything
                about the UI. */}
            <View
              testID={`dataSource-${USE_SUPABASE ? 'live' : 'mock'}`}
              // `accessible` + a label are REQUIRED, not decoration. A bare
              // zero-size View is not an iOS accessibility element, so it never
              // enters the hierarchy Maestro reads and the assertion fails even
              // when the mode is correct.
              accessible
              accessibilityLabel={`dataSource ${USE_SUPABASE ? 'live' : 'mock'}`}
              pointerEvents="none"
              // SIZE IS LOAD-BEARING (2026-08-11, run 31373413201). This was
              // 1x1dp at exactly (0,0), and that made the gate UNPASSABLE ON
              // ANDROID — it took 7 of the 8 nightly flows down at their FIRST
              // command while iOS stayed green locally. The node reached Maestro
              // with the right id and label; the framework just refused to call
              // it visible, and Maestro's Android driver drops those ("Skipping
              // invisible child", from that run's logcat):
              //   boundsInScreen: Rect(0, 0 - 3, 3); viewIdResName: dataSource-mock;
              //   contentDescription: dataSource mock;
              //   importantForAccessibility: true; visible: false
              // (`visible:` there is AccessibilityNodeInfo.isVisibleToUser().) It
              // was the ONLY non-degenerate app node in the whole dump marked
              // invisible — everything else Maestro skipped was 0-width,
              // 0-height, or system decor.
              //
              // 48dp clears both candidate causes at once rather than betting on
              // one: it is far past any minimum-area threshold, and it extends
              // well below the status bar / display cutout, so a top inset can no
              // longer clip the visible rect to nothing. iOS has no equivalent
              // filter, which is exactly why a simulator run cannot catch a
              // regression here. Do not shrink it back toward zero — and it costs
              // nothing to keep: the View has no background, so it renders no
              // pixels at any size.
              style={{ position: 'absolute', top: 0, left: 0, width: 48, height: 48 }}
            />
            {/* DEFENCE IN DEPTH, not the actual exclusion (2026-08-06). In any
                non-dev bundle this import has already been swapped for a no-op
                stub at RESOLUTION time — `metro/excludedModules.js` — so the real
                badge, the RPC names it calls and the inlined
                EXPO_PUBLIC_DEV_SCENARIO_PASSWORD are absent from the shipped
                JS, which is what App Store review requires. This guard is what
                keeps it invisible if that swap is ever bypassed (a bundle built
                with dev=true and shipped in a Release app), and it costs
                nothing. Do NOT rely on it alone: `__DEV__` hides, it does not
                exclude. */}
            {__DEV__ ? <DevBadge /> : null}
          </BottomSheetModalProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
