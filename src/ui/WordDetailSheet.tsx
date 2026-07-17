// WordDetailSheet (W-03) — the shared saved-word detail sheet. Used from the Word List
// and the deck detail sheet. Tier + memory-strength card, example, a DetailStats strip
// (Next review · Reviews · Added), and a delete action.
import { Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { WordListItem } from '@/data/DataSource';
import { useTranslation } from '@/i18n';
import { addedLabel, dueLabel } from '@/lib/relativeTime';
import { useExamples } from '@/query/hooks';
import { getTierByStability } from '@/theme/tiers';
import { DetailStats } from './DetailStats';
import { IconTrash } from './icons';
import { Button } from './Button';
import { Sheet } from './Sheet';
import { RawText as Text } from './Text';
import { TierBadge } from './TierBadge';

export interface WordDetailSheetProps {
  word: WordListItem | null;
  onClose: () => void;
  /** Omit for read-only contexts (e.g. the Progress tier drawer, 18 §A6) — hides the delete action. */
  onDelete?: (w: WordListItem) => void;
}

export function WordDetailSheet({ word, onClose, onDelete }: WordDetailSheetProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const tier = word ? getTierByStability(word.stability) : null;
  // W-03 is the "first card view" of 16 §3 — fetch the example lazily when the
  // row doesn't carry one yet (cached server-side once, free thereafter).
  const { examples } = useExamples(word != null && word.example === '' ? word.translationId : null);
  const fetched = examples?.[0];
  const example = word?.example || (fetched ? `${fetched.sourcePrefix}${fetched.sourceTerm}${fetched.sourceSuffix}` : '');
  // Target-side line, mirroring the search card's example pair.
  const exampleTranslation =
    word?.exampleTranslation || (fetched ? `${fetched.targetPrefix}${fetched.targetTerm}${fetched.targetSuffix}` : '');
  return (
    <Sheet visible={word != null} onClose={onClose}>
      {word != null && tier != null && (
        <View>
          <View style={styles.head}>
            <Text style={styles.word}>{word.native}</Text>
            <Text style={styles.target}>{word.target}</Text>
          </View>
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
          {example !== '' && (
            <>
              <Text style={styles.sectionLabel}>{t('wordList.example')}</Text>
              <Text style={[styles.example, exampleTranslation !== '' && styles.exampleTight]}>&ldquo;{example}&rdquo;</Text>
              {exampleTranslation !== '' && <Text style={styles.exampleTranslation}>{exampleTranslation}</Text>}
            </>
          )}
          <DetailStats
            style={styles.stats}
            items={[
              { label: t('wordList.nextReview'), value: dueLabel(word.dueAt, t) },
              { label: t('wordList.reviews'), value: t('wordList.reviewsValue', { count: word.reps }) },
              { label: t('wordList.addedLabel'), value: addedLabel(word.createdAt, t) },
            ]}
          />
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
  const { color, palette, fonts } = theme;
  return {
    head: { marginBottom: 14 },
    word: { fontFamily: fonts.serif.bold, fontSize: 24, color: color.textStrong, letterSpacing: -0.3 },
    target: { fontFamily: fonts.sans.regular, fontSize: 16, color: color.textMuted, marginTop: 3 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
    posPill: { backgroundColor: palette.slate[100], borderRadius: 4, paddingVertical: 2, paddingHorizontal: 8 },
    posPillText: { fontFamily: fonts.sans.semibold, fontSize: 12, color: color.textMuted },
    memoryCard: { borderWidth: theme.borderWidth.thin, borderRadius: 10, padding: 12, marginBottom: 14 },
    memoryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
    memoryTier: { fontFamily: fonts.sans.bold, fontSize: 12 },
    memoryDays: { fontFamily: fonts.sans.semibold, fontSize: 12 },
    memoryHint: { fontFamily: fonts.sans.regular, fontSize: 11, lineHeight: 15, opacity: 0.7, marginTop: 8, paddingTop: 8, borderTopWidth: theme.borderWidth.thin },
    sectionLabel: { fontFamily: fonts.sans.bold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: color.textMuted, marginBottom: 6 },
    example: { fontFamily: fonts.sans.regular, fontSize: 14, fontStyle: 'italic', lineHeight: 21, color: color.textBody, marginBottom: 16 },
    exampleTight: { marginBottom: 4 },
    exampleTranslation: { fontFamily: fonts.sans.regular, fontSize: 13, lineHeight: 19, color: color.textMuted, marginBottom: 16 },
    stats: { marginBottom: 18 },
    delete: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(209, 73, 91, 0.12)', borderRadius: 10, paddingVertical: 12 },
    deleteText: { fontFamily: fonts.sans.semibold, fontSize: 15, color: color.danger },
    closeWrap: { marginTop: 10 },
  };
});
