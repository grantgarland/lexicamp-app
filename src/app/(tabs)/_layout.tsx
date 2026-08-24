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

import { firstRunRoute } from '@/auth/firstRunGate';
import { useSession } from '@/auth/session';
import { USE_SUPABASE } from '@/data';
import { SearchView } from '@/screens/SearchScreen';
import { useProfileQuery, useQuizLengthSync } from '@/query/hooks';
import { useUiStore } from '@/store/uiStore';
import { TAB_BAR_CORE_HEIGHT, TAB_BAR_FAB_OVERHANG, TabBar, type TabId } from '@/ui';
import { tourTargets, WalkthroughController, WalkthroughOverlayHost } from '@/tour/walkthrough';

export default function TabsLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { session, isLoading: sessionLoading } = useSession();
  const { data: profile, isPending: profilePending, isFetching: profileFetching } = useProfileQuery();
  const searchOpen = useUiStore((s) => s.searchOpen);
  // UX-17b: adopt the server quiz-length mirror (cross-device sync).
  useQuizLengthSync();
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);

  // First-run gate (3.5, spec `24`). The decision itself lives in
  // `auth/firstRunGate.ts` as a pure function so it can be tested exhaustively —
  // it is three-state logic whose failure modes (redirect loops, onboarding
  // flashed at existing users) are invisible to typecheck and awkward to reach
  // from a render test. See that file for why `isFetching` is consulted.
  const route = firstRunRoute({
    useSupabase: USE_SUPABASE,
    sessionLoading,
    hasSession: session != null,
    profilePending,
    profileFetching,
    profile,
  });
  if (route === 'wait') return null;
  if (route === 'value') return <Redirect href="/onboarding" />;
  if (route === 'pair') return <Redirect href="/onboarding/pair" />;

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
          {/* The overlay is full-bleed under the nav, so it must clear the bar
              AND the FAB that floats above it. */}
          <SearchView onClose={() => setSearchOpen(false)} bottomInset={TAB_BAR_CORE_HEIGHT + TAB_BAR_FAB_OVERHANG + insets.bottom} />
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
