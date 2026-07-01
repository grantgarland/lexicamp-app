// Toast — a transient confirmation snackbar (e.g. "Added to Travel words"). Driven by the
// UI store so any screen can trigger it via `useUiStore().showToast(...)`. Mounted once in
// the tab layout; auto-dismisses. Sits just above the bottom nav.
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { useUiStore } from '@/store/uiStore';
import { RawText as Text } from './Text';
import { TAB_BAR_CORE_HEIGHT } from './TabBar';

const DURATION_MS = 2400;

export function Toast() {
  const toast = useUiStore((s) => s.toast);
  const hide = useUiStore((s) => s.hideToast);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (toast == null) return;
    const timer = setTimeout(hide, DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast, hide]);

  if (toast == null) return null;
  return (
    <View style={[styles.anchor, { bottom: insets.bottom + TAB_BAR_CORE_HEIGHT + 14 }]} pointerEvents="none">
      <Animated.View key={toast.id} entering={FadeInDown.duration(220)} exiting={FadeOutDown.duration(180)} style={styles.toast}>
        <Text style={styles.text}>{toast.message}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  anchor: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 60 },
  toast: {
    backgroundColor: 'rgba(24, 32, 38, 0.97)',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 18,
    maxWidth: '88%',
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  text: { fontFamily: theme.fonts.sans.semibold, fontSize: 13.5, color: '#fff', textAlign: 'center' },
}));
