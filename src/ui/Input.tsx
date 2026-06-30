// Input — text field, ported from Foundation's canonical `InputField`.
// Label (sans semibold) · framed field (1.5px border → brand on focus, danger on
// error, focus ring via boxShadow) · optional left icon · error line.
import type { ReactNode } from 'react';
import { useState } from 'react';
import { TextInput, type TextInputProps, View, type ViewStyle } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { FONT_SCALE_MAX, Text } from './Text';

export interface InputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string;
  iconLeft?: ReactNode;
  containerStyle?: ViewStyle;
}

export function Input({ label, error, iconLeft, containerStyle, onFocus, onBlur, ...rest }: InputProps) {
  const { theme } = useUnistyles();
  const [focused, setFocused] = useState(false);

  const borderColor = error != null ? theme.color.danger : focused ? theme.color.brand : theme.color.borderStrong;
  const boxShadow = focused
    ? `0 0 0 3px ${error != null ? theme.color.dangerSoft : theme.color.focusRing}`
    : undefined;

  return (
    <View style={[styles.wrap, containerStyle]}>
      {label != null && <Text style={styles.label}>{label}</Text>}
      <View style={[styles.field, { borderColor, boxShadow }]}>
        {iconLeft != null && <View style={styles.icon}>{iconLeft}</View>}
        <TextInput
          placeholderTextColor={theme.color.textMuted}
          maxFontSizeMultiplier={FONT_SCALE_MAX}
          style={styles.input}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />
      </View>
      {error != null && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: 6 },
  label: { fontFamily: theme.fonts.sans.semibold, fontSize: theme.size.sm, color: theme.color.textBody },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    backgroundColor: theme.color.surfaceCard,
    borderWidth: theme.borderWidth.base,
    borderRadius: theme.radius.md,
  },
  icon: { flexShrink: 0 },
  input: {
    flex: 1,
    paddingVertical: 12,
    fontFamily: theme.fonts.sans.regular,
    fontSize: theme.size.md,
    color: theme.color.textStrong,
  },
  error: { fontFamily: theme.fonts.sans.regular, fontSize: theme.size.xs, color: theme.color.danger },
}));
