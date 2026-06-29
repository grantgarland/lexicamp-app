// Unistyles runtime must be configured before any component renders.
import '@/theme/unistyles';

import { PlusJakartaSans_400Regular } from '@expo-google-fonts/plus-jakarta-sans';
import { Spectral_400Regular } from '@expo-google-fonts/spectral';
import { SpaceMono_400Regular } from '@expo-google-fonts/space-mono';
import { useFonts } from 'expo-font';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';

export default function TabLayout() {
  // Family keys must match the registered names in `@/theme/theme`.
  const [fontsLoaded] = useFonts({
    Spectral: Spectral_400Regular,
    PlusJakartaSans: PlusJakartaSans_400Regular,
    SpaceMono: SpaceMono_400Regular,
  });

  return (
    <>
      <AnimatedSplashOverlay />
      {fontsLoaded && <AppTabs />}
    </>
  );
}
