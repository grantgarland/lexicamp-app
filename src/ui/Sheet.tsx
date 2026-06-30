// Sheet — bottom sheet / modal overlay, the RN realization of `_shared/sheet-overlay.js`.
// Wraps @gorhom/bottom-sheet's BottomSheetModal with a controlled `visible`/`onClose`
// API, a navy scrim (overlay-scrim), rounded-xl surface, and dynamic content sizing.
// Requires GestureHandlerRootView + BottomSheetModalProvider at the app root (wired
// in app/_layout.tsx).
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { type ReactNode, useCallback, useEffect, useRef } from 'react';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from './Text';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Fixed snap points; omit for content-sized (dynamic) height. */
  snapPoints?: (string | number)[];
  children: ReactNode;
}

export function Sheet({ visible, onClose, title, snapPoints, children }: SheetProps) {
  useUnistyles(); // subscribe to theme so styles re-resolve on theme change
  const ref = useRef<BottomSheetModal>(null);

  useEffect(() => {
    if (visible) ref.current?.present();
    else ref.current?.dismiss();
  }, [visible]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.45}
        pressBehavior="close"
        style={[props.style, styles.scrim]}
      />
    ),
    [],
  );

  return (
    <BottomSheetModal
      ref={ref}
      snapPoints={snapPoints}
      enableDynamicSizing={snapPoints == null}
      onDismiss={onClose}
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={styles.handle}
      backgroundStyle={styles.background}
    >
      <BottomSheetView style={styles.content}>
        {title != null && (
          <Text variant="heading" style={styles.title}>
            {title}
          </Text>
        )}
        {children}
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create((theme) => ({
  scrim: { backgroundColor: 'rgb(24, 47, 63)' }, // overlay-scrim base (alpha from `opacity`)
  background: {
    backgroundColor: theme.color.surfaceCard,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
  },
  handle: { backgroundColor: theme.palette.slate[300], width: 36 },
  content: {
    paddingHorizontal: theme.space[5],
    paddingTop: theme.space[2],
    paddingBottom: theme.space[8],
    gap: theme.space[4],
  },
  title: { marginBottom: theme.space[1] },
}));
