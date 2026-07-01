// TabBar — canonical bottom nav + raised FAB, ported from `_shared/nav-shell.js`.
// 4 tabs (Home / Word List / Progress / Settings) with a central 58px amber FAB
// (search-plus → blue + rotate-to-× when a sheet is open). Frosted nav surface via
// expo-glass-effect on liquid-glass devices, opaque-white fallback elsewhere.
import { type ComponentType, useEffect, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { IconChart, IconGear, IconHome, IconList, IconSearchPlus, type IconProps } from './icons';
import { Text } from './Text';

export type TabId = 'home' | 'words' | 'progress' | 'settings';

/** Core bar height (excl. bottom safe-area inset). The tab layout renders the bar
 *  absolutely and reserves this much scene space (+ inset) via a spacer. Matches the
 *  `bar`/`tab` styles below (tab minHeight 48 + top border). */
export const TAB_BAR_CORE_HEIGHT = 49;

// Labels resolve from i18n (`tabs.<id>`) at render — the registry only fixes id + icon.
const TABS: { id: TabId; Icon: ComponentType<IconProps> }[] = [
  { id: 'home', Icon: IconHome },
  { id: 'words', Icon: IconList },
  { id: 'progress', Icon: IconChart },
  { id: 'settings', Icon: IconGear },
];

export interface TabBarProps {
  activeTab: TabId;
  onTabChange?: (id: TabId) => void;
  sheetOpen?: boolean;
  onFabPress?: () => void;
}

function TabButton({ tab, active, onPress }: { tab: (typeof TABS)[number]; active: boolean; onPress?: () => void }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const color = active ? theme.color.brand : theme.color.textMuted;
  const { Icon } = tab;
  return (
    <Pressable style={styles.tab} onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: active }}>
      <Icon size={22} color={color} />
      <Text style={[styles.tabLabel, { color, fontFamily: active ? theme.fonts.sans.semibold : theme.fonts.sans.regular }]}>
        {t(`tabs.${tab.id}`)}
      </Text>
    </Pressable>
  );
}

export function TabBar({ activeTab, onTabChange, sheetOpen = false, onFabPress }: TabBarProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  // Lazy `useState` init (not `useRef().current`) so the stable Animated.Value can be used
  const [rot] = useState(() => new Animated.Value(sheetOpen ? 1 : 0));

  useEffect(() => {
    Animated.timing(rot, { toValue: sheetOpen ? 1 : 0, duration: 320, useNativeDriver: true }).start();
  }, [sheetOpen, rot]);

  const rotate = rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] });

  const tabs = (
    <>
      <TabButton tab={TABS[0]} active={activeTab === 'home'} onPress={() => onTabChange?.('home')} />
      <TabButton tab={TABS[1]} active={activeTab === 'words'} onPress={() => onTabChange?.('words')} />
      <View style={styles.gap} />
      <TabButton tab={TABS[2]} active={activeTab === 'progress'} onPress={() => onTabChange?.('progress')} />
      <TabButton tab={TABS[3]} active={activeTab === 'settings'} onPress={() => onTabChange?.('settings')} />
    </>
  );

  const glass = isLiquidGlassAvailable();

  return (
    <View style={styles.container}>
      <View style={styles.fabWrap} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={sheetOpen ? t('common.closeSearch') : t('common.search')}
          onPress={onFabPress}
          style={({ pressed }) => [
            styles.fab,
            {
              backgroundColor: sheetOpen ? theme.color.brand : theme.color.accent,
              boxShadow: sheetOpen ? theme.shadow.brand : theme.shadow.accent,
            },
            pressed && styles.fabPressed,
          ]}
        >
          <Animated.View style={{ transform: [{ rotate }] }}>
            <IconSearchPlus size={26} color="#fff" />
          </Animated.View>
        </Pressable>
      </View>

      {glass ? (
        <GlassView style={[styles.bar, { paddingBottom: insets.bottom }]} glassEffectStyle="regular" colorScheme="light">
          {tabs}
        </GlassView>
      ) : (
        <View style={[styles.bar, styles.barFallback, { paddingBottom: insets.bottom }]}>{tabs}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { position: 'relative' },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderTopWidth: theme.borderWidth.thin,
    borderTopColor: theme.color.border,
  },
  barFallback: { backgroundColor: 'rgba(255, 255, 255, 0.96)' },
  gap: { flex: 1.3 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, paddingTop: 10, minHeight: 48 },
  tabLabel: { fontSize: 10, lineHeight: 12, letterSpacing: 0.1 },
  fabWrap: { position: 'absolute', top: -28, left: 0, right: 0, alignItems: 'center', zIndex: 2 },
  fab: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  fabPressed: { transform: [{ scale: 0.91 }] },
}));
