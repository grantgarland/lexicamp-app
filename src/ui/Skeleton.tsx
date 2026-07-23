// Skeleton — pulsing placeholder blocks for loading states. `SkeletonRows` renders a
// stack of list-row-shaped placeholders (used while words/decks hydrate, so the empty
// state only shows when a slice is genuinely empty).
import { useEffect } from 'react';
import { type DimensionValue, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';

export function Skeleton({ width = '100%', height, radius = 6 }: { width?: DimensionValue; height: number; radius?: number }) {
  const o = useSharedValue(0.5);
  useEffect(() => {
    o.value = withRepeat(withTiming(1, { duration: 850, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [o]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[styles.block, { width, height, borderRadius: radius }, anim]} />;
}

export function SkeletonRows({ count = 8 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.row}>
          <Skeleton width={30} height={20} radius={4} />
          <View style={styles.rowBody}>
            <Skeleton width="52%" height={14} />
            <View style={styles.gap} />
            <Skeleton width="34%" height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  block: { backgroundColor: theme.color.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: theme.borderWidth.thin, borderBottomColor: theme.color.divider },
  rowBody: { flex: 1 },
  gap: { height: 6 },
}));
