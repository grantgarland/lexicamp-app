// WordListScreen (W-01, "My Words") — the vocabulary browse hub. Header (title + live
// count), a search field + filter/sort button (W-02 sheet), and the scrollable saved-word
// list (WordRow, swipe → Add-to-Deck · Delete). Reads real scenario data via `useWords()`;
// the DevBadge tier scenario drives which words appear. Delete opens a confirmation sheet.
//
// The bottom nav is provided by the persistent tab layout (app/(tabs)/_layout), not here.
// Custom Decks sub-nav (W-04/07) and the word-detail sheet (W-03) are the next chunk; the
// row tap + Add-to-Deck are wired as TODOs.
import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { useDecks, useEntitlement, useWords } from '@/query/hooks';
import type { DeckSummary, WordListItem } from '@/data/DataSource';
import { addedLabel } from '@/lib/relativeTime';
import { useUiStore } from '@/store/uiStore';
import { getTierByStability, TIERS, type TierId } from '@/theme/tiers';

import {
  Button,
  ButtonRow,
  ConfirmDialog,
  DeckRow,
  DetailStats,
  EmptyState,
  IconList,
  IconLock,
  IconTrash,
  List,
  ListItem,
  RawText,
  Screen,
  SearchBar,
  SegmentedTabs,
  Sheet,
  SkeletonRows,
  TierBadge,
  WordDetailSheet,
  WordRow,
} from '@/ui';

type SortId = 'newest' | 'oldest' | 'az' | 'tier';

