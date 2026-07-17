// Tab group — the bottom TabBar is rendered ONCE here (persistent) so tab traversal
// swaps only the screen body. The nav is drawn as an absolute sibling ON TOP of the tab
// scenes AND the search overlay, so:
//   • switching tabs never slides a new bar in, and
//   • opening the search FAB overlays search ABOVE the scenes but the nav stays visible.
// The navigator's built-in tab bar is replaced by a same-height spacer so scene content
// still reserves room for the absolute bar. Quiz stays a root full-screen modal.
import { Redirect, Tabs, usePathname, useRouter } from 'expo-router';
import Animated, { SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { useSession } from '@/auth/session';
import { USE_SUPABASE } from '@/data';
import { SearchView } from '@/screens/SearchScreen';
import { useProfile, useQuizLengthSync } from '@/query/hooks';
import { useUiStore } from '@/store/uiStore';
import { TAB_BAR_CORE_HEIGHT, TabBar, type TabId } from '@/ui';
import { tourTargets, WalkthroughController, WalkthroughOverlayHost } from '@/tour/walkthrough';

export default function TabsLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { session, isLoading: sessionLoading } = useSession();
  const profile = useProfile();
  const searchOpen = useUiStore((s) => s.searchOpen);
  // UX-17b: adopt the server quiz-length mirror (cross-device sync).
  useQuizLengthSync();
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);

  // First-run gate. Live backend: no session → the onboarding arc (→ auth) —
  // rendering tabs signed-out would just be a wall of failing queries. Wait out
  // the async session restore before deciding (avoids a flash of onboarding for
  // returning users). Mock mode keeps the old profile-flag behavior.
  if (USE_SUPABASE) {
    if (sessionLoading) return null; // one frame while AsyncStorage restores
    if (session == null) return <Redirect href="/onboarding" />;
  }
  if (profile != null && !profile.onboardingComplete) {
    return <Redirect href="/onboarding" />;
  }

  const active: TabId = pathname.startsWith('/words')
    ? 'words'
    : pathname.startsWith('/progress')
      ? 'progress'
      : pathname.startsWith('/settings')
        ? 'settings'
        : 'home';

  return (
    <View style={styles.root}>
      {/* Scenes. The built-in bar is a transparent spacer of the real bar's height, so
          scene content reserves space for the absolute TabBar below. */}
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={() => <View style={{ height: TAB_BAR_CORE_HEIGHT + insets.bottom }} />}
      />

      {/* Search overlay — above the scenes, below the nav (which paints on top).
          `SearchView` isn't wrapped in a Screen here, so inset the top safe area
          ourselves (else the handle/close/toggle bleed into the status bar/notch). */}
      {searchOpen && (
        <Animated.View
          entering={SlideInDown.duration(300)}
          exiting={SlideOutDown.duration(240)}
          style={[styles.overlay, { paddingTop: insets.top }]}
        >
          <SearchView onClose={() => setSearchOpen(false)} />
        </Animated.View>
      )}

      {/* Persistent nav — last sibling → paints on top of scenes + search overlay. */}
      <View style={styles.navWrap} pointerEvents="box-none">
        <TabBar
          activeTab={active}
          sheetOpen={searchOpen}
          tabRefs={{ progress: tourTargets.progressTab }}
          fabRef={tourTargets.fab}
          onFabPress={() => setSearchOpen(!searchOpen)}
          onTabChange={(id) => {
            if (searchOpen) setSearchOpen(false);
            if (id === 'home') router.navigate('/');
            else if (id === 'words') router.navigate('/words');
            else if (id === 'progress') router.navigate('/progress');
            else if (id === 'settings') router.navigate('/settings');
          }}
        />
      </View>

      {/* 18 §F2 walkthrough: controller owns auto-start (live-mode only —
          smoke/mock never auto-fires) + replay. The scope="main" host renders
          the overlay for every step EXCEPT the quiz-interior ones (the quiz
          fullScreenModal hosts its own — see walkthrough.tsx). Provider lives
          in the ROOT layout so the quiz screen shares the tour context. */}
      <WalkthroughController activeTab={active} />
      <WalkthroughOverlayHost scope="main" />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.color.canvas },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.color.canvas,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    overflow: 'hidden',
  },
  navWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
}));
