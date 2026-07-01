// List + ListItem — the shared vocabulary/selection list primitives. One row component
// drives the Word List rows, the deck word-picker (checkbox variant), the Filter tier
// list, and the Add-to-Deck deck list. `List` renders a divider-separated stack with a
// built-in empty state (overridable via `emptyState`).
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View, type ViewStyle } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { IconCheck } from './icons';
import { RawText as Text } from './Text';

// ── Checkbox ──────────────────────────────────────────────────────────────────
export function Checkbox({ checked, color }: { checked: boolean; color?: string }) {
  const { theme } = useUnistyles();
  const accent = color ?? theme.color.brand;
  return (
    <View style={[styles.checkbox, { borderColor: checked ? accent : theme.palette.slate[300], backgroundColor: checked ? accent : 'transparent' }]}>
      {checked && <IconCheck size={13} color="#fff" />}
    </View>
  );
}

// ── ListItem ──────────────────────────────────────────────────────────────────
export interface ListItemProps {
  title: string;
  subtitle?: string;
  /** Subtitle sits to the right of the title (compact word rows) rather than below. */
  subtitleInline?: boolean;
  /** Slot before the text (tier badge, icon tile, …), after any checkbox. */
  leading?: ReactNode;
  /** Slot at the trailing edge (value, chevron, status, …). */
  trailing?: ReactNode;
  /** Render a leading checkbox reflecting `checked`; pressing the row toggles via onPress. */
  checkbox?: boolean;
  checked?: boolean;
  /** Checkbox accent (e.g. the tier colour). */
  checkColor?: string;
  onPress?: () => void;
  disabled?: boolean;
  compact?: boolean;
  /** Omit the bottom divider (last row / standalone). */
  last?: boolean;
  accessibilityLabel?: string;
}

export function ListItem({
  title,
  subtitle,
  subtitleInline = false,
  leading,
  trailing,
  checkbox = false,
  checked = false,
  checkColor,
  onPress,
  disabled = false,
  compact = false,
  last = false,
  accessibilityLabel,
}: ListItemProps) {
  const base = [
    styles.row,
    compact && styles.rowCompact,
    !last && styles.rowBorder,
    checkbox && checked && styles.rowChecked,
    disabled && styles.rowDisabled,
  ];
  const content = (
    <>
      {checkbox && <Checkbox checked={checked} color={checkColor} />}
      {leading}
      <View style={styles.body}>
        {subtitleInline ? (
          <Text numberOfLines={1} style={styles.titleInline}>
            {title}
            {subtitle != null && <Text style={styles.subtitleInline}> {subtitle}</Text>}
          </Text>
        ) : (
          <>
            <Text numberOfLines={1} style={styles.title}>
              {title}
            </Text>
            {subtitle != null && (
              <Text numberOfLines={1} style={styles.subtitle}>
                {subtitle}
              </Text>
            )}
          </>
        )}
      </View>
      {trailing}
    </>
  );

  if (onPress != null) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole={checkbox ? 'checkbox' : 'button'}
        accessibilityState={checkbox ? { checked } : undefined}
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [base, pressed && !disabled && styles.rowPressed]}
      >
        {content}
      </Pressable>
    );
  }
  return (
    <View accessibilityLabel={accessibilityLabel} style={base}>
      {content}
    </View>
  );
}

// ── List ──────────────────────────────────────────────────────────────────────
export interface ListProps {
  children?: ReactNode;
  /** When true, render the empty state instead of children. */
  isEmpty?: boolean;
  /** Custom empty state; falls back to `emptyTitle`/`emptyBody`. */
  emptyState?: ReactNode;
  emptyTitle?: string;
  emptyBody?: string;
  /** Wrap the rows in a ScrollView. */
  scroll?: boolean;
  style?: ViewStyle;
  contentStyle?: ViewStyle;
}

export function List({ children, isEmpty = false, emptyState, emptyTitle, emptyBody, scroll = false, style, contentStyle }: ListProps) {
  if (isEmpty) {
    if (emptyState != null) return <>{emptyState}</>;
    return (
      <View style={[styles.empty, style]}>
        {emptyTitle != null && <Text style={styles.emptyTitle}>{emptyTitle}</Text>}
        {emptyBody != null && <Text style={styles.emptyBody}>{emptyBody}</Text>}
      </View>
    );
  }
  if (scroll) {
    return (
      <ScrollView style={style} contentContainerStyle={contentStyle} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    );
  }
  return <View style={[style, contentStyle]}>{children}</View>;
}

const styles = StyleSheet.create((theme) => {
  const { color, fonts } = theme;
  return {
    checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: color.surfaceCard },
    rowCompact: { paddingVertical: 10 },
    rowBorder: { borderBottomWidth: theme.borderWidth.thin, borderBottomColor: color.divider },
    rowChecked: { backgroundColor: theme.palette.blue[50] },
    rowDisabled: { opacity: 0.45 },
    rowPressed: { opacity: 0.7 },
    body: { flex: 1, minWidth: 0 },
    title: { fontFamily: fonts.sans.semibold, fontSize: 15, color: color.textStrong },
    subtitle: { fontFamily: fonts.sans.regular, fontSize: 13, color: color.textMuted, marginTop: 1 },
    titleInline: { fontFamily: fonts.sans.semibold, fontSize: 14, color: color.textStrong },
    subtitleInline: { fontFamily: fonts.sans.regular, fontSize: 13, color: color.textMuted },
    empty: { paddingVertical: 48, paddingHorizontal: 24, alignItems: 'center' },
    emptyTitle: { fontFamily: fonts.serif.semibold, fontSize: 17, color: color.textStrong, textAlign: 'center', marginBottom: 6 },
    emptyBody: { fontFamily: fonts.sans.regular, fontSize: 14, lineHeight: 20, color: color.textMuted, textAlign: 'center' },
  };
});
