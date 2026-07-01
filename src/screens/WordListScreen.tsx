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
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { useDecks, useEntitlement, useWords } from '@/query/hooks';
import type { DeckSummary, WordListItem } from '@/data/DataSource';
import { getTierByStability, TIERS, type TierId } from '@/theme/tiers';

import {
  Button,
  ButtonRow,
  DeckRow,
  EmptyState,
  IconChevronRight,
  IconFolderPlus,
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
  const router = useRouter();
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
  // Local deck membership (deckId|wordId) — optimistic until the real write lands.
  const [added, setAdded] = useState<Set<string>>(new Set());
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
          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder={t('wordList.searchPlaceholder')}
            onFilter={() => setFilterOpen(true)}
            filterActive={filterActive}
            style={styles.headerSearch}
          />
        )}
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
            <View style={styles.decksHeader}>
              <RawText style={styles.decksCount}>{t('wordList.deckCount', { count: allDecks.length })}</RawText>
              <Pressable style={({ pressed }) => [styles.newDeck, pressed && { opacity: 0.7 }]} onPress={() => setCreateOpen(true)} accessibilityRole="button">
                <IconFolderPlus size={16} color="#fff" />
                <RawText style={styles.newDeckText}>{t('wordList.newDeck')}</RawText>
              </Pressable>
            </View>
            {allDecks.length === 0 ? (
              <View style={styles.decksEmpty}>
                <RawText style={styles.decksEmptyTitle}>{t('wordList.decksEmptyTitle')}</RawText>
                <RawText style={styles.decksEmptyBody}>{t('wordList.decksEmptyBody')}</RawText>
              </View>
            ) : (
              allDecks.map((d) => (
                <DeckRow key={d.id} deck={{ name: d.name }} wordCount={d.wordCount} onPress={() => setDetailDeck(d)} onDelete={() => setExtraDecks((e) => e.filter((x) => x.id !== d.id))} />
              ))
            )}
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
        words={words}
        onClose={() => setCreateOpen(false)}
        onCreate={(name, ids) => {
          setExtraDecks((e) => [...e, { id: `d_${Date.now()}`, name, wordCount: ids.length }]);
          setCreateOpen(false);
        }}
      />

      {/* W-06 — Deck detail */}
      <DeckDetailSheet
        deck={detailDeck}
        words={words}
        onClose={() => setDetailDeck(null)}
        onStudy={() => {
          setDetailDeck(null);
          router.push('/quiz');
        }}
        onDelete={(d) => {
          setExtraDecks((e) => e.filter((x) => x.id !== d.id));
          setDetailDeck(null);
        }}
      />

      {/* W-08 — Add to deck */}
      <AddToDeckSheet
        word={addToDeckWord}
        decks={allDecks}
        added={added}
        onAdd={(w, d) => {
          setAdded((s) => new Set(s).add(`${d.id}|${w.id}`));
          setAddToDeckWord(null);
        }}
        onCreateNew={() => {
          setAddToDeckWord(null);
          setCreateOpen(true);
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

// Shared word-picker list (checkbox rows) used by Create/Deck-detail sheets: SearchBar +
// filtered word ListItems. Built-in empty state (no matches / no words).
function WordPicker({
  words,
  selected,
  onToggle,
  selectable = true,
}: {
  words: WordListItem[];
  selected?: Set<string>;
  onToggle?: (id: string) => void;
  selectable?: boolean;
}) {
  const { t } = useTranslation();
  const [pickerQuery, setPickerQuery] = useState('');
  const filtered = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return q === '' ? words : words.filter((w) => w.native.toLowerCase().includes(q) || w.target.toLowerCase().includes(q));
  }, [words, pickerQuery]);
  return (
    <>
      <SearchBar value={pickerQuery} onChange={setPickerQuery} placeholder={t('wordList.filterPlaceholder')} style={styles.pickerSearch} />
      <List
        scroll
        style={styles.pickerList}
        isEmpty={filtered.length === 0}
        emptyTitle={words.length === 0 ? t('wordList.pickerEmptyTitle') : t('wordList.noMatch')}
        emptyBody={words.length === 0 ? t('wordList.pickerEmptyBody') : undefined}
      >
        {filtered.map((w, i) => {
          const tier = getTierByStability(w.stability);
          return (
            <ListItem
              key={w.id}
              checkbox={selectable}
              checked={selected?.has(w.id) ?? false}
              checkColor={tier.color}
              leading={<TierBadge tier={tier.id} variant="pill" size="sm" />}
              title={w.native}
              subtitle={w.target}
              subtitleInline
              compact
              onPress={selectable && onToggle ? () => onToggle(w.id) : undefined}
              last={i === filtered.length - 1}
            />
          );
        })}
      </List>
    </>
  );
}

