// EmptyState — the single empty/error state for all modules, ported from
// `_shared/empty-state.js`. Centered column: illustration → serif title → body →
// pill CTA → secondary link → optional network note. Caller owns the wrapper.
// (The wifi glyph on the network note arrives with the SVG icon set.)
import type { ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Button } from './Button';
import { IconWifi } from './icons';
import { Text } from './Text';

export interface EmptyStateProps {
  illustration?: ReactNode;
  title: string;
  body?: string;
  cta?: string;
  onCta?: () => void;
  secondary?: string;
  onSecondary?: () => void;
  networkNote?: string;
  /** Larger title (sheet contexts). */
  large?: boolean;
  style?: ViewStyle;
}

export function EmptyState({
  illustration,
  title,
  body,
  cta,
  onCta,
  secondary,
  onSecondary,
  networkNote,
  large = false,
  style,
}: EmptyStateProps) {
  const { theme } = useUnistyles();
  const hasBelowBody = !!cta || !!networkNote;
  return (
    <View style={[styles.wrap, style]}>
      {illustration != null && <View style={styles.illustration}>{illustration}</View>}

      <Text style={[styles.title, large && styles.titleLarge]}>{title}</Text>

      {body != null && (
        <Text variant="caption" align="center" style={[styles.body, { marginBottom: hasBelowBody ? 24 : 0 }]}>
          {body}
        </Text>
      )}

      {cta != null && (
        <Button title={cta} variant="pill" onPress={onCta} style={{ alignSelf: 'center', marginBottom: secondary ? 14 : 0 }} />
      )}

      {secondary != null && (
        <Pressable onPress={onSecondary} hitSlop={8} style={{ marginBottom: networkNote ? 20 : 0 }}>
          <Text variant="footnote" style={styles.secondary}>
            {secondary}
          </Text>
        </Pressable>
      )}

      {networkNote != null && (
        <View style={[styles.note, { marginTop: !cta && !secondary ? 24 : 0 }]}>
          <View style={styles.noteIcon}>
            <IconWifi size={14} color={theme.color.textMuted} />
          </View>
          <Text variant="footnote" style={styles.noteText}>
            {networkNote}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 48,
    paddingBottom: 40,
  },
  illustration: { marginBottom: 20 },
  title: {
    fontFamily: theme.fonts.serif.semibold,
    fontSize: theme.size.lg,
    lineHeight: Math.round(theme.size.lg * theme.leading.snug),
    color: theme.color.textStrong,
    textAlign: 'center',
    marginBottom: 10,
  },
  titleLarge: {
    fontSize: theme.size.xl,
    lineHeight: Math.round(theme.size.xl * theme.leading.snug),
  },
  body: { maxWidth: 238, lineHeight: Math.round(theme.size.sm * theme.leading.relaxed) },
  secondary: { textDecorationLine: 'underline', color: theme.color.textMuted },
  note: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: theme.palette.slate[50],
    borderWidth: theme.borderWidth.thin,
    borderColor: theme.color.border,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    width: '100%',
  },
  noteIcon: { marginTop: 1, flexShrink: 0 },
  noteText: { flex: 1, textAlign: 'left', lineHeight: Math.round(theme.size.xs * theme.leading.relaxed) },
}));
