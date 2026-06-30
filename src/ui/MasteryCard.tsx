// MasteryCard — the Home "Word Mastery" hero, ported from Home's MasteryCard +
// TierDistributionBar. A proportional 5-tier bar (segment width = word count) with
// per-tier labels/counts, plus a saved / at-Summit stats row. Tapping a segment
// highlights it and fires `onTierPress`. (The prototype's floating tier tooltip is
// omitted — surface details via `onTierPress` instead.)
import { useState } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { TIERS, type TierId } from '@/theme/tiers';
import { IconBook } from './icons';
import { RawText as RNText } from './Text';

export interface MasteryCardProps {
  /** Word counts per tier, in registry order [bc, abc, hc, sr, summit]. */
  tierCounts?: number[];
  wordsSaved?: number;
  isEmpty?: boolean;
  onTierPress?: (tierId: TierId) => void;
  style?: ViewStyle;
}

export function MasteryCard({
  tierCounts = [0, 0, 0, 0, 0],
  wordsSaved = 0,
  isEmpty = false,
  onTierPress,
  style,
}: MasteryCardProps) {
  const { theme } = useUnistyles();
  const [active, setActive] = useState<number | null>(null);
  const total = tierCounts.reduce((a, b) => a + b, 0);
  const mastered = tierCounts[4] ?? 0;

  const onSeg = (i: number) => {
    setActive((a) => (a === i ? null : i));
    onTierPress?.(TIERS[i].id);
  };

  return (
    <View style={[styles.card, isEmpty ? styles.cardEmpty : styles.cardFull, style]}>
      <View style={styles.header}>
        <RNText style={styles.eyebrow}>Word Mastery</RNText>
        <RNText style={[styles.subtitle, isEmpty && styles.subtitleEmpty]}>
          {isEmpty ? 'Add words to start climbing' : `${total} word${total !== 1 ? 's' : ''} across 5 tiers`}
        </RNText>
      </View>

      {/* Proportional tier bar */}
      <View style={styles.barRow}>
        {TIERS.map((tier, i) => {
          const count = tierCounts[i] ?? 0;
          const flexVal = isEmpty || total === 0 ? 1 : Math.max(count, 0.4);
          const filled = !isEmpty && count > 0;
          return (
            <Pressable
              key={tier.id}
              onPress={() => onSeg(i)}
              style={{ flex: flexVal }}
              hitSlop={{ top: 16, bottom: 16 }}
              accessibilityRole="button"
              accessibilityLabel={`${tier.name}: ${count} word${count !== 1 ? 's' : ''}`}
            >
              <View
                style={[
                  styles.seg,
                  i === 0 && styles.segFirst,
                  i === TIERS.length - 1 && styles.segLast,
                  { backgroundColor: filled ? tier.color : theme.palette.slate[100] },
                  active !== null && active !== i && styles.segDim,
                  active === i && { borderWidth: 2, borderColor: tier.color },
                ]}
              />
            </Pressable>
          );
        })}
      </View>

      {/* Labels + counts */}
      <View style={styles.labelRow}>
        {TIERS.map((tier, i) => {
          const count = tierCounts[i] ?? 0;
          const isActive = active === i;
          return (
            <Pressable key={tier.id} onPress={() => onSeg(i)} style={styles.labelCell}>
              <RNText
                style={[
                  styles.labelShort,
                  { color: isActive ? theme.color.textStrong : count > 0 ? theme.color.textBody : theme.color.textFaint },
                ]}
              >
                {tier.short}
              </RNText>
              <RNText
                style={[
                  styles.labelCount,
                  { color: isActive ? tier.color : count > 0 ? theme.color.textMuted : theme.color.textFaint },
                ]}
              >
                {count}
              </RNText>
            </Pressable>
          );
        })}
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <IconBook size={13} color={isEmpty ? theme.palette.slate[300] : theme.color.textMuted} />
          <RNText style={[styles.statValue, { color: isEmpty ? theme.color.textFaint : theme.color.textStrong }]}>
            {isEmpty ? 0 : wordsSaved}
          </RNText>
          <RNText style={styles.statLabel}>saved</RNText>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <RNText style={[styles.star, { color: isEmpty || mastered === 0 ? theme.palette.slate[300] : theme.color.accent }]}>
            ★
          </RNText>
          <RNText
            style={[styles.statValue, { color: isEmpty || mastered === 0 ? theme.color.textFaint : theme.color.textStrong }]}
          >
            {isEmpty ? 0 : mastered}
          </RNText>
          <RNText style={styles.statLabel}>at Summit</RNText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, palette, fonts } = theme;
  return {
    card: {
      borderRadius: theme.radius.lg,
      borderWidth: theme.borderWidth.thin,
      backgroundColor: color.surfaceCard,
      paddingTop: 16,
      paddingHorizontal: 18,
      paddingBottom: 18,
    },
    cardFull: { borderColor: palette.blue[100], boxShadow: theme.shadow.sm },
    cardEmpty: { borderColor: color.border, boxShadow: theme.shadow.xs },
    header: { marginBottom: 14 },
    eyebrow: { fontFamily: fonts.sans.bold, fontSize: 10, letterSpacing: 0.9, textTransform: 'uppercase', color: color.textMuted, marginBottom: 4 },
    subtitle: { fontFamily: fonts.sans.regular, fontSize: 13, lineHeight: 17, color: color.textMuted },
    subtitleEmpty: { color: color.textFaint },

    barRow: { flexDirection: 'row', gap: 4, height: 10, marginBottom: 8 },
    seg: { width: '100%', height: 10, borderRadius: 2 },
    segFirst: { borderTopLeftRadius: 4, borderBottomLeftRadius: 4 },
    segLast: { borderTopRightRadius: 4, borderBottomRightRadius: 4 },
    segDim: { opacity: 0.3 },

    labelRow: { flexDirection: 'row', gap: 4 },
    labelCell: { flex: 1, alignItems: 'center' },
    labelShort: { fontFamily: fonts.mono.bold, fontSize: 9 },
    labelCount: { fontFamily: fonts.mono.regular, fontSize: 10, marginTop: 1 },

    statsRow: {
      flexDirection: 'row',
      marginTop: 14,
      paddingTop: 14,
      borderTopWidth: theme.borderWidth.thin,
      borderTopColor: color.divider,
    },
    stat: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 },
    statValue: { fontFamily: fonts.mono.bold, fontSize: 15 },
    statLabel: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted },
    statDivider: { width: 1, backgroundColor: color.divider, marginHorizontal: 12 },
    star: { fontSize: 12 },
  };
});
