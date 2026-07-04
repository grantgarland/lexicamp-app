// PremiumBadge — the amber "★ PREMIUM" pill from settings/Settings.html. Shared so the
// Settings rows, plan card, and (later) paywall gates all read from one definition.
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { IconStar } from './icons';
import { RawText as Text } from './Text';

export interface PremiumBadgeProps {
  /** Compact variant for inline row slots (smaller pad + glyph). */
  small?: boolean;
  label?: string;
}

export function PremiumBadge({ small = false, label = 'PREMIUM' }: PremiumBadgeProps) {
  const { theme } = useUnistyles();
  return (
    <View style={[styles.badge, small ? styles.badgeSmall : styles.badgeBase]}>
      <IconStar size={small ? 9 : 10} color={theme.palette.amber[600]} />
      <Text style={[styles.text, small && styles.textSmall]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 99,
    borderWidth: theme.borderWidth.thin,
    borderColor: theme.palette.amber[200],
    backgroundColor: theme.palette.amber[50],
  },
  badgeBase: { paddingHorizontal: 8, paddingVertical: 3 },
  badgeSmall: { paddingHorizontal: 6, paddingVertical: 2 },
  text: { fontFamily: theme.fonts.sans.bold, fontSize: 11, letterSpacing: 0.3, color: theme.palette.amber[600] },
  textSmall: { fontSize: 10 },
}));
