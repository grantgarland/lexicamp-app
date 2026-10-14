// Input — text field, ported from Foundation's canonical `InputField`.
// Label (sans semibold) · framed field (1.5px border → brand on focus, danger on
// error, focus ring via boxShadow) · optional left icon · hint/error line.
// `secureTextEntry` fields get a trailing show/hide-password toggle for free.
import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import { Platform, Pressable, TextInput, type TextInputProps, View, type ViewStyle } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { IconEye, IconEyeOff } from './icons';
import { FONT_SCALE_MAX, Text } from './Text';

export interface InputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string;
  /** Helper text under the field — states a rule BEFORE the user trips it (e.g.
   *  a password minimum). Yields to `error`: the slot shows one line at a time,
   *  so a correction never has to compete with the rule it just broke. */
  hint?: string;
  iconLeft?: ReactNode;
  containerStyle?: ViewStyle;
}

export function Input({ label, error, hint, iconLeft, containerStyle, onFocus, onBlur, secureTextEntry, testID, value, onChangeText, ...rest }: InputProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  // Password reveal (prod 2026-10-14: a user retried a refused password five
  // times blind). Hidden by default; the toggle only flips masking and never
  // takes focus, so the keyboard stays up and the caret stays put. Local
  // state, so a remount (e.g. switching sign-in ↔ sign-up) re-masks.
  const secure = secureTextEntry === true;
  const [revealed, setRevealed] = useState(false);
  // UIKit wipes a secure field on the first edit after it is re-masked, so
  // reveal → hide → type one key used to leave just that key (iOS simulator,
  // 2026-10-14). The wipe arrives as TWO change events — "" then the keystroke
  // alone — so: armed when hiding, swallow that "" (TextInput then re-syncs the
  // native text to `value`), and re-attach the keystroke that follows unless it
  // is an ordinary edit of the old value. Cost: a backspace that triggers the
  // wipe is swallowed once, which beats losing the whole password.
  const rearmed = useRef(false);
  const wiped = useRef(false);
  const handleChangeText = (text: string) => {
    if (rearmed.current && Platform.OS === 'ios' && value != null && value !== '') {
      if (text === '' && !wiped.current) {
        wiped.current = true;
        return;
      }
      const wasWiped = wiped.current;
      rearmed.current = false;
      wiped.current = false;
      if (wasWiped && !text.startsWith(value) && !value.startsWith(text)) {
        onChangeText?.(value + text);
        return;
      }
    }
    onChangeText?.(text);
  };
  const toggleReveal = () => {
    if (revealed) rearmed.current = true;
    setRevealed(!revealed);
  };

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
          testID={testID}
          value={value}
          onChangeText={handleChangeText}
          secureTextEntry={secure && !revealed}
          // An unmasked password must not be capitalised, corrected or learned
          // by the keyboard's suggestion dictionary. Android only honours that
          // via the visible-password keyboard; iOS via autocorrect/spellcheck.
          {...(secure && {
            autoCapitalize: 'none' as const,
            autoCorrect: false,
            spellCheck: false,
            ...(revealed && Platform.OS === 'android' && { keyboardType: 'visible-password' as const }),
          })}
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
        {secure && (
          <Pressable
            onPress={toggleReveal}
            accessibilityRole="button"
            // The label names the ACTION, so VoiceOver/TalkBack announce what a
            // tap will do; the glyph shows the current state.
            accessibilityLabel={t(revealed ? 'common.hidePassword' : 'common.showPassword')}
            testID={testID != null ? `${testID}Reveal` : undefined}
            // 24pt glyph box + 10pt slop each side = the 44pt minimum target.
            hitSlop={10}
            style={({ pressed }) => [styles.reveal, pressed && { opacity: 0.6 }]}
          >
            {revealed ? (
              <IconEyeOff size={20} color={theme.color.textMuted} />
            ) : (
              <IconEye size={20} color={theme.color.textMuted} />
            )}
          </Pressable>
        )}
      </View>
      {error != null ? (
        <Text style={styles.error}>{error}</Text>
      ) : hint != null ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
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
  reveal: { flexShrink: 0, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1,
    paddingVertical: 12,
    fontFamily: theme.fonts.sans.regular,
    fontSize: theme.size.md,
    color: theme.color.textStrong,
  },
  error: { fontFamily: theme.fonts.sans.regular, fontSize: theme.size.xs, color: theme.color.danger },
  hint: { fontFamily: theme.fonts.sans.regular, fontSize: theme.size.xs, color: theme.color.textMuted },
}));
