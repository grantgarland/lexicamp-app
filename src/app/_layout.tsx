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
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { useUnistyles } from 'react-native-unistyles';

import { useRecoveryLink } from '@/auth/useRecoveryLink';
import { DevBadge } from '@/dev/DevBadge';
import { queryClient } from '@/query/queryClient';
import { startAppearanceSync } from '@/theme/appearance';
import { PortalHost, Toast } from '@/ui';
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
          <BottomSheetModalProvider>
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
            {__DEV__ ? <DevBadge /> : null}
          </BottomSheetModalProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
