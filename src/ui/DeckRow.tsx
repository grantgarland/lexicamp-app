// DeckRow — a deck-list row with a left-swipe action tray (Study · Delete),
// ported from WordList's DeckRow. Icon tile + name + count/date + chevron.
import { useRef } from 'react';
import { Pressable, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { IconChevronRight, IconList, IconPlay, IconTrash } from './icons';
import { Text } from './Text';

export interface DeckItem {
  name: string;
  created?: string;
}

export interface DeckRowProps {
  deck: DeckItem;
  wordCount: number;
  onPress?: () => void;
  onStudy?: () => void;
  onDelete?: () => void;
}

const ACTION_W = 76;

export function DeckRow({ deck, wordCount, onPress, onStudy, onDelete }: DeckRowProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const ref = useRef<SwipeableMethods>(null);

  const renderRightActions = () => (
    <View style={styles.tray}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('deckRow.studyA11y')}
        style={[styles.action, { backgroundColor: theme.color.accentCta }]}
        onPress={() => {
          ref.current?.close();
          onStudy?.();
        }}
      >
        <IconPlay size={18} color={theme.color.textOnAccentCta} />
        <Text variant="label" style={[styles.actionLabel, { color: theme.color.textOnAccentCta }]}>
          {t('deckRow.study')}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('deckRow.deleteA11y')}
        style={[styles.action, { backgroundColor: theme.color.danger }]}
        onPress={() => {
          ref.current?.close();
          onDelete?.();
        }}
      >
        <IconTrash size={18} color={theme.color.textOnDanger} />
        <Text variant="label" style={[styles.actionLabel, { color: theme.color.textOnDanger }]}>
          {t('deckRow.delete')}
        </Text>
      </Pressable>
    </View>
  );

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={renderRightActions}
      containerStyle={styles.container}
    >
      <Pressable onPress={onPress} style={styles.face} accessibilityRole="button">
        <View style={styles.tile}>
          <IconList size={18} color={theme.color.brand} />
        </View>
        <View style={styles.body}>
          <Text variant="bodyStrong" numberOfLines={1} style={styles.name}>
            {deck.name}
          </Text>
          <Text variant="caption" style={styles.sub}>
            {t('deckRow.words', { count: wordCount })}
            {deck.created != null ? t('deckRow.addedSuffix', { date: deck.created }) : ''}
          </Text>
        </View>
        <IconChevronRight size={14} color={theme.color.borderStrong} />
      </Pressable>
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
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: theme.color.surfaceCard,
  },
  tile: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: theme.color.brandTint,
    borderWidth: theme.borderWidth.thin,
    borderColor: theme.color.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0 },
  name: { fontSize: 15 },
  sub: { fontSize: 13 },
  tray: { flexDirection: 'row' },
  action: { width: ACTION_W, alignItems: 'center', justifyContent: 'center', gap: 4 },
  actionLabel: { color: '#fff', fontSize: 9, letterSpacing: 0.3 },
}));