function sortWords(list: WordListItem[], sortBy: SortId): WordListItem[] {
  const arr = [...list];
  switch (sortBy) {
    case 'oldest':
      return arr.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    case 'az':
      return arr.sort((a, b) => a.native.localeCompare(b.native));
    case 'tier': // Base Camp (low stability) → Summit (high)
      return arr.sort((a, b) => a.stability - b.stability);
    default:
      return arr.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}

export function WordListScreen() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const router = useRouter();
  const showToast = useUiStore((s) => s.showToast);
  const { words, isLoading: wordsLoading } = useWords();
  const { decks, isLoading: decksLoading } = useDecks();
  const { isPaid } = useEntitlement();

  const [subTab, setSubTab] = useState<'words' | 'decks'>('words');
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortId>('newest');
  const [filterTiers, setFilterTiers] = useState<Set<TierId>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [detailWord, setDetailWord] = useState<WordListItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WordListItem | null>(null);
  // Optimistic removal until the real delete mutation (03 write) lands.
  const [removed, setRemoved] = useState<string[]>([]);
  // Decks (W-04…W-08). `extraDecks` holds optimistically-created decks.
  const [extraDecks, setExtraDecks] = useState<DeckSummary[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createInitialWord, setCreateInitialWord] = useState<WordListItem | null>(null);
  const [detailDeck, setDetailDeck] = useState<DeckSummary | null>(null);
  const [addToDeckWord, setAddToDeckWord] = useState<WordListItem | null>(null);
  const [pendingDeckDelete, setPendingDeckDelete] = useState<DeckSummary | null>(null);
  const [deckWordDetail, setDeckWordDetail] = useState<WordListItem | null>(null);
  const [pendingRemove, setPendingRemove] = useState<{ deck: DeckSummary; word: WordListItem } | null>(null);
  const [removedFromDeck, setRemovedFromDeck] = useState<Set<string>>(new Set());
  // Local deck membership (deckId|wordId) — optimistic until the real write lands.
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [removedDecks, setRemovedDecks] = useState<string[]>([]);
  const allDecks = [...decks, ...extraDecks].filter((d) => !removedDecks.includes(d.id));

  const openCreate = (initialWord: WordListItem | null = null) => {
    setCreateInitialWord(initialWord);
    setCreateOpen(true);
  };
  const deleteDeck = (d: DeckSummary) => {
    setRemovedDecks((r) => [...r, d.id]);
    setExtraDecks((e) => e.filter((x) => x.id !== d.id));
  };

  const filterActive = sortBy !== 'newest' || filterTiers.size > 0;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = words
      .filter((w) => !removed.includes(w.id))
      .filter((w) => q === '' || w.native.toLowerCase().includes(q) || w.target.toLowerCase().includes(q))
      .filter((w) => filterTiers.size === 0 || filterTiers.has(getTierByStability(w.stability).id));
    return sortWords(filtered, sortBy);
  }, [words, removed, query, filterTiers, sortBy]);

  const savedCount = words.length - removed.length;
  const noneSaved = savedCount === 0;

  return (
    <Screen edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <RawText style={styles.title}>{t('wordList.title')}</RawText>
          <RawText style={styles.count}>
            {subTab === 'words' ? t('wordList.count', { count: savedCount }) : t('wordList.deckCount', { count: allDecks.length })}
          </RawText>
        </View>
        <SegmentedTabs
          active={subTab}
          onChange={(id) => setSubTab(id as 'words' | 'decks')}
          tabs={[
            { id: 'words', label: t('wordList.tabAllWords') },
            {
              id: 'decks',
              label: t('wordList.tabCustomDecks'),
              badge: !isPaid ? (
                <View style={styles.proBadge}>
                  <RawText style={styles.proBadgeText}>PRO</RawText>
                </View>
              ) : undefined,
            },
          ]}
        />
      </View>

      {/* Search sits UNDER the tabs (words tab only) so switching tabs never moves the
          tab row across routes. */}
      {subTab === 'words' && (
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder={t('wordList.searchPlaceholder')}
          onFilter={() => setFilterOpen(true)}
          filterActive={filterActive}
          style={styles.searchUnderTabs}
        />
      )}

      {/* Words tab */}
      {subTab === 'words' &&
        (wordsLoading ? (
          <SkeletonRows />
        ) : noneSaved ? (
          <EmptyState title={t('wordList.emptyTitle')} body={t('wordList.emptyBody')} style={styles.empty} />
        ) : visible.length === 0 ? (
          <View style={styles.noMatch}>
            <RawText style={styles.noMatchText}>{t('wordList.noMatch')}</RawText>
          </View>
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.listContent}>
            {visible.map((w) => (
              <WordRow
                key={w.id}
                word={{ native: w.native, target: w.target, stability: w.stability, added: addedLabel(w.createdAt, t) }}
                isPremium={isPaid}
                onPress={() => setDetailWord(w)}
                onDelete={() => setPendingDelete(w)}
                onAddToDeck={() => (isPaid ? setAddToDeckWord(w) : setSubTab('decks'))}
              />
            ))}
          </ScrollView>
        ))}

      {/* Decks tab (W-04 / W-07) */}
      {subTab === 'decks' &&
        (!isPaid ? (
          <PremiumGate />
        ) : (
          <View style={styles.decksBody}>
            {/* Sticky "Create new deck" — consistent with the Add-to-Deck sheet; never scrolls. */}
            <View style={styles.stickyCreate}>
              <CreateNewDeckRow onPress={() => openCreate()} />
            </View>
            {decksLoading ? (
              <SkeletonRows count={3} />
            ) : allDecks.length === 0 ? (
              <View style={styles.decksEmpty}>
                <RawText style={styles.decksEmptyTitle}>{t('wordList.decksEmptyTitle')}</RawText>
                <RawText style={styles.decksEmptyBody}>{t('wordList.decksEmptyBody')}</RawText>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.decksList}>
                {allDecks.map((d) => (
                  <DeckRow
                    key={d.id}
                    deck={{ name: d.name }}
                    wordCount={d.wordCount}
                    onPress={() => setDetailDeck(d)}
                    onStudy={() => router.push('/quiz')}
                    onDelete={() => setPendingDeckDelete(d)}
                  />
                ))}
              </ScrollView>
            )}
          </View>
        ))}

      {/* W-02 — Filter & sort */}
      <FilterSortSheet
        visible={filterOpen}
        sortBy={sortBy}
        filterTiers={filterTiers}
        onClose={() => setFilterOpen(false)}
        onApply={(s, tiers) => {
          setSortBy(s);
          setFilterTiers(tiers);
          setFilterOpen(false);
        }}
        onReset={() => {
          setSortBy('newest');
          setFilterTiers(new Set());
          setFilterOpen(false);
        }}
      />

      {/* W-03 — Word detail */}
      <WordDetailSheet
        word={detailWord}
        onClose={() => setDetailWord(null)}
        onDelete={(w) => {
          setDetailWord(null);
          setPendingDelete(w);
        }}
      />

      {/* Delete-word confirmation (shared dialog) */}
      <ConfirmDialog
        visible={pendingDelete != null}
        icon={<IconTrash size={22} color={theme.color.danger} />}
        title={t('wordList.deleteTitle', { word: pendingDelete?.native ?? '' })}
        body={t('wordList.deleteBody')}
        confirmLabel={t('wordList.deleteConfirm')}
        destructive
        onConfirm={() => {
          const w = pendingDelete;
          if (w) {
            setRemoved((r) => [...r, w.id]);
            showToast({
              variant: 'destructive',
              message: t('wordList.wordDeleted', { word: w.native }),
              action: { label: t('common.undo'), onPress: () => setRemoved((r) => r.filter((id) => id !== w.id)) },
            });
          }
          setPendingDelete(null);
        }}
        onClose={() => setPendingDelete(null)}
      />

      {/* Delete-deck confirmation (data removed; words kept) */}
      <ConfirmDialog
        visible={pendingDeckDelete != null}
        icon={<IconTrash size={22} color={theme.color.danger} />}
        title={t('wordList.deleteDeckTitle', { name: pendingDeckDelete?.name ?? '' })}
        body={t('wordList.deleteDeckBody')}
        confirmLabel={t('wordList.deleteDeck')}
        destructive
        onConfirm={() => {
          const d = pendingDeckDelete;
          if (d) {
            deleteDeck(d);
            showToast({
              variant: 'destructive',
              message: t('wordList.deckDeleted', { name: d.name }),
              action: { label: t('common.undo'), onPress: () => setRemovedDecks((r) => r.filter((id) => id !== d.id)) },
            });
          }
          setPendingDeckDelete(null);
          setDetailDeck(null); // also close the deck detail sheet if it was open
        }}
        onClose={() => setPendingDeckDelete(null)}
      />

      {/* W-05 — Create deck */}
      <CreateDeckSheet
        visible={createOpen}
        words={words}
        initialWord={createInitialWord}
        onClose={() => setCreateOpen(false)}
        onCreate={(name, ids) => {
          setExtraDecks((e) => [...e, { id: `d_${Date.now()}`, name, wordCount: ids.length, reviews: 0, createdAt: new Date(), lastReviewedAt: null }]);
          setCreateOpen(false);
          showToast({ variant: 'success', message: t('wordList.deckCreated', { name }) });
        }}
      />

      {/* W-06 — Deck detail */}
      <DeckDetailSheet
        deck={detailDeck}
        words={words}
        removed={removed}
        removedFromDeck={removedFromDeck}
        onClose={() => setDetailDeck(null)}
        onStudy={() => {
          setDetailDeck(null);
          router.push('/quiz');
        }}
        onDelete={(d) => setPendingDeckDelete(d)}
        onWordPress={(w) => setDeckWordDetail(w)}
        onRemoveWord={(deck, w) => setPendingRemove({ deck, word: w })}
      />

      {/* Nested: a word's detail opened from inside the deck (returns to the deck sheet) */}
      <WordDetailSheet
        word={deckWordDetail}
        onClose={() => setDeckWordDetail(null)}
        onDelete={(w) => {
          setDeckWordDetail(null);
          setPendingDelete(w);
        }}
      />

      {/* Remove-from-deck confirmation (word stays in your library) */}
      <ConfirmDialog
        visible={pendingRemove != null}
        icon={<IconTrash size={22} color={theme.color.danger} />}
        title={t('wordList.removeTitle', { word: pendingRemove?.word.native ?? '' })}
        body={t('wordList.removeBody')}
        confirmLabel={t('wordList.removeConfirm')}
        destructive
        onConfirm={() => {
          if (pendingRemove) setRemovedFromDeck((s) => new Set(s).add(`${pendingRemove.deck.id}|${pendingRemove.word.id}`));
          setPendingRemove(null);
        }}
        onClose={() => setPendingRemove(null)}
      />

      {/* W-08 — Add to deck */}
      <AddToDeckSheet
        word={addToDeckWord}
        decks={allDecks}
        added={added}
        onAdd={(w, d) => {
          setAdded((s) => new Set(s).add(`${d.id}|${w.id}`));
          setAddToDeckWord(null);
          showToast({ variant: 'success', message: t('wordList.addedToDeck', { deck: d.name }) });
        }}
        onCreateNew={() => {
          const w = addToDeckWord;
          setAddToDeckWord(null);
          openCreate(w); // pre-select + pin this word in the New Deck sheet
        }}
        onClose={() => setAddToDeckWord(null)}
      />
    </Screen>
  );
}

