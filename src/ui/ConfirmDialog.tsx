// ConfirmDialog — the shared confirm bottom sheet (delete word, delete deck, remove from
// deck, clear data, sign out). Centered icon + title + body + a destructive/primary
// confirm and a secondary cancel.
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { Button } from './Button';
import { Sheet } from './Sheet';
import { RawText as Text } from './Text';

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  body?: string;
  /** Optional icon rendered in a soft circle above the title. */
  icon?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({ visible, title, body, icon, confirmLabel, cancelLabel, destructive = false, onConfirm, onClose }: ConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.wrap}>
        {icon != null && <View style={styles.icon}>{icon}</View>}
        <Text style={styles.title}>{title}</Text>
        {body != null && <Text style={styles.body}>{body}</Text>}
        {/* Maestro tap targets (only one ConfirmDialog is ever visible, so the
            ids are unique at runtime). Confirm labels often collide with the
            action that opened the dialog (e.g. the swipe-tray 'Delete') — id
            taps need no positional disambiguation. */}
        <Button title={confirmLabel} variant={destructive ? 'destructive' : 'primary'} onPress={onConfirm} testID="confirm-accept" />
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
  cancel: { marginTop: 10, alignSelf: 'stretch' },
}));
