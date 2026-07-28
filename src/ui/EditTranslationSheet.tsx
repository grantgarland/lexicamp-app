// EditTranslationSheet — Edit Translations (Premium, 2026-07-28). Lets a paying
// user replace the RENDERED target-language text of one saved word when the
// translation endpoint returned a form they don't want to study (the motivating
// case: «воды» came back for "water" but the user wants the nominative «вода»).
//
// Deliberately mirrors WordDetailSheet's card meta — headword, part of speech,
// example pair — MINUS every FSRS/scheduling element (memory-strength card,
// next review, review count). Those describe the user's progress; this sheet is
// about the word's text, and showing progress next to an edit field invites the
// exact fear the info tooltip exists to answer ("will this reset my streak?").
//
// Keyboard shape (2026-07-28): the field autofocuses, so the keyboard is up
// before the sheet finishes sliding — this sheet exists to type in, and a user
// who has to hunt for the field pays for our hesitation. That makes the CTAs the
// thing at risk, so they live in the Sheet's pinned `footer` (never scrolled,
// never covered) and the meta above scrolls. Return commits, so a one-word edit
// never needs a reach past the keyboard at all.
//
// The write is additive: it lands in `card_target_overrides`, never in the
// shared `translations_cache` row (global content, service-role-only under the
// capture gate) and never in `cards.custom_back` (that field is the A12c SENSE
// selection — mappers match it against alt_translations to resolve per-sense
// examples, so a free-form edit there would break example lookup).
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { WordListItem } from '@/data/DataSource';
import { useTranslation } from '@/i18n';
import { Button } from './Button';
import { IconInfo, IconRefresh } from './icons';
import { Input } from './Input';
import { Sheet } from './Sheet';
import { RawText as Text } from './Text';
import { Tooltip } from './Tooltip';

/** Mirrors the DB check constraint on card_target_overrides.target_text. */
export const TARGET_OVERRIDE_MAX = 120;

export interface EditTranslationSheetProps {
  word: WordListItem | null;
  onClose: () => void;
  /** Text to save, or null to CLEAR the override (restore the original). */
  onConfirm: (target: string | null) => void;
  /** The write is in flight — disables both CTAs. */
  isSaving?: boolean;
  /** Localized failure message from the mutation (null = none). */
  error?: string | null;
}