// W-02 — Filter & Sort bottom sheet: radio sort + multi-select tier filter (none = all).
function FilterSortSheet({
  visible,
  sortBy,
  filterTiers,
  onClose,
  onApply,
  onReset,
}: {
  visible: boolean;
  sortBy: SortId;
  filterTiers: Set<TierId>;
  onClose: () => void;
  onApply: (sortBy: SortId, tiers: Set<TierId>) => void;
  onReset: () => void;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const [localSort, setLocalSort] = useState<SortId>(sortBy);
  const [localTiers, setLocalTiers] = useState<Set<TierId>>(new Set(filterTiers));

  // Re-sync local state each time the sheet opens.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setLocalSort(sortBy);
      setLocalTiers(new Set(filterTiers));
    }
  }

  const toggleTier = (id: TierId) =>
    setLocalTiers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sortOptions: { id: SortId; label: string }[] = [
    { id: 'newest', label: t('wordList.sortNewest') },
    { id: 'oldest', label: t('wordList.sortOldest') },
    { id: 'az', label: t('wordList.sortAz') },
    { id: 'tier', label: t('wordList.sortTier') },
  ];

  return (
    <Sheet visible={visible} onClose={onClose} title={t('wordList.filterSortTitle')}>
      <View style={styles.sheetSection}>
        <RawText style={styles.sheetLabel}>{t('wordList.sortBy')}</RawText>
        {sortOptions.map((opt) => {
          const on = localSort === opt.id;
          return (
            <Pressable key={opt.id} onPress={() => setLocalSort(opt.id)} style={styles.optionRow} accessibilityRole="radio" accessibilityState={{ selected: on }}>
              <View style={[styles.radio, { borderColor: on ? theme.color.brand : theme.palette.slate[300] }]}>
                {on && <View style={styles.radioDot} />}
              </View>
              <RawText style={styles.optionLabel}>{opt.label}</RawText>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.sheetSection}>
        <RawText style={styles.sheetLabel}>
          {t('wordList.filterByTier')} <RawText style={styles.sheetHint}>{t('wordList.filterByTierHint')}</RawText>
        </RawText>
        <List>
          {TIERS.map((tier, i) => (
            <ListItem
              key={tier.id}
              checkbox
              checked={localTiers.has(tier.id)}
              checkColor={tier.color}
              leading={<TierBadge tier={tier.id} variant="pill" size="sm" />}
              title={t(`tier.${tier.id}.name`)}
              subtitleInline
              onPress={() => toggleTier(tier.id)}
              last={i === TIERS.length - 1}
            />
          ))}
        </List>
      </View>

      <ButtonRow
        style={styles.sheetActions}
        left={{ title: t('wordList.reset'), onPress: onReset }}
        right={{ title: t('wordList.apply'), variant: 'primary', onPress: () => onApply(localSort, localTiers) }}
      />
    </Sheet>
  );
}

// Shared "Create new deck…" row (dashed tile + label) — Custom Decks (sticky) + Add-to-Deck.
function CreateNewDeckRow({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable style={({ pressed }) => [styles.createNewRow, pressed && { opacity: 0.6 }]} onPress={onPress} accessibilityRole="button">
      <View style={styles.createNewTile}>
        <RawText style={styles.createNewPlus}>+</RawText>
      </View>
      <RawText style={styles.createNewText}>{t('wordList.createNewDeck')}</RawText>
    </Pressable>
  );
}

// W-07 — Premium gate for Custom Decks (free users).
function PremiumGate() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <View style={styles.gate}>
      <View style={styles.gateLock}>
        <IconLock size={28} color={theme.palette.amber[600]} />
      </View>
      <RawText style={styles.gateTitle}>{t('wordList.premiumTitle')}</RawText>
      <RawText style={styles.gateBody}>{t('wordList.premiumBody')}</RawText>
      <Pressable style={({ pressed }) => [styles.gateBtn, pressed && { opacity: 0.9 }]} accessibilityRole="button" onPress={() => router.push('/paywall')}>
        <RawText style={styles.gateBtnText}>{t('wordList.unlockPremium')}</RawText>
      </Pressable>
      <RawText style={styles.gatePricing}>{t('wordList.premiumPricing')}</RawText>
    </View>
  );
}

