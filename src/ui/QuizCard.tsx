// QuizCard — the study card faces, ported from Quiz's CardFrontTier1/Tier3 + CardBack.
// Front has two modes: `recognition` (tap to reveal) and `recall` (WordCharInput).
// Colors come from the tier registry; the screen owns the flip between front/back.
import type { TFunction } from 'i18next';
import { Pressable, useColorScheme, View, type ViewStyle } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { getTier, tierView, type Tier, type TierId } from '@/theme/tiers';
import { IconChevronDown } from './icons';
import { RawText as RNText } from './Text';
import { TierBadge } from './TierBadge';
import { Tooltip } from './Tooltip';
import { WordCharInput } from './WordCharInput';

/** Pointed, localized help text for a tier badge tooltip (CEFR code stays as-is). */
function tierTooltip(tier: Tier, translate: TFunction): { title: string; content: string } {
  const name = translate(`tier.${tier.id}.name`);
  return {
    title: `${name} · ${tier.cefr}`,
    content: `${translate(`tier.${tier.id}.stabilityRange`)}. ${translate(`tier.${tier.id}.desc`)}`,
  };
}

export interface QuizCardData {
  frontWord: string;
  frontSub?: string;
  frontPrompt: string;
  backWord: string;
  backPhonetic?: string;
  backPos?: string;
  backExample?: string;
}

export type QuizMode = 'recognition' | 'recall';

const toTier = (t: Tier | string): Tier => (typeof t === 'string' ? getTier(t) : t);

export interface QuizCardFrontProps {
  tier: Tier | TierId | string;
  card: QuizCardData;
  mode?: QuizMode;
  onReveal: () => void;
  /** recall mode: focus the first cell on mount (opens the keyboard). Default true. */
  autoFocus?: boolean;
  /** Render the reveal CTA inside the card (default true). The quiz screen passes
   *  false and renders `QuizRevealButton` in the bottom gutter instead, so the
   *  reveal target sits where the rating buttons appear — one thumb position for
   *  the whole session (18-session ergonomics). */
  revealCta?: boolean;
  style?: ViewStyle;
}

export function QuizCardFront({ tier, card, mode = 'recognition', onReveal, autoFocus = true, revealCta = true, style }: QuizCardFrontProps) {
  const { t: translate } = useTranslation();
  const isDark = useColorScheme() === 'dark';
  const tr = tierView(toTier(tier), isDark);
  const recall = mode === 'recall';

  return (
    <View style={[styles.cardBase, { backgroundColor: tr.bg, borderColor: tr.border }, style]}>
      <View style={styles.badge}>
        <Tooltip {...tierTooltip(tr, translate)} accessibilityLabel={translate('tier.a11yInfo', { name: translate(`tier.${tr.id}.name`) })}>
          <TierBadge tier={tr} variant="chip" size="sm" />
        </Tooltip>
      </View>

      <View style={[styles.frontContent, recall && styles.frontContentRecall]}>
        <RNText style={[styles.frontWord, recall && styles.frontWordRecall]}>{card.frontWord}</RNText>
        {card.frontSub != null && (
          <RNText style={[recall ? styles.recallSub : styles.frontSub]}>{card.frontSub}</RNText>
        )}
        <RNText style={[styles.frontPrompt, { color: tr.labelColor }]}>{card.frontPrompt}</RNText>

        {recall && (
          <>
            <WordCharInput word={card.backWord} accentColor={tr.accent} borderColor={tr.border} backgroundColor={tr.bg} autoFocus={autoFocus} onComplete={onReveal} />
            <RNText style={styles.letterHint}>
              {translate('quizCard.letters', { count: card.backWord.replace(/ /g, '').length })}
            </RNText>
          </>
        )}
      </View>

      {revealCta && <QuizRevealButton tier={tr} mode={mode} onPress={onReveal} />}
    </View>
  );
}

/** The reveal CTA, extracted so the quiz screen can place it in the bottom
 *  gutter (same position as the rating buttons — minimal thumb travel). In
 *  recall mode the open keyboard covers the gutter until it's dismissed
 *  (auto on a correct type-out, or manually) — intentional: typing IS the
 *  interaction while the keyboard is up. */
export function QuizRevealButton({ tier, mode = 'recognition', onPress, style }: { tier: Tier | TierId | string; mode?: QuizMode; onPress: () => void; style?: ViewStyle }) {
  const { t: translate } = useTranslation();
  const isDark = useColorScheme() === 'dark';
  const tr = tierView(toTier(tier), isDark);
  if (mode === 'recall') {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [styles.revealSolid, { backgroundColor: tr.accent }, style, pressed && styles.pressedOpacity]}
      >
        <RNText style={styles.revealSolidText}>{translate('quizCard.reveal')}</RNText>
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.revealOutline, { borderColor: tr.border }, style, pressed && styles.pressedScale]}
    >
      <RNText style={[styles.revealOutlineText, { color: tr.accent }]}>{translate('quizCard.tapToReveal')}</RNText>
      <IconChevronDown size={16} color={tr.accent} />
    </Pressable>
  );
}

