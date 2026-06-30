// WordCharInput — OTP-style per-letter recall input (Tier-3 quiz cards), ported
// from `_shared/word-char-input.js`. One underline cell per letter; spaces become
// visual word gaps. Auto-advance on type, backspace to go back, onComplete when full.
import { useEffect, useMemo, useRef, useState } from 'react';
import { type NativeSyntheticEvent, TextInput, type TextInputKeyPressEventData, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { FONT_SCALE_MAX } from './Text';

export interface WordCharInputProps {
  /** Answer word/phrase; spaces render as gaps between cell groups. */
  word: string;
  /** Filled / focused underline color (tier accent). */
  accentColor?: string;
  /** Idle underline color (tier border). */
  borderColor?: string;
  autoFocus?: boolean;
  onComplete?: () => void;
}

export function WordCharInput({ word, accentColor, borderColor, autoFocus, onComplete }: WordCharInputProps) {
  const { theme } = useUnistyles();
  const accent = accentColor ?? theme.color.accent;
  const idle = borderColor ?? theme.color.border;

  const letters = useMemo(() => word.split(''), [word]);
  const letterCount = useMemo(() => letters.filter((ch) => ch !== ' ').length, [letters]);

  const [values, setValues] = useState<string[]>(() => new Array(letterCount).fill(''));
  const [focused, setFocused] = useState<number | null>(null);
  const refs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    setValues(new Array(letterCount).fill(''));
  }, [letterCount]);

  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => refs.current[0]?.focus(), 80);
    return () => clearTimeout(t);
  }, [autoFocus]);

  // Responsive sizing — keeps the row inside typical card widths.
  const cellW = letterCount <= 6 ? 36 : letterCount <= 10 ? 28 : 22;
  const fontSize = letterCount <= 6 ? 22 : letterCount <= 10 ? 17 : 14;
  const gap = letterCount <= 6 ? 8 : letterCount <= 10 ? 5 : 4;
  const wordGap = letterCount <= 6 ? 16 : 12;

  const setAt = (i: number, ch: string) => {
    setValues((prev) => {
      const next = [...prev];
      next[i] = ch;
      return next;
    });
  };

  const handleChange = (i: number, text: string) => {
    if (text === '') {
      setAt(i, '');
      return;
    }
    const ch = text.slice(-1);
    setValues((prev) => {
      const next = [...prev];
      next[i] = ch;
      if (i < letterCount - 1) refs.current[i + 1]?.focus();
      else if (next.every((v) => v)) onComplete?.();
      return next;
    });
  };

  const handleKeyPress = (i: number, e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (e.nativeEvent.key !== 'Backspace') return;
    if (values[i]) {
      setAt(i, '');
    } else if (i > 0) {
      setAt(i - 1, '');
      refs.current[i - 1]?.focus();
    }
  };

  // Group slot indices by spaces (visual word breaks).
  const groups = useMemo(() => {
    const out: number[][] = [];
    let slot = -1;
    let cur: number[] = [];
    for (const ch of letters) {
      if (ch === ' ') {
        if (cur.length) {
          out.push(cur);
          cur = [];
        }
      } else {
        slot++;
        cur.push(slot);
      }
    }
    if (cur.length) out.push(cur);
    return out;
  }, [letters]);

  return (
    <View style={[styles.row, { gap: wordGap }]}>
      {groups.map((group, gi) => (
        <View key={gi} style={[styles.group, { gap }]}>
          {group.map((si) => {
            const filled = !!values[si];
            const isFocused = focused === si;
            return (
              <TextInput
                key={si}
                ref={(el) => {
                  refs.current[si] = el;
                }}
                value={values[si] ?? ''}
                onChangeText={(t) => handleChange(si, t)}
                onKeyPress={(e) => handleKeyPress(si, e)}
                onFocus={() => setFocused(si)}
                onBlur={() => setFocused((f) => (f === si ? null : f))}
                caretHidden
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                maxFontSizeMultiplier={FONT_SCALE_MAX}
                style={[
                  styles.cell,
                  {
                    width: cellW,
                    height: cellW + 10,
                    fontSize,
                    fontFamily: theme.fonts.serif.semibold,
                    color: theme.color.textStrong,
                    borderBottomWidth: isFocused ? 3 : 2.5,
                    borderBottomColor: filled || isFocused ? accent : idle,
                  },
                ]}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  row: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', flexWrap: 'wrap' },
  group: { flexDirection: 'row', alignItems: 'flex-end' },
  cell: { textAlign: 'center', padding: 0 },
}));