// Shared word-picker list (checkbox rows) used by Create/Deck-detail sheets: SearchBar +
// filtered word ListItems. Built-in empty state (no matches / no words).
function WordPicker({
  words,
  selected,
  onToggle,
}: {
  words: WordListItem[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [pickerQuery, setPickerQuery] = useState('');
  const filtered = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return q === '' ? words : words.filter((w) => w.native.toLowerCase().includes(q) || w.target.toLowerCase().includes(q));
  }, [words, pickerQuery]);
  // Selected-gutter: selected items rise to the top, separated from the rest.
  const gutter = filtered.filter((w) => selected.has(w.id));
  const rest = filtered.filter((w) => !selected.has(w.id));
  const renderItem = (w: WordListItem) => {
    const tier = getTierByStability(w.stability);
    return (
      <ListItem
        key={w.id}
        checkbox
        checked={selected.has(w.id)}
        checkColor={tier.color}
        leading={<TierBadge tier={tier.id} variant="pill" size="sm" />}
        title={w.native}
        subtitle={w.target}
        subtitleInline
        compact
        onPress={() => onToggle(w.id)}
      />
    );
  };
  return (
    <>
      <SearchBar value={pickerQuery} onChange={setPickerQuery} placeholder={t('wordList.filterPlaceholder')} style={styles.pickerSearch} />
      {/* Sticky selected-gutter: never scrolls out of view; caps at ~5 rows then scrolls. */}
      {gutter.length > 0 && (
        <View style={styles.gutter}>
          <ScrollView style={styles.gutterScroll} nestedScrollEnabled showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {gutter.map(renderItem)}
          </ScrollView>
          <View style={styles.gutterDivider} />
        </View>
      )}
      <List
        scroll
        style={styles.pickerList}
        isEmpty={filtered.length === 0}
        emptyTitle={words.length === 0 ? t('wordList.pickerEmptyTitle') : t('wordList.noMatch')}
        emptyBody={words.length === 0 ? t('wordList.pickerEmptyBody') : undefined}
      >
        {rest.map(renderItem)}
      </List>
    </>
  );
}

