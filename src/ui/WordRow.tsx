// WordRow — a word-list row with a left-swipe action tray (Add to Deck · Delete),
// ported from WordList's WordRow. Swipe via ReanimatedSwipeable (gesture-handler).
// Tier indicator + native/target + added date + chevron. `compact` disables swipe.
import { useRef } from 'react';
import { Pressable, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { getTierByStability } from '@/theme/tiers';
import { IconChevronRight, IconFolderPlus, IconLock, IconTrash } from './icons';
import { Text } from './Text';
import { TierBadge } from './TierBadge';

export interface WordItem {
  native: string;
  target: string;
  added?: string;
  /** FSRS stability (days) → drives the tier indicator. */
  stability: number;
}

export interface WordRowProps {
  word: WordItem;
  onPress?: () => void;
  onDelete?: () => void;
  onAddToDeck?: () => void;
  /** Free tier shows a lock on Add-to-Deck. */
  isPremium?: boolean;
  /** Static row (no swipe, no date). */
  compact?: boolean;
}

const ACTION_W = 76;

export function WordRow({ word, onPress, onDelete, onAddToDeck, isPremium = false, compact = false }: WordRowProps) {
  const { theme } = useUnistyles();
  const ref = useRef<SwipeableMethods>(null);
  const tier = getTierByStability(word.stability);

  const renderRightActions = () => (
    <View style={styles.tray}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add to deck"
        style={[styles.action, { backgroundColor: isPremium ? theme.color.brand : theme.palette.slate[400] }]}
        onPress={() => {
          ref.current?.close();
          onAddToDeck?.();
        }}
      >
        {isPremium ? <IconFolderPlus size={18} color="#fff" /> : <IconLock size={18} color="#fff" />}
        <Text variant="label" style={styles.actionLabel}>
          Add to Deck
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Delete word"
        style={[styles.action, { backgroundColor: theme.color.danger }]}
        onPress={() => {
          ref.current?.close();
          onDelete?.();
        }}
      >
        <IconTrash size={18} color="#fff" />
        <Text variant="label" style={styles.actionLabel}>
          Delete
        </Text>
      </Pressable>
    </View>
  );

  const face = (
    <Pressable onPress={onPress} style={styles.face} accessibilityRole="button">
      <TierBadge tier={tier} variant="pill" size="sm" />
      <View style={styles.body}>
        <Text variant="bodyStrong" numberOfLines={1} style={styles.native}>
          {word.native}
        </Text>
        <Text variant="caption" numberOfLines={1} style={styles.target}>
          {word.target}
        </Text>
      </View>
      {!compact && word.added != null && (
        <Text variant="footnote" color="textFaint">
          {word.added}
        </Text>
      )}
      <IconChevronRight size={14} color={theme.color.borderStrong} />
    </Pressable>
  );

  if (compact) return <View style={styles.container}>{face}</View>;

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={renderRightActions}
      containerStyle={styles.container}
    >
      {face}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    backgroundColor: theme.color.surfaceCard,
    borderBottomWidth: theme.borderWidth.thin,
    borderBottomColor: theme.color.divider,
  },
  face: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: theme.color.surfaceCard,
  },
  body: { flex: 1, minWidth: 0 },
  native: { fontSize: 15 },
  target: { fontSize: 13 },
  tray: { flexDirection: 'row' },
  action: { width: ACTION_W, alignItems: 'center', justifyContent: 'center', gap: 4 },
  actionLabel: { color: '#fff', fontSize: 9, letterSpacing: 0.3 },
}));
