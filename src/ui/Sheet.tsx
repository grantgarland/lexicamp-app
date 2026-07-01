// Sheet — bottom sheet / modal overlay, the RN realization of `_shared/sheet-overlay.js`.
// Built on React Native's `Modal` (transparent, fade) with a navy scrim that dismisses on
// tap and a bottom-anchored, rounded surface. This is the same proven primitive the
// Tooltip uses; it renders above nav + tab bar reliably. Controlled via `visible`/`onClose`.
import type { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { Text } from './Text';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Accepted for API compatibility; the sheet is content-sized. */
  snapPoints?: (string | number)[];
  children: ReactNode;
}

export function Sheet({ visible, onClose, title, children }: SheetProps) {
  useUnistyles(); // subscribe to theme so styles re-resolve on theme change
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('common.dismiss')} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.handle} />
          {title != null && (
            <Text variant="heading" style={styles.title}>
              {title}
            </Text>
          )}
          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(24, 47, 63, 0.45)' },
  sheet: {
    backgroundColor: theme.color.surfaceCard,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    paddingHorizontal: theme.space[5],
    paddingTop: theme.space[3],
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: theme.palette.slate[300], marginBottom: theme.space[4] },
  title: { marginBottom: theme.space[2] },
}));
