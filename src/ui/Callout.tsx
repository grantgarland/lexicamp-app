// Callout — a demarcated note that has to survive being read at a glance:
// consequences, caveats, and gates that sit INSIDE a block of ordinary copy and
// would otherwise be skimmed past as more of the same. Ported from the premium-gate
// callout in the design system's `settings/Settings.html` prototype (amber tinted
// surface + 1px border + radius-10 + a leading glyph), generalized to the semantic
// tone tokens so danger/info variants come free.
//
// This is the FIRST consumer of `color.warning` / `color.warningSoft` — both tones
// existed in the generated token set and had no caller. Nothing here hardcodes a
// hex; light/dark both come from the theme.
import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { IconInfo } from './icons';
import { RawText as Text } from './Text';

export type CalloutTone = 'warning' | 'danger' | 'info';

export interface CalloutProps {
  /** Body copy. For rich content, use `children` instead. */
  text?: string;
  children?: ReactNode;
  /** Semantic tone (default `warning`). Drives surface, border and icon color. */
  tone?: CalloutTone;
  /** Leading glyph. Defaults to `IconInfo` in the tone's accent; pass `null` for none. */
  icon?: ReactNode | null;
  style?: ViewStyle;
  testID?: string;
}

export function Callout({ text, children, tone = 'warning', icon, style, testID }: CalloutProps) {
  // The theme is read directly (as in `Text`) rather than through a style: SVG
  // stroke is a prop, not an inherited CSS color, and routing a bare token
  // through StyleSheet.create would hand Unistyles a "style" it cannot bind to a
  // ShadowNode.
  const { theme } = useUnistyles();
  // Icons align to the FIRST LINE, not the block's centre: es copy runs ~20%
  // longer than en and wraps to three lines where en wraps to two, which would
  // leave a centred glyph floating mid-paragraph.
  const showIcon = icon !== null;
  return (
    <View style={[styles.base, styles.tone(tone), style]} testID={testID}>
      {showIcon && <View style={styles.icon}>{icon ?? <IconInfo size={14} color={theme.color[tone]} />}</View>}
      <View style={styles.content}>{children ?? (text != null && <Text style={styles.text}>{text}</Text>)}</View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  base: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: theme.borderWidth.thin,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  tone: (tone: CalloutTone) => ({
    backgroundColor: theme.color[`${tone}Soft`],
    borderColor: theme.color[tone],
  }),
  // Nudged to sit on the cap-height of the first line rather than its box top.
  icon: { paddingTop: 2 },
  content: { flex: 1 },
  text: {
    fontFamily: theme.fonts.sans.regular,
    fontSize: 13,
    lineHeight: 19,
    color: theme.color.textStrong,
    textAlign: 'left',
  },
}));
