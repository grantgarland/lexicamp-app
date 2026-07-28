// RatingButtons — the quiz recall self-grade (Limited / Almost / Got it), ported
// from Quiz's RATING_CONFIG. Full-width 56px rows, label + sublabel, press scale.
//
// Auto-traversal (2026-07-28): when the user TYPED an answer, the screen grades
// it and passes the matching rating as `highlighted`. That button renders filled
// and the fill recedes right→left over `autoMs`; when it empties, the rating
// commits itself and the quiz moves on. The receding fill IS the timer — it
// tells the user how long they have to override without a countdown numeral, and
// it makes the auto-select feel chosen rather than done to them. Any tap (on the
// highlighted button or another) cancels the timer and takes the user's answer.
import { useEffect, useRef } from 'react';
import { Pressable, useColorScheme, View } from 'react-native';
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { Text } from './Text';

export type Rating = 'again' | 'almost' | 'got_it';

/** How long the user has to override the pre-selected grade  */
export const AUTO_ADVANCE_MS = 3500;

// Rating ids + their i18n key stems (label = `rating.<key>`, sublabel = `rating.<key>Sub`).
const ITEMS: { id: Rating; key: 'again' | 'almost' | 'gotIt' }[] = [
  { id: 'again', key: 'again' },
  { id: 'almost', key: 'almost' },
  { id: 'got_it', key: 'gotIt' },
];

export interface RatingButtonsProps {
  onRate: (rating: Rating) => void;
  /** Prompt override; defaults to the localized "How well did you recall it?". */
  prompt?: string;
  /** Pre-selected grade from a typed recall answer. null/undefined = no timer,
   *  no highlight (the manual reveal path is unchanged). */
  highlighted?: Rating | null;
  /** Fires when the timer runs out without a tap. Required for auto-advance —
   *  without it `highlighted` is a static highlight and nothing self-commits. */
  onAutoSelect?: (rating: Rating) => void;
  /** Timer length; override in tests. */
  autoMs?: number;
}

export function RatingButtons({ onRate, prompt, highlighted = null, onAutoSelect, autoMs = AUTO_ADVANCE_MS }: RatingButtonsProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const { color: c, palette: p } = theme;
  const isDark = useColorScheme() === 'dark';

  // Dark-only: the neutral "again" and blue "almost" buttons used light palette
  // fills that don't flip (light box + now-light text = unreadable). Override to
  // dark surfaces with light text; "got it" (green + white) works in both.
  const cfg: Record<Rating, { bg: string; border: string; text: string; sub: string }> = {
    again: isDark
      ? { bg: p.slate[800], border: p.slate[700], text: c.textBody, sub: c.textMuted }
      : { bg: p.slate[100], border: p.slate[200], text: c.textBody, sub: c.textMuted },
    almost: isDark
      ? { bg: c.brandSoft, border: p.blue[700], text: p.blue[200], sub: c.textMuted }
      : { bg: p.blue[50], border: p.blue[200], text: p.blue[700], sub: c.textMuted },
    got_it: { bg: p.green[500], border: 'transparent', text: '#fff', sub: 'rgba(255, 255, 255, 0.7)' },
  };

  // Ring + receding-fill colors. "got it" is already a saturated fill, so its
  // highlight is a white wash rather than more green.
  const hl: Record<Rating, { ring: string; fill: string }> = {
    again: { ring: isDark ? p.slate[400] : p.slate[500], fill: isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(15, 23, 42, 0.12)' },
    almost: { ring: p.blue[500], fill: isDark ? 'rgba(147, 197, 253, 0.24)' : 'rgba(59, 130, 246, 0.18)' },
    got_it: { ring: p.green[700], fill: 'rgba(255, 255, 255, 0.30)' },
  };

  // 1 → 0 over autoMs. Left-anchored width, so the fill empties right→left.
  const progress = useSharedValue(1);
  // Latest props in refs: the animation callback fires on the UI thread and must
  // not close over a stale render's handler.
  const settled = useRef(false);
  const autoRef = useRef(onAutoSelect);
  const ratingRef = useRef(highlighted);

  const fire = () => {
    if (settled.current) return;
    settled.current = true;
    const r = ratingRef.current;
    if (r != null) autoRef.current?.(r);
  };

  useEffect(() => {
    autoRef.current = onAutoSelect;
    ratingRef.current = highlighted;
  });

  useEffect(() => {
    if (highlighted == null || onAutoSelect == null) return undefined;
    settled.current = false;
    progress.value = 1;
    progress.value = withTiming(0, { duration: autoMs, easing: Easing.linear }, (finished) => {
      if (finished) runOnJS(fire)();
    });
    // Unmount / re-grade mid-flight must not commit a rating for a card that is
    // already gone — cancel first, and `settled` guards a callback that already
    // crossed to the JS thread.
    return () => {
      settled.current = true;
      cancelAnimation(progress);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlighted, autoMs]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${Math.max(0, progress.value) * 100}%` }));

  const press = (r: Rating) => {
    // A manual tap always wins — stop the clock before handing the rating up.
    settled.current = true;
    cancelAnimation(progress);
    onRate(r);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.prompt}>{prompt ?? t('rating.prompt')}</Text>
      {ITEMS.map((r) => {
        const s = cfg[r.id];
        const isHl = highlighted === r.id;
        return (
          <Pressable
            key={r.id}
            accessibilityRole="button"
            accessibilityState={{ selected: isHl }}
            accessibilityHint={isHl ? t('rating.autoHint') : undefined}
            testID={`rating-${r.id}`}
            onPress={() => press(r.id)}
            style={({ pressed }) => [
              styles.btn,
              { backgroundColor: s.bg, borderColor: isHl ? hl[r.id].ring : s.border },
              isHl && styles.btnHighlighted,
              pressed && styles.pressed,
            ]}
          >
            {isHl && (
              // Painted FIRST so the label/sublabel stay above it. Clipped by the
              // wrapper so the fill can't spill past the button's rounded corners.
              <View style={styles.fillClip} pointerEvents="none">
                <Animated.View style={[styles.fill, { backgroundColor: hl[r.id].fill }, fillStyle]} />
              </View>
            )}
            <Text style={[styles.label, { color: s.text }]}>{t(`rating.${r.key}`)}</Text>
            <Text style={[styles.sub, { color: s.sub }]}>{t(`rating.${r.key}Sub`)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: 8 },
  prompt: {
    fontFamily: theme.fonts.sans.bold,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: theme.color.textMuted,
    textAlign: 'center',
    marginBottom: 2,
  },
  btn: {
    minHeight: 56,
    borderWidth: theme.borderWidth.base,
    borderRadius: theme.radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    overflow: 'hidden',
  },
  btnHighlighted: { borderWidth: 2 },
  fillClip: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: theme.radius.md, overflow: 'hidden' },
  fill: { position: 'absolute', top: 0, left: 0, bottom: 0 },
  pressed: { transform: [{ scale: 0.98 }] },
  label: { fontFamily: theme.fonts.sans.bold, fontSize: 16 },
  sub: { fontFamily: theme.fonts.sans.regular, fontSize: 12 },
}));