// W-05 — Create custom deck: name + word selection (initialWord pre-selects + pins).
function CreateDeckSheet({ visible, words, initialWord, onClose, onCreate }: { visible: boolean; words: WordListItem[]; initialWord: WordListItem | null; onClose: () => void; onCreate: (name: string, ids: string[]) => void }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setName('');
      setSelected(new Set(initialWord ? [initialWord.id] : []));
    }
  }
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const canCreate = name.trim() !== '' && selected.size > 0;
  return (
    <Sheet visible={visible} onClose={onClose} title={t('wordList.createDeckTitle')}>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder={t('wordList.deckNamePlaceholder')}
        placeholderTextColor={theme.color.textMuted}
        style={[styles.deckNameInput, { fontFamily: theme.fonts.sans.medium, color: theme.color.textStrong }]}
      />
      <RawText style={styles.pickerLabel}>{t('wordList.selectWords', { count: selected.size })}</RawText>
      <WordPicker words={words} selected={selected} onToggle={toggle} />
      <View style={styles.pickerCta}>
        <Button title={t('wordList.create')} variant="primary" disabled={!canCreate} onPress={() => canCreate && onCreate(name.trim(), [...selected])} />
      </View>
    </Sheet>
  );
}

// W-06 — Deck detail: stats (Words · Reviews · Created) + tier-ordered word list (press →
// word detail, swipe → remove) + Delete/Study footer. Membership isn't modeled in the mock,
// so it shows a tier-sorted slice of the library as stand-in contents.
function DeckDetailSheet({
  deck,
  words,
  removed,
  removedFromDeck,
  onClose,
  onStudy,
  onDelete,
  onWordPress,
  onRemoveWord,
}: {
  deck: DeckSummary | null;
  words: WordListItem[];
  removed: string[];
  removedFromDeck: Set<string>;
  onClose: () => void;
  onStudy: () => void;
  onDelete: (d: DeckSummary) => void;
  onWordPress: (w: WordListItem) => void;
  onRemoveWord: (deck: DeckSummary, w: WordListItem) => void;
}) {
  const { t } = useTranslation();
  const deckWords = useMemo(() => {
    if (deck == null) return [];
    return words
      .slice(0, deck.wordCount)
      .filter((w) => !removed.includes(w.id)) // globally deleted words drop from the deck too
      .filter((w) => !removedFromDeck.has(`${deck.id}|${w.id}`))
      .sort((a, b) => a.stability - b.stability); // tier low → high
  }, [deck, words, removed, removedFromDeck]);
  return (
    <Sheet visible={deck != null} onClose={onClose} title={deck?.name}>
      {deck != null && (
        <>
          <DetailStats
            style={styles.deckStats}
            items={[
              { label: t('wordList.deckWordsLabel'), value: String(deck.wordCount) },
              { label: t('wordList.deckReviewsLabel'), value: String(deck.reviews) },
              { label: t('wordList.deckLastReviewedLabel'), value: deck.lastReviewedAt != null ? addedLabel(deck.lastReviewedAt, t) : t('wordList.lastReviewedNever') },
            ]}
          />
          <List scroll style={styles.deckWordScroll} isEmpty={deckWords.length === 0} emptyTitle={t('wordList.deckEmptyTitle')} emptyBody={t('wordList.deckEmptyBody')}>
            {deckWords.map((w) => (
              <WordRow key={w.id} word={{ native: w.native, target: w.target, stability: w.stability }} onPress={() => onWordPress(w)} onRemoveFromDeck={() => onRemoveWord(deck, w)} />
            ))}
          </List>
          <ButtonRow
            style={styles.pickerCta}
            left={{ title: t('wordList.deleteDeck'), variant: 'destructive', onPress: () => onDelete(deck) }}
            right={{ title: t('wordList.studyDeck'), variant: 'primary', onPress: onStudy }}
          />
        </>
      )}
    </Sheet>
  );
}

