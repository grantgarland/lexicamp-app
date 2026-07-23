// ProgressDots — paged step indicator (onboarding story act, sheets).
// Spec: active = 22px pill in brand; inactive = 6px dot in slate-200.
import { View, type ViewStyle } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

export interface ProgressDotsProps {
  count: number;
  /** Active step (0-based). */
  index: number;
  style?: ViewStyle;
}

export function ProgressDots({ count, index, style }: ProgressDotsProps) {
  return (
    <View
      style={[styles.row, style]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: count, now: Math.min(index + 1, count) }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[styles.dot, i === index ? styles.active : styles.inactive]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { height: 6, borderRadius: 3 },
  inactive: { width: 6, backgroundColor: theme.color.border },
  active: { width: 22, backgroundColor: theme.color.brand },
}));
