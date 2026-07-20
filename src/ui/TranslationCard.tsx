// TranslationCard — the flagship search-capture result, ported from Search's
// TranslationCard + TranslationItem. A headword header (direction chips · POS ·
// headword · phonetic) over an accordion of translations; the expanded ("current")
// item shows an example, optional details, and a save / saved / delete action.
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { Card } from './Card';
import { IconArrowRight, IconBook, IconCheck, IconChevronDown, IconInfo, IconLock, IconTrash } from './icons';
import { RawText as RNText } from './Text';

export interface TranslationExample {
  source: string;
  target: string;
}
export interface TranslationDetail {
  label: string;
  value: string;
}
export interface Translation {
  id: string;
  word: string;
  pos: string;
  example?: TranslationExample;
  details?: TranslationDetail[];
}
export interface TranslationResult {
  sourceText: string;
  phonetic: string;
  pos: string;
  translations: Translation[];
}

export interface TranslationCardProps {
  result: TranslationResult;
  currentIdx: number;
  onSetCurrent: (i: number) => void;
  /** IDs of translations already saved to the deck. */
  savedIds?: Set<string>;
  /** Translation id that was just saved (shows the "Saved!" confirmation). */
  justSavedId?: string | null;
  onSave: (i: number) => void;
  onDelete: (i: number) => void;
  /** Short language-pair chip labels (e.g. 'EN' / 'ES'), resolved by the caller
   *  from the user's profile + search direction. Presentational only. */
  sourceLang?: string;
  targetLang?: string;
  /** Result-quality gate (16 §2). When false the card is read-only: Save is disabled
   *  and `noticeText` explains why (e.g. the translation echoes the input). Default true. */
  saveable?: boolean;
  /** Inline reason shown when `saveable` is false. */
  noticeText?: string;
}

type ButtonState = 'save' | 'saved' | 'delete';

export function TranslationCard({
  result,
  currentIdx,
  onSetCurrent,
  savedIds,
  justSavedId,
  onSave,
  onDelete,
  sourceLang,
  targetLang,
  saveable = true,
  noticeText,
}: TranslationCardProps) {
  const { theme } = useUnistyles();

  const buttonState = (t: Translation): ButtonState => {
    if (!savedIds?.has(t.id)) return 'save';
    if (justSavedId === t.id) return 'saved';
    return 'delete';
  };

  return (
    <Card radius={18} padding={0} style={styles.card}>
      <View style={styles.header}>
        <View style={styles.dirRow}>
          <View style={[styles.langChip, styles.langChipSource]}>
            <RNText style={[styles.langChipText, { color: theme.color.brand }]}>{sourceLang}</RNText>
          </View>
          <IconArrowRight size={12} color={theme.color.textFaint} />
          <View style={[styles.langChip, styles.langChipTarget]}>
            <RNText style={[styles.langChipText, { color: theme.color.textMuted }]}>{targetLang}</RNText>
          </View>
          <View style={styles.posChip}>
            <RNText style={styles.posChipText}>{result.pos}</RNText>
          </View>
        </View>
        <RNText style={styles.headword}>{result.sourceText}</RNText>
        <RNText style={styles.phonetic}>{result.phonetic}</RNText>
      </View>

      <Animated.View style={styles.accordion} layout={LinearTransition.duration(240)}>
        {result.translations.map((t, i) => (
          <TranslationItem
            key={t.id}
            translation={t}
            isExpanded={i === currentIdx}
            onExpand={() => onSetCurrent(i)}
            buttonState={buttonState(t)}
            saveable={saveable}
            noticeText={noticeText}
            onSave={() => onSave(i)}
            onDelete={() => onDelete(i)}
          />
        ))}
      </Animated.View>
    </Card>
  );
}

