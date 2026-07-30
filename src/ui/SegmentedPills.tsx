// SegmentedPills — a compact two-or-more-way view switch that lives INSIDE a
// card, as opposed to `SegmentedTabs` which is screen-level navigation.
//
// Why a second segmented control: Progress already renders SegmentedTabs (the
// underline bar) for Route / Inventory / Leaders. Reusing that treatment for
// the projection card's next-camp ⇄ Summit switch would put a second underline
// tab bar a few points below the first, and the two would read as nested
// navigation rather than "this card has two views". A filled pill inside a
// track is visually distinct, compact enough to sit in a card header, and
// carries an obvious selected state.
//
// a11y: the track is a tablist, each pill a tab with `selected` state, so
// VoiceOver announces "Next camp, tab, 1 of 2, selected" rather than reading
// two anonymous buttons.
import { Pressable, View, type ViewStyle } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { RawText as Text } from './Text';

export interface SegmentedPill {
  id: string;
  label: string;
  /** Optional VoiceOver label when `label` alone is ambiguous out of context. */
  a11yLabel?: string;
}

export interface SegmentedPillsProps {
  pills: SegmentedPill[];
  active: string;
  onChange: (id: string) => void;
  style?: ViewStyle;
}

export function SegmentedPills({ pills, active, onChange, style }: SegmentedPillsProps) {
  const { theme } = useUnistyles();
  return (
    <View style={[styles.track, style]} accessibilityRole="tablist">
      {pills.map((pill) => {
        const on = pill.id === active;
        return (
          <Pressable
            key={pill.id}
            onPress={() => onChange(pill.id)}
            style={[styles.pill, on && { backgroundColor: theme.color.surfaceCard }]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={pill.a11yLabel ?? pill.label}
            // 44pt minimum touch target is enforced by hitSlop rather than by
            // padding, so the control stays visually compact in a card header.
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Text style={[styles.label, on && styles.labelOn]} numberOfLines={1}>
              {pill.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, fonts, radius } = theme;
  return {
    track: {
      flexDirection: 'row',
      backgroundColor: color.surfaceSunken,
      borderWidth: theme.borderWidth.thin,
      borderColor: color.border,
      borderRadius: radius.pill,
      padding: 3,
      gap: 3,
    },
    pill: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 7,
      paddingHorizontal: 10,
      borderRadius: radius.pill,
    },
    label: { fontFamily: fonts.sans.semibold, fontSize: 12, color: color.textMuted },
    labelOn: { color: color.textStrong },
  };
});
