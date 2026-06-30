// Button — the canonical CTA set, ported from lexicamp-design-system
// `_shared/buttons.js` (Session 18 source-of-truth set):
//   primary (amber + shadow) · secondary (surface + border = the "Cancel") ·
//   destructive (danger) · ghost (text link) · pill (compact, empty states).
// Block variants are 56px / radius-md / full-width by default; pill is auto-width.
// Press feedback: scale .98 (block), opacity (pill/ghost) — matches the prototype.
import { Pressable, type PressableProps, type ViewStyle } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { RawText as Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost' | 'pill';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style' | 'disabled'> {
  title: string;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** Block variants stretch to fill by default; ignored for pill. */
  fullWidth?: boolean;
  style?: ViewStyle;
}

export function Button({
  title,
  variant = 'primary',
  disabled = false,
  fullWidth = true,
  style,
  ...rest
}: ButtonProps) {
  const { theme } = useUnistyles();
  const isPill = variant === 'pill';
  const isGhost = variant === 'ghost';

  const labelColor = disabled
    ? theme.color.textMuted
    : variant === 'secondary'
      ? theme.color.textBody
      : isGhost
        ? theme.color.textMuted
        : theme.color.textOnAccent; // primary / destructive / pill

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={({ pressed }) => [
        isPill ? styles.pillBase : isGhost ? styles.ghostBase : styles.blockBase,
        !isPill && !isGhost && fullWidth && styles.fullWidth,
        disabled ? styles[`${variant}Disabled`] : styles[variant],
        pressed && !disabled && styles[`${variant}Pressed`],
        style,
      ]}
      {...rest}
    >
      <Text style={[styles[`label_${variant}`], { color: labelColor }]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, palette, radius, space, shadow, borderWidth, fonts, size } = theme;

  return {
    blockBase: {
      minHeight: 56, // grows (not clips) when OS text size is enlarged
      borderRadius: radius.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 10,
      paddingHorizontal: space[4],
    },
    ghostBase: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 14,
    },
    pillBase: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'flex-start',
      borderRadius: radius.pill,
      paddingVertical: 13,
      paddingHorizontal: space[8],
    },
    fullWidth: { alignSelf: 'stretch' },

    // ── primary ──
    primary: { backgroundColor: color.accent, boxShadow: shadow.accent },
    primaryPressed: { backgroundColor: palette.amber[600], transform: [{ scale: 0.98 }] },
    primaryDisabled: { backgroundColor: palette.slate[200] },

    // ── secondary (canonical Cancel) ──
    secondary: {
      backgroundColor: color.surfaceSunken,
      borderWidth: borderWidth.thin,
      borderColor: color.border,
    },
    secondaryPressed: { transform: [{ scale: 0.98 }] },
    secondaryDisabled: {
      backgroundColor: color.surfaceSunken,
      borderWidth: borderWidth.thin,
      borderColor: color.border,
    },

    // ── destructive ──
    destructive: { backgroundColor: color.danger },
    destructivePressed: { transform: [{ scale: 0.98 }] },
    destructiveDisabled: { backgroundColor: palette.slate[200] },

    // ── ghost ──
    ghost: {},
    ghostPressed: { opacity: 0.6 },
    ghostDisabled: {},

    // ── pill ──
    pill: { backgroundColor: color.accent, boxShadow: shadow.accent },
    pillPressed: { opacity: 0.88 },
    pillDisabled: { backgroundColor: palette.slate[200] },

    // ── labels ──
    label_primary: { fontFamily: fonts.sans.semibold, fontSize: size.md, letterSpacing: -0.2 },
    label_secondary: { fontFamily: fonts.sans.semibold, fontSize: size.md, letterSpacing: -0.2 },
    label_destructive: { fontFamily: fonts.sans.semibold, fontSize: size.md, letterSpacing: -0.2 },
    label_ghost: { fontFamily: fonts.sans.medium, fontSize: size.sm },
    label_pill: { fontFamily: fonts.sans.semibold, fontSize: 15, letterSpacing: 0.15 },
  };
});
