// TierBadge — canonical mastery-tier badge, ported from `_shared/tier-badge.js`.
// One presentational component, three variants; colors/labels come from the tier
// registry (`@/theme/tiers`) so callers pass a tier id or object, not raw colors.
//   chip  — circular numeral (quiz card corners)
//   pill  — short-label pill (word-list rows); summit shows its ★ glyph
//   badge — large bundled image (milestone screens) — needs `source` (assets pending)
import { View, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { StyleSheet } from 'react-native-unistyles';

import { getTier, type Tier, type TierId } from '@/theme/tiers';
import { RawText as Text } from './Text';
import { TIER_BADGE_XML } from './tierBadges';

export type TierBadgeVariant = 'chip' | 'pill' | 'badge';

export interface TierBadgeProps {
  /** Tier object or id/alias (e.g. 'sr', 'summit', 'base_camp'). */
  tier: Tier | TierId | string;
  variant?: TierBadgeVariant;
  size?: 'sm' | 'md';
  /** badge variant: rendered width in px (height = px × 1.05). */
  px?: number;
  style?: ViewStyle;
}

const toTier = (t: Tier | string): Tier => (typeof t === 'string' ? getTier(t) : t);

export function TierBadge({ tier, variant = 'pill', size = 'md', px = 110, style }: TierBadgeProps) {
  const t = toTier(tier);

  if (variant === 'badge') {
    return (
      <View style={style} accessibilityLabel={`${t.name} tier badge`}>
        <SvgXml xml={TIER_BADGE_XML[t.id]} width={px} height={Math.round(px * 1.05)} />
      </View>
    );
  }

  if (variant === 'chip') {
    const sz = size === 'md' ? 28 : 22;
    return (
      <View
        accessibilityLabel={`${t.name} tier`}
        style={[styles.chip, { width: sz, height: sz, borderRadius: sz / 2, backgroundColor: t.badgeBg }, style]}
      >
        <Text style={[styles.chipText, { color: t.badgeText, fontSize: size === 'md' ? 13 : 10 }]}>
          {String(t.chipGlyph)}
        </Text>
      </View>
    );
  }

  // pill
  const sm = size === 'sm';
  return (
    <View
      accessibilityLabel={`${t.name} tier`}
      style={[
        styles.pill,
        {
          backgroundColor: t.badgeBg,
          borderColor: t.badgeBorder,
          paddingVertical: sm ? 2 : 3,
          paddingHorizontal: sm ? 6 : 8,
          borderRadius: sm ? 4 : 6,
        },
        style,
      ]}
    >
      <Text style={[styles.pillText, { color: t.badgeText, fontSize: sm ? 10 : 11 }]}>{t.short}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  chip: { alignItems: 'center', justifyContent: 'center' },
  chipText: { fontFamily: theme.fonts.mono.bold },
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: theme.borderWidth.thin,
  },
  pillText: { fontFamily: theme.fonts.sans.bold, letterSpacing: 0.3 },
}));
