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
import { FlatList, Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import {
  useActiveLang,
  useAddCardToDeck,
  useCardDeckIds,
  useCreateDeck,
  useDeckWords,
  useDecks,
  useDeleteCard,
  useDeleteDeck,
  useEntitlement,
  useRemoveCardFromDeck,
  useSetCardSuspended,
  useSetCardTargetOverride,
  useWords,
} from '@/query/hooks';
import { usePullToRefresh } from '@/query/usePullToRefresh';
import type { DeckSummary, WordListItem } from '@/data/DataSource';
import { addedLabel } from '@/lib/relativeTime';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
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
  EditTranslationSheet,
  EmptyOverlay,
  EmptyStateCard,
  GhostRows,
  IconList,
  IconLock,
  IconTrash,
  IllustEmptyDeck,
  IllustSearchEmpty,
  IllustWordCards,
  List,
  ListItem,
  RawText,
  Screen,
  SearchBar,
  SegmentedTabs,
  Sheet,
  TAB_BAR_FAB_OVERHANG,
  TierBadge,
  Toggle,
  WordDetailSheet,
  WordRow,
} from '@/ui';

/** Deck-write rejections (DeckWriteError) → user-facing copy. Anything
 *  unrecognised falls back to the generic failure line rather than leaking a
 *  Postgres message into the sheet. */
function deckErrorMessage(e: unknown, t: (k: string) => string): string {
  const token = e instanceof Error ? e.message : '';
  switch (token) {
    case 'deck_name_taken':
      return t('wordList.deckNameTaken');
    case 'deck_name_invalid':
      return t('wordList.deckNameInvalid');
    case 'deck_cap_reached':
      return t('wordList.deckCapReached');
    case 'premium_required':
      return t('wordList.deckPremiumRequired');
    case 'main_deck_undeletable':
      return t('wordList.deckMainUndeletable');
    case 'language_not_enrolled':
      return t('wordList.deckLanguageMissing');
    default:
      return t('wordList.deckActionFailed');
  }
}

// 18-session sort model (Casey): three DIMENSIONS, each with a direction toggle.
// The old flat radio list (incl. the tier sort) is gone.
//
// 'due' was called 'strength' / "Memory strength" until 2026-08-04. It always
// sorted by `dueAt` — the label was the lie. FSRS separates STABILITY (how
// durable the memory is) from RETRIEVABILITY (how likely recall is right now),
// and "memory strength" collapsed the two: a Summit-tier word with months of
// stability comes due on schedule without its memory being weak, so it sorted
// under a "Weakest" heading that flatly contradicted its own tier badge. The
// dimension now says what it does — next review, soonest ↔ latest.
type SortDim = 'added' | 'due' | 'alpha';
export interface SortSel {
  dim: SortDim;
  /** Direction index into the dimension's two labels (0 = first). */
  dir: 0 | 1;
}
const DEFAULT_SORT: SortSel = { dim: 'added', dir: 0 }; // newest first
const sameSort = (a: SortSel, b: SortSel) => a.dim === b.dim && a.dir === b.dir;
const sameTiers = (a: Set<TierId>, b: Set<TierId>) => a.size === b.size && [...a].every((id) => b.has(id));

function sortWords(list: WordListItem[], sel: SortSel): WordListItem[] {
  const arr = [...list];
  switch (sel.dim) {
    case 'due': // soonest (what's coming up) ↔ latest
      return arr.sort((a, b) => (sel.dir === 0 ? a.dueAt.getTime() - b.dueAt.getTime() : b.dueAt.getTime() - a.dueAt.getTime()));
    case 'alpha': // by the TARGET word — the bold lead column the user scans
      return arr.sort((a, b) => (sel.dir === 0 ? a.target.localeCompare(b.target) : b.target.localeCompare(a.target)));
    default: // added
      return arr.sort((a, b) => (sel.dir === 0 ? b.createdAt.getTime() - a.createdAt.getTime() : a.createdAt.getTime() - b.createdAt.getTime()));
  }
}

/** Every query this screen renders (prefixes — see usePullToRefresh). Both
 *  sub-tabs, because switching tabs is not a refresh. */
const WORDS_REFRESH_KEYS = ['words', 'decks', 'deckWords', 'cardDecks'] as const;

