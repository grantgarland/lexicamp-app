// TranslationCard — the flagship search-capture result, ported from Search's
// TranslationCard + TranslationItem. A headword header (direction chips · POS ·
// headword · phonetic) over an accordion of translations; the expanded ("current")
// item shows an example, optional details, and a save / saved / delete action.
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { Card } from './Card';
import { ScrollIntoView } from './ScrollIntoView';
import { IconArrowRight, IconBook, IconCheck, IconChevronDown, IconInfo, IconLock, IconPencil, IconTrash } from './icons';
import { RawText as RNText } from './Text';

export interface TranslationExample {
  source: string;
  target?: string;
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
  /** Result-quality gate (16 §2), evaluated PER SENSE (2026-07-23 fix — was a single
   *  card-wide flag, which let one bad sense block a sibling's Save button). Absent
   *  ⇒ saveable. */
  saveable?: boolean;
  /** Inline reason shown when `saveable` is false. */
  noticeText?: string;
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
  /** Premium save-time edit. Omit to hide the pencil entirely — the CTA then
   *  renders exactly as it did before the split. */
  onSaveWithEdit?: (i: number) => void;
  onDelete: (i: number) => void;
  /** Short language-pair chip labels (e.g. 'EN' / 'ES'), resolved by the caller
   *  from the user's profile + search direction. Presentational only. */
  sourceLang?: string;
  targetLang?: string;
  /** Fetch the example sentence for the primary word (16 §3). Examples are NEVER
   *  auto-fetched — the button rendered on the primary sense (when no example
   *  exists yet) calls this; the first fetch caches server-side and then also
   *  shows on the saved word and in quiz/review cards. Omit to hide the affordance. */
  onRequestExample?: (index: number) => void;
  /** True while the example fetch is in flight (drives the button's loading label). */
  exampleLoading?: boolean;
  /** False when this result's provider can NEVER yield example sentences —
   *  `azure_mt` / phrase_mt entries, for which supabase/functions/examples
   *  returns [] unconditionally (16 §3 forbids MT-generated examples). The
   *  affordance is hidden outright: a button that is guaranteed to resolve to
   *  nothing is worse than no button. Deterministic, costs no API call. */
  examplesSupported?: boolean;
  /** Outcome of the last example fetch for the EXPANDED sense. Azure cannot tell
   *  us up front whether a given (term, sense) has sentences — numExamples
   *  under-reports (see BackTranslation) — so the button is optimistic and this
   *  carries the answer back. 'empty' is terminal for that sense; re-rendering
   *  the same button instead reads as "the tap did nothing". */
  exampleStatus?: 'idle' | 'empty' | 'error';
  /** Receives the host node of the currently EXPANDED item. The walkthrough
   *  spotlights it (w3b — "pick the right meaning"), which needs the whole open
   *  block, not the card and not the search field. */
  expandedRef?: (node: View | null) => void;
}

type ButtonState = 'save' | 'saved' | 'delete';