function TranslationItem({
  translation,
  isExpanded,
  onExpand,
  buttonState,
  saveable,
  noticeText,
  onSave,
  onDelete,
}: {
  translation: Translation;
  isExpanded: boolean;
  onExpand: () => void;
  buttonState: ButtonState;
  saveable: boolean;
  noticeText?: string;
  onSave: () => void;
  onDelete: () => void;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  // Local binding keeps TS narrowing inside the .map closure (drops the `!`).
  const details = translation.details;

  // Layout-animated shell: height animates as the current word changes; the
  // collapsed row and the expanded "current word" block crossfade in/out.
  return (
    <Animated.View layout={LinearTransition.duration(240)}>
      {!isExpanded ? (
        <Animated.View key="collapsed" entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)}>
          <Pressable onPress={onExpand} style={styles.collapsed} accessibilityRole="button">
            <View style={styles.collapsedLeft}>
              <RNText style={styles.collapsedWord}>{translation.word}</RNText>
              <RNText style={styles.collapsedPos}>{translation.pos}</RNText>
            </View>
            <IconChevronDown size={14} color={theme.color.textFaint} />
          </Pressable>
        </Animated.View>
      ) : (
        <Animated.View key="expanded" entering={FadeIn.duration(220)} exiting={FadeOut.duration(120)} style={styles.expanded}>
          <View style={styles.expandedHead}>
            <RNText style={styles.eyebrow}>{t('translationCard.currentWord')}</RNText>
            <RNText style={styles.expandedWord}>{translation.word}</RNText>
            <RNText style={[styles.expandedPos, { marginBottom: translation.example ? 12 : 0 }]}>{translation.pos}</RNText>
          </View>

          {translation.example != null && (
            <View style={styles.exampleBox}>
              <RNText style={styles.exampleSource}>&ldquo;{translation.example.source}&rdquo;</RNText>
              <RNText style={styles.exampleTarget}>{translation.example.target}</RNText>
            </View>
          )}

          {/* Details render unconditionally when present (Casey, 2026-07-16: the
              "More details" disclosure was a tap-tax paid on every lookup). */}
          {details != null && details.length > 0 && (
            <View style={styles.detailsWrap}>
              <View style={styles.detailsList}>
                {details.map((d, i) => (
                  <View
                    key={d.label}
                    style={[styles.detailRow, i < details.length - 1 && styles.detailRowBorder]}
                  >
                    <RNText style={styles.detailLabel}>{d.label}</RNText>
                    <RNText style={styles.detailValue}>{d.value}</RNText>
                  </View>
                ))}
              </View>
            </View>
          )}

          <View style={styles.actionWrap}>
            {!saveable && (
              <>
                {noticeText != null && (
                  <View style={styles.notice}>
                    <IconInfo size={15} color={theme.color.textMuted} />
                    <RNText style={styles.noticeText}>{noticeText}</RNText>
                  </View>
                )}
                <View
                  style={[styles.action, styles.actionDisabled]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: true }}
                  testID="result-unsaveable"
                >
                  <IconLock size={15} color={theme.color.textFaint} />
                  <RNText style={styles.actionTextDisabled}>{t('translationCard.cantSave')}</RNText>
                </View>
              </>
            )}
            {saveable && buttonState === 'save' && (
              /* Maestro action-state ids: only the EXPANDED sense renders its
                 action block, so at most one of these exists at a time. */
              <Pressable onPress={onSave} style={[styles.action, styles.actionSave]} accessibilityRole="button" testID="result-save">
                <IconBook size={16} color="#fff" />
                <RNText style={styles.actionTextLight}>{t('translationCard.saveWord')}</RNText>
              </Pressable>
            )}
            {saveable && buttonState === 'saved' && (
              <Animated.View key="saved" entering={FadeIn.duration(200)} style={[styles.action, styles.actionSaved]} testID="result-saved">
                <IconCheck size={17} color="#fff" />
                <RNText style={styles.actionTextLight}>{t('translationCard.saved')}</RNText>
              </Animated.View>
            )}
            {saveable && buttonState === 'delete' && (
              <Pressable onPress={onDelete} style={[styles.action, styles.actionDelete]} accessibilityRole="button" testID="result-delete">
                <IconTrash size={15} color={theme.color.danger} />
                <RNText style={styles.actionTextDanger}>{t('translationCard.deleteWord')}</RNText>
              </Pressable>
            )}
          </View>
        </Animated.View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, palette, fonts } = theme;
  return {
    card: { overflow: 'hidden' },
    header: { paddingTop: 18, paddingHorizontal: 18, paddingBottom: 14 },
    dirRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10 },
    langChip: { borderRadius: 5, paddingVertical: 2, paddingHorizontal: 7 },
    langChipSource: { backgroundColor: palette.blue[50] },
    langChipTarget: { backgroundColor: palette.slate[100] },
    langChipText: { fontFamily: fonts.mono.bold, fontSize: 10, letterSpacing: 0.4 },
    posChip: {
      backgroundColor: palette.slate[100],
      borderRadius: 6,
      paddingVertical: 2,
      paddingHorizontal: 7,
      marginLeft: 4,
    },
    posChipText: { fontFamily: fonts.sans.semibold, fontSize: 11, letterSpacing: 0.3, color: color.textMuted },
    headword: { fontFamily: fonts.serif.semibold, fontSize: 36, color: color.textStrong, marginBottom: 5 },
    phonetic: { fontFamily: fonts.mono.regular, fontSize: 13, color: color.textMuted, letterSpacing: 0.4 },

    accordion: { borderTopWidth: theme.borderWidth.thin, borderTopColor: color.divider },

    collapsed: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 13,
      paddingHorizontal: 18,
      borderTopWidth: theme.borderWidth.thin,
      borderTopColor: color.divider,
    },
    collapsedLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    collapsedWord: { fontFamily: fonts.serif.regular, fontSize: 17, color: color.textBody },
    collapsedPos: { fontFamily: fonts.mono.regular, fontSize: 10, color: color.textFaint },

    expanded: {
      borderTopWidth: theme.borderWidth.thin,
      borderTopColor: color.divider,
      backgroundColor: palette.blue[50],
      borderBottomWidth: theme.borderWidth.thin,
      borderBottomColor: palette.blue[100],
    },
    expandedHead: { paddingTop: 16, paddingHorizontal: 18 },
    eyebrow: {
      fontFamily: fonts.sans.bold,
      fontSize: 9,
      letterSpacing: 0.7,
      textTransform: 'uppercase',
      color: color.brand,
      opacity: 0.7,
      marginBottom: 2,
    },
    expandedWord: { fontFamily: fonts.serif.semibold, fontSize: 28, color: color.textStrong, marginBottom: 4 },
    expandedPos: { fontFamily: fonts.mono.regular, fontSize: 11, color: color.textMuted },

    exampleBox: {
      marginHorizontal: 18,
      marginBottom: 12,
      backgroundColor: 'rgba(255, 255, 255, 0.7)',
      borderRadius: 10,
      paddingVertical: 11,
      paddingHorizontal: 13,
    },
    exampleSource: { fontFamily: fonts.sans.regular, fontSize: 13, fontStyle: 'italic', color: color.textBody, lineHeight: 20, marginBottom: 4 },
    exampleTarget: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted, lineHeight: 18 },

    detailsWrap: { marginHorizontal: 18, marginBottom: 12 },
    detailsList: { marginTop: 8 },
    // Stacked label-over-value (Casey bug, 2026-07-16): the old fixed 66px label
    // column mid-word-wrapped "other translations" ("translatio / ns") and would
    // do worse in Spanish or at large Dynamic Type. Stacking removes the whole
    // class of narrow-column wraps regardless of locale/font scale.
    detailRow: { paddingVertical: 7 },
    detailRowBorder: { borderBottomWidth: theme.borderWidth.thin, borderBottomColor: palette.blue[100] },
    detailLabel: { fontFamily: fonts.mono.regular, fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase', color: color.textFaint, marginBottom: 3 },
    detailValue: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textBody, lineHeight: 18 },

    actionWrap: { paddingTop: 12, paddingHorizontal: 18, paddingBottom: 16 },
    action: {
      borderRadius: 13,
      paddingVertical: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      // Every state carries the same 1.5px border box (transparent unless delete) so
      // toggling save → saved → delete never changes the button's size / shifts layout.
      borderWidth: theme.borderWidth.base,
      borderColor: 'transparent',
    },
    actionSave: { backgroundColor: color.accent, boxShadow: theme.shadow.accent },
    actionSaved: { backgroundColor: palette.green[500] },
    actionDelete: { backgroundColor: color.dangerSoft, borderColor: palette.red[100] },
    actionDisabled: { backgroundColor: palette.slate[100], borderColor: color.border },
    actionTextLight: { fontFamily: fonts.sans.bold, fontSize: 15, color: '#fff' },
    actionTextDanger: { fontFamily: fonts.sans.semibold, fontSize: 15, color: color.danger },
    actionTextDisabled: { fontFamily: fonts.sans.semibold, fontSize: 15, color: color.textFaint },

    notice: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      marginHorizontal: 0,
      marginBottom: 10,
      paddingVertical: 9,
      paddingHorizontal: 11,
      borderRadius: 10,
      backgroundColor: palette.amber[50],
      borderWidth: theme.borderWidth.thin,
      borderColor: palette.amber[200],
    },
    noticeText: { flex: 1, fontFamily: fonts.sans.regular, fontSize: 12.5, lineHeight: 18, color: color.textBody },
  };
});
