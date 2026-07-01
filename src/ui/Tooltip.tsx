// Tooltip — press-to-reveal contextual help popover. Wrap any trigger; on press it
// measures the trigger and shows a small dark bubble (with an arrow) above/below it,
// over a full-screen scrim that dismisses on any tap. Renders in a Modal so it floats
// above nav/sheets. Generic — used for the quiz tier-badge info, stat-tile help, etc.
//
// This is the kit's INFO AFFORDANCE (see pressable.ts): the trigger shows a subtle ⓘ
// indicator at its top-right corner (the universal "there's info here" cue) and dims on
// press for consistent feedback. Pass `indicator={false}` when the trigger already reads
// as an info control on its own.
import { type ReactNode, useRef, useState } from 'react';
import { Modal, Pressable, type StyleProp, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { IconInfo } from './icons';
import { pressableOpacity } from './pressable';
import { RawText } from './Text';

export interface TooltipProps {
  /** Popover body (string, or custom node). */
  content: ReactNode;
  /** Optional bold heading above the body. */
  title?: string;
  /** The trigger element. */
  children: ReactNode;
  /** Show the ⓘ info indicator at the trigger's corner (default true). */
  indicator?: boolean;
  /** Style applied to the trigger Pressable (e.g. `flex` so a whole card is the target). */
  style?: StyleProp<ViewStyle>;
  /** Notified when the popover opens/closes — lets a parent drive active/dim state. */
  onOpenChange?: (open: boolean) => void;
  accessibilityLabel?: string;
}

const BUBBLE_BG = 'rgba(24, 32, 38, 0.97)';

export function Tooltip({ content, title, children, indicator = true, style, onOpenChange, accessibilityLabel }: TooltipProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const triggerRef = useRef<View>(null);
  const { width: winW, height: winH } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ x: 0, y: 0, w: 0, h: 0 });

  const openTip = () => {
    triggerRef.current?.measureInWindow((x, y, w, h) => {
      setAnchor({ x, y, w, h });
      setOpen(true);
      onOpenChange?.(true);
    });
  };
  const close = () => {
    setOpen(false);
    onOpenChange?.(false);
  };

  const bubbleW = Math.min(240, winW - 24);
  const below = anchor.y + anchor.h < winH * 0.6; // enough room below the trigger?
  const cx = anchor.x + anchor.w / 2;
  const left = Math.max(12, Math.min(cx - bubbleW / 2, winW - bubbleW - 12));
  const arrowLeft = Math.max(10, Math.min(cx - left - 6, bubbleW - 22));

  return (
    <>
      <Pressable
        ref={triggerRef}
        onPress={openTip}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        hitSlop={8}
        style={({ pressed }) => [style, pressableOpacity(pressed)]}
      >
        {children}
        {indicator && (
          <View style={styles.indicator} pointerEvents="none">
            <IconInfo size={9} color={theme.color.textMuted} />
          </View>
        )}
      </Pressable>
      <Modal transparent visible={open} animationType="fade" onRequestClose={close}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel={t('common.dismiss')}>
          <View
            style={[
              styles.bubble,
              {
                width: bubbleW,
                left,
                ...(below ? { top: anchor.y + anchor.h + 8 } : { bottom: winH - anchor.y + 8 }),
              },
            ]}
          >
            <View style={[below ? styles.arrowUp : styles.arrowDown, { left: arrowLeft }]} />
            {title != null && <RawText style={styles.title}>{title}</RawText>}
            {typeof content === 'string' ? <RawText style={styles.body}>{content}</RawText> : content}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

/** Standalone info affordance: a subtle, tappable ⓘ glyph that opens a Tooltip. Use
 *  where the info cue stands on its own (a label, a stat tile corner) rather than being
 *  attached to a larger tappable element. Same glyph + muted color as Tooltip's corner
 *  indicator, so the "there's info here" cue reads consistently everywhere. */
export function InfoDot({
  content,
  title,
  size = 13,
  accessibilityLabel,
}: {
  content: ReactNode;
  title?: string;
  size?: number;
  accessibilityLabel?: string;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  return (
    <Tooltip content={content} title={title} indicator={false} accessibilityLabel={accessibilityLabel ?? t('common.moreInfo')}>
      <IconInfo size={size} color={theme.color.textMuted} />
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Subtle ⓘ chip at the trigger's top-right corner — the consistent "info here" cue.
  indicator: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 15,
    height: 15,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.surfaceCard,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  bubble: {
    position: 'absolute',
    backgroundColor: BUBBLE_BG,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 13,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  title: { color: '#fff', fontFamily: theme.fonts.sans.bold, fontSize: 12.5, marginBottom: 3 },
  body: { color: 'rgba(255, 255, 255, 0.85)', fontFamily: theme.fonts.sans.regular, fontSize: 12, lineHeight: 17 },
  arrowUp: {
    position: 'absolute',
    top: -6,
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: BUBBLE_BG,
  },
  arrowDown: {
    position: 'absolute',
    bottom: -6,
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: BUBBLE_BG,
  },
}));
