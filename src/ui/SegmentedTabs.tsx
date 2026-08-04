// SegmentedTabs — the shared underline tab bar (Word List sub-nav, Progress sub-tabs).
// The active underline is the segment's own 2px bottom edge (flush with the container
// bottom); inactive segments show the divider colour, so the row reads as one continuous
// bottom border with the active tab highlighted.
import type { ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { RawText as Text } from './Text';

export interface SegmentedTab {
  /** Optional Maestro hook. Opt-in per call site rather than derived from `id`,
   *  so two segmented controls on one screen cannot collide. */
  testID?: string;
  id: string;
  label: string;
  /** Optional trailing chip (e.g. "PRO"). */
  badge?: ReactNode;
}

export interface SegmentedTabsProps {
  tabs: SegmentedTab[];
  active: string;
  onChange: (id: string) => void;
  style?: ViewStyle;
}

export function SegmentedTabs({ tabs, active, onChange, style }: SegmentedTabsProps) {
  const { theme } = useUnistyles();
  return (
    <View style={[styles.row, style]}>
      {tabs.map((tab) => {
        const on = tab.id === active;
        return (
          <Pressable key={tab.id} testID={tab.testID} onPress={() => onChange(tab.id)} style={styles.tab} accessibilityRole="tab" accessibilityState={{ selected: on }}>
            <View style={styles.labelRow}>
              <Text style={[styles.label, on && styles.labelOn]}>{tab.label}</Text>
              {tab.badge}
            </View>
            <View style={[styles.underline, { backgroundColor: on ? theme.color.brand : theme.color.divider }]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: 'row' },
  tab: { flex: 1, alignItems: 'center' },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 9 },
  label: { fontFamily: theme.fonts.sans.regular, fontSize: 14, color: theme.color.textMuted },
  labelOn: { fontFamily: theme.fonts.sans.semibold, color: theme.color.brand },
  underline: { height: 2, alignSelf: 'stretch' },
}));
