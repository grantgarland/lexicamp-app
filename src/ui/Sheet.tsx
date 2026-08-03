// Sheet — bottom sheet / modal overlay. Rendered through the in-app Portal (NOT RN
// `Modal`), so sheets stack: opening a second sheet slides it up over the first, which
// stays mounted behind it; dismissing slides back down to reveal it. Slide + scrim fade
// via a single reanimated progress value; unmounts only after the close animation.
//
// KEYBOARD (2026-07-28): a bottom-anchored sheet with a text field is unusable
// the moment the keyboard opens — it covers the field and both CTAs (reported on
// EditTranslationSheet; LanguagePickerSheet's search, Edit Profile's username and
// Create Deck's name field all had it too). Fixed HERE rather than per-sheet:
//   · the CONTAINER's bottom padding tracks the keyboard, lifting the sheet with
//     it. Padding on the container, not the sheet, so the lift never feeds back
//     into `sheetH` (which drives the slide transform) — that loop would jitter.
//   · `maxHeight` shrinks by the same amount, so a tall sheet can never grow off
//     the top of the screen instead of being covered from the bottom.
//   · `useAnimatedKeyboard` (not Keyboard events + setState) so the sheet rides
//     iOS's real keyboard curve frame-for-frame instead of snapping after it.
// Sheets whose content can outgrow the remaining space pass `scrollable`, and
// anything that must stay reachable (form CTAs) goes in `footer`, which is
// pinned OUTSIDE the scroll area.
import { type ReactNode, useEffect, useState } from 'react';
import { Pressable, StyleSheet as RNStyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedKeyboard, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { Portal } from './Portal';
import { ScrollIntoViewScrollView } from './ScrollIntoView';
import { Text } from './Text';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Accepted for API compatibility; the sheet is content-sized. */
  snapPoints?: (string | number)[];
  /** Scroll the body when it outgrows the space left by the keyboard. Opt-in:
   *  sheets that own a FlatList/ScrollView must NOT nest one. */
  scrollable?: boolean;
  /** Pinned below the (optionally scrolling) body — form CTAs live here so the
   *  keyboard can never bury them and scrolling can never move them. */
  footer?: ReactNode;
  children: ReactNode;
}

/** Breathing room kept between the top of a full-height sheet and the status bar. */
const TOP_GUTTER = 24;

export function Sheet({ visible, onClose, title, scrollable = false, footer, children }: SheetProps) {
  useUnistyles();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const { t } = useTranslation();
  const [mounted, setMounted] = useState(visible);
  const [sheetH, setSheetH] = useState(0);
  const p = useSharedValue(visible ? 1 : 0);
  const keyboard = useAnimatedKeyboard();

  // Mount synchronously when opening — the React-endorsed "adjust state during
  // render" pattern (avoids a setState-in-effect cascade; react-hooks/set-state-in-effect).
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible) {
      p.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });
    } else {
      // Unmount only after the close animation completes (animation callback,
      // not an effect-body setState).
      p.value = withTiming(0, { duration: 200, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
  }, [visible, p]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: p.value }));
  // The lift: pad the CONTAINER (which bottom-aligns its child) by the keyboard
  // height. The sheet itself is untouched, so `sheetH` stays stable.
  const containerStyle = useAnimatedStyle(() => ({ paddingBottom: keyboard.height.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - p.value) * (sheetH || winH * 0.6) }],
    maxHeight: winH - insets.top - TOP_GUTTER - keyboard.height.value,
    // Once the keyboard covers the home indicator, its inset is dead space.
    paddingBottom: 20 + Math.max(0, insets.bottom - keyboard.height.value),
  }));

  if (!mounted) return null;
  const body = scrollable ? (
    /* ScrollIntoView-aware: a sheet body is short, so any accordion inside it
       (Settings → How Lexicamp works) expands straight past the bottom edge. */
    <ScrollIntoViewScrollView
      // `handled` (not `always`): a tap on a CTA registers on the FIRST press
      // instead of being eaten by the keyboard dismissal.
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
    >
      {children}
    </ScrollIntoViewScrollView>
  ) : (
    children
  );

  return (
    <Portal>
      {/* Scrim sits OUTSIDE the keyboard-padded lane: absolute children resolve
          against the padding box, so a scrim inside it would stop short of the
          screen bottom and leave an unscrimmed sliver as the keyboard animates. */}
      <View style={styles.container} pointerEvents="box-none">
        <Animated.View style={[styles.scrim, scrimStyle]}>
          <Pressable style={RNStyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('common.dismiss')} />
        </Animated.View>
        <Animated.View style={[styles.lane, containerStyle]} pointerEvents="box-none">
        <Animated.View
          onLayout={(e) => setSheetH(e.nativeEvent.layout.height)}
          style={[styles.sheet, sheetStyle]}
        >
          <View style={styles.handle} />
          {title != null && (
            <Text variant="heading" style={styles.title}>
              {title}
            </Text>
          )}
          {/* flexShrink so the body yields space to the pinned footer when the
              keyboard squeezes the sheet, instead of pushing it off-screen. */}
          <View style={styles.body}>{body}</View>
          {footer != null && <View style={styles.footer}>{footer}</View>}
        </Animated.View>
        </Animated.View>
      </View>
    </Portal>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end' },
  lane: { justifyContent: 'flex-end' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.color.overlayScrim },
  sheet: {
    backgroundColor: theme.color.surfaceCard,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    paddingHorizontal: theme.space[5],
    paddingTop: theme.space[3],
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: theme.color.borderStrong, marginBottom: theme.space[4] },
  title: { marginBottom: theme.space[2] },
  body: { flexShrink: 1, minHeight: 0 },
  scrollContent: { flexGrow: 1 },
  footer: { flexShrink: 0 },
}));
