// Card — base surface container, ported from lexicamp-design-system
// `_shared/card.js`. surface-card + 1px border + radius-lg. Screen-specific cards
// (MasteryCard, TranslationCard, WordRow, quiz cards…) compose THIS in P3.
// Interactive cards get a brand border + 1px lift on press.
import type { ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

export interface CardProps {
  children?: ReactNode;
  /** Inner padding (default 16). */
  padding?: number;
  /** Corner radius override (default radius-lg / 20). */
  radius?: number;
  /** Adds shadow-md. */
  elevated?: boolean;
  /** Pointer + press feedback (implied by onPress). */
  interactive?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
}

export function Card({
  children,
  padding = 16,
  radius,
  elevated = false,
  interactive = false,
  onPress,
  style,
}: CardProps) {
  const clickable = !!onPress || interactive;
  const dynamic: ViewStyle = { padding, ...(radius != null && { borderRadius: radius }) };

  if (!clickable) {
    return <View style={[styles.base, elevated && styles.elevated, dynamic, style]}>{children}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        elevated && styles.elevated,
        pressed && styles.pressed,
        dynamic,
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  base: {
    backgroundColor: theme.color.surfaceCard,
    borderWidth: theme.borderWidth.thin,
    borderColor: theme.color.border,
    borderRadius: theme.radius.lg,
  },
  elevated: { boxShadow: theme.shadow.md },
  pressed: { borderColor: theme.color.brand, transform: [{ translateY: -1 }] },
}));