export interface QuizCardBackProps {
  tier: Tier | TierId | string;
  card: QuizCardData;
  style?: ViewStyle;
}

export function QuizCardBack({ tier, card, style }: QuizCardBackProps) {
  const { theme } = useUnistyles();
  const { t: translate } = useTranslation();
  const isDark = useColorScheme() === 'dark';
  const tr = tierView(toTier(tier), isDark);

  return (
    <View style={[styles.cardBase, styles.backCard, { borderColor: tr.border }, style]}>
      <View style={styles.backHeadRow}>
        <View style={styles.backTierRow}>
          <Tooltip {...tierTooltip(tr, translate)} accessibilityLabel={translate('tier.a11yInfo', { name: translate(`tier.${tr.id}.name`) })}>
            <TierBadge tier={tr} variant="chip" size="sm" />
          </Tooltip>
          <RNText style={styles.backTierName}>{translate(`tier.${tr.id}.name`)}</RNText>
        </View>
        {card.backPos != null && (
          <View style={styles.posPill}>
            <RNText style={styles.posPillText}>{card.backPos}</RNText>
          </View>
        )}
      </View>

      <RNText style={styles.backWord}>{card.backWord}</RNText>
      {card.backPhonetic != null && (
        <RNText style={[styles.backIpa, { color: tr.labelColor }]}>{card.backPhonetic}</RNText>
      )}

      <View style={styles.backDivider} />

      {card.backExample != null && (
        <RNText style={styles.backExample}>&ldquo;{card.backExample}&rdquo;</RNText>
      )}

      <View style={[styles.echo, { backgroundColor: tr.bg }]}>
        <RNText style={[styles.echoText, { color: tr.labelColor }]}>
          <RNText style={styles.echoStrong}>{card.frontWord}</RNText>
          <RNText style={{ color: theme.color.textMuted }}>{`  →  ${card.backWord}`}</RNText>
        </RNText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, fonts, radius } = theme;
  return {
    cardBase: {
      borderWidth: theme.borderWidth.base,
      borderRadius: radius.xl,
      paddingTop: 28,
      paddingHorizontal: 24,
      paddingBottom: 24,
      boxShadow: theme.shadow.md,
      position: 'relative',
    },
    badge: { position: 'absolute', top: 16, right: 16, zIndex: 1 },

    frontContent: { alignItems: 'center', gap: 10, paddingVertical: 16 },
    frontContentRecall: { gap: 14, paddingTop: 24 },
    frontWord: {
      fontFamily: fonts.serif.semibold,
      fontSize: 40,
      letterSpacing: -0.8,
      color: color.textStrong,
      textAlign: 'center',
    },
    frontWordRecall: { fontSize: 32 },
    frontSub: { fontFamily: fonts.mono.regular, fontSize: 13, color: color.textMuted, textAlign: 'center' },
    recallSub: { fontFamily: fonts.sans.regular, fontSize: 14, lineHeight: 22, color: color.textMuted, textAlign: 'center', maxWidth: 220 },
    frontPrompt: { fontFamily: fonts.sans.medium, fontSize: 14, textAlign: 'center', marginTop: 2 },
    letterHint: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted, letterSpacing: 0.2 },

    revealOutline: {
      marginTop: 8,
      paddingVertical: 14,
      backgroundColor: color.surfaceCard,
      borderWidth: theme.borderWidth.base,
      borderRadius: radius.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    revealOutlineText: { fontFamily: fonts.sans.semibold, fontSize: 15 },
    revealSolid: {
      marginTop: 8,
      paddingVertical: 13,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    revealSolidText: { fontFamily: fonts.sans.bold, fontSize: 15, color: '#fff' },
    pressedScale: { transform: [{ scale: 0.98 }] },
    pressedOpacity: { opacity: 0.85 },

    // ── back ──
    backCard: { backgroundColor: color.surfaceCard },
    backHeadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    backTierRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    backTierName: { fontFamily: fonts.sans.semibold, fontSize: 11, letterSpacing: 0.7, textTransform: 'uppercase', color: color.textMuted },
    posPill: { backgroundColor: color.surfaceSunken, borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: 10 },
    posPillText: { fontFamily: fonts.sans.medium, fontSize: 12, color: color.textMuted },
    backWord: { fontFamily: fonts.serif.semibold, fontSize: 40, letterSpacing: -0.8, color: color.textStrong, marginBottom: 8 },
    backIpa: { fontFamily: fonts.mono.regular, fontSize: 13, marginBottom: 20 },
    backDivider: { height: 1, backgroundColor: color.divider, marginBottom: 16 },
    backExample: { fontFamily: fonts.sans.regular, fontSize: 13, fontStyle: 'italic', color: color.textMuted, lineHeight: 21 },
    echo: { marginTop: 16, paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.md },
    echoText: { fontFamily: fonts.sans.regular, fontSize: 13 },
    echoStrong: { fontFamily: fonts.sans.semibold },
  };
});