export function EditTranslationSheet({ word, onClose, onConfirm, isSaving = false, error = null }: EditTranslationSheetProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();

  // Draft resets whenever the sheet's word changes — render-adjust, not an
  // effect (the repo's react-hooks purity rule; same shape WordDetailSheet uses).
  const [draft, setDraft] = useState(word?.target ?? '');
  const [lastWordId, setLastWordId] = useState(word?.id);
  if (word?.id !== lastWordId) {
    setLastWordId(word?.id);
    setDraft(word?.target ?? '');
  }

  const trimmed = draft.trim();
  const hasOverride = word?.targetOverride != null;
  const tooLong = trimmed.length > TARGET_OVERRIDE_MAX;
  // Confirm is live only when the text is valid AND actually different from
  // what's rendered today — a no-op write would burn a round trip and read as
  // "something happened" when nothing did.
  const canConfirm = word != null && trimmed !== '' && !tooLong && trimmed !== word.target && !isSaving;

  const ctas =
    word == null ? null : (
      <View style={styles.ctas}>
        <View style={styles.cta}>
          <Button title={t('common.cancel')} variant="secondary" onPress={onClose} disabled={isSaving} />
        </View>
        <View style={styles.cta}>
          <Button
            title={t('editTranslation.confirm')}
            variant="primary"
            disabled={!canConfirm}
            onPress={() => canConfirm && onConfirm(trimmed)}
          />
        </View>
      </View>
    );

  return (
    <Sheet visible={word != null} onClose={onClose} scrollable footer={ctas}>
      {word != null && (
        <View>
          <View style={styles.head}>
            <Text style={styles.word}>{word.native}</Text>
            <Text style={styles.original}>
              {t('editTranslation.originalLabel')} {word.originalTarget}
            </Text>
          </View>

          <View style={styles.metaRow}>
            {word.pos !== '' && (
              <View style={styles.posPill}>
                <Text style={styles.posPillText}>{word.pos}</Text>
              </View>
            )}
            {hasOverride && (
              <View style={styles.editedPill}>
                <Text style={styles.editedPillText}>{t('editTranslation.editedBadge')}</Text>
              </View>
            )}
          </View>

          {word.example !== '' && (
            <>
              <Text style={styles.sectionLabel}>{t('wordList.example')}</Text>
              <Text style={[styles.example, word.exampleTranslation !== '' && styles.exampleTight]}>&ldquo;{word.example}&rdquo;</Text>
              {word.exampleTranslation !== '' && <Text style={styles.exampleTranslation}>{word.exampleTranslation}</Text>}
            </>
          )}

          <Input
            label={t('editTranslation.inputLabel')}
            value={draft}
            onChangeText={setDraft}
            // Focused on open (this sheet has exactly one job), cursor at the END
            // rather than select-all: the motivating edit is a one-or-two-letter
            // correction («воды» → «вода»), and select-all would make the common
            // case destructive.
            autoFocus
            clearButtonMode="while-editing"
            returnKeyType="done"
            onSubmitEditing={() => canConfirm && onConfirm(trimmed)}
            submitBehavior="submit"
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            maxLength={TARGET_OVERRIDE_MAX}
            accessibilityLabel={t('editTranslation.inputLabel')}
            containerStyle={styles.input}
            error={error ?? (tooLong ? t('editTranslation.tooLong', { max: TARGET_OVERRIDE_MAX }) : undefined)}
          />

          {/* The reassurance line. Every user editing a word they've been
              studying for weeks is really asking "does this delete my progress?"
              — answer it here, in place, instead of hoping they trust us. */}
          <Tooltip
            title={t('editTranslation.infoTitle')}
            content={t('editTranslation.infoBody')}
            indicator={false}
            accessibilityLabel={t('editTranslation.infoA11y')}
            style={styles.infoTrigger}
          >
            <View style={styles.infoRow}>
              <IconInfo size={14} color={theme.color.textMuted} />
              <Text style={styles.infoText}>{t('editTranslation.infoHint')}</Text>
            </View>
          </Tooltip>

          {hasOverride && (
            <Pressable
              onPress={() => onConfirm(null)}
              disabled={isSaving}
              accessibilityRole="button"
              testID="edit-translation-reset"
              style={({ pressed }) => [styles.reset, pressed && { opacity: 0.85 }]}
            >
              <IconRefresh size={15} color={theme.color.textMuted} />
              <Text style={styles.resetText}>{t('editTranslation.reset', { original: word.originalTarget })}</Text>
            </Pressable>
          )}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, fonts } = theme;
  return {
    head: { marginBottom: 12 },
    word: { fontFamily: fonts.serif.bold, fontSize: 24, color: color.textStrong, letterSpacing: -0.3 },
    original: { fontFamily: fonts.sans.regular, fontSize: 14, color: color.textMuted, marginTop: 3 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
    posPill: { backgroundColor: color.surfaceSunken, borderRadius: 4, paddingVertical: 2, paddingHorizontal: 8 },
    posPillText: { fontFamily: fonts.sans.semibold, fontSize: 12, color: color.textMuted },
    editedPill: { backgroundColor: color.brandTint, borderRadius: 4, paddingVertical: 2, paddingHorizontal: 8 },
    editedPillText: { fontFamily: fonts.sans.semibold, fontSize: 12, color: color.onBrandSoft },
    sectionLabel: { fontFamily: fonts.sans.bold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: color.textMuted, marginBottom: 6 },
    example: { fontFamily: fonts.sans.regular, fontSize: 14, fontStyle: 'italic', lineHeight: 21, color: color.textBody, marginBottom: 16 },
    exampleTight: { marginBottom: 4 },
    exampleTranslation: { fontFamily: fonts.sans.regular, fontSize: 13, lineHeight: 19, color: color.textMuted, marginBottom: 16 },
    input: { marginBottom: 12 },
    infoTrigger: { alignSelf: 'flex-start' },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
    infoText: { fontFamily: fonts.sans.regular, fontSize: 12, lineHeight: 18, color: color.textMuted },
    reset: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: color.surfaceSunken, borderRadius: 10, paddingVertical: 12, marginTop: 12 },
    resetText: { fontFamily: fonts.sans.semibold, fontSize: 14, color: color.textMuted },
    // Pinned footer: sits directly above the keyboard, with a hairline so it
    // reads as a bar rather than as content that happened to stop scrolling.
    ctas: { flexDirection: 'row', gap: 10, paddingTop: 14, borderTopWidth: theme.borderWidth.thin, borderTopColor: color.divider },
    cta: { flex: 1 },
  };
});
