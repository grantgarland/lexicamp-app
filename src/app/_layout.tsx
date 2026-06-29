import '@/theme/unistyles'; // Configure Unistyles before any component renders.

import { PlusJakartaSans_400Regular } from '@expo-google-fonts/plus-jakarta-sans';
import { Spectral_400Regular } from '@expo-google-fonts/spectral';
import { SpaceMono_400Regular } from '@expo-google-fonts/space-mono';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';

// Minimal root. Real navigation (NavShell / tabs) lands in P2–P4.
// Font keys MUST match the registered names in `@/theme/theme` (family.*).
// Only the 400 weights are loaded for now; add the weights the Text primitive
// needs in P2.
export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Spectral: Spectral_400Regular,
    PlusJakartaSans: PlusJakartaSans_400Regular,
    SpaceMono: SpaceMono_400Regular,
  });

  if (!fontsLoaded) return null;
  return <Stack screenOptions={{ headerShown: false }} />;
}