// W-05 — Create custom deck: name + word selection.
function CreateDeckSheet({ visible, words, onClose, onCreate }: { visible: boolean; words: WordListItem[]; onClose: () => void; onCreate: (name: string, ids: string[]) => void }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setName('');
      setSelected(new Set());
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

// W-06 — Deck detail: word list + Delete/Study footer (no name field). Membership isn't
// modeled in the mock, so it shows a slice of the library as stand-in contents.
function DeckDetailSheet({ deck, words, onClose, onStudy, onDelete }: { deck: DeckSummary | null; words: WordListItem[]; onClose: () => void; onStudy: () => void; onDelete: (d: DeckSummary) => void }) {
  const { t } = useTranslation();
  const deckWords = deck ? words.slice(0, deck.wordCount) : [];
  return (
    <Sheet visible={deck != null} onClose={onClose} title={deck?.name}>
      <RawText style={styles.pickerLabel}>{t('deckRow.words', { count: deck?.wordCount ?? 0 })}</RawText>
      <WordPicker words={deckWords} selectable={false} />
      <ButtonRow
        style={styles.pickerCta}
        left={{ title: t('wordList.deleteDeck'), variant: 'destructive', onPress: () => deck && onDelete(deck) }}
        right={{ title: t('wordList.studyDeck'), variant: 'primary', onPress: onStudy }}
      />
    </Sheet>
  );
}

// W-08 — Add a word to a deck (icon-slot deck rows + create-new-deck).
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
          <List
            isEmpty={decks.length === 0}
            emptyState={<RawText style={styles.addToDeckEmpty}>{t('wordList.addToDeckEmpty')}</RawText>}
          >
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
                  trailing={
                    inDeck ? (
                      <RawText style={styles.alreadyAdded}>{t('wordList.alreadyAdded')}</RawText>
                    ) : (
                      <IconChevronRight size={14} color={theme.color.borderStrong} />
                    )
                  }
                />
              );
            })}
          </List>
          <Pressable style={({ pressed }) => [styles.createNewRow, pressed && { opacity: 0.6 }]} onPress={onCreateNew} accessibilityRole="button">
            <View style={styles.createNewTile}>
              <RawText style={styles.createNewPlus}>+</RawText>
            </View>
            <RawText style={styles.createNewText}>{t('wordList.createNewDeck')}</RawText>
          </Pressable>
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
    headerSearch: { marginBottom: 10 },

    listContent: { paddingBottom: 16 },
    empty: { paddingTop: 64 },
    proBadge: { backgroundColor: palette.amber[100], borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 },
    proBadgeText: { fontFamily: fonts.sans.bold, fontSize: 9, letterSpacing: 0.3, color: palette.amber[800] },

    // decks tab
    decksContent: { paddingTop: 12, paddingBottom: 20 },
    decksHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 8 },
    decksCount: { fontFamily: fonts.sans.medium, fontSize: 13, color: color.textMuted },
    newDeck: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 14, borderRadius: theme.radius.md, backgroundColor: color.brand },
    newDeckText: { fontFamily: fonts.sans.bold, fontSize: 14, color: '#fff' },
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
    addToDeckEmpty: { fontFamily: fonts.sans.regular, fontSize: 13, color: color.textMuted, textAlign: 'center', paddingVertical: 20 },
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
