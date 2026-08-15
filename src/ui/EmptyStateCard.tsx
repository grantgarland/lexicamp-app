// EmptyStateCard — the canonical empty-state column ON a card surface.
//
// Same illustration → title → body → CTA column as `EmptyState`, which it
// COMPOSES rather than copies: there is exactly one implementation of that
// layout in the app and this is not a second one. The card is the only
// difference, and it earns its place in two situations:
//
//   · over a ghost layer (see EmptyOverlay), where the card has to separate
//     itself from the silhouettes behind it;
//   · on a busy tab, where a bare centered column reads as unstyled.
//
// A bare `EmptyState` is still right inside sheets and scroll content, where a
// card inside a card is just a box in a box.
import { View, type ViewStyle } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { EmptyState, type EmptyStateProps } from './EmptyState';

export interface EmptyStateCardProps extends Omit<EmptyStateProps, 'inset' | 'style'> {
  /** Outer wrapper (positioning); the card's own chrome is fixed. */
  style?: ViewStyle;
  /** Card style escape hatch (width caps, margins). */
  cardStyle?: ViewStyle;
}

export function EmptyStateCard({ style, cardStyle, ...rest }: EmptyStateCardProps) {
  return (
    <View style={[styles.wrap, style]}>
      <View style={[styles.card, cardStyle]}>
        <EmptyState inset {...rest} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  card: {
    backgroundColor: theme.color.surfaceCard,
    borderWidth: theme.borderWidth.base,
    borderColor: theme.color.border,
    borderRadius: theme.radius.lg,
    // The `shadow.md` TOKEN, not the one-off literal the leaderboard card used
    // to carry — that string matched no token and was the only copy of itself.
    boxShadow: theme.shadow.md,
    paddingVertical: 24,
    paddingHorizontal: 22,
    alignItems: 'center',
    maxWidth: 300,
  },
}));
