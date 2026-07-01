// MasteryCard — the Home "Word Mastery" hero, ported from Home's MasteryCard +
// TierDistributionBar. A proportional 5-tier bar (segment width = word count) with
// per-tier labels/counts, plus a saved / at-Summit stats row. Tapping a segment (or its
// label) opens a tier-detail tooltip (name / count / stability range / desc) and
// highlights that tier while the tooltip is open — matching the prototype.
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { View, type ViewStyle } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { type Tier, TIERS, type TierId } from '@/theme/tiers';
import { IconBook } from './icons';
import { RawText as RNText } from './Text';
import { InfoDot, Tooltip } from './Tooltip';

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
  const { t } = useTranslation();
  const [active, setActive] = useState<number | null>(null);
  const total = tierCounts.reduce((a, b) => a + b, 0);
  const mastered = tierCounts[4] ?? 0;

  // Open/close a tier's tooltip drives the active highlight; opening also fires onTierPress.
  const onTierOpen = (i: number) => (open: boolean) => {
    setActive(open ? i : null);
    if (open) onTierPress?.(TIERS[i].id);
  };

  return (
    <View style={[styles.card, isEmpty ? styles.cardEmpty : styles.cardFull, style]}>
      <View style={styles.header}>
        <View style={styles.eyebrowRow}>
          <RNText style={styles.eyebrow}>{t('masteryCard.eyebrow')}</RNText>
          <InfoDot
            title={t('masteryCard.tierInfoTitle')}
            content={t('masteryCard.tierInfoContent')}
            accessibilityLabel={t('masteryCard.tierInfoA11y')}
          />
        </View>
        <RNText style={[styles.subtitle, isEmpty && styles.subtitleEmpty]}>
          {isEmpty ? t('masteryCard.subtitleEmpty') : t('masteryCard.subtitle', { count: total })}
        </RNText>
      </View>

      {/* Proportional tier bar — each segment opens its tier tooltip */}
      <View style={styles.barRow}>
        {TIERS.map((tier, i) => {
          const count = tierCounts[i] ?? 0;
          const flexVal = isEmpty || total === 0 ? 1 : Math.max(count, 0.4);
          const filled = !isEmpty && count > 0;
          return (
            <Tooltip
              key={tier.id}
              style={{ flex: flexVal }}
              indicator={false}
              content={tierTip(t, tier, count)}
              onOpenChange={onTierOpen(i)}
              accessibilityLabel={t('masteryCard.segmentA11y', { name: t(`tier.${tier.id}.name`), count })}
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
            </Tooltip>
          );
        })}
      </View>

      {/* Labels + counts — also open the tier tooltip */}
      <View style={styles.labelRow}>
        {TIERS.map((tier, i) => {
          const count = tierCounts[i] ?? 0;
          const isActive = active === i;
          return (
            <Tooltip
              key={tier.id}
              style={styles.labelCell}
              indicator={false}
              content={tierTip(t, tier, count)}
              onOpenChange={onTierOpen(i)}
              accessibilityLabel={t('masteryCard.segmentA11y', { name: t(`tier.${tier.id}.name`), count })}
            >
              <RNText
                style={[
                  styles.labelShort,
                  { color: isActive ? theme.color.textStrong : count > 0 ? theme.color.textBody : theme.color.textFaint },
                ]}
              >
                {t(`tier.${tier.id}.short`)}
              </RNText>
              <RNText
                style={[
                  styles.labelCount,
                  { color: isActive ? tier.color : count > 0 ? theme.color.textMuted : theme.color.textFaint },
                ]}
              >
                {count}
              </RNText>
            </Tooltip>
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
          <RNText style={styles.statLabel}>{t('masteryCard.saved')}</RNText>
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
          <RNText style={styles.statLabel}>{t('masteryCard.atSummit')}</RNText>
          <InfoDot
            content={t('masteryCard.summitInfoContent')}
            accessibilityLabel={t('masteryCard.summitInfoA11y')}
          />
        </View>
      </View>
    </View>
  );
}

// Tier-detail tooltip body (rendered inside Tooltip's dark bubble → light text). Plain
// function (not a component) so it can be passed as `content`; reads the module `styles`.
function tierTip(t: TFunction, tier: Tier, count: number) {
  return (
    <View>
      <View style={styles.ttHead}>
        <View style={[styles.ttDot, { backgroundColor: tier.color }]} />
        <RNText style={styles.ttName}>{t(`tier.${tier.id}.name`)}</RNText>
        <RNText style={[styles.ttCount, { color: count > 0 ? tier.color : 'rgba(255,255,255,0.3)' }]}>
          {t('masteryCard.tierWordCount', { count })}
        </RNText>
      </View>
      <RNText style={styles.ttRange}>{t(`tier.${tier.id}.stabilityRange`)}</RNText>
      <RNText style={styles.ttDesc}>{t(`tier.${tier.id}.desc`)}</RNText>
    </View>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, palette, fonts } = theme;
  return {
    ttHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 4 },
    ttDot: { width: 9, height: 9, borderRadius: 2 },
    ttName: { color: '#fff', fontFamily: fonts.sans.bold, fontSize: 12 },
    ttCount: { marginLeft: 'auto', fontFamily: fonts.mono.bold, fontSize: 12 },
    ttRange: { color: 'rgba(255,255,255,0.55)', fontFamily: fonts.sans.regular, fontSize: 10.5, marginBottom: 3 },
    ttDesc: { color: 'rgba(255,255,255,0.85)', fontFamily: fonts.sans.regular, fontSize: 11.5, lineHeight: 16 },
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
    eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
    eyebrow: { fontFamily: fonts.sans.bold, fontSize: 10, letterSpacing: 0.9, textTransform: 'uppercase', color: color.textMuted },
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