// W-08 — Add a word to a deck (icon-slot deck rows). "Create new deck…" shows only when
// the user has no decks yet.
function AddToDeckSheet({
  word,
  decks,
  added,
  onAdd,
  onCreateNew,
  onClose,
}: {
  word: WordListItem | null;
  decks: DeckSummary[];
  added: Set<string>;
  onAdd: (w: WordListItem, d: DeckSummary) => void;
  onCreateNew: () => void;
  onClose: () => void;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  return (
    <Sheet visible={word != null} onClose={onClose} title={t('wordList.addToDeckTitle')}>
      {word != null && (
        <>
          <RawText style={styles.addToDeckSub}>{`${word.native} · ${word.target}`}</RawText>
          {decks.length === 0 ? (
            <CreateNewDeckRow onPress={onCreateNew} />
          ) : (
            <List>
              {decks.map((d) => {
                const inDeck = added.has(`${d.id}|${word.id}`);
                return (
                  <ListItem
                    key={d.id}
                    leading={
                      <View style={styles.deckIconTile}>
                        <IconList size={16} color={theme.color.brand} />
                      </View>
                    }
                    title={d.name}
                    subtitle={t('deckRow.words', { count: d.wordCount })}
                    disabled={inDeck}
                    onPress={() => onAdd(word, d)}
                    trailing={inDeck ? <RawText style={styles.alreadyAdded}>{t('wordList.alreadyAdded')}</RawText> : undefined}
                  />
                );
              })}
            </List>
          )}
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, fonts, palette } = theme;
  return {
    header: { paddingHorizontal: 16, paddingTop: 4 },
    titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 },
    title: { fontFamily: fonts.sans.extra, fontSize: 22, letterSpacing: -0.3, color: color.textStrong },
    count: { fontFamily: fonts.sans.medium, fontSize: 13, color: color.textMuted },
    // Matches the Custom Decks "Create new deck" container height/gap (both ~64px, bordered).
    searchUnderTabs: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: theme.borderWidth.thin, borderBottomColor: color.divider },

    listContent: { paddingBottom: 16 },
    empty: { paddingTop: 64 },
    proBadge: { backgroundColor: palette.amber[100], borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 },
    proBadgeText: { fontFamily: fonts.sans.bold, fontSize: 9, letterSpacing: 0.3, color: palette.amber[800] },

    // decks tab
    decksBody: { flex: 1 },
    stickyCreate: { paddingHorizontal: 16, borderBottomWidth: theme.borderWidth.thin, borderBottomColor: color.divider },
    decksList: { paddingBottom: 20 },
    gutter: {},
    gutterScroll: { maxHeight: 190 },
    gutterDivider: { height: 1.5, backgroundColor: color.borderStrong, marginTop: 2, marginBottom: 4, borderRadius: 1 },
    deckStats: { marginBottom: 14 },
    deckWordScroll: { maxHeight: 340 },
    decksEmpty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 24 },
    decksEmptyTitle: { fontFamily: fonts.serif.semibold, fontSize: 18, color: color.textStrong, marginBottom: 6 },
    decksEmptyBody: { fontFamily: fonts.sans.regular, fontSize: 14, color: color.textMuted, textAlign: 'center' },
    gate: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 48 },
    gateLock: { width: 64, height: 64, borderRadius: 32, backgroundColor: palette.amber[100], alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
    gateTitle: { fontFamily: fonts.sans.bold, fontSize: 17, color: color.textStrong, marginBottom: 8 },
    gateBody: { fontFamily: fonts.sans.regular, fontSize: 14, lineHeight: 22, color: color.textMuted, textAlign: 'center', marginBottom: 28, maxWidth: 280 },
    gateBtn: { backgroundColor: color.accent, borderRadius: theme.radius.md, paddingVertical: 13, paddingHorizontal: 32, boxShadow: theme.shadow.accent },
    gateBtnText: { fontFamily: fonts.sans.bold, fontSize: 15, color: '#fff' },
    gatePricing: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textFaint, marginTop: 12 },

    // create / detail / add-to-deck
    deckNameInput: { borderWidth: theme.borderWidth.base, borderColor: color.border, borderRadius: theme.radius.md, paddingHorizontal: 14, height: 48, fontSize: 16, marginBottom: 14 },
    pickerLabel: { fontFamily: fonts.sans.bold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: color.textMuted, marginBottom: 8 },
    pickerSearch: { marginBottom: 8 },
    pickerList: { maxHeight: 320 },
    pickerCta: { marginTop: 14 },
    addToDeckSub: { fontFamily: fonts.sans.regular, fontSize: 13, color: color.textMuted, marginBottom: 12, marginTop: -6 },
    deckIconTile: { width: 38, height: 38, borderRadius: 9, backgroundColor: palette.blue[50], borderWidth: theme.borderWidth.thin, borderColor: palette.blue[200], alignItems: 'center', justifyContent: 'center' },
    alreadyAdded: { fontFamily: fonts.sans.semibold, fontSize: 11, color: color.brand },
    createNewRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 0 },
    createNewTile: { width: 38, height: 38, borderRadius: 9, borderWidth: 1.5, borderColor: palette.slate[300], borderStyle: 'dashed', backgroundColor: palette.slate[50], alignItems: 'center', justifyContent: 'center' },
    createNewPlus: { fontFamily: fonts.sans.regular, fontSize: 20, color: color.textMuted, lineHeight: 22 },
    createNewText: { fontFamily: fonts.sans.semibold, fontSize: 14, color: color.brand },
    noMatch: { paddingVertical: 48, paddingHorizontal: 24, alignItems: 'center' },
    noMatchText: { fontFamily: fonts.sans.regular, fontSize: 15, color: color.textMuted },

    // Filter/sort sheet
    sheetSection: { paddingTop: 6 },
    sheetLabel: { fontFamily: fonts.sans.bold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: color.textMuted, marginBottom: 6 },
    sheetHint: { fontFamily: fonts.sans.regular, fontSize: 10, letterSpacing: 0, textTransform: 'none', color: color.textFaint },
    optionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: theme.borderWidth.thin, borderBottomColor: color.divider },
    optionLabel: { fontFamily: fonts.sans.regular, fontSize: 14, color: color.textBody },
    radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.color.brand },
    checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    sheetActions: { flexDirection: 'row', gap: 10, paddingTop: 16 },
  };
});