export function TranslationCard({
  result,
  currentIdx,
  onSetCurrent,
  savedIds,
  justSavedId,
  onSave,
  onSaveWithEdit,
  onDelete,
  sourceLang,
  targetLang,
  onRequestExample,
  exampleLoading,
  examplesSupported = true,
  exampleStatus = 'idle',
  expandedRef,
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
          /* The expanded item is much taller than the collapsed row it replaces
             — near the bottom of the list its Save button lands under the tab
             bar. Reveal it (and any example sentence fetched into it later).
             `layout` lives HERE, not on TranslationItem: this wrapper is the node
             that moves when a sibling above it expands, so it is the one that has
             to animate. */
          <ScrollIntoView
            key={t.id}
            enabled={i === currentIdx}
            nodeRef={i === currentIdx ? expandedRef : undefined}
            layout={LinearTransition.duration(240)}
          >
            <TranslationItem
              translation={t}
              isExpanded={i === currentIdx}
              onExpand={() => onSetCurrent(i)}
              buttonState={buttonState(t)}
              saveable={t.saveable ?? true}
              noticeText={t.noticeText}
              onSave={() => onSave(i)}
              onSaveWithEdit={onSaveWithEdit == null ? undefined : () => onSaveWithEdit(i)}
              onDelete={() => onDelete(i)}
              canRequestExample={(t.saveable ?? true) && examplesSupported}
              exampleLoading={exampleLoading}
              /* Only the expanded item can have an in-flight/settled fetch. */
              exampleStatus={i === currentIdx ? exampleStatus : 'idle'}
              onRequestExample={onRequestExample != null ? () => onRequestExample(i) : undefined}
            />
          </ScrollIntoView>
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
  onSaveWithEdit,
  onDelete,
  canRequestExample,
  exampleLoading,
  exampleStatus = 'idle',
  onRequestExample,
}: {
  translation: Translation;
  isExpanded: boolean;
  onExpand: () => void;
  buttonState: ButtonState;
  saveable: boolean;
  noticeText?: string;
  onSave: () => void;
  onSaveWithEdit?: () => void;
  onDelete: () => void;
  canRequestExample: boolean;
  exampleLoading?: boolean;
  exampleStatus?: 'idle' | 'empty' | 'error';
  onRequestExample?: () => void;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  // Local binding keeps TS narrowing inside the .map closure (drops the `!`).
  const details = translation.details;

  // Shell for the crossfade: the collapsed row and the expanded "current word"
  // block fade in and out of the same slot. The LAYOUT transition (this row's
  // height, and the rows below it sliding) is owned by the `ScrollIntoView`
  // wrapper in TranslationCard — nesting a second one on the same geometry makes
  // the two fight over the frame.
  return (
    <View>
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
            <RNText style={[styles.expandedPos, { marginBottom: translation.example != null || canRequestExample ? 12 : 0 }]}>{translation.pos}</RNText>
          </View>

          {translation.example != null ? (
            <View style={styles.exampleBox}>
              <RNText style={styles.exampleSource}>&ldquo;{translation.example.source}&rdquo;</RNText>
              {translation.example.target != null && <RNText style={styles.exampleTarget}>{translation.example.target}</RNText>}
            </View>
          ) : canRequestExample && onRequestExample != null ? (
            /* Example sentences are user-gated (16 §3): no auto-fetch. Pressing
               this spends one Azure examples call, caches it server-side, and
               surfaces the example here + on the saved word + in quizzes. */
            <View style={styles.exampleReqWrap}>
              {exampleLoading === true ? (
                <View style={styles.exampleReqBtn} accessibilityRole="button" accessibilityState={{ busy: true }}>
                  <RNText style={styles.exampleReqText}>{t('translationCard.loadingExample')}</RNText>
                </View>
              ) : exampleStatus === 'empty' ? (
                /* Terminal: the dictionary has no sentence for THIS sense. Say so
                   once and stop — the server cached the empty result, so there is
                   nothing to retry and the button must not come back. */
                <RNText style={styles.exampleNote} testID="result-example-empty">
                  {t('translationCard.noExample')}
                </RNText>
              ) : (
                <Pressable
                  onPress={onRequestExample}
                  style={({ pressed }) => [styles.exampleReqBtn, pressed && styles.exampleReqBtnPressed]}
                  accessibilityRole="button"
                  testID="result-example"
                >
                  <IconBook size={14} color={theme.color.brand} />
                  <RNText style={styles.exampleReqText}>
                    {t(exampleStatus === 'error' ? 'translationCard.exampleError' : 'translationCard.showExample')}
                  </RNText>
                </Pressable>
              )}
            </View>
          ) : null}

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
                 action block, so at most one of these exists at a time.
                 SPLIT CTA (Premium, 2026-08-04): the bar still reads as one
                 button — tapping the wide part saves exactly as before. The
                 trailing pencil opens the save-time editor, for when the
                 dictionary hands back an inflected form («годы» for "year")
                 and the user would otherwise hesitate to save at all. Rendered
                 only when the caller says the user is entitled, so it is never
                 a dead affordance. */
              <View style={styles.saveSplit}>
                <Pressable onPress={onSave} style={[styles.action, styles.actionSave, onSaveWithEdit != null && styles.actionSaveSplit]} accessibilityRole="button" testID="result-save">
                  <IconBook size={16} color={theme.color.textOnAccentCta} />
                  <RNText style={styles.actionTextOnAccent}>{t('translationCard.saveWord')}</RNText>
                </Pressable>
                {onSaveWithEdit != null && (
                  <Pressable
                    onPress={onSaveWithEdit}
                    style={[styles.action, styles.actionSave, styles.actionSaveEdit]}
                    accessibilityRole="button"
                    accessibilityLabel={t('saveWithEdit.a11y')}
                    testID="result-save-edit"
                  >
                    <IconPencil size={16} color={theme.color.textOnAccentCta} />
                  </Pressable>
                )}
              </View>
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
    </View>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, palette, fonts } = theme;
  return {
    card: { overflow: 'hidden' },
    header: { paddingTop: 18, paddingHorizontal: 18, paddingBottom: 14 },
    dirRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10 },
    langChip: { borderRadius: 5, paddingVertical: 2, paddingHorizontal: 7 },
    langChipSource: { backgroundColor: color.brandTint },
    langChipTarget: { backgroundColor: color.surfaceSunken },
    langChipText: { fontFamily: fonts.mono.bold, fontSize: 10, letterSpacing: 0.4 },
    posChip: {
      backgroundColor: color.surfaceSunken,
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
      backgroundColor: color.brandTint,
      borderBottomWidth: theme.borderWidth.thin,
      borderBottomColor: color.brandSoft,
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
      backgroundColor: color.overlayGlass,
      borderRadius: 10,
      paddingVertical: 11,
      paddingHorizontal: 13,
    },
    exampleSource: { fontFamily: fonts.sans.regular, fontSize: 13, fontStyle: 'italic', color: color.textBody, lineHeight: 20, marginBottom: 4 },
    exampleTarget: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted, lineHeight: 18 },

    // Gated example affordance (16 §3): a light outline chip on the primary sense
    // when no example is cached yet. Same horizontal inset as the example box.
    exampleReqWrap: { marginHorizontal: 18, marginBottom: 12 },
    exampleReqBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: color.overlayGlass,
      borderWidth: theme.borderWidth.thin,
      borderColor: color.brandSoft,
    },
    exampleReqBtnPressed: { opacity: 0.6 },
    // Terminal "no example" line — deliberately quiet and non-interactive, sized
    // to sit where the button was without shifting the card's rhythm.
    exampleNote: {
      fontFamily: fonts.sans.regular,
      fontSize: 13,
      fontStyle: 'italic',
      color: color.textMuted,
      lineHeight: 20,
      paddingVertical: 10,
      textAlign: 'center',
    },
    exampleReqText: { fontFamily: fonts.sans.semibold, fontSize: 13, color: color.brand },

    detailsWrap: { marginHorizontal: 18, marginBottom: 12 },
    detailsList: { marginTop: 8 },
    // Stacked label-over-value (Casey bug, 2026-07-16): the old fixed 66px label
    // column mid-word-wrapped "other translations" ("translatio / ns") and would
    // do worse in Spanish or at large Dynamic Type. Stacking removes the whole
    // class of narrow-column wraps regardless of locale/font scale.
    detailRow: { paddingVertical: 7 },
    detailRowBorder: { borderBottomWidth: theme.borderWidth.thin, borderBottomColor: color.brandSoft },
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
    saveSplit: { flexDirection: 'row', gap: 2 },
    actionSaveSplit: { flex: 1, borderTopRightRadius: 0, borderBottomRightRadius: 0 },
    actionSaveEdit: { flexGrow: 0, paddingHorizontal: 18, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 },
    actionSave: { backgroundColor: color.accentCta, boxShadow: theme.shadow.accent },
    actionSaved: { backgroundColor: palette.green[500] },
    actionDelete: { backgroundColor: color.dangerSoft, borderColor: color.dangerSoft },
    actionDisabled: { backgroundColor: color.surfaceSunken, borderColor: color.border },
    actionTextLight: { fontFamily: fonts.sans.bold, fontSize: 15, color: '#fff' },
    actionTextOnAccent: { fontFamily: fonts.sans.bold, fontSize: 15, color: theme.color.textOnAccentCta },
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
      backgroundColor: color.accentTint,
      borderWidth: theme.borderWidth.thin,
      borderColor: color.accentSoft,
    },
    noticeText: { flex: 1, fontFamily: fonts.sans.regular, fontSize: 12.5, lineHeight: 18, color: color.textBody },
  };
});
