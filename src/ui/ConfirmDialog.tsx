// ConfirmDialog — the shared confirm bottom sheet (delete word, delete deck, remove from
// deck, clear data, sign out). Centered icon + title + body + a destructive/primary
// confirm and a secondary cancel.
//
// `typeToConfirm` adds a second gate for the irreversible end of the scale (account
// deletion): the confirm button stays disabled until the user types a given word.
// One tap can be a misfire; one tap plus a deliberately typed word cannot.
import type { ReactNode } from 'react';
import { useState } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { Button } from './Button';
import { Input } from './Input';
import { Sheet } from './Sheet';
import { RawText as Text } from './Text';

/** Case- and whitespace-insensitive match against the word the dialog RENDERED.
 *  Exported for tests; `locale` casing so a Turkish "sil" or a Greek "διαγραφή"
 *  folds the way that language folds, not the way ASCII does. */
export function matchesConfirmWord(input: string, expected: string): boolean {
  return input.trim().toLocaleLowerCase() === expected.trim().toLocaleLowerCase();
}

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  body?: string;
  /** Optional icon rendered in a soft circle above the title. */
  icon?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Type-to-confirm gate. `word` is compared as an opaque string against what
   *  the user types, and is also the value rendered in the prompt — so the
   *  comparison can never drift from the instruction. Pass a TRANSLATED word
   *  (`t('…confirmWord')`); nothing here may hardcode "delete", or a translator
   *  changing the word would lock every non-English user out of the action. */
  typeToConfirm?: { word: string; label: string; placeholder?: string };
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({ visible, title, body, icon, confirmLabel, cancelLabel, destructive = false, typeToConfirm, onConfirm, onClose }: ConfirmDialogProps) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  // Render-adjust (the kit's Sheet pattern, not an effect): a reopened dialog
  // must start empty IN THIS RENDER — otherwise the previous session's text is
  // still there and the destructive button is live before the sheet settles.
  const [wasVisible, setWasVisible] = useState(visible);
  if (wasVisible !== visible) {
    setWasVisible(visible);
    if (typed !== '') setTyped('');
  }
  const gated = typeToConfirm != null && !matchesConfirmWord(typed, typeToConfirm.word);

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.wrap}>
        {icon != null && <View style={styles.icon}>{icon}</View>}
        <Text style={styles.title}>{title}</Text>
        {body != null && <Text style={styles.body}>{body}</Text>}
        {typeToConfirm != null && (
          <View style={styles.gate}>
            <Input
              // The label carries the word to type, interpolated by the caller
              // from the SAME string this component compares against.
              label={typeToConfirm.label}
              placeholder={typeToConfirm.placeholder}
              value={typed}
              onChangeText={setTyped}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              returnKeyType="done"
              testID="confirm-type-gate"
            />
          </View>
        )}
        {/* Maestro tap targets (only one ConfirmDialog is ever visible, so the
            ids are unique at runtime). Confirm labels often collide with the
            action that opened the dialog (e.g. the swipe-tray 'Delete') — id
            taps need no positional disambiguation. */}
        <Button title={confirmLabel} variant={destructive ? 'destructive' : 'primary'} disabled={gated} onPress={onConfirm} testID="confirm-accept" />
        <View style={styles.cancel}>
          <Button title={cancelLabel ?? t('common.cancel')} variant="secondary" onPress={onClose} testID="confirm-cancel" />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { alignItems: 'center', paddingTop: 4 },
  icon: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(209, 73, 91, 0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  title: { fontFamily: theme.fonts.sans.bold, fontSize: 17, color: theme.color.textStrong, textAlign: 'center', marginBottom: 8 },
  body: { fontFamily: theme.fonts.sans.regular, fontSize: 14, lineHeight: 21, color: theme.color.textMuted, textAlign: 'center', marginBottom: 22 },
  // Stretches to the sheet's width like the buttons below it; the body's bottom
  // margin already provides the gap above.
  gate: { alignSelf: 'stretch', marginBottom: 18 },
  cancel: { marginTop: 10, alignSelf: 'stretch' },
}));
