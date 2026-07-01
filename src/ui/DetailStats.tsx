// DetailStats — a shared 3-up (label / value) meta strip. Used by the word detail sheet
// (Next review · Reviews · Added) and the deck detail sheet (Words · Reviews · Created).
import { View, type ViewStyle } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { RawText as Text } from './Text';

export interface DetailStat {
  label: string;
  value: string;
}

export function DetailStats({ items, style }: { items: DetailStat[]; style?: ViewStyle }) {
  return (
    <View style={[styles.row, style]}>
      {items.map((it) => (
        <View key={it.label} style={styles.col}>
          <Text style={styles.label}>{it.label}</Text>
          <Text style={styles.value}>{it.value}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: 'row', gap: 12 },
  col: { flex: 1 },
  label: { fontFamily: theme.fonts.sans.bold, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: theme.color.textMuted, marginBottom: 3 },
  value: { fontFamily: theme.fonts.sans.medium, fontSize: 13, color: theme.color.textBody },
}));