export function WordListScreen() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const router = useRouter();
  const showToast = useUiStore((s) => s.showToast);
  const { words, isLoading: wordsLoading } = useWords();
  const deleteCard = useDeleteCard();
  const setSuspended = useSetCardSuspended();
  const setTargetOverride = useSetCardTargetOverride();
  const { decks, isLoading: decksLoading } = useDecks();
  const { isPaid } = useEntitlement();

  const [subTab, setSubTab] = useState<'words' | 'decks'>('words');
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortSel>(DEFAULT_SORT);
  const [filterTiers, setFilterTiers] = useState<Set<TierId>>(new Set());
  // 18 §E3: false = active words (default); true = the archived shelf.
  const [showArchived, setShowArchived] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [detailWord, setDetailWord] = useState<WordListItem | null>(null);
  // Edit Translations (Premium, 2026-07-28). Free-tier taps route to the paywall
  // instead of opening the sheet — the server rejects the write anyway, and a
  // sheet that can only fail is worse than an honest upsell.
  const [editWord, setEditWord] = useState<WordListItem | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WordListItem | null>(null);
  // Optimistic removal until the real delete mutation (03 write) lands.
  const [removed, setRemoved] = useState<string[]>([]);
  // Decks (W-04…W-08). Membership is SERVER state as of 2026-07-30 — the
  // optimistic overlays that used to live here (`extraDecks`, `added`,
  // `removedFromDeck`, `removedDecks`) were the entire feature: decks created
  // in-session vanished on reload, "Already added" was a Set no write ever
  // populated, and deck contents were a positional slice of the library.
  const [createOpen, setCreateOpen] = useState(false);
  const [createInitialWord, setCreateInitialWord] = useState<WordListItem | null>(null);
  const [detailDeck, setDetailDeck] = useState<DeckSummary | null>(null);
  const [addToDeckWord, setAddToDeckWord] = useState<WordListItem | null>(null);
  const [pendingDeckDelete, setPendingDeckDelete] = useState<DeckSummary | null>(null);
  const [deckWordDetail, setDeckWordDetail] = useState<WordListItem | null>(null);
  const [pendingRemove, setPendingRemove] = useState<{ deck: DeckSummary; word: WordListItem } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const createDeck = useCreateDeck();
  const deleteDeck = useDeleteDeck();
  const addCardToDeck = useAddCardToDeck();
  const removeCardFromDeck = useRemoveCardFromDeck();

  // Language switch: the optimistic overlays below reference card ids of the
  // PREVIOUS language — carrying them over corrupts counts (the "-3 words" bug)
  // and filters. Render-adjust reset on activeLang change. Deck state is no
  // longer in this list: those queries are keyed by activeLang and refetch.
  const refresh = usePullToRefresh(WORDS_REFRESH_KEYS);
  const refreshControl = <RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} tintColor={theme.color.textMuted} />;

  const activeLang = useActiveLang();
  const [prevLang, setPrevLang] = useState(activeLang);
  if (prevLang !== activeLang) {
    setPrevLang(activeLang);
    setRemoved([]);
    // These five hold card/deck ids from the PREVIOUS language and now drive real
    // server writes: a "Delete Food?" dialog left open across a switch would
    // delete the OTHER language's deck on confirm, with nothing visibly wrong.
    setPendingDeckDelete(null);
    setDetailDeck(null);
    setAddToDeckWord(null);
    setPendingRemove(null);
    setDeckWordDetail(null);
    setQuery('');
    setShowArchived(false);
  }

  const allDecks = decks;

  const openCreate = (initialWord: WordListItem | null = null) => {
    setCreateInitialWord(initialWord);
    setCreateOpen(true);
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

  // Edit Translations entry point, shared by both word-detail sheets (the ⋮).
  // Deliberately NOT in the row's swipe tray — Casey, 2026-07-28: a 4th action
  // made the tray read as clutter. Premium-gated HERE (the RPC re-checks
  // server-side).
  const openEditTranslation = (w: WordListItem) => {
    setEditError(null);
    if (!isPaid) {
      router.push('/paywall');
      return;
    }
    setEditWord(w);
  };

  // The optimistic-delete overlay, applied ONCE. Everything that counts or
  // renders words derives from this array — see `savedCount` for why.
  const present = useMemo(() => words.filter((w) => !removed.includes(w.id)), [words, removed]);

  // ── Deferred filtering (perf, 2026-08-05) ──────────────────────────────────
  // Filtering and sorting a 4,000-word library is real JS-thread work, and it
  // used to run in the SAME commit as the tap that changed a filter — so the
  // sheet's Apply, and the tab traversal into this screen, both froze until it
  // finished. Nothing could paint in between, because `visible` recomputed
  // before React could show a skeleton.
  //
  // Split the inputs in two: `query`/`sortBy`/`filterTiers`/`showArchived` are
  // what the CONTROLS show and update instantly; `applied` is what the LIST
  // computes from, and it only catches up once the frame has painted. The gap
  // is the skeleton — so a filter change is now: tap → skeleton this frame →
  // list next tick, instead of a stalled thread.
  //
  // SEARCH is debounced on top of that (2026-08-05). `query` was in this key, so
  // every keystroke changed it, blanked the list to a skeleton and rebuilt —
  // typing "mountain" flashed the skeleton eight times. The KEY now reads the
  // settled term, so a burst of typing costs one rebuild at the end instead of
  // one per character. The input below still binds to raw `query`, so the text
  // field itself never lags a keypress.
  const settledQuery = useDebouncedValue(query);
  // True while the user is mid-word: results on screen are for an older term.
  const searchPending = settledQuery.trim().toLowerCase() !== query.trim().toLowerCase();
  const pendingKey = `${subTab}|${settledQuery.trim().toLowerCase()}|${sortBy.dim}${sortBy.dir}|${[...filterTiers].sort().join(',')}|${showArchived}`;
  // False in the render where the key changes, true once interactions settle.
  const contentReady = useDeferredReady(pendingKey);
  const [applied, setApplied] = useState({ key: pendingKey, query: settledQuery, sortBy, filterTiers, showArchived });
  // Render-adjust (the repo's no-setState-in-effect rule): adopt the pending
  // inputs on the first ready render after they changed.
  if (contentReady && applied.key !== pendingKey) {
    setApplied({ key: pendingKey, query: settledQuery, sortBy, filterTiers, showArchived });
  }

  // While the debounce settles, the rows on screen answer the PREVIOUS term. Dim
  // them rather than swapping in a skeleton: the list keeps its scroll position
  // and its height, so nothing jumps, and the fade reads as "catching up" rather
  // than "reloading". 120ms on the way out, 160ms back — quick to acknowledge
  // the keystroke, unhurried on the way back so it never strobes mid-word.
  const staleStyle = useAnimatedStyle(() => ({
    opacity: withTiming(searchPending ? 0.45 : 1, { duration: searchPending ? 120 : 160 }),
  }));

  const visible = useMemo(() => {
    const q = applied.query.trim().toLowerCase();
    const filtered = present
      .filter((w) => w.suspended === applied.showArchived) // E3: active list vs archived shelf
      .filter((w) => q === '' || w.native.toLowerCase().includes(q) || w.target.toLowerCase().includes(q))
      .filter((w) => applied.filterTiers.size === 0 || applied.filterTiers.has(getTierByStability(w.stability).id));
    return sortWords(filtered, applied.sortBy);
  }, [present, applied]);

  // Count = ALL saved words, archived included (Casey ruling, post-E3): archiving
  // a mastered word removes it from lists/reviews, never from what you've earned —
  // tier counts and this header stay whole.
  //
  // Counted from `present`, NOT `words.length - removed.length` (Casey bug,
  // 2026-08-04). `removed` is an optimistic overlay that is never cleared on
  // success, so once the delete lands and ['words'] refetches WITHOUT the row,
  // the subtraction charged for the same delete twice: 3 words minus 1 read as
  // 1 while the list rendered 2, and 2 words minus 1 read as 0 — which tripped
  // `noneSaved` and swapped the whole list for the empty state, i.e. deleting
  // one word appeared to delete every word. Deriving both numbers from one
  // array makes the header and the rows structurally unable to disagree.
  const savedCount = present.length;
  const noneSaved = savedCount === 0;

  return (
    <Screen edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <RawText style={styles.title}>{t('wordList.title')}</RawText>
          {/* Count first, toggle LAST — the language switcher holds the same
              trailing slot on every screen (2026-08-04). */}
          <View style={styles.titleRight}>
            <RawText style={styles.count}>
              {subTab === 'words' ? t('wordList.count', { count: savedCount }) : t('wordList.deckCount', { count: allDecks.length })}
            </RawText>
            <LanguageIndicator compact />
          </View>
        </View>
        <SegmentedTabs
          active={subTab}
          onChange={(id) => setSubTab(id as 'words' | 'decks')}
          tabs={[
            // Maestro hooks. SegmentedTabs sets accessibilityRole="tab" but no
            // explicit label, so the visible text IS reachable — the ids are
            // here for the same reason as `tab-<id>` on the bottom bar: they
            // survive localization, and "All Words" is not a string this flow
            // should have to keep in sync with copy.
            { id: 'words', label: t('wordList.tabAllWords'), testID: 'words-tab-all' },
            {
              id: 'decks',
              label: t('wordList.tabCustomDecks'),
              testID: 'words-tab-decks',
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
            testID="words-search-input"
            filterTestID="words-filter"
            style={styles.searchUnderTabs}
          />
        </View>
      )}

      {/* Words tab. `contentReady` gates the HEAVY mounts (18-session perf fix):
          the press paints the tab traversal + skeleton this frame; the list
          mounts right after interactions settle. */}
      {subTab === 'words' &&
        (wordsLoading || !contentReady ? (
          // PULSING ghosts — genuinely heavy work: first load, tab traversal, a
          // filter apply. NOT for typing: with the debounce above, a keystroke no
          // longer reaches this branch, so the list stays put and merely dims.
          <GhostRows variant="word" animated />
        ) : noneSaved && !showArchived ? (
          // STATIC ghosts under the card: the library is confirmed empty, and the
          // silhouettes show what a filled list looks like. Same shape, no pulse.
          <EmptyOverlay ghost={<GhostRows variant="word" count={14} />} style={styles.emptyFill}>
            <EmptyStateCard illustration={<IllustWordCards />} title={t('wordList.emptyTitle')} body={t('wordList.emptyBody')} />
          </EmptyOverlay>
        ) : visible.length === 0 ? (
          // A filtered-to-nothing list is NOT an empty library — no ghosts here,
          // or the user would read it as having lost their words.
          <EmptyStateCard
            style={styles.emptyPad}
            illustration={showArchived ? undefined : <IllustSearchEmpty />}
            title={showArchived ? t('wordList.archivedEmptyTitle') : t('wordList.noMatch')}
            body={showArchived ? t('wordList.archivedEmptyBody') : t('wordList.noMatchBody')}
          />
        ) : (
          // Virtualized (18 §2b perf guardrail): rows mount lazily instead of
          // all-at-once — a plain ScrollView built every swipeable row
          // synchronously, which is what made tab traversal feel stuck.
          <Animated.View style={[styles.listFill, staleStyle]} pointerEvents={searchPending ? 'none' : 'auto'}>
          <FlatList
            data={visible}
            refreshControl={refreshControl}
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
          </Animated.View>
        ))}

      {/* Decks tab (W-04 / W-07) */}
      {subTab === 'decks' &&
        (!isPaid ? (
          <PremiumGate />
        ) : (
          <View style={styles.decksBody}>
            {/* Sticky "Create new deck" — consistent with the Add-to-Deck sheet; never scrolls. */}
            <View style={styles.stickyCreate}>
              <CreateNewDeckRow testID="deck-create-open" onPress={() => openCreate()} />
            </View>
            {decksLoading || !contentReady ? (
              <GhostRows variant="deck" count={3} animated />
            ) : allDecks.length === 0 ? (
              // Deliberately more rows than fit — EmptyOverlay clips, so the
              // silhouettes run off the bottom the way a real deck list would.
              <EmptyOverlay ghost={<GhostRows variant="deck" count={12} />} style={styles.emptyFill}>
                <EmptyStateCard illustration={<IllustEmptyDeck />} title={t('wordList.decksEmptyTitle')} body={t('wordList.decksEmptyBody')} />
              </EmptyOverlay>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} refreshControl={refreshControl} contentContainerStyle={styles.decksList}>
                {allDecks.map((d) => (
                  <DeckRow
                    key={d.id}
                    deck={{ name: d.name }}
                    wordCount={d.wordCount}
                    onPress={() => setDetailDeck(d)}
                    // Same deck-scoped push as the detail sheet's Study button —
                    // this swipe action was the OTHER entry point and studied the
                    // whole language queue.
                    onStudy={() => router.push({ pathname: '/quiz', params: { deckId: d.id, deckName: d.name } })}
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
        applyDisabled={!contentReady}
        onApply={(s, tiers, archived) => {
          setSortBy(s);
          setFilterTiers(tiers);
          setShowArchived(archived);
          setFilterOpen(false);
        }}
      />

      {/* W-03 — Word detail */}
      <WordDetailSheet
        word={detailWord}
        onClose={() => setDetailWord(null)}
        onToggleArchive={toggleArchive}
        onEditTranslation={(w) => openEditTranslation(w)}
        onDelete={(w) => {
          setDetailWord(null);
          setPendingDelete(w);
        }}
      />

      {/* Edit Translations (Premium) — stacks OVER the word-detail sheet (the
          kit's Portal sheets stack; the detail sheet stays mounted behind). */}
      <EditTranslationSheet
        word={editWord}
        isSaving={setTargetOverride.isPending}
        error={editError}
        onClose={() => {
          setEditWord(null);
          setEditError(null);
        }}
        onConfirm={(target) => {
          const w = editWord;
          if (w == null) return;
          setEditError(null);
          setTargetOverride.mutate(
            { cardId: w.id, target },
            {
              onSuccess: () => {
                setEditWord(null);
                // The detail sheet behind holds a STALE snapshot of this word
                // (it was captured before the edit); close it rather than let
                // it repaint the old target after the sheet above dismisses.
                setDetailWord(null);
                setDeckWordDetail(null);
                showToast({ variant: 'success', message: target == null ? t('editTranslation.toastReset') : t('editTranslation.toastSaved') });
              },
              onError: (e) =>
                setEditError((e as Error).message === 'premium_required' ? t('editTranslation.premiumRequired') : t('editTranslation.saveFailed')),
            },
          );
        }}
      />

      {/* Delete-word confirmation (shared dialog) */}
      <ConfirmDialog
        visible={pendingDelete != null}
        icon={<IconTrash size={22} color={theme.color.danger} />}
        title={t('wordList.deleteTitle', { word: pendingDelete?.target ?? '' })}
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
                showToast({ variant: 'destructive', message: t('wordList.deleteFailed', { word: w.target }) });
              },
            });
            showToast({
              variant: 'destructive',
              message: t('wordList.wordDeleted', { word: w.target }),
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
            // No Undo action any more: the deck row and its membership are gone
            // server-side, and a toast that silently fails to restore them is
            // worse than no toast. The confirm dialog is the guard. (The WORDS
            // are untouched — that is what the dialog body promises.)
            deleteDeck.mutate(d.id, {
              onSuccess: () => showToast({ variant: 'destructive', message: t('wordList.deckDeleted', { name: d.name }) }),
              onError: () => showToast({ variant: 'destructive', message: t('wordList.deckActionFailed') }),
            });
          }
          setPendingDeckDelete(null);
          setDetailDeck(null); // also close the deck detail sheet if it was open
        }}
        onClose={() => setPendingDeckDelete(null)}
      />

      {/* W-05 — Create deck. `present`, not `words`: a word deleted this session
          must not be offerable as a member of a new deck — the delete has landed
          server-side, so picking it would fail the membership write. */}
      <CreateDeckSheet
        visible={createOpen}
        words={present}
        initialWord={createInitialWord}
        error={createError}
        pending={createDeck.isPending}
        onClose={() => {
          setCreateError(null);
          setCreateOpen(false);
        }}
        onCreate={(name, ids) => {
          // The picked ids are now PERSISTED as membership. They used to be
          // discarded — only `ids.length` survived, as the deck's word count.
          setCreateError(null);
          createDeck.mutate(
            { name, cardIds: ids },
            {
              onSuccess: () => {
                setCreateOpen(false);
                showToast({ variant: 'success', message: t('wordList.deckCreated', { name }) });
              },
              onError: (e) => setCreateError(deckErrorMessage(e, t)),
            },
          );
        }}
      />

      {/* W-06 — Deck detail */}
      <DeckDetailSheet
        deck={detailDeck}
        removed={removed}
        onClose={() => setDetailDeck(null)}
        onStudy={() => {
          const d = detailDeck;
          setDetailDeck(null);
          // 2026-07-30: actually studies THIS deck. It used to push a bare
          // /quiz, i.e. the whole language queue — invisible while deck
          // contents were fake, a visible lie now that they aren't.
          if (d != null) router.push({ pathname: '/quiz', params: { deckId: d.id, deckName: d.name } });
        }}
        onDelete={(d) => setPendingDeckDelete(d)}
        onWordPress={(w) => setDeckWordDetail(w)}
        onRemoveWord={(deck, w) => setPendingRemove({ deck, word: w })}
      />

      {/* Nested: a word's detail opened from inside the deck (returns to the deck sheet) */}
      <WordDetailSheet
        word={deckWordDetail}
        onClose={() => setDeckWordDetail(null)}
        onEditTranslation={(w) => openEditTranslation(w)}
        onDelete={(w) => {
          setDeckWordDetail(null);
          setPendingDelete(w);
        }}
      />

      {/* Remove-from-deck confirmation (word stays in your library) */}
      <ConfirmDialog
        visible={pendingRemove != null}
        icon={<IconTrash size={22} color={theme.color.danger} />}
        title={t('wordList.removeTitle', { word: pendingRemove?.word.target ?? '' })}
        body={t('wordList.removeBody')}
        confirmLabel={t('wordList.removeConfirm')}
        destructive
        onConfirm={() => {
          const pr = pendingRemove;
          if (pr) {
            removeCardFromDeck.mutate(
              { deckId: pr.deck.id, cardId: pr.word.id },
              {
                onSuccess: () =>
                  showToast({
                    variant: 'destructive',
                    message: t('wordList.removedFromDeck', { word: pr.word.target, deck: pr.deck.name }),
                    // Undo is honest here — re-adding is a real, idempotent write.
                    action: { label: t('common.undo'), onPress: () => addCardToDeck.mutate({ deckId: pr.deck.id, cardId: pr.word.id }) },
                  }),
                onError: () => showToast({ variant: 'destructive', message: t('wordList.deckActionFailed') }),
              },
            );
          }
          setPendingRemove(null);
        }}
        onClose={() => setPendingRemove(null)}
      />

      {/* W-08 — Add to deck */}
      <AddToDeckSheet
        word={addToDeckWord}
        decks={allDecks}
        onAdd={(w, d) => {
          addCardToDeck.mutate(
            { deckId: d.id, cardId: w.id },
            {
              onSuccess: () => showToast({ variant: 'success', message: t('wordList.addedToDeck', { deck: d.name }) }),
              onError: () => showToast({ variant: 'destructive', message: t('wordList.deckActionFailed') }),
            },
          );
          setAddToDeckWord(null);
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
  applyDisabled = false,
}: {
  visible: boolean;
  sortBy: SortSel;
  filterTiers: Set<TierId>;
  showArchived: boolean;
  onClose: () => void;
  onApply: (sortBy: SortSel, tiers: Set<TierId>, showArchived: boolean) => void;
  /** True while a previous apply is still settling — the list is showing its
   *  skeleton, and a second apply on top of it would queue more work behind the
   *  one already running. */
  applyDisabled?: boolean;
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

  // Draft vs. applied (Apply) and draft vs. defaults (Reset) — see the ButtonRow
  // at the foot of the sheet.
  const dirty = !sameSort(localSort, sortBy) || !sameTiers(localTiers, filterTiers) || localArchived !== showArchived;
  const atDefault = sameSort(localSort, DEFAULT_SORT) && localTiers.size === 0 && !localArchived;

  const toggleTier = (id: TierId) =>
    setLocalTiers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Order matters: "Next review" leads (2026-08-04). Browsing a word list is
  // mostly asking "what's coming up?", and that answer was buried under two
  // sorts nobody reaches for first. Date added stays the DEFAULT — promoting a
  // row in the sheet is a discoverability change; changing `DEFAULT_SORT` would
  // silently reorder every existing user's list.
  const sortDims: { dim: SortDim; label: string; dirs: [string, string] }[] = [
    { dim: 'due', label: t('wordList.sortDimDue'), dirs: [t('wordList.dirSoonest'), t('wordList.dirLatest')] },
    { dim: 'added', label: t('wordList.sortDimAdded'), dirs: [t('wordList.dirNewest'), t('wordList.dirOldest')] },
    { dim: 'alpha', label: t('wordList.sortDimAlpha'), dirs: [t('wordList.dirAZ'), t('wordList.dirZA')] },
  ];

  return (
    <Sheet visible={visible} onClose={onClose} title={t('wordList.filterSortTitle')}>
      <View style={styles.sheetSection}>
        {/* Hint inlined with the label, matching "Filter by tier (none = all)"
            below — the two sections now read the same way. */}
        <RawText style={styles.sheetLabel}>
          {t('wordList.sortBy')} <RawText style={styles.sheetHint}>{t('wordList.sortHint')}</RawText>
        </RawText>
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
              // Maestro hook, and NOT optional here: the row declares its own
              // accessibilityLabel below (sortA11yActive/Inactive), so iOS
              // collapses the whole row into one element and the visible
              // "Next review" / "Date added" text is absent from the hierarchy
              // Maestro reads. Selecting a sort by text is impossible; this is
              // the a11y-collapse class src/test/a11yCollapse.ts guards.
              testID={`sort-${dim}`}
              style={styles.optionRow}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={on ? t('wordList.sortA11yActive', { dim: label, dir: dirLabel }) : t('wordList.sortA11yInactive', { dim: label })}
            >
              <View style={[styles.radio, { borderColor: on ? theme.color.brand : theme.color.borderStrong }]}>
                {on && <View style={styles.radioDot} />}
              </View>
              <RawText style={[styles.optionLabel, on && styles.optionLabelOn]}>{label}</RawText>
              {on && (
                // Dual brand colors signal the direction at a glance (Casey):
                // dir 0 (Soonest / Newest / A–Z) wears base-camp green; dir 1
                // (Latest / Oldest / Z–A) wears brand ember — the color flip
                // doubles the toggle feedback.
                <Animated.View
                  key={`dir-${localSort.dir}`}
                  entering={FadeIn.duration(140)}
                  style={[
                    styles.sortDirPill,
                    localSort.dir === 0
                      ? { backgroundColor: theme.color.evergreenTint, borderColor: theme.color.evergreenSoft }
                      : { backgroundColor: theme.color.accentTint, borderColor: theme.color.accentSoft },
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
              // Maestro hook. The row's accessible name merges the tier badge in
              // ("Base Camp tier, BC, Base Camp"), so a whole-text selector for
              // "Base Camp" cannot match it; the id says which tier without
              // depending on that merge or on the tier's copy.
              testID={`tier-filter-${tier.id}`}
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
          <Toggle testID="filter-archived" value={localArchived} onValueChange={setLocalArchived} />
        </View>
      </View>

      {/* Both CTAs judge the DRAFT, not what's applied (UX audit) — so they can
          never disagree about what "changed" means. Apply lights up when the
          draft differs from the live filter; Reset when it differs from the
          defaults. Reset clears the draft in place and leaves the sheet open,
          so "reset, then adjust, then apply" is one trip. */}
      <ButtonRow
        style={styles.sheetActions}
        left={{
          title: t('wordList.reset'),
          disabled: atDefault,
          onPress: () => {
            setLocalSort(DEFAULT_SORT);
            setLocalTiers(new Set());
            setLocalArchived(false);
          },
          testID: 'filter-reset',
        }}
        right={{
          title: t('wordList.apply'),
          variant: 'primary',
          disabled: applyDisabled || !dirty,
          onPress: () => onApply(localSort, localTiers, localArchived),
          testID: 'filter-apply',
        }}
      />
    </Sheet>
  );
}

// Shared "Create new deck…" row (dashed tile + label) — Custom Decks (sticky) + Add-to-Deck.
function CreateNewDeckRow({ onPress, testID }: { onPress: () => void; testID?: string }) {
  const { t } = useTranslation();
  return (
    <Pressable testID={testID} style={({ pressed }) => [styles.createNewRow, pressed && { opacity: 0.6 }]} onPress={onPress} accessibilityRole="button">
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
        <IconLock size={28} color={theme.color.accentStrong} />
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
  // The gutter is capped at ~5 rows by its own styling, so mapping it is bounded; `rest`
  // is the whole library and is virtualized below.
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
      {/* `deck-picker-filter`, not the placeholder: this bar is mounted INSIDE a
          sheet that sits over the Word List's own SearchBar, so at that moment
          two text fields are in the hierarchy at once. */}
      <SearchBar
        value={pickerQuery}
        onChange={setPickerQuery}
        placeholder={t('wordList.filterPlaceholder')}
        testID="deck-picker-filter"
        style={styles.pickerSearch}
      />
      {/* Sticky selected-gutter: never scrolls out of view; caps at ~5 rows then scrolls. */}
      {gutter.length > 0 && (
        <View style={styles.gutter}>
          <ScrollView style={styles.gutterScroll} nestedScrollEnabled showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {gutter.map(renderItem)}
          </ScrollView>
          <View style={styles.gutterDivider} />
        </View>
      )}
      {/* VIRTUALIZED (data-perf audit, 2026-08-06). This was `<List scroll>` wrapping
          `{rest.map(renderItem)}` — a plain ScrollView, so opening Add-to-Deck mounted a
          row component for EVERY saved word at once. At 4,300 words that is 4,300
          synchronous mounts before the sheet can paint. The main Word List was already a
          FlatList; this second, unvirtualized path through the same data was the one
          nobody had looked at. Same rows, same order, same empty states. */}
      {filtered.length === 0 ? (
        <List
          isEmpty
          style={styles.pickerList}
          emptyTitle={words.length === 0 ? t('wordList.pickerEmptyTitle') : t('wordList.noMatch')}
          emptyBody={words.length === 0 ? t('wordList.pickerEmptyBody') : undefined}
        />
      ) : (
        <FlatList
          style={styles.pickerList}
          data={rest}
          keyExtractor={(w) => w.id}
          renderItem={({ item }) => renderItem(item)}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          initialNumToRender={12}
          windowSize={7}
        />
      )}
    </>
  );
}

// W-05 — Create custom deck: name + word selection (initialWord pre-selects + pins).
function CreateDeckSheet({
  visible,
  words,
  initialWord,
  error,
  pending,
  onClose,
  onCreate,
}: {
  visible: boolean;
  words: WordListItem[];
  initialWord: WordListItem | null;
  /** Server rejection, already localised (deck_name_taken / cap / premium). */
  error: string | null;
  pending: boolean;
  onClose: () => void;
  onCreate: (name: string, ids: string[]) => void;
}) {
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
  const canCreate = name.trim() !== '' && selected.size > 0 && !pending;
  return (
    <Sheet visible={visible} onClose={onClose} title={t('wordList.createDeckTitle')}>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder={t('wordList.deckNamePlaceholder')}
        placeholderTextColor={theme.color.textMuted}
        accessibilityLabel={t('wordList.deckNamePlaceholder')}
        testID="deck-name-input"
        style={[styles.deckNameInput, { fontFamily: theme.fonts.sans.medium, color: theme.color.textStrong }]}
      />
      {error != null && <RawText style={styles.deckNameError}>{error}</RawText>}
      <RawText style={styles.pickerLabel}>{t('wordList.selectWords', { count: selected.size })}</RawText>
      <WordPicker words={words} selected={selected} onToggle={toggle} />
      <View style={styles.pickerCta}>
        {/* `deck-create-confirm` rather than the "Create" text: the same word is
            the Create button on the Add-to-Deck sheet's own create path, and a
            text selector cannot tell the two apart when both have been open. */}
        <Button testID="deck-create-confirm" title={t('wordList.create')} variant="primary" disabled={!canCreate} onPress={() => canCreate && onCreate(name.trim(), [...selected])} />
      </View>
    </Sheet>
  );
}

// W-06 — Deck detail: stats (Words · Reviews · Created) + word list (press →
// word detail, swipe → remove) + Delete/Study footer.
//
// 2026-07-30: contents are REAL membership (`deck_cards` via useDeckWords).
// They used to be `words.slice(0, deck.wordCount)` — a positional prefix of the
// entire library — which is how a "Food" deck came to display взять / шутка /
// принять, and why editing an unrelated word appeared to make it "vanish" from
// its deck: the edit invalidated ['words'], the refetch reshuffled the prefix.
function DeckDetailSheet({
  deck,
  removed,
  onClose,
  onStudy,
  onDelete,
  onWordPress,
  onRemoveWord,
}: {
  deck: DeckSummary | null;
  /** Locally-deleted card ids (optimistic) — a deleted word leaves its decks too. */
  removed: string[];
  onClose: () => void;
  onStudy: () => void;
  onDelete: (d: DeckSummary) => void;
  onWordPress: (w: WordListItem) => void;
  onRemoveWord: (deck: DeckSummary, w: WordListItem) => void;
}) {
  const { t } = useTranslation();
  const { words: members, isLoading } = useDeckWords(deck?.id ?? null);
  const deckWords = useMemo(
    () =>
      members
        .filter((w) => !removed.includes(w.id)) // globally deleted words drop from the deck too
        // 18 §A4: implicit lists default to due-soonest — surface what needs review.
        .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime()),
    [members, removed],
  );
  // Archived words are IN the deck (18 §E3 keeps them in list contexts) but not
  // in the review queue, so a deck whose words are all archived would offer a
  // session that resolves to nothing. Gate Study on what's actually studyable.
  const studyableCount = useMemo(() => deckWords.filter((w) => !w.suspended).length, [deckWords]);
  return (
    <Sheet visible={deck != null} onClose={onClose} title={deck?.name}>
      {deck != null && (
        <>
          <DetailStats
            style={styles.deckStats}
            items={[
              // Read from the LIST, not the summary: one number, one source, so
              // the tile and the rows below it can never disagree again.
              { label: t('wordList.deckWordsLabel'), value: isLoading ? '—' : String(deckWords.length) },
              { label: t('wordList.deckReviewsLabel'), value: String(deck.reviews) },
              { label: t('wordList.deckLastReviewedLabel'), value: deck.lastReviewedAt != null ? addedLabel(deck.lastReviewedAt, t) : t('wordList.lastReviewedNever') },
            ]}
          />
          <List scroll style={styles.deckWordScroll} isEmpty={!isLoading && deckWords.length === 0} emptyTitle={t('wordList.deckEmptyTitle')} emptyBody={t('wordList.deckEmptyBody')}>
            {deckWords.map((w) => (
              <WordRow key={w.id} word={{ native: w.native, target: w.target, stability: w.stability, dueAt: w.dueAt, reps: w.reps }} onPress={() => onWordPress(w)} onRemoveFromDeck={() => onRemoveWord(deck, w)} />
            ))}
          </List>
          <ButtonRow
            style={styles.pickerCta}
            left={{ title: t('wordList.deleteDeck'), variant: 'destructive', onPress: () => onDelete(deck), testID: 'deck-detail-delete' }}
            // Don't offer a session for a deck that has none — pushing into the
            // quiz just to show an empty state is a worse answer than a button
            // that plainly isn't available yet.
            right={{ title: t('wordList.studyDeck'), variant: 'primary', disabled: isLoading || studyableCount === 0, onPress: onStudy, testID: 'deck-detail-study' }}
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
  onAdd,
  onCreateNew,
  onClose,
}: {
  word: WordListItem | null;
  decks: DeckSummary[];
  onAdd: (w: WordListItem, d: DeckSummary) => void;
  onCreateNew: () => void;
  onClose: () => void;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  // Server truth. This was a local Set that only the current session's taps ever
  // wrote — so "Already added" was right until you reloaded, and wrong after.
  const { deckIds, isLoading: membershipLoading } = useCardDeckIds(word?.id ?? null);
  const inDeckIds = useMemo(() => new Set(deckIds), [deckIds]);
  return (
    <Sheet visible={word != null} onClose={onClose} title={t('wordList.addToDeckTitle')}>
      {word != null && (
        <>
          <RawText style={styles.addToDeckSub}>{`${word.native} · ${word.target}`}</RawText>
          {/* `deck-add-create-new` is distinct from the Custom Decks tab's sticky
              row (`deck-create-open`) on purpose: both render the SAME "Create new
              deck…" text, and this sheet sits OVER that tab, so a text selector is
              genuinely ambiguous while the sheet is open. */}
          {decks.length === 0 ? (
            <CreateNewDeckRow testID="deck-add-create-new" onPress={onCreateNew} />
          ) : (
            <List>
              {decks.map((d) => {
                // While membership is in flight every row would read as
                // tappable, and tapping a deck the word is ALREADY in would fire
                // "Added to X" for a no-op (the RPC is on-conflict-do-nothing).
                // Disable until we know.
                const inDeck = inDeckIds.has(d.id);
                const pending = membershipLoading;
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
                    disabled={inDeck || pending}
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
  const { color, fonts } = theme;
  return {
    header: { paddingHorizontal: 16, paddingTop: 4 },
    titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 },
    titleRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { fontFamily: fonts.sans.extra, fontSize: 22, letterSpacing: -0.3, color: color.textStrong },
    count: { fontFamily: fonts.sans.medium, fontSize: 13, color: color.textMuted },
    // Matches the Custom Decks "Create new deck" container height/gap (both ~64px, bordered).
    searchUnderTabs: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: theme.borderWidth.thin, borderBottomColor: color.divider },

    // + the FAB's overhang: the nav's height is spacer-reserved, the FAB is not.
    listFill: { flex: 1 },
  listContent: { paddingBottom: 16 + TAB_BAR_FAB_OVERHANG },
    // Empty states fill the pane so the ghost layer runs the height of the list
    // it stands in for, rather than stopping wherever the row count happens to end.
    emptyFill: { flex: 1 },
    emptyPad: { paddingTop: 48 },
    proBadge: { backgroundColor: color.accentSoft, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 },
    proBadgeText: { fontFamily: fonts.sans.bold, fontSize: 9, letterSpacing: 0.3, color: color.accentStrong },

    // decks tab
    decksBody: { flex: 1 },
    stickyCreate: { paddingHorizontal: 16, borderBottomWidth: theme.borderWidth.thin, borderBottomColor: color.divider },
    decksList: { paddingBottom: 20 + TAB_BAR_FAB_OVERHANG },
    gutter: {},
    gutterScroll: { maxHeight: 190 },
    gutterDivider: { height: 1.5, backgroundColor: color.borderStrong, marginTop: 2, marginBottom: 4, borderRadius: 1 },
    deckStats: { marginBottom: 14 },
    deckWordScroll: { maxHeight: 340 },
    gate: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 48 },
    gateLock: { width: 64, height: 64, borderRadius: 32, backgroundColor: color.accentSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
    gateTitle: { fontFamily: fonts.sans.bold, fontSize: 17, color: color.textStrong, marginBottom: 8 },
    gateBody: { fontFamily: fonts.sans.regular, fontSize: 14, lineHeight: 22, color: color.textMuted, textAlign: 'center', marginBottom: 28, maxWidth: 280 },
    gateBtn: { backgroundColor: color.accentCta, borderRadius: theme.radius.md, paddingVertical: 13, paddingHorizontal: 32, boxShadow: theme.shadow.accent },
    gateBtnText: { fontFamily: fonts.sans.bold, fontSize: 15, color: '#fff' },
    gatePricing: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textFaint, marginTop: 12 },

    // create / detail / add-to-deck
    deckNameInput: { borderWidth: theme.borderWidth.base, borderColor: color.border, borderRadius: theme.radius.md, paddingHorizontal: 14, height: 48, fontSize: 16, marginBottom: 14 },
    deckNameError: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.danger, marginTop: -8, marginBottom: 12 },
    pickerLabel: { fontFamily: fonts.sans.bold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: color.textMuted, marginBottom: 8 },
    pickerSearch: { marginBottom: 8 },
    pickerList: { maxHeight: 320 },
    pickerCta: { marginTop: 14 },
    addToDeckSub: { fontFamily: fonts.sans.regular, fontSize: 13, color: color.textMuted, marginBottom: 12, marginTop: -6 },
    deckIconTile: { width: 38, height: 38, borderRadius: 9, backgroundColor: color.brandTint, borderWidth: theme.borderWidth.thin, borderColor: color.brandSoft, alignItems: 'center', justifyContent: 'center' },
    alreadyAdded: { fontFamily: fonts.sans.semibold, fontSize: 11, color: color.brand },
    createNewRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 0 },
    createNewTile: { width: 38, height: 38, borderRadius: 9, borderWidth: 1.5, borderColor: color.borderStrong, borderStyle: 'dashed', backgroundColor: color.surfaceSunken, alignItems: 'center', justifyContent: 'center' },
    createNewPlus: { fontFamily: fonts.sans.regular, fontSize: 20, color: color.textMuted, lineHeight: 22 },
    createNewText: { fontFamily: fonts.sans.semibold, fontSize: 14, color: color.brand },
    archivedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    archivedText: { flex: 1 },

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
