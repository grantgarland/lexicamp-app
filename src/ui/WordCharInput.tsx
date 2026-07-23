// WordCharInput — OTP-style per-letter recall input (Tier-3 quiz cards).
// Long / multi-word answers do NOT wrap (wrapping would imply multiple words).
// Instead the cells live in a single horizontal row that SCROLLS: the row fades out
// at whichever edge has more content, and focus auto-scrolls the active cell into
// view as you type. Spaces become word gaps, so multi-word translations (e.g. the
// Russian «лежачий полицейский») are supported. Auto-focuses cell 0 on mount so the
// keyboard opens (after the screen/modal transition settles).
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  TextInput,
  type TextInputKeyPressEventData,
  View,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { FONT_SCALE_MAX } from './Text';

export interface WordCharInputProps {
  /** Answer word/phrase; spaces render as gaps between cell groups. */
  word: string;
  /** Filled / focused underline color (tier accent). */
  accentColor?: string;
  /** Idle underline color (tier border). */
  borderColor?: string;
  /** Background the input sits on — the edge fades blend to this. */
  backgroundColor?: string;
  autoFocus?: boolean;
  onComplete?: () => void;
}

const CELL_W = 30;
const CELL_H = 44;
const GAP = 6; // between cells in a word
const WORD_GAP = 18; // between words
const FONT = 22;
const FADE_W = 26;
const PAD = 6;

export function WordCharInput({ word, accentColor, borderColor, backgroundColor, autoFocus, onComplete }: WordCharInputProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const accent = accentColor ?? theme.color.accent;
  const idle = borderColor ?? theme.color.border;
  const fadeBg = backgroundColor ?? theme.color.surfaceCard;

  const letters = useMemo(() => word.split(''), [word]);
  const letterCount = useMemo(() => letters.filter((ch) => ch !== ' ').length, [letters]);

  // Per-cell left margin (word/letter spacing) + x-offset (for auto-scroll).
  const { cellMargins, slotX, contentW } = useMemo(() => {
    const margins: number[] = [];
    const xs: number[] = [];
    let gapBefore = 0;
    let cursor = PAD;
    for (const ch of letters) {
      if (ch === ' ') {
        gapBefore = WORD_GAP;
        continue;
      }
      const marginLeft = margins.length === 0 ? 0 : gapBefore || GAP;
      margins.push(marginLeft);
      cursor += marginLeft;
      xs.push(cursor);
      cursor += CELL_W;
      gapBefore = 0;
    }
    return { cellMargins: margins, slotX: xs, contentW: cursor + PAD };
  }, [letters]);

  const [values, setValues] = useState<string[]>(() => new Array(letterCount).fill(''));
  const [focused, setFocused] = useState<number | null>(null);
  const [containerW, setContainerW] = useState(0);
  const [scrollX, setScrollX] = useState(0);
  const refs = useRef<(TextInput | null)[]>([]);
  const scrollRef = useRef<ScrollView>(null);

  // When the answer length changes (without a remount), clear the cells + scroll offset.
  // Reset during render — the lint-clean form of a reset effect (react.dev "adjusting
  // state on prop change"); the imperative scroll reset stays in the effect below.
  const [prevLetterCount, setPrevLetterCount] = useState(letterCount);
  if (prevLetterCount !== letterCount) {
    setPrevLetterCount(letterCount);
    setValues(new Array(letterCount).fill(''));
    setScrollX(0);
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ x: 0, animated: false });
  }, [letterCount]);

  // Cell 0 uses the native `autoFocus` prop (below) to open the keyboard on mount.
  // The parent keys this component per card, so it remounts → refocuses each card.

  const maxScroll = Math.max(0, contentW - containerW);
  const overflow = contentW > containerW + 1;
  const showLeftFade = scrollX > 4;
  const showRightFade = overflow && scrollX < maxScroll - 4;

  const scrollToSlot = (i: number) => {
    if (i < 0 || i >= slotX.length) return;
    const target = Math.max(0, Math.min(slotX[i] - 44, maxScroll));
    scrollRef.current?.scrollTo({ x: target, animated: true });
  };

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
    const next = [...values];
    next[i] = ch;
    setValues(next);
    // Side effects live OUTSIDE the state updater (updaters must be pure — calling
    // onComplete there triggers a parent setState during render).
    if (i < letterCount - 1) {
      refs.current[i + 1]?.focus();
      scrollToSlot(i + 1);
    } else if (next.every((v) => v)) {
      onComplete?.();
    }
  };

  const handleKeyPress = (i: number, e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (e.nativeEvent.key !== 'Backspace') return;
    if (values[i]) {
      setAt(i, '');
    } else if (i > 0) {
      setAt(i - 1, '');
      refs.current[i - 1]?.focus();
      scrollToSlot(i - 1);
    }
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setScrollX(e.nativeEvent.contentOffset.x);

  return (
    <View style={styles.wrap} onLayout={(e) => setContainerW(e.nativeEvent.layout.width)}>
      <ScrollView
        ref={scrollRef}
        horizontal
        keyboardShouldPersistTaps="always"
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={styles.row}
      >
        {cellMargins.map((marginLeft, si) => {
          const filled = !!values[si];
          const isFocused = focused === si;
          return (
            <TextInput
              key={si}
              ref={(el) => {
                refs.current[si] = el;
              }}
              value={values[si] ?? ''}
              autoFocus={autoFocus === true && si === 0}
              onChangeText={(txt) => handleChange(si, txt)}
              onKeyPress={(e) => handleKeyPress(si, e)}
              onFocus={() => {
                setFocused(si);
                scrollToSlot(si);
              }}
              onBlur={() => setFocused((f) => (f === si ? null : f))}
              accessibilityLabel={t('quiz.letterInputA11y', { position: si + 1, total: letterCount })}
              caretHidden
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              maxFontSizeMultiplier={FONT_SCALE_MAX}
              style={[
                styles.cell,
                {
                  marginLeft,
                  fontFamily: theme.fonts.serif.semibold,
                  color: theme.color.textStrong,
                  borderBottomWidth: isFocused ? 3 : 2.5,
                  borderBottomColor: filled || isFocused ? accent : idle,
                },
              ]}
            />
          );
        })}
      </ScrollView>

      {showLeftFade && (
        <Svg style={[styles.fade, styles.fadeLeft]} width={FADE_W} height={CELL_H} pointerEvents="none">
          <Defs>
            <LinearGradient id="wciFadeL" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={fadeBg} stopOpacity={1} />
              <Stop offset="1" stopColor={fadeBg} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect width={FADE_W} height={CELL_H} fill="url(#wciFadeL)" />
        </Svg>
      )}
      {showRightFade && (
        <Svg style={[styles.fade, styles.fadeRight]} width={FADE_W} height={CELL_H} pointerEvents="none">
          <Defs>
            <LinearGradient id="wciFadeR" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={fadeBg} stopOpacity={0} />
              <Stop offset="1" stopColor={fadeBg} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect width={FADE_W} height={CELL_H} fill="url(#wciFadeR)" />
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  wrap: { position: 'relative', height: CELL_H, alignSelf: 'stretch' },
  // flexGrow + center: short answers sit centered in the card; long ones overflow → scroll.
  row: { flexGrow: 1, justifyContent: 'center', alignItems: 'flex-end', paddingHorizontal: PAD },
  cell: { width: CELL_W, height: CELL_H, fontSize: FONT, textAlign: 'center', padding: 0 },
  fade: { position: 'absolute', top: 0, bottom: 0 },
  fadeLeft: { left: 0 },
  fadeRight: { right: 0 },
}));
