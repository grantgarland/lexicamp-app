// Sheet — bottom sheet / modal overlay. Rendered through the in-app Portal (NOT RN
// `Modal`), so sheets stack: opening a second sheet slides it up over the first, which
// stays mounted behind it; dismissing slides back down to reveal it. Slide + scrim fade
// via a single reanimated progress value; unmounts only after the close animation.
import { type ReactNode, useEffect, useState } from 'react';
import { Pressable, StyleSheet as RNStyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { Portal } from './Portal';
import { Text } from './Text';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Accepted for API compatibility; the sheet is content-sized. */
  snapPoints?: (string | number)[];
  children: ReactNode;
}

export function Sheet({ visible, onClose, title, children }: SheetProps) {
  useUnistyles();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const { t } = useTranslation();
  const [mounted, setMounted] = useState(visible);
  const [sheetH, setSheetH] = useState(0);
  const p = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      p.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });
    } else {
      p.value = withTiming(0, { duration: 200, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
  }, [visible, p]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: p.value }));
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - p.value) * (sheetH || winH * 0.6) }] }));

  if (!mounted) return null;
  return (
    <Portal>
      <View style={styles.container} pointerEvents="box-none">
        <Animated.View style={[styles.scrim, scrimStyle]}>
          <Pressable style={RNStyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('common.dismiss')} />
        </Animated.View>
        <Animated.View
          onLayout={(e) => setSheetH(e.nativeEvent.layout.height)}
          style={[styles.sheet, sheetStyle, { paddingBottom: insets.bottom + 20 }]}
        >
          <View style={styles.handle} />
          {title != null && (
            <Text variant="heading" style={styles.title}>
              {title}
            </Text>
          )}
          {children}
        </Animated.View>
      </View>
    </Portal>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(24, 47, 63, 0.45)' },
  sheet: {
    backgroundColor: theme.color.surfaceCard,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    paddingHorizontal: theme.space[5],
    paddingTop: theme.space[3],
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: theme.palette.slate[300], marginBottom: theme.space[4] },
  title: { marginBottom: theme.space[2] },
}));
