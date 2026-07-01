// WordListScreen (W-01, "My Words") — the vocabulary browse hub. Header (title + live
// count), a search field + filter/sort button (W-02 sheet), and the scrollable saved-word
// list (WordRow, swipe → Add-to-Deck · Delete). Reads real scenario data via `useWords()`;
// the DevBadge tier scenario drives which words appear. Delete opens a confirmation sheet.
//
// The bottom nav is provided by the persistent tab layout (app/(tabs)/_layout), not here.
// Custom Decks sub-nav (W-04/07) and the word-detail sheet (W-03) are the next chunk; the
// row tap + Add-to-Deck are wired as TODOs.
import { useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { useDecks, useEntitlement, useWords } from '@/query/hooks';
import type { DeckSummary, WordListItem } from '@/data/DataSource';
import { getTierByStability, TIERS, type TierId } from '@/theme/tiers';

import {
  Button,
  DeckRow,
  EmptyState,
  IconCheck,
  IconFolderPlus,
  IconLock,
  IconSearch,
  IconSliders,
  IconTrash,
  IconX,
  RawText,
  Screen,
  Sheet,
  TierBadge,
  WordRow,
} from '@/ui';

const DAY = 24 * 60 * 60 * 1000;

type SortId = 'newest' | 'oldest' | 'az' | 'tier';

/** Relative "added" label (Today / Yesterday / N days · weeks · months ago). */
function addedLabel(createdAt: Date, t: TFunction): string {
  const days = Math.floor((Date.now() - createdAt.getTime()) / DAY);
  if (days <= 0) return t('wordList.addedToday');
  if (days === 1) return t('wordList.addedYesterday');
  if (days < 14) return t('wordList.addedDaysAgo', { count: days });
  if (days < 60) return t('wordList.addedWeeksAgo', { count: Math.round(days / 7) });
  return t('wordList.addedMonthsAgo', { count: Math.round(days / 30) });
}

/** Relative "next review" label (Due now / Today / Tomorrow / in N days · weeks). */
function dueLabel(dueAt: Date, t: TFunction): string {
  const ms = dueAt.getTime() - Date.now();
  if (ms <= 0) return t('wordList.dueNow');
  const days = Math.round(ms / DAY);
  if (days === 0) return t('wordList.dueToday');
  if (days === 1) return t('wordList.dueTomorrow');
  if (days < 14) return t('wordList.dueInDays', { count: days });
  return t('wordList.dueInWeeks', { count: Math.round(days / 7) });
}

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
  const { words } = useWords();
  const { decks } = useDecks();
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
  const [detailDeck, setDetailDeck] = useState<DeckSummary | null>(null);
  const [addToDeckWord, setAddToDeckWord] = useState<WordListItem | null>(null);
  const allDecks = [...decks, ...extraDecks];

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
        {subTab === 'words' && (
          <View style={styles.searchRow}>
            <View style={styles.searchField}>
              <IconSearch size={16} color={theme.color.textMuted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t('wordList.searchPlaceholder')}
                placeholderTextColor={theme.color.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.searchInput, { fontFamily: theme.fonts.sans.regular, color: theme.color.textBody }]}
              />
              {query !== '' && (
                <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel={t('wordList.clearSearch')} hitSlop={8}>
                  <IconX size={14} color={theme.color.textMuted} />
                </Pressable>
              )}
            </View>
            <Pressable
              onPress={() => setFilterOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t('wordList.filterA11y')}
              style={[styles.filterBtn, { backgroundColor: filterActive ? theme.color.brand : theme.palette.slate[100] }]}
            >
              <IconSliders size={16} color={filterActive ? '#fff' : theme.color.textMuted} />
            </Pressable>
          </View>
        )}
        {/* Sub-nav: All Words | Custom Decks */}
        <View style={styles.subNav}>
          {(['words', 'decks'] as const).map((id) => {
            const on = subTab === id;
            return (
              <Pressable key={id} onPress={() => setSubTab(id)} style={styles.subNavTab} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                <View style={styles.subNavRow}>
                  <RawText style={[styles.subNavText, on && styles.subNavTextOn]}>
                    {id === 'words' ? t('wordList.tabAllWords') : t('wordList.tabCustomDecks')}
                  </RawText>
                  {id === 'decks' && !isPaid && (
                    <View style={styles.proBadge}>
                      <RawText style={styles.proBadgeText}>PRO</RawText>
                    </View>
                  )}
                </View>
                <View style={[styles.subNavUnderline, on && styles.subNavUnderlineOn]} />
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Words tab */}
      {subTab === 'words' &&
        (noneSaved ? (
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
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.decksContent}>
            {allDecks.map((d) => (
              <DeckRow key={d.id} deck={{ name: d.name }} wordCount={d.wordCount} onPress={() => setDetailDeck(d)} onDelete={() => setExtraDecks((e) => e.filter((x) => x.id !== d.id))} />
            ))}
            <Pressable style={({ pressed }) => [styles.newDeck, pressed && { opacity: 0.7 }]} onPress={() => setCreateOpen(true)} accessibilityRole="button">
              <IconFolderPlus size={18} color={theme.color.brand} />
              <RawText style={styles.newDeckText}>{t('wordList.newDeck')}</RawText>
            </Pressable>
          </ScrollView>
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

      {/* Delete confirmation */}
      <Sheet visible={pendingDelete != null} onClose={() => setPendingDelete(null)}>
        <View style={styles.confirm}>
          <View style={styles.confirmIcon}>
            <IconTrash size={22} color={theme.color.danger} />
          </View>
          <RawText style={styles.confirmTitle}>{t('wordList.deleteTitle', { word: pendingDelete?.native ?? '' })}</RawText>
          <RawText style={styles.confirmBody}>{t('wordList.deleteBody')}</RawText>
          <Button
            title={t('wordList.deleteConfirm')}
            variant="destructive"
            onPress={() => {
              if (pendingDelete) setRemoved((r) => [...r, pendingDelete.id]);
              setPendingDelete(null);
            }}
          />
          <View style={styles.confirmCancel}>
            <Button title={t('wordList.cancel')} variant="secondary" onPress={() => setPendingDelete(null)} />
          </View>
        </View>
      </Sheet>

      {/* W-05 — Create deck */}
      <CreateDeckSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={(name) => {
          setExtraDecks((e) => [...e, { id: `d_${Date.now()}`, name, wordCount: 0 }]);
          setCreateOpen(false);
        }}
      />

      {/* W-06 — Deck detail */}
      <DeckDetailSheet deck={detailDeck} words={words} onClose={() => setDetailDeck(null)} />

      {/* W-08 — Add to deck */}
      <AddToDeckSheet word={addToDeckWord} decks={allDecks} onClose={() => setAddToDeckWord(null)} />
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
        {TIERS.map((tier) => {
          const on = localTiers.has(tier.id);
          return (
            <Pressable key={tier.id} onPress={() => toggleTier(tier.id)} style={styles.optionRow} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
              <View style={[styles.checkbox, { borderColor: on ? tier.color : theme.palette.slate[300], backgroundColor: on ? tier.color : 'transparent' }]}>
                {on && <IconCheck size={12} color="#fff" />}
              </View>
              <TierBadge tier={tier} variant="pill" size="sm" />
              <RawText style={styles.optionLabel}>{tier.name}</RawText>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.sheetActions}>
        <View style={styles.sheetActionReset}>
          <Button title={t('wordList.reset')} variant="secondary" onPress={onReset} />
        </View>
        <View style={styles.sheetActionApply}>
          <Button title={t('wordList.apply')} variant="primary" onPress={() => onApply(localSort, localTiers)} />
        </View>
      </View>
    </Sheet>
  );
}

// W-03 — Word detail bottom sheet.
function WordDetailSheet({ word, onClose, onDelete }: { word: WordListItem | null; onClose: () => void; onDelete: (w: WordListItem) => void }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const tier = word ? getTierByStability(word.stability) : null;
  return (
    <Sheet visible={word != null} onClose={onClose}>
      {word != null && tier != null && (
        <View>
          <View style={styles.detailHead}>
            <RawText style={styles.detailWord}>{word.native}</RawText>
            <RawText style={styles.detailTarget}>{word.target}</RawText>
          </View>
          <View style={styles.detailMetaRow}>
            <View style={styles.posPill}>
              <RawText style={styles.posPillText}>{word.pos}</RawText>
            </View>
            <TierBadge tier={tier.id} variant="pill" size="md" />
          </View>
          <View style={[styles.memoryCard, { backgroundColor: tier.bg, borderColor: tier.border }]}>
            <View style={styles.memoryTop}>
              <RawText style={[styles.memoryTier, { color: tier.text }]}>{t(`tier.${tier.id}.name`)}</RawText>
              <RawText style={[styles.memoryDays, { color: tier.text }]}>{t('wordList.memoryStrengthDays', { count: Math.round(word.stability) })}</RawText>
            </View>
            <RawText style={[styles.memoryDesc, { color: tier.text }]}>{t(`tier.${tier.id}.desc`)}</RawText>
            <RawText style={[styles.memoryHint, { color: tier.text, borderTopColor: tier.border }]}>{t('wordList.memoryHint')}</RawText>
          </View>
          <RawText style={styles.detailSectionLabel}>{t('wordList.example')}</RawText>
          <RawText style={styles.detailExample}>&ldquo;{word.example}&rdquo;</RawText>
          <View style={styles.detailGrid}>
            <DetailMeta label={t('wordList.nextReview')} value={dueLabel(word.dueAt, t)} />
            <DetailMeta label={t('wordList.reviews')} value={t('wordList.reviewsValue', { count: word.reps })} />
            <DetailMeta label={t('wordList.addedLabel')} value={addedLabel(word.createdAt, t)} />
          </View>
          <Pressable onPress={() => onDelete(word)} accessibilityRole="button" style={({ pressed }) => [styles.detailDelete, pressed && { opacity: 0.85 }]}>
            <IconTrash size={17} color={theme.color.danger} />
            <RawText style={styles.detailDeleteText}>{t('wordList.deleteWord')}</RawText>
          </Pressable>
        </View>
      )}
    </Sheet>
  );
}
function DetailMeta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailMeta}>
      <RawText style={styles.detailMetaLabel}>{label}</RawText>
      <RawText style={styles.detailMetaValue}>{value}</RawText>
    </View>
  );
}

// W-07 — Premium gate for Custom Decks (free users).
function PremiumGate() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  return (
    <View style={styles.gate}>
      <View style={styles.gateLock}>
        <IconLock size={28} color={theme.palette.amber[600]} />
      </View>
      <RawText style={styles.gateTitle}>{t('wordList.premiumTitle')}</RawText>
      <RawText style={styles.gateBody}>{t('wordList.premiumBody')}</RawText>
      <Pressable style={({ pressed }) => [styles.gateBtn, pressed && { opacity: 0.9 }]} accessibilityRole="button" onPress={() => { /* TODO: paywall (PW-01) */ }}>
        <RawText style={styles.gateBtnText}>{t('wordList.unlockPremium')}</RawText>
      </Pressable>
      <RawText style={styles.gatePricing}>{t('wordList.premiumPricing')}</RawText>
    </View>
  );
}

// W-05 — Create custom deck.
function CreateDeckSheet({ visible, onClose, onCreate }: { visible: boolean; onClose: () => void; onCreate: (name: string) => void }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setName('');
  }
  return (
    <Sheet visible={visible} onClose={onClose} title={t('wordList.createDeckTitle')}>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder={t('wordList.deckNamePlaceholder')}
        placeholderTextColor={theme.color.textMuted}
        autoFocus
        style={[styles.deckNameInput, { fontFamily: theme.fonts.sans.medium, color: theme.color.textStrong }]}
      />
      <Button title={t('wordList.create')} variant="primary" onPress={() => name.trim() !== '' && onCreate(name.trim())} />
    </Sheet>
  );
}

// W-06 — Deck detail (name + its words). Membership isn't modeled in the mock, so it
// shows a slice of the library as stand-in contents.
function DeckDetailSheet({ deck, words, onClose }: { deck: DeckSummary | null; words: WordListItem[]; onClose: () => void }) {
  const { t } = useTranslation();
  const deckWords = deck ? words.slice(0, deck.wordCount) : [];
  return (
    <Sheet visible={deck != null} onClose={onClose} title={deck?.name}>
      <RawText style={styles.deckDetailCount}>{t('deckRow.words', { count: deck?.wordCount ?? 0 })}</RawText>
      <ScrollView style={styles.deckWordList} showsVerticalScrollIndicator={false}>
        {deckWords.map((w) => (
          <WordRow key={w.id} compact word={{ native: w.native, target: w.target, stability: w.stability }} />
        ))}
      </ScrollView>
    </Sheet>
  );
}

// W-08 — Add a word to a deck.
function AddToDeckSheet({ word, decks, onClose }: { word: WordListItem | null; decks: DeckSummary[]; onClose: () => void }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  return (
    <Sheet visible={word != null} onClose={onClose} title={t('wordList.addToDeckTitle')}>
      <View>
        {decks.map((d) => (
          <Pressable key={d.id} style={({ pressed }) => [styles.addDeckRow, pressed && { opacity: 0.6 }]} onPress={onClose} accessibilityRole="button">
            <IconFolderPlus size={18} color={theme.color.brand} />
            <RawText style={styles.addDeckName}>{d.name}</RawText>
            <RawText style={styles.addDeckCount}>{t('deckRow.words', { count: d.wordCount })}</RawText>
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, fonts, palette } = theme;
  return {
    header: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10, borderBottomWidth: theme.borderWidth.thin, borderBottomColor: color.border },
    titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 },
    title: { fontFamily: fonts.sans.extra, fontSize: 22, letterSpacing: -0.3, color: color.textStrong },
    count: { fontFamily: fonts.sans.medium, fontSize: 13, color: color.textMuted },
    searchRow: { flexDirection: 'row', gap: 8 },
    searchField: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.slate[100], borderRadius: 10, paddingHorizontal: 12, height: 40 },
    searchInput: { flex: 1, fontSize: 15, padding: 0 },
    filterBtn: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },

    listContent: { paddingBottom: 16 },
    empty: { paddingTop: 64 },

    // sub-nav
    subNav: { flexDirection: 'row', marginTop: 4 },
    subNavTab: { flex: 1, alignItems: 'center' },
    subNavRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 9 },
    subNavText: { fontFamily: fonts.sans.regular, fontSize: 14, color: color.textMuted },
    subNavTextOn: { fontFamily: fonts.sans.semibold, color: color.brand },
    subNavUnderline: { height: 2, alignSelf: 'stretch', backgroundColor: 'transparent' },
    subNavUnderlineOn: { backgroundColor: color.brand },
    proBadge: { backgroundColor: palette.amber[100], borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 },
    proBadgeText: { fontFamily: fonts.sans.bold, fontSize: 9, letterSpacing: 0.3, color: palette.amber[800] },

    // decks tab
    decksContent: { paddingTop: 4, paddingBottom: 20 },
    newDeck: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, marginHorizontal: 16, paddingVertical: 13, borderRadius: theme.radius.md, borderWidth: theme.borderWidth.base, borderColor: palette.blue[200], borderStyle: 'dashed', backgroundColor: palette.blue[50] },
    newDeckText: { fontFamily: fonts.sans.bold, fontSize: 15, color: color.brand },
    gate: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 48 },
    gateLock: { width: 64, height: 64, borderRadius: 32, backgroundColor: palette.amber[100], alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
    gateTitle: { fontFamily: fonts.sans.bold, fontSize: 17, color: color.textStrong, marginBottom: 8 },
    gateBody: { fontFamily: fonts.sans.regular, fontSize: 14, lineHeight: 22, color: color.textMuted, textAlign: 'center', marginBottom: 28, maxWidth: 280 },
    gateBtn: { backgroundColor: color.accent, borderRadius: theme.radius.md, paddingVertical: 13, paddingHorizontal: 32, boxShadow: theme.shadow.accent },
    gateBtnText: { fontFamily: fonts.sans.bold, fontSize: 15, color: '#fff' },
    gatePricing: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textFaint, marginTop: 12 },

    // create / detail / add-to-deck
    deckNameInput: { borderWidth: theme.borderWidth.base, borderColor: color.border, borderRadius: theme.radius.md, paddingHorizontal: 14, height: 48, fontSize: 16, marginBottom: 14 },
    deckDetailCount: { fontFamily: fonts.sans.medium, fontSize: 13, color: color.textMuted, marginBottom: 10 },
    deckWordList: { maxHeight: 360 },
    addDeckRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: theme.borderWidth.thin, borderBottomColor: color.divider },
    addDeckName: { flex: 1, fontFamily: fonts.sans.semibold, fontSize: 15, color: color.textStrong },
    addDeckCount: { fontFamily: fonts.sans.regular, fontSize: 13, color: color.textMuted },
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
    sheetActionReset: { flex: 1 },
    sheetActionApply: { flex: 2 },

    // Word detail sheet
    detailHead: { marginBottom: 14 },
    detailWord: { fontFamily: fonts.serif.bold, fontSize: 24, color: color.textStrong, letterSpacing: -0.3 },
    detailTarget: { fontFamily: fonts.sans.regular, fontSize: 16, color: color.textMuted, marginTop: 3 },
    detailMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
    posPill: { backgroundColor: palette.slate[100], borderRadius: 4, paddingVertical: 2, paddingHorizontal: 8 },
    posPillText: { fontFamily: fonts.sans.semibold, fontSize: 12, color: color.textMuted },
    memoryCard: { borderWidth: theme.borderWidth.thin, borderRadius: 10, padding: 12, marginBottom: 14 },
    memoryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
    memoryTier: { fontFamily: fonts.sans.bold, fontSize: 12 },
    memoryDays: { fontFamily: fonts.sans.semibold, fontSize: 12 },
    memoryDesc: { fontFamily: fonts.sans.regular, fontSize: 12, lineHeight: 17, opacity: 0.85 },
    memoryHint: { fontFamily: fonts.sans.regular, fontSize: 11, lineHeight: 15, opacity: 0.7, marginTop: 8, paddingTop: 8, borderTopWidth: theme.borderWidth.thin },
    detailSectionLabel: { fontFamily: fonts.sans.bold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: color.textMuted, marginBottom: 6 },
    detailExample: { fontFamily: fonts.sans.regular, fontSize: 14, fontStyle: 'italic', lineHeight: 21, color: color.textBody, marginBottom: 16 },
    detailGrid: { flexDirection: 'row', gap: 12, marginBottom: 18 },
    detailMeta: { flex: 1 },
    detailMetaLabel: { fontFamily: fonts.sans.bold, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: color.textMuted, marginBottom: 3 },
    detailMetaValue: { fontFamily: fonts.sans.medium, fontSize: 13, color: color.textBody },
    detailDelete: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(209, 73, 91, 0.12)', borderRadius: 10, paddingVertical: 12 },
    detailDeleteText: { fontFamily: fonts.sans.semibold, fontSize: 15, color: color.danger },

    // Delete confirm sheet
    confirm: { alignItems: 'center', paddingTop: 4 },
    confirmIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(209, 73, 91, 0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
    confirmTitle: { fontFamily: fonts.sans.bold, fontSize: 17, color: color.textStrong, textAlign: 'center', marginBottom: 8 },
    confirmBody: { fontFamily: fonts.sans.regular, fontSize: 14, lineHeight: 21, color: color.textMuted, textAlign: 'center', marginBottom: 22 },
    confirmCancel: { marginTop: 10, alignSelf: 'stretch' },
  };
});
