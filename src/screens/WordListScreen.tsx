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
import { FlatList, Pressable, ScrollView, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { useActiveLang, useDecks, useDeleteCard, useEntitlement, useSetCardSuspended, useWords } from '@/query/hooks';
import type { DeckSummary, WordListItem } from '@/data/DataSource';
import { addedLabel } from '@/lib/relativeTime';
import { useDeferredReady } from '@/lib/useDeferredReady';
import { LanguageIndicator } from '@/screens/shared/LanguageSwitcher';
import { useUiStore } from '@/store/uiStore';
import { tourTargets } from '@/tour/walkthrough';
import { getTierByStability, TIERS, type TierId } from '@/theme/tiers';

import {
  Button,
  ButtonRow,
  IconArrowDown,
  IconArrowUp,
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
  Toggle,
  WordDetailSheet,
  WordRow,
} from '@/ui';

// 18-session sort model (Casey): three DIMENSIONS, each with a direction toggle.
// The old flat radio list (incl. the tier sort) is gone — "memory strength"
// covers it more honestly (weakest = due soonest = what needs attention).
type SortDim = 'added' | 'strength' | 'alpha';
export interface SortSel {
  dim: SortDim;
  /** Direction index into the dimension's two labels (0 = first). */
  dir: 0 | 1;
}
const DEFAULT_SORT: SortSel = { dim: 'added', dir: 0 }; // newest first
const sameSort = (a: SortSel, b: SortSel) => a.dim === b.dim && a.dir === b.dir;

function sortWords(list: WordListItem[], sel: SortSel): WordListItem[] {
  const arr = [...list];
  switch (sel.dim) {
    case 'strength': // weakest = due soonest (needs attention) ↔ strongest
      return arr.sort((a, b) => (sel.dir === 0 ? a.dueAt.getTime() - b.dueAt.getTime() : b.dueAt.getTime() - a.dueAt.getTime()));
    case 'alpha': // by the TARGET word — the bold lead column the user scans
      return arr.sort((a, b) => (sel.dir === 0 ? a.target.localeCompare(b.target) : b.target.localeCompare(a.target)));
    default: // added
      return arr.sort((a, b) => (sel.dir === 0 ? b.createdAt.getTime() - a.createdAt.getTime() : a.createdAt.getTime() - b.createdAt.getTime()));
  }
}

export function WordListScreen() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const router = useRouter();
  const showToast = useUiStore((s) => s.showToast);
  const { words, isLoading: wordsLoading } = useWords();
  const deleteCard = useDeleteCard();
  const setSuspended = useSetCardSuspended();
  const { decks, isLoading: decksLoading } = useDecks();
  const { isPaid } = useEntitlement();

  const [subTab, setSubTab] = useState<'words' | 'decks'>('words');
  // Paint-first traversal: false on mount + for the frame after a tab switch,
  // true once interactions settle — heavy lists render behind a skeleton.
  const contentReady = useDeferredReady(subTab);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortSel>(DEFAULT_SORT);
  const [filterTiers, setFilterTiers] = useState<Set<TierId>>(new Set());
  // 18 §E3: false = active words (default); true = the archived shelf.
  const [showArchived, setShowArchived] = useState(false);
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

  // Language switch: every optimistic overlay above references card/deck ids of
  // the PREVIOUS language — carrying them over corrupts counts (the "-3 words"
  // bug) and filters. Render-adjust reset on activeLang change.
  const activeLang = useActiveLang();
  const [prevLang, setPrevLang] = useState(activeLang);
  if (prevLang !== activeLang) {
    setPrevLang(activeLang);
    setRemoved([]);
    setExtraDecks([]);
    setRemovedFromDeck(new Set());
    setAdded(new Set());
    setRemovedDecks([]);
    setQuery('');
    setShowArchived(false);
  }

  const allDecks = [...decks, ...extraDecks].filter((d) => !removedDecks.includes(d.id));

  const openCreate = (initialWord: WordListItem | null = null) => {
    setCreateInitialWord(initialWord);
    setCreateOpen(true);
  };
  const deleteDeck = (d: DeckSummary) => {
    setRemovedDecks((r) => [...r, d.id]);
    setExtraDecks((e) => e.filter((x) => x.id !== d.id));
  };

  const filterActive = !sameSort(sortBy, DEFAULT_SORT) || filterTiers.size > 0 || showArchived;

  // E3: archive/unarchive — no confirm (fully reversible), toast states the effect.
  const toggleArchive = (w: WordListItem) => {
    const next = !w.suspended;
    setSuspended.mutate(
      { cardId: w.id, suspended: next },
      {
        onSuccess: () =>
          showToast({ variant: 'success', message: next ? t('wordList.archivedToast', { word: w.target }) : t('wordList.unarchivedToast', { word: w.target }) }),
      },
    );
    setDetailWord(null);
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = words
      .filter((w) => w.suspended === showArchived) // E3: active list vs archived shelf
      .filter((w) => !removed.includes(w.id))
      .filter((w) => q === '' || w.native.toLowerCase().includes(q) || w.target.toLowerCase().includes(q))
      .filter((w) => filterTiers.size === 0 || filterTiers.has(getTierByStability(w.stability).id));
    return sortWords(filtered, sortBy);
  }, [words, removed, query, filterTiers, sortBy, showArchived]);

  // Count = ALL saved words, archived included (Casey ruling, post-E3): archiving
  // a mastered word removes it from lists/reviews, never from what you've earned —
  // tier counts and this header stay whole.
  const savedCount = words.length - removed.length;
  const noneSaved = savedCount === 0;

  return (
    <Screen edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <RawText style={styles.title}>{t('wordList.title')}</RawText>
          <View style={styles.titleRight}>
            <LanguageIndicator compact />
            <RawText style={styles.count}>
              {subTab === 'words' ? t('wordList.count', { count: savedCount }) : t('wordList.deckCount', { count: allDecks.length })}
            </RawText>
          </View>
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
        /* 18 §F2: walkthrough anchor (w4 — search/filter/details toolbar). */
        <View ref={(node) => { tourTargets.wordsToolbar.current = node; }} collapsable={false}>
          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder={t('wordList.searchPlaceholder')}
            onFilter={() => setFilterOpen(true)}
            filterActive={filterActive}
            style={styles.searchUnderTabs}
          />
        </View>
      )}

      {/* Words tab. `contentReady` gates the HEAVY mounts (18-session perf fix):
          the press paints the tab traversal + skeleton this frame; the list
          mounts right after interactions settle. */}
      {subTab === 'words' &&
        (wordsLoading || !contentReady ? (
          <SkeletonRows />
        ) : noneSaved && !showArchived ? (
          <EmptyState title={t('wordList.emptyTitle')} body={t('wordList.emptyBody')} style={styles.empty} />
        ) : visible.length === 0 ? (
          <View style={styles.noMatch}>
            <RawText style={styles.noMatchText}>{showArchived ? t('wordList.archivedEmpty') : t('wordList.noMatch')}</RawText>
          </View>
        ) : (
          // Virtualized (18 §2b perf guardrail): rows mount lazily instead of
          // all-at-once — a plain ScrollView built every swipeable row
          // synchronously, which is what made tab traversal feel stuck.
          <FlatList
            data={visible}
            keyExtractor={(w) => w.id}
            renderItem={({ item: w }) => (
              <WordRow
                word={{ native: w.native, target: w.target, stability: w.stability, dueAt: w.dueAt, reps: w.reps, suspended: w.suspended }}
                isPremium={isPaid}
                onPress={() => setDetailWord(w)}
                onDelete={() => setPendingDelete(w)}
                onAddToDeck={() => (isPaid ? setAddToDeckWord(w) : setSubTab('decks'))}
                onToggleArchive={() => toggleArchive(w)}
              />
            )}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={7}
          />
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
            {decksLoading || !contentReady ? (
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
        showArchived={showArchived}
        onClose={() => setFilterOpen(false)}
        onApply={(s, tiers, archived) => {
          setSortBy(s);
          setFilterTiers(tiers);
          setShowArchived(archived);
          setFilterOpen(false);
        }}
        onReset={() => {
          setSortBy(DEFAULT_SORT);
          setFilterTiers(new Set());
          setShowArchived(false);
          setFilterOpen(false);
        }}
      />

      {/* W-03 — Word detail */}
      <WordDetailSheet
        word={detailWord}
        onClose={() => setDetailWord(null)}
        onToggleArchive={toggleArchive}
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
            // Optimistic removal (also carries mock mode) + the REAL delete
            // (A12b — delete_card RPC cascades FSRS state). No Undo: the study
            // history is gone with the card, and offering to bring it back
            // would be dishonest. The confirm dialog is the safety.
            setRemoved((r) => [...r, w.id]);
            deleteCard.mutate(w.id, {
              onError: () => {
                setRemoved((r) => r.filter((id) => id !== w.id));
                showToast({ variant: 'destructive', message: t('wordList.deleteFailed', { word: w.native }) });
              },
            });
            showToast({
              variant: 'destructive',
              message: t('wordList.wordDeleted', { word: w.native }),
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

// W-02 — Filter & Sort bottom sheet (reworked, 18-session): sort DIMENSION rows,
// each carrying its own inline direction toggle — tapping a direction selects
// the dimension AND the direction in one gesture; tapping the row selects the
// dimension keeping its last direction. Tier filter (multi-select) unchanged.
function FilterSortSheet({
  visible,
  sortBy,
  filterTiers,
  showArchived,
  onClose,
  onApply,
  onReset,
}: {
  visible: boolean;
  sortBy: SortSel;
  filterTiers: Set<TierId>;
  showArchived: boolean;
  onClose: () => void;
  onApply: (sortBy: SortSel, tiers: Set<TierId>, showArchived: boolean) => void;
  onReset: () => void;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const [localSort, setLocalSort] = useState<SortSel>(sortBy);
  const [localTiers, setLocalTiers] = useState<Set<TierId>>(new Set(filterTiers));
  const [localArchived, setLocalArchived] = useState(showArchived);

  // Re-sync local state each time the sheet opens.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setLocalSort(sortBy);
      setLocalTiers(new Set(filterTiers));
      setLocalArchived(showArchived);
    }
  }

  const toggleTier = (id: TierId) =>
    setLocalTiers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sortDims: { dim: SortDim; label: string; dirs: [string, string] }[] = [
    { dim: 'added', label: t('wordList.sortDimAdded'), dirs: [t('wordList.dirNewest'), t('wordList.dirOldest')] },
    { dim: 'strength', label: t('wordList.sortDimStrength'), dirs: [t('wordList.dirWeakest'), t('wordList.dirStrongest')] },
    { dim: 'alpha', label: t('wordList.sortDimAlpha'), dirs: [t('wordList.dirAZ'), t('wordList.dirZA')] },
  ];

  return (
    <Sheet visible={visible} onClose={onClose} title={t('wordList.filterSortTitle')}>
      <View style={styles.sheetSection}>
        <RawText style={styles.sheetLabel}>{t('wordList.sortBy')}</RawText>
        <RawText style={styles.sortHint}>{t('wordList.sortHint')}</RawText>
        {/* Drive-pattern sort (18-session refactor): tap a row to select its
            dimension; tap the SELECTED row again to reverse — the direction
            pill (↓/↑ + label) appears only on the active row, so one row =
            one control with progressive disclosure instead of 3×2 pills. */}
        {sortDims.map(({ dim, label, dirs }) => {
          const on = localSort.dim === dim;
          const dirLabel = dirs[on ? localSort.dir : 0];
          return (
            <Pressable
              key={dim}
              onPress={() =>
                setLocalSort((cur) => (cur.dim === dim ? { dim, dir: cur.dir === 0 ? 1 : 0 } : { dim, dir: 0 }))
              }
              style={styles.optionRow}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={on ? t('wordList.sortA11yActive', { dim: label, dir: dirLabel }) : t('wordList.sortA11yInactive', { dim: label })}
            >
              <View style={[styles.radio, { borderColor: on ? theme.color.brand : theme.palette.slate[300] }]}>
                {on && <View style={styles.radioDot} />}
              </View>
              <RawText style={[styles.optionLabel, on && styles.optionLabelOn]}>{label}</RawText>
              {on && (
                // Dual brand colors signal the direction at a glance (Casey):
                // dir 0 (Newest / Weakest / A–Z) wears base-camp green; dir 1
                // (Oldest / Strongest / Z–A) wears brand ember — the color flip
                // doubles the toggle feedback.
                <Animated.View
                  key={`dir-${localSort.dir}`}
                  entering={FadeIn.duration(140)}
                  style={[
                    styles.sortDirPill,
                    localSort.dir === 0
                      ? { backgroundColor: theme.color.evergreenTint, borderColor: theme.color.evergreenSoft }
                      : { backgroundColor: theme.palette.amber[50], borderColor: theme.palette.amber[200] },
                  ]}
                >
                  {localSort.dir === 0 ? (
                    <IconArrowDown size={12} color={theme.color.evergreen} />
                  ) : (
                    <IconArrowUp size={12} color={theme.color.accentStrong} />
                  )}
                  <RawText style={[styles.sortDirText, { color: localSort.dir === 0 ? theme.color.evergreen : theme.color.accentStrong }]}>
                    {dirLabel}
                  </RawText>
                </Animated.View>
              )}
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

      {/* E3: the archived shelf — words kept forever but excluded from reviews. */}
      <View style={styles.sheetSection}>
        <View style={styles.archivedRow}>
          <View style={styles.archivedText}>
            <RawText style={styles.sheetLabel}>{t('wordList.showArchived')}</RawText>
            <RawText style={styles.sheetHint}>{t('wordList.showArchivedHint')}</RawText>
          </View>
          <Toggle value={localArchived} onValueChange={setLocalArchived} />
        </View>
      </View>

      <ButtonRow
        style={styles.sheetActions}
        left={{ title: t('wordList.reset'), onPress: onReset }}
        right={{ title: t('wordList.apply'), variant: 'primary', onPress: () => onApply(localSort, localTiers, localArchived) }}
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
        // 18-session item 1.2: target-language word leads everywhere.
        title={w.target}
        subtitle={w.native}
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
        accessibilityLabel={t('wordList.deckNamePlaceholder')}
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
      // 18 §A4: implicit lists default to due-soonest — surface what needs review.
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
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
              <WordRow key={w.id} word={{ native: w.native, target: w.target, stability: w.stability, dueAt: w.dueAt, reps: w.reps }} onPress={() => onWordPress(w)} onRemoveFromDeck={() => onRemoveWord(deck, w)} />
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
    titleRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
    archivedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    archivedText: { flex: 1 },
    noMatch: { paddingVertical: 48, paddingHorizontal: 24, alignItems: 'center' },
    noMatchText: { fontFamily: fonts.sans.regular, fontSize: 15, color: color.textMuted },

    // Filter/sort sheet
    sheetSection: { paddingTop: 6 },
    sheetLabel: { fontFamily: fonts.sans.bold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: color.textMuted, marginBottom: 6 },
    sheetHint: { fontFamily: fonts.sans.regular, fontSize: 10, letterSpacing: 0, textTransform: 'none', color: color.textFaint },
    optionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: theme.borderWidth.thin, borderBottomColor: color.divider },
    optionLabel: { fontFamily: fonts.sans.regular, fontSize: 14, color: color.textBody },
    optionLabelOn: { fontFamily: fonts.sans.bold, color: color.textStrong },
    sortHint: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textFaint, marginBottom: 8 },
    sortDirPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: theme.borderWidth.thin, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
    sortDirText: { fontFamily: fonts.sans.semibold, fontSize: 12 },
    radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.color.brand },
    checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    sheetActions: { flexDirection: 'row', gap: 10, paddingTop: 16 },
  };
});
