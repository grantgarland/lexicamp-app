import '@/theme/unistyles'; // Configure Unistyles before any component renders.

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
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { DevBadge } from '@/dev/DevBadge';
import { DevConfigProvider } from '@/dev/devConfig';

// Minimal root. Real navigation (NavShell / tabs) lands in P3–P4.
// Registered names MUST match `theme.fonts.*` in `@/theme/theme` — one family per
// weight (RN custom fonts don't select weight reliably via `fontWeight`).
// GestureHandlerRootView + BottomSheetModalProvider are required by the Sheet kit.
export default function RootLayout() {
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
    <DevConfigProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <BottomSheetModalProvider>
          <Stack screenOptions={{ headerShown: false }}>
            {/* Search is a route, presented as a slide-up modal sheet (from the Home FAB). */}
            <Stack.Screen name="search" options={{ presentation: 'modal' }} />
          </Stack>
          {__DEV__ ? <DevBadge /> : null}
        </BottomSheetModalProvider>
      </GestureHandlerRootView>
    </DevConfigProvider>
  );
}
