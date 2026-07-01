// Toast — an app-wide snackbar at the TOP of the screen, full device width. Driven by the
// UI store (`useUiStore().showToast(...)`). Semantic variants (info/success/warning/
// destructive), optional header + body + an action (e.g. Undo), and a dismiss (×).
// Non-destructive toasts auto-dismiss; destructive ones persist until dismissed.
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useUiStore, type ToastVariant } from '@/store/uiStore';
import { IconX } from './icons';
import { RawText as Text } from './Text';

const AUTO_MS = 3200;

function variantColor(variant: ToastVariant, theme: ReturnType<typeof useUnistyles>['theme']): string {
  switch (variant) {
    case 'success':
      return theme.palette.green[600];
    case 'warning':
      return theme.palette.amber[600];
    case 'destructive':
      return theme.color.danger;
    default:
      return theme.palette.slate[800];
  }
}

export function Toast() {
  const { theme } = useUnistyles();
  const toast = useUiStore((s) => s.toast);
  const hide = useUiStore((s) => s.hideToast);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (toast == null || toast.persistent) return;
    const timer = setTimeout(hide, AUTO_MS);
    return () => clearTimeout(timer);
  }, [toast, hide]);

  if (toast == null) return null;
  const bg = variantColor(toast.variant ?? 'info', theme);
  return (
    <View style={[styles.anchor, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
      <Animated.View key={toast.id} entering={FadeInUp.duration(220)} exiting={FadeOutUp.duration(180)} style={[styles.toast, { backgroundColor: bg }]}>
        <View style={styles.body}>
          {toast.title != null && <Text style={styles.title}>{toast.title}</Text>}
          <Text style={styles.message}>{toast.message}</Text>
        </View>
        {toast.action != null && (
          <Pressable
            onPress={() => {
              toast.action?.onPress();
              hide();
            }}
            accessibilityRole="button"
            hitSlop={8}
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.actionText}>{toast.action.label}</Text>
          </Pressable>
        )}
        <Pressable onPress={hide} accessibilityRole="button" hitSlop={8} style={({ pressed }) => [styles.close, pressed && { opacity: 0.6 }]}>
          <IconX size={14} color="rgba(255,255,255,0.85)" />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  anchor: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'stretch', zIndex: 100 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 10,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  body: { flex: 1 },
  title: { fontFamily: theme.fonts.sans.bold, fontSize: 14, color: '#fff', marginBottom: 1 },
  message: { fontFamily: theme.fonts.sans.regular, fontSize: 13, lineHeight: 18, color: 'rgba(255,255,255,0.92)' },
  action: { paddingHorizontal: 4, paddingVertical: 2 },
  actionText: { fontFamily: theme.fonts.sans.bold, fontSize: 13, color: '#fff', textDecorationLine: 'underline' },
  close: { padding: 2 },
}));
