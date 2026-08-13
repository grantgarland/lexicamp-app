// SaveWithEditSheet — correct a translation AT SAVE TIME (Premium, 2026-08-04).
//
// The motivating case: the dictionary returns an inflected form rather than the
// lemma the user wants to study — «годы» when they searched "year" and want
// «год». Until now the only cure was save-it-then-edit-it from the Word List,
// which is two screens away from where the user noticed the problem, so the real
// behaviour was to hesitate over Save. A word you don't save is a word you never
// learn, and that hesitation is the cost this sheet removes.
//
// WHAT IT WRITES, and why it is two steps rather than one:
// the capture gate (16 §2) only lets a card reference a gate-approved
// `translations_cache` row, and that row is SHARED, service-role-only content —
// so nothing here may alter it. `cards.custom_back` is not available either:
// that field is the A12c SENSE selection, matched against alt_translations to
// resolve per-sense examples, and a free-form edit there would break example
// lookup. The correct home for "the text I want to see" is
// `card_target_overrides` — which is keyed by CARD id and therefore only exists
// once the card does. So the caller saves first, then applies the override to
// the returned id. The user experiences one action; the data model keeps its
// invariants.
import { useState } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { Button } from './Button';
import { Input } from './Input';
import { Sheet } from './Sheet';
import { RawText as Text } from './Text';

/** Mirrors the DB check constraint on card_target_overrides.target_text. */
export const TARGET_OVERRIDE_MAX = 120;

export interface SaveWithEditSheetProps {
  /** The sense being saved — null closes the sheet. */
  word: { headword: string; target: string; pos?: string } | null;
  onClose: () => void;
  /** Confirmed text. Equal to the original ⇒ a plain save, no override. */
  onConfirm: (target: string) => void;
  isSaving?: boolean;
  error?: string | null;
}

export function SaveWithEditSheet({ word, onClose, onConfirm, isSaving = false, error = null }: SaveWithEditSheetProps) {
  const { t } = useTranslation();

  // Render-adjust reset (the kit's Sheet pattern, not an effect): a sheet opened
  // for a different sense must not show the previous one's draft.
  const [draft, setDraft] = useState(word?.target ?? '');
  const [lastTarget, setLastTarget] = useState(word?.target);
  if (word?.target !== lastTarget) {
    setLastTarget(word?.target);
    setDraft(word?.target ?? '');
  }

  const trimmed = draft.trim();
  const tooLong = trimmed.length > TARGET_OVERRIDE_MAX;
  // Unlike the post-save editor, an UNCHANGED value is legitimate here: the user
  // opened the editor, looked, and decided the translation was fine. That still
  // saves the word — which is the point.
  const canConfirm = word != null && trimmed !== '' && !tooLong && !isSaving;

  const ctas =
    word == null ? null : (
      <View style={styles.ctas}>
        <View style={styles.cta}>
          <Button title={t('common.cancel')} variant="secondary" onPress={onClose} disabled={isSaving} />
        </View>
        <View style={styles.cta}>
          <Button title={t('saveWithEdit.confirm')} variant="primary" disabled={!canConfirm} onPress={() => canConfirm && onConfirm(trimmed)} testID="save-with-edit-confirm" />
        </View>
      </View>
    );

  return (
    <Sheet visible={word != null} onClose={onClose} scrollable footer={ctas} title={t('saveWithEdit.title')}>
      {word != null && (
        <View>
          <Text style={styles.headword}>{word.headword}</Text>
          <Text style={styles.help}>{t('saveWithEdit.help')}</Text>

          <Input
            label={t('saveWithEdit.fieldLabel')}
            value={draft}
            onChangeText={setDraft}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            returnKeyType="done"
            onSubmitEditing={() => canConfirm && onConfirm(trimmed)}
            error={tooLong ? t('saveWithEdit.tooLong', { max: TARGET_OVERRIDE_MAX }) : (error ?? undefined)}
            testID="save-with-edit-input"
          />

          {/* The original stays visible so an edit is always a comparison, and
              so a user who mistyped can see what they started from. This is the
              LAST thing in the body — the footer owns the gap below it. */}
          <Text style={styles.original}>{t('saveWithEdit.originalLabel', { word: word.target })}</Text>
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, fonts } = theme;
  return {
    headword: { fontFamily: fonts.serif.bold, fontSize: 24, color: color.textStrong },
    help: { fontFamily: fonts.sans.regular, fontSize: 13, lineHeight: 19, color: color.textMuted, marginTop: 4, marginBottom: 16 },
    original: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted, marginTop: 10 },
    // The gap above the CTAs lives on the PINNED footer, not on the body's last
    // child: Sheet gives its body no bottom padding, so whatever ends the body
    // sits flush against the buttons. Putting it here (as EditTranslationSheet
    // already does) keeps the gap correct no matter what the body ends with.
    ctas: { flexDirection: 'row', gap: 10, paddingTop: 16 },
    cta: { flex: 1 },
  };
});
