// WordDetailSheet (W-03) — the shared saved-word detail sheet. Used from the Word List
// and the deck detail sheet. Tier + memory-strength card, example, a DetailStats strip
// (Next review · Reviews · Added), and a delete action.
import { useState } from 'react';
import { Pressable, useColorScheme, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { WordListItem } from '@/data/DataSource';
import { useTranslation } from '@/i18n';
import { addedLabel, dueLabel } from '@/lib/relativeTime';
import { useExamples } from '@/query/hooks';
import { getTierByStability, tierView } from '@/theme/tiers';
import { DetailStats } from './DetailStats';
import { IconArchive, IconMoreVertical, IconTrash } from './icons';
import { Button } from './Button';
import { Sheet } from './Sheet';
import { RawText as Text } from './Text';
import { TierBadge } from './TierBadge';

export interface WordDetailSheetProps {
  word: WordListItem | null;
  onClose: () => void;
  /** Omit for read-only contexts (e.g. the Progress tier drawer, 18 §A6) — hides the delete action. */
  onDelete?: (w: WordListItem) => void;
  /** 18 §E3: archive / unarchive (label follows word.suspended). Omit to hide. */
  onToggleArchive?: (w: WordListItem) => void;
  /** Edit Translations (Premium, 2026-07-28): shows the ⋮ overflow button in the
   *  sheet's top-right corner. The caller decides what a free-tier tap does
   *  (route to the paywall) — this component only surfaces the affordance. */
  onEditTranslation?: (w: WordListItem) => void;
}

export function WordDetailSheet({ word, onClose, onDelete, onToggleArchive, onEditTranslation }: WordDetailSheetProps) {
  const { theme } = useUnistyles();
  const isDark = useColorScheme() === 'dark';
  const { t } = useTranslation();
  const tier = word ? tierView(getTierByStability(word.stability), isDark) : null;
  // Examples (16 §3) are USER-GATED (2026-07-22): a saved word with no cached
  // example shows a "Show example sentence" button instead of auto-fetching; the
  // fetch (and its permanent server-side cache) happens only on press. senseTarget
  // scopes it to THIS card's sense (per-sense examples, 2026-07-17). Reset the
  // request when the sheet's word changes (render-adjust, not an effect).
  const [exampleReqId, setExampleReqId] = useState<string | null>(null);
  const [lastWordId, setLastWordId] = useState(word?.id);
  if (word?.id !== lastWordId) {
    setLastWordId(word?.id);
    setExampleReqId(null);
  }
  // `azure_mt` (phrase_mt) cards can never have examples — the examples fn
  // returns [] for them by contract (16 §3) — so don't offer the button at all.
  const examplesSupported = word != null && word.provider !== 'azure_mt';
  const needsFetch = word != null && word.example === '' && examplesSupported;
  const exampleRequested = word != null && exampleReqId === word.id;
  const {
    examples,
    isLoading: exampleLoading,
    isSettled: exampleSettled,
    isError: exampleFailed,
    refetch: refetchExample,
  } = useExamples(needsFetch && exampleRequested ? word.translationId : null, word?.senseTarget);
  const fetched = examples?.[0];
  const example = word?.example || (fetched ? `${fetched.sourcePrefix}${fetched.sourceTerm}${fetched.sourceSuffix}` : '');
  // Target-side line, mirroring the search card's example pair.
  const exampleTranslation =
    word?.exampleTranslation || (fetched ? `${fetched.targetPrefix}${fetched.targetTerm}${fetched.targetSuffix}` : '');
  return (
    <Sheet visible={word != null} onClose={onClose} scrollable>
      {word != null && tier != null && (
        <View>
          <View style={styles.head}>
            <Text style={styles.word}>{word.native}</Text>
            <Text style={styles.target}>{word.target}</Text>
          </View>
          {onEditTranslation != null && (
            <Pressable
              onPress={() => onEditTranslation(word)}
              accessibilityRole="button"
              accessibilityLabel={t('editTranslation.openA11y')}
              testID="word-detail-overflow"
              // Top-right of the sheet body, clear of the drag handle above it.
              // Hit slop rather than a bigger box so the ⋮ stays visually light
              // while still meeting the 44pt touch minimum.
              hitSlop={12}
              style={({ pressed }) => [styles.overflow, pressed && { opacity: 0.6 }]}
            >
              <IconMoreVertical size={18} color={theme.color.textMuted} />
            </Pressable>
          )}
          <View style={styles.metaRow}>
            <View style={styles.posPill}>
              <Text style={styles.posPillText}>{word.pos}</Text>
            </View>
            <TierBadge tier={tier.id} variant="pill" size="md" />
          </View>
          <View style={[styles.memoryCard, { backgroundColor: tier.bg, borderColor: tier.border }]}>
            <View style={styles.memoryTop}>
              <Text style={[styles.memoryTier, { color: tier.text }]}>{t(`tier.${tier.id}.name`)}</Text>
              <Text style={[styles.memoryDays, { color: tier.text }]}>{t('wordList.memoryStrengthDays', { count: Math.round(word.stability) })}</Text>
            </View>
            {/* 18-session: tier-desc subheader cut — the tier name + days already
                say it; the hint below is the one line that earns the space. */}
            <Text style={[styles.memoryHint, { color: tier.text, borderTopColor: tier.border }]}>{t('wordList.memoryHint')}</Text>
          </View>
          {example !== '' ? (
            <>
              <Text style={styles.sectionLabel}>{t('wordList.example')}</Text>
              <Text style={[styles.example, exampleTranslation !== '' && styles.exampleTight]}>&ldquo;{example}&rdquo;</Text>
              {exampleTranslation !== '' && <Text style={styles.exampleTranslation}>{exampleTranslation}</Text>}
            </>
          ) : needsFetch ? (
            <View style={styles.exampleReqWrap}>
              <Text style={styles.sectionLabel}>{t('wordList.example')}</Text>
              {exampleLoading ? (
                <Text style={styles.exampleReqLoading}>{t('wordList.loadingExample')}</Text>
              ) : exampleRequested && exampleSettled && (examples?.length ?? 0) === 0 ? (
                /* Terminal — the dictionary has no sentence for this sense. The
                   server cached the empty result, so there is nothing to retry. */
                <Text style={styles.exampleReqLoading}>{t('wordList.noExample')}</Text>
              ) : (
                <Pressable
                  onPress={() => (exampleRequested && exampleFailed ? void refetchExample() : setExampleReqId(word.id))}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.exampleReqBtn, pressed && { opacity: 0.6 }]}
                >
                  <Text style={styles.exampleReqText}>
                    {t(exampleRequested && exampleFailed ? 'wordList.exampleError' : 'wordList.showExample')}
                  </Text>
                </Pressable>
              )}
            </View>
          ) : null}
          <DetailStats
            style={styles.stats}
            items={[
              { label: t('wordList.nextReview'), value: dueLabel(word.dueAt, t) },
              { label: t('wordList.reviews'), value: t('wordList.reviewsValue', { count: word.reps }) },
              { label: t('wordList.addedLabel'), value: addedLabel(word.createdAt, t) },
            ]}
          />
          {onToggleArchive != null && (
            <Pressable onPress={() => onToggleArchive(word)} accessibilityRole="button" style={({ pressed }) => [styles.archive, pressed && { opacity: 0.85 }]}>
              <IconArchive size={16} color={theme.color.textMuted} />
              <Text style={styles.archiveText}>{word.suspended ? t('wordList.unarchiveWord') : t('wordList.archiveWord')}</Text>
            </Pressable>
          )}
          {onDelete != null && (
            <Pressable onPress={() => onDelete(word)} accessibilityRole="button" style={({ pressed }) => [styles.delete, pressed && { opacity: 0.85 }]}>
              <IconTrash size={17} color={theme.color.danger} />
              <Text style={styles.deleteText}>{t('wordList.deleteWord')}</Text>
            </Pressable>
          )}
          {/* 18-session: explicit large dismissal — tap-away works, but a clear
              Close gives confident exit without discovering the gesture. */}
          <View style={styles.closeWrap}>
            <Button title={t('common.close')} variant="secondary" onPress={onClose} />
          </View>
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, fonts } = theme;
  return {
    head: { marginBottom: 14, paddingRight: 36 },
    overflow: { position: 'absolute', top: -4, right: 0, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    word: { fontFamily: fonts.serif.bold, fontSize: 24, color: color.textStrong, letterSpacing: -0.3 },
    target: { fontFamily: fonts.sans.regular, fontSize: 16, color: color.textMuted, marginTop: 3 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
    posPill: { backgroundColor: color.surfaceSunken, borderRadius: 4, paddingVertical: 2, paddingHorizontal: 8 },
    posPillText: { fontFamily: fonts.sans.semibold, fontSize: 12, color: color.textMuted },
    memoryCard: { borderWidth: theme.borderWidth.thin, borderRadius: 10, padding: 12, marginBottom: 14 },
    memoryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
    memoryTier: { fontFamily: fonts.sans.bold, fontSize: 12 },
    memoryDays: { fontFamily: fonts.sans.semibold, fontSize: 12 },
    memoryHint: { fontFamily: fonts.sans.regular, fontSize: 11, lineHeight: 15, opacity: 0.7, marginTop: 8, paddingTop: 8, borderTopWidth: theme.borderWidth.thin },
    sectionLabel: { fontFamily: fonts.sans.bold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: color.textMuted, marginBottom: 6 },
    exampleReqWrap: { marginBottom: 16 },
    exampleReqBtn: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 11,
      borderRadius: 10,
      backgroundColor: color.surfaceSunken,
      borderWidth: theme.borderWidth.thin,
      borderColor: color.border,
    },
    exampleReqText: { fontFamily: fonts.sans.semibold, fontSize: 14, color: color.brand },
    exampleReqLoading: { fontFamily: fonts.sans.regular, fontSize: 13, fontStyle: 'italic', color: color.textMuted, paddingVertical: 4 },
    example: { fontFamily: fonts.sans.regular, fontSize: 14, fontStyle: 'italic', lineHeight: 21, color: color.textBody, marginBottom: 16 },
    exampleTight: { marginBottom: 4 },
    exampleTranslation: { fontFamily: fonts.sans.regular, fontSize: 13, lineHeight: 19, color: color.textMuted, marginBottom: 16 },
    stats: { marginBottom: 18 },
    archive: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: color.surfaceSunken, borderRadius: 10, paddingVertical: 12, marginBottom: 10 },
    archiveText: { fontFamily: fonts.sans.semibold, fontSize: 15, color: color.textMuted },
    delete: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(209, 73, 91, 0.12)', borderRadius: 10, paddingVertical: 12 },
    deleteText: { fontFamily: fonts.sans.semibold, fontSize: 15, color: color.danger },
    closeWrap: { marginTop: 10 },
  };
});
