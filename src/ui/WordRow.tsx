// WordRow — THE shared word-list row (18-session item 1: all word lists compose
// this one component). Left-swipe action tray (Add to Deck · Delete) via
// ReanimatedSwipeable. Anatomy: tier badge (first flex item, vertically centered
// by the ListItem row) · TARGET word bold over native beneath · right cells =
// colored next-review label ("Today", "in 2 days"…) with the review count under
// it — matching the Progress tier-drawer treatment. `compact` disables swipe.
import { useRef } from 'react';
import { Pressable, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { dueLabelShort, wordHealth } from '@/lib/relativeTime';
import { getTierByStability } from '@/theme/tiers';
import { IconArchive, IconFolderPlus, IconLock, IconMinus, IconTrash } from './icons';
import { ListItem } from './List';
import { Text } from './Text';
import { TierBadge } from './TierBadge';

export interface WordItem {
  native: string;
  target: string;
  /** FSRS stability (days) → drives the tier indicator. */
  stability: number;
  /** Next scheduled review → the colored right-cell label. Omit to hide the cell. */
  dueAt?: Date;
  /** Completed review count → the small right cell under the due label. */
  reps?: number;
  /** Archived (18 §E3): dims the row; tray offers Unarchive instead of Add-to-Deck. */
  suspended?: boolean;
}

export interface WordRowProps {
  word: WordItem;
  onPress?: () => void;
  onDelete?: () => void;
  onAddToDeck?: () => void;
  /** 18 §E3: archive (or unarchive when the word is archived). */
  onToggleArchive?: () => void;
  /** Deck context: replaces the Add/Delete tray with a single "Remove from deck". */
  onRemoveFromDeck?: () => void;
  /** Free tier shows a lock on Add-to-Deck. */
  isPremium?: boolean;
  /** Static row (no swipe, no date). */
  compact?: boolean;
}

const ACTION_W = 76;

export function WordRow({ word, onPress, onDelete, onAddToDeck, onToggleArchive, onRemoveFromDeck, isPremium = false, compact = false }: WordRowProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const ref = useRef<SwipeableMethods>(null);
  const tier = getTierByStability(word.stability);

  const renderRightActions = () =>
    onRemoveFromDeck != null ? (
      <View style={styles.tray}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('wordRow.removeA11y')}
          style={[styles.action, { backgroundColor: theme.color.brand }]}
          onPress={() => {
            ref.current?.close();
            onRemoveFromDeck();
          }}
        >
          <IconMinus size={18} color="#fff" />
          <Text variant="label" style={styles.actionLabel}>
            {t('wordRow.remove')}
          </Text>
        </Pressable>
      </View>
    ) : (
      <View style={styles.tray}>
        {onToggleArchive != null && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={word.suspended ? t('wordRow.unarchiveA11y') : t('wordRow.archiveA11y')}
            style={[styles.action, { backgroundColor: theme.palette.slate[500] }]}
            onPress={() => {
              ref.current?.close();
              onToggleArchive();
            }}
          >
            <IconArchive size={18} color="#fff" />
            <Text variant="label" style={styles.actionLabel}>
              {word.suspended ? t('wordRow.unarchive') : t('wordRow.archive')}
            </Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('wordRow.addToDeckA11y')}
          style={[styles.action, { backgroundColor: isPremium ? theme.color.brand : theme.palette.slate[400] }]}
          onPress={() => {
            ref.current?.close();
            onAddToDeck?.();
          }}
        >
          {isPremium ? <IconFolderPlus size={18} color="#fff" /> : <IconLock size={18} color="#fff" />}
          <Text variant="label" style={styles.actionLabel}>
            {t('wordRow.addToDeck')}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('wordRow.deleteA11y')}
          style={[styles.action, { backgroundColor: theme.color.danger }]}
          onPress={() => {
            ref.current?.close();
            onDelete?.();
          }}
        >
          <IconTrash size={18} color="#fff" />
          <Text variant="label" style={styles.actionLabel}>
            {t('wordRow.delete')}
          </Text>
        </Pressable>
      </View>
    );

  // Due-label color by review health (same mapping as the Progress tier drawer).
  const health = word.dueAt != null ? wordHealth(word.dueAt) : null;
  const healthColor: Record<'due' | 'soon' | 'ok', string> = {
    due: theme.color.danger,
    soon: theme.palette.amber[500],
    ok: theme.palette.green[500],
  };

  const face = (
    <ListItem
      // alignSelf overrides the pill's own `flex-start` so the badge centers
      // against the full two-line row (18-session item 1.1), not the title line.
      leading={<TierBadge tier={tier} variant="pill" size="sm" style={{ alignSelf: 'center' }} />}
      // 18-session item 1.2: the TARGET-language word leads bold; native beneath.
      title={word.target}
      subtitle={word.native}
      onPress={onPress}
      last
      trailing={
        word.dueAt != null || word.reps != null ? (
          <View style={styles.trailing}>
            {word.dueAt != null && health != null && (
              <Text variant="footnote" style={[styles.due, { color: healthColor[health] }]}>
                {dueLabelShort(word.dueAt, t)}
              </Text>
            )}
            {word.reps != null && (
              <Text variant="footnote" color="textMuted">
                {t('wordRow.reviewsCount', { count: word.reps })}
              </Text>
            )}
          </View>
        ) : undefined
      }
    />
  );

  if (compact) return <View style={[styles.container, word.suspended && styles.archived]}>{face}</View>;

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={renderRightActions}
      containerStyle={[styles.container, word.suspended && styles.archived]}
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
  archived: { opacity: 0.55 },
  trailing: { alignItems: 'flex-end', gap: 2 },
  due: { fontFamily: theme.fonts.sans.semibold },
  tray: { flexDirection: 'row' },
  action: { width: ACTION_W, alignItems: 'center', justifyContent: 'center', gap: 4 },
  actionLabel: { color: '#fff', fontSize: 9, letterSpacing: 0.3 },
}));
