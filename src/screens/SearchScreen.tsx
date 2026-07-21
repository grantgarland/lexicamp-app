// SearchScreen (S-01…S-04) — the capture flow, assembled against search/Search.html.
// Full-screen route (pushed from the Home FAB). Composes the kit (Screen,
// TranslationCard, EmptyState) + Search-specific pieces built inline: DirectionToggle,
// SearchBar, RecentChips, SkeletonCard. Lookup flows through DataSource.lookup()
// (2.1): Tier-0 capture gate client-side for instant feedback → debounced query
// through the state layer (mock now, translate Edge Function via SupabaseDataSource).
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet as RNStyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { captureReasonI18nKey, evaluateCaptureInput } from '@/domain/capture';
import { tourTargets } from '@/tour/walkthrough';
import { directionLangs } from '@/domain/derive';
import { type LookupResult, posTagI18nKey, qualityReasonI18nKey } from '@/domain/translation';
import type { Profile, SearchDirection } from '@/domain/types';
import { useTranslation } from '@/i18n';
import { useDeleteCard, useExamples, useLookup, useProfile, useSaveCard, useWords } from '@/query/hooks';
import { LanguageIndicator } from '@/screens/shared/LanguageSwitcher';
import { usePrefsStore } from '@/store/prefsStore';
import {
  ConfirmDialog,
  EmptyState,
  FONT_SCALE_MAX,
  IconClock,
  IconTrash,
  IconSearch,
  IconX,
  RawText,
  Screen,
  TranslationCard,
  type TranslationResult,
} from '@/ui';

/** Adapt a domain LookupResult (Azure dictionary shape) to the card's view model. */
function toCardResult(r: LookupResult, t: (k: string, o?: Record<string, unknown>) => string): TranslationResult {
  const example = r.examples?.[0];
  return {
    sourceText: r.displaySource,
    phonetic: '', // IPA comes from lexical enrichment (3.6), not the dictionary
    pos: r.senses[0] ? t(posTagI18nKey(r.senses[0].posTag)) : '',
    translations: r.senses.map((s, i) => ({
      id: `${r.normalizedSource}:${s.normalizedTarget}`,
      word: s.prefixWord ? `${s.prefixWord} ${s.displayTarget}` : s.displayTarget,
      pos: t(posTagI18nKey(s.posTag)),
      ...(i === 0 && example
        ? {
            example: {
              source: `${example.sourcePrefix}${example.sourceTerm}${example.sourceSuffix}`,
            },
          }
        : {}),
      ...(s.backTranslations.length > 1
        ? {
            details: [
              {
                label: t('search.alsoTranslates'),
                value: s.backTranslations.slice(0, 3).map((b) => b.displayText).join(', '),
              },
            ],
          }
        : {}),
    })),
  };
}

/** Small debounce so lookups fire on typing pauses, not every keystroke. */
function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

// SearchView — the search body. Reused both as the modal route (SearchScreen) and
// as an in-Home overlay (so the bottom nav can stay visible). Closes via `onClose`.
export function SearchView({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const router = useRouter();
  // Direction is a device pref; recents are PER USER (18-session: only what the
  // active account actually searched — no seeds, no cross-account bleed).
  const direction = usePrefsStore((s) => s.searchDirection);
  const setDirection = usePrefsStore((s) => s.setSearchDirection);
  const recentsByUser = usePrefsStore((s) => s.recentsByUser);
  const addRecentToStore = usePrefsStore((s) => s.addRecent);
  const removeRecentFromStore = usePrefsStore((s) => s.removeRecent);

  // The language PAIR is a per-user fact (profiles.native_lang / learning_lang, 03);
  // direction just picks which way to read it. Resolve both into the labels the UI shows.
  const profile = useProfile();
  const recents = profile != null ? (recentsByUser[profile.id] ?? []) : [];
  const addRecent = (w: string) => {
    if (profile != null) addRecentToStore(profile.id, w);
  };
  const removeRecent = (w: string) => {
    if (profile != null) removeRecentFromStore(profile.id, w);
  };
  const langs = profile ? directionLangs(profile, direction) : null;
  const placeholder = langs ? t('search.placeholder', { lang: langs.sourceName }) : t('search.placeholderFallback');

  const [query, setQuery] = useState('');
  const [currentIdx, setCurrentIdx] = useState(0);
  // Saved-state is DERIVED from the user's saved words (cards.translation_id ↔
  // result.translationId — a stable join), not kept as screen state: a word saved
  // in a previous session must show as saved when searched again. The two local
  // sets are per-session optimistic overlays only: `saved` (sense ids just saved
  // here) and `locallyRemoved` (translationIds deleted here, pending the real
  // delete wiring — see 18 follow-up).
  const { words } = useWords();
  const [saved, setSaved] = useState<Set<string>>(new Set());
  // D10 (multi-sense cards): saved-state, removal masks, and card-id tracking are
  // all PER SENSE now — each sense of a headword can be its own card with its own
  // FSRS history ("to go" → ехать/идти/пойти).
  const [locallyRemoved, setLocallyRemoved] = useState<Set<string>>(new Set()); // sense chip ids
  const [sessionCardIds, setSessionCardIds] = useState<Map<string, string>>(new Map()); // sense id → card id
  const [justSaved, setJustSaved] = useState<string | null>(null);

  const q = query.trim();
  // Tier-0 capture gate, client-side (16 §2): instant feedback, and junk input
  // never even reaches the data source. The source re-gates authoritatively.
  const verdict = q.length >= 2 && langs ? evaluateCaptureInput(q, langs.sourceCode) : null;
  // 600ms: 250ms fired lookups on mid-word
  // typing pauses — every prefix ("hel", "hell") was an uncached lookup costing
  // up to TWO Azure calls (dictionary + MT fallback) and a junk cache row. 600ms
  // fires on a real stop-typing pause, cutting Azure spend several-fold with no
  // change to the interaction (results still appear automatically).
  const debouncedQ = useDebouncedValue(q, 600);
  const { outcome, isLoading, error: lookupError } = useLookup(
    debouncedQ,
    direction,
    debouncedQ === q && verdict?.ok === true, // wait out the debounce + the gate
  );

  // Lazy examples (16 §3): the primary sense is expanded by default in the
  // result card (per the S-series prototype), so fetch on first found-view when
  // the cache row doesn't carry examples yet. Cached once, free thereafter.
  // DWELL 700ms: only spend the Azure examples call once the
  // SAME result has stayed on screen — a prefix that flashes by while the user
  // keeps typing ("hell" en route to "hello") no longer triggers one.
  const examplesCandidate = outcome?.status === 'found' && outcome.result.examples == null ? outcome.result.translationId : null;
  const dwelledCandidate = useDebouncedValue(examplesCandidate, 700);
  const { examples: fetchedExamples } = useExamples(dwelledCandidate != null && dwelledCandidate === examplesCandidate ? dwelledCandidate : null);
  const result =
    outcome?.status === 'found'
      ? toCardResult(
          { ...outcome.result, examples: outcome.result.examples ?? fetchedExamples ?? undefined },
          t,
        )
      : null;
  // Result-quality gate (16 §2): a found result may still be unsaveable (e.g. the
  // translation echoes the input). Show the card, disable Save, explain why.
  const saveable = outcome?.status === 'found' ? outcome.result.quality !== 'unsaveable' : true;
  const noticeText =
    outcome?.status === 'found' && outcome.result.quality === 'unsaveable'
      ? t(qualityReasonI18nKey(outcome.result.qualityReason ?? 'echo'))
      : undefined;
  const rejectReason = verdict != null && !verdict.ok ? verdict.reason : outcome?.status === 'rejected' ? outcome.reason : null;
  const phase: 'recents' | 'typing' | 'results' | 'noresults' | 'rejected' | 'error' =
    q === ''
      ? 'recents'
      : rejectReason != null
        ? 'rejected'
        : lookupError != null
          ? 'error'
          : q.length < 2 || isLoading || (verdict?.ok === true && outcome == null)
            ? 'typing'
            : result != null
              ? 'results'
              : 'noresults';

  // New headword → reset the expanded sense to the primary (render-adjust
  // pattern, same as Sheet's mount logic — not an effect).
  const headword = result?.sourceText;
  const [lastHeadword, setLastHeadword] = useState(headword);
  if (headword !== lastHeadword) {
    setLastHeadword(headword);
    setCurrentIdx(0);
  }

  // The set the card renders: server truth plus this session's optimistic adds,
  // minus this session's per-sense deletes. D10: EVERY sense with a saved card
  // marks — match each saved word row (target = custom_back ?? primary) to its
  // sense chip by text; a row that matches no chip falls back to the primary
  // sense (pre-D10 cards).
  const savedIds = useMemo(() => {
    const set = new Set(saved);
    if (outcome?.status === 'found' && result != null) {
      const tid = outcome.result.translationId;
      for (const w of words) {
        if (w.translationId !== tid) continue;
        const sense = result.translations.find((tr) => tr.word === w.target) ?? result.translations[0];
        if (sense != null && !locallyRemoved.has(sense.id)) set.add(sense.id);
      }
    }
    return set;
  }, [saved, locallyRemoved, outcome, result, words]);

  const saveCard = useSaveCard();
  const deleteCard = useDeleteCard();
  const save = (i: number) => {
    if (result == null || outcome?.status !== 'found' || !saveable) return;
    const tid = outcome.result.translationId;
    const id = result.translations[i].id;
    // Optimistic UI on the sense chip. D10: senses are independent cards —
    // saving one never touches its siblings.
    setSaved((s) => new Set(s).add(id));
    setLocallyRemoved((s) => {
      if (!s.has(id)) return s;
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    setJustSaved(id);
    setTimeout(() => setJustSaved(null), 1500);
    addRecent(q);
    saveCard.mutate(
      { translationId: tid, custom: i > 0 ? { back: result.translations[i].word } : undefined },
      {
        onSuccess: (cardId) => {
          if (cardId != null) setSessionCardIds((m) => new Map(m).set(id, cardId));
        },
        onError: (e) => {
          setSaved((s) => {
            const n = new Set(s);
            n.delete(id);
            return n;
          });
          // Server-enforced free-tier cap (3.2) → this IS the value moment; route
          // to the paywall rather than showing a dead error.
          if (e instanceof Error && e.message.includes('free_word_cap')) router.push('/paywall');
        },
      },
    );
  };
  // Delete-from-results goes through the SAME confirmation as every other delete
  // surface (shared ConfirmDialog + wordList.delete* copy): a saved word carries
  // study history, so un-saving it is destructive, not a toggle.
  const [pendingUnsave, setPendingUnsave] = useState<number | null>(null);
  const confirmUnsave = () => {
    const i = pendingUnsave;
    setPendingUnsave(null);
    if (result == null || i == null || outcome?.status !== 'found') return;
    const tid = outcome.result.translationId;
    const sense = result.translations[i];
    // Optimistic clear (also covers mock mode, where nothing persists) …
    setSaved((s) => {
      const n = new Set(s);
      n.delete(sense.id);
      return n;
    });
    setLocallyRemoved((s) => new Set(s).add(sense.id));
    // … then the REAL delete (A12b, sense-scoped per D10): this session's save
    // id, else the words row whose content IS this sense. On failure, unmask.
    const cardId =
      sessionCardIds.get(sense.id) ??
      words.find((w) => w.translationId === tid && w.target === sense.word)?.id ??
      (i === 0 ? words.find((w) => w.translationId === tid)?.id : undefined);
    if (cardId != null) {
      deleteCard.mutate(cardId, {
        onError: () => {
          setLocallyRemoved((s) => {
            const n = new Set(s);
            n.delete(sense.id);
            return n;
          });
        },
      });
    }
  };

  return (
    <View style={styles.fill}>
      <View style={styles.handle} />
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.closeSearch')} testID="search-close" style={styles.close}>
          <IconXClose />
        </Pressable>
        <DirectionToggle direction={direction} onChange={setDirection} profile={profile} />
        {/* Phase D (item 3.1.1): the global language indicator — the toggle shows
            the pair per-direction; this is the switch-affordance for the PAIR. */}
        <View style={styles.headerSpacer}>
          <LanguageIndicator compact />
        </View>
      </View>

      {/* 18 §F2: walkthrough anchor (w3 — "search & save here"). */}
      <View ref={(node) => { tourTargets.searchInput.current = node; }} collapsable={false}>
        <SearchBar value={query} onChange={setQuery} placeholder={placeholder} />
      </View>

      {/* Recents live OUTSIDE the content scroll: the fade mask must stay fixed
          relative to the search input while the list scrolls beneath it. */}
      {phase === 'recents' ? (
        <View key="recents" style={styles.fill}>
          <RecentList recents={recents} onTap={setQuery} onDismiss={removeRecent} />
        </View>
      ) : (
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        {phase === 'typing' && (
          <View key="typing">
            <SkeletonCard typed={q} />
          </View>
        )}
        {phase === 'results' && result != null && (
          <View key="results" style={styles.resultWrap}>
            <TranslationCard
              result={result}
              sourceLang={langs?.sourceShort}
              targetLang={langs?.targetShort}
              currentIdx={currentIdx}
              onSetCurrent={setCurrentIdx}
              savedIds={savedIds}
              justSavedId={justSaved}
              saveable={saveable}
              noticeText={noticeText}
              onSave={save}
              onDelete={setPendingUnsave}
            />
          </View>
        )}
        {phase === 'noresults' && (
          <View key="noresults">
            <EmptyState
              title={t('search.noResultsTitle')}
              body={t('search.noResultsBody')}
              networkNote={t('search.noResultsNetwork')}
            />
          </View>
        )}
        {phase === 'rejected' && rejectReason != null && (
          <View key="rejected">
            <EmptyState title={t('capture.rejectedTitle')} body={t(captureReasonI18nKey(rejectReason), { lang: langs?.sourceName ?? '' })} />
          </View>
        )}
        {/* Service failure ≠ "no results" (429-hardening): rate-limited/throttled
            reads as "busy, try again shortly"; anything else as unavailable. The
            user retries by pausing typing again — no auto-retry into a throttle. */}
        {phase === 'error' && (
          <View key="error">
            <EmptyState
              title={t(lookupError === 'busy' ? 'search.busyTitle' : 'search.unavailableTitle')}
              body={t(lookupError === 'busy' ? 'search.busyBody' : 'search.unavailableBody')}
            />
          </View>
        )}
      </ScrollView>
      )}

      {/* Shared delete confirmation — identical prompt to the Word List surfaces. */}
      <ConfirmDialog
        visible={pendingUnsave != null}
        icon={<IconTrash size={22} color={theme.color.danger} />}
        title={t('wordList.deleteTitle', { word: pendingUnsave != null ? (result?.translations[pendingUnsave]?.word ?? '') : '' })}
        body={t('wordList.deleteBody')}
        confirmLabel={t('wordList.deleteConfirm')}
        destructive
        onConfirm={confirmUnsave}
        onClose={() => setPendingUnsave(null)}
      />
    </View>
  );
}

// Modal route: the same SearchView wrapped in a Screen, dismissed via router.back().
export function SearchScreen() {
  const router = useRouter();
  return (
    <Screen edges={['top', 'bottom']}>
      <SearchView onClose={() => router.back()} />
    </Screen>
  );
}

// ── Search-specific pieces (not reused → live here) ──────────────────────────

function IconXClose() {
  const { theme } = useUnistyles();
  return <IconX size={18} color={theme.color.textBody} />;
}

function DirectionToggle({
  direction,
  onChange,
  profile,
}: {
  direction: SearchDirection;
  onChange: (d: SearchDirection) => void;
  profile?: Profile;
}) {
  const { theme } = useUnistyles();
  const opts: SearchDirection[] = ['native_to_target', 'target_to_native'];
  return (
    <View style={styles.dirWrap}>
      <View style={styles.segmented}>
        {opts.map((value) => {
          const isActive = direction === value;
          const langs = profile ? directionLangs(profile, value) : null;
          const label = langs ? `${langs.sourceShort} → ${langs.targetShort}` : '· → ·';
          return (
            <Pressable
              key={value}
              onPress={() => onChange(value)}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              style={[styles.segBtn, isActive && { backgroundColor: theme.color.brand }]}
            >
              <RawText style={[styles.segText, { color: isActive ? '#fff' : theme.color.textMuted, fontFamily: isActive ? theme.fonts.mono.bold : theme.fonts.mono.regular }]}>
                {label}
              </RawText>
            </Pressable>
          );
        })}
      </View>
      {/* 18 §A3: the full-sentence direction hint was cut — the toggle labels and
          the search-bar placeholder already state the direction. */}
    </View>
  );
}

function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (s: string) => void; placeholder: string }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const hasValue = value.length > 0;
  return (
    <View style={styles.searchPad}>
      <View style={[styles.searchBox, { borderColor: hasValue ? theme.color.brand : theme.color.border }]}>
        <IconSearch size={17} color={hasValue ? theme.color.brand : theme.color.textMuted} />
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={theme.color.textFaint}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          // Maestro tap target (word-capture.yaml) — taps by id, never by
          // placeholder text (placeholder is locale/profile-dependent).
          testID="search-input"
          maxFontSizeMultiplier={FONT_SCALE_MAX}
          style={[styles.searchInput, { fontFamily: hasValue ? theme.fonts.serif.regular : theme.fonts.sans.regular }]}
        />
        {hasValue && (
          <Pressable onPress={() => onChange('')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('search.clear')} testID="search-clear" style={styles.clear}>
            <IconX size={11} color={theme.color.textMuted} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

// RecentList (18-session rework) — a vertical "floating" history under the search
// input with a FIXED fade mask: rows begin fading ~50% down the pane and are fully
// faded by ~90%. The list scrolls BENEATH the mask, so older searches surface into
// clarity as the user scrolls — a visible-but-unobtrusive history.
function RecentList({ recents, onTap, onDismiss }: { recents: string[]; onTap: (w: string) => void; onDismiss: (w: string) => void }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  if (recents.length === 0) return null;
  const canvas = theme.color.canvas;
  return (
    <View style={styles.recentPane}>
      <RawText style={styles.recentLabel}>{t('search.recent')}</RawText>
      <View style={styles.recentListWrap}>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.recentListContent} automaticallyAdjustKeyboardInsets>
          {recents.map((word) => (
            <View key={word}>
              <Pressable onPress={() => onTap(word)} accessibilityRole="button" style={({ pressed }) => [styles.recentRow, pressed && { opacity: 0.6 }]}>
                <IconClock size={13} color={theme.color.textFaint} />
                <RawText style={styles.recentWord} numberOfLines={1}>{word}</RawText>
                <Pressable onPress={() => onDismiss(word)} hitSlop={10} accessibilityLabel={t('search.removeA11y', { word })} style={styles.recentX}>
                  <IconX size={11} color={theme.color.textMuted} />
                </Pressable>
              </Pressable>
            </View>
          ))}
        </ScrollView>
        {/* Fixed fade mask: canvas-colored gradient, alpha 0 → 1 between 50% and
            90% of the pane (fully opaque below). pointerEvents none — the list
            underneath keeps scrolling. */}
        <Svg style={RNStyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
          <Defs>
            <LinearGradient id="recentsFade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0.5" stopColor={canvas} stopOpacity="0" />
              <Stop offset="0.9" stopColor={canvas} stopOpacity="1" />
              <Stop offset="1" stopColor={canvas} stopOpacity="1" />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#recentsFade)" />
        </Svg>
      </View>
    </View>
  );
}

function SkeletonCard({ typed }: { typed: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.skelWrap}>
      <RawText style={styles.skelCaption}>{t('search.translating', { typed })}</RawText>
      <View style={styles.skelCard}>
        <View style={styles.skelRow}>
          <View style={[styles.skel, { height: 36, width: '50%' }]} />
          <View style={[styles.skel, { height: 14, width: '28%' }]} />
        </View>
        <View style={[styles.skel, { height: 24, width: '65%', marginBottom: 10 }]} />
        <View style={styles.skelRow}>
          <View style={[styles.skel, { height: 28, width: 70, borderRadius: 14 }]} />
          <View style={[styles.skel, { height: 28, width: 60, borderRadius: 14 }]} />
          <View style={[styles.skel, { height: 28, width: 66, borderRadius: 14 }]} />
        </View>
        <View style={[styles.skel, { height: 13, width: '88%', marginBottom: 7 }]} />
        <View style={[styles.skel, { height: 13, width: '70%', marginBottom: 20 }]} />
        <View style={[styles.skel, { height: 48, borderRadius: 14 }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, palette, fonts } = theme;
  return {
    fill: { flex: 1 },
    handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: palette.slate[300], alignSelf: 'center', marginTop: 8, marginBottom: 4 },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 4, paddingBottom: 2 },
    close: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    headerSpacer: { minWidth: 32, alignItems: 'flex-end' },

    dirWrap: { flex: 1, alignItems: 'center', gap: 7 },
    segmented: { flexDirection: 'row', backgroundColor: palette.slate[100], borderRadius: 10, padding: 3, gap: 2 },
    segBtn: { paddingVertical: 6, paddingHorizontal: 18, borderRadius: 8 },
    segText: { fontSize: 13 },

    searchPad: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10 },
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: palette.slate[50],
      borderRadius: 14,
      borderWidth: theme.borderWidth.base,
      paddingVertical: 11,
      paddingHorizontal: 14,
    },
    searchInput: { flex: 1, fontSize: 16, color: color.textStrong, padding: 0 },
    clear: { width: 20, height: 20, borderRadius: 10, backgroundColor: palette.slate[300], alignItems: 'center', justifyContent: 'center' },

    content: { paddingBottom: 32 },
    resultWrap: { paddingHorizontal: 16, paddingTop: 8 },

    recentPane: { flex: 1, paddingHorizontal: 16, paddingTop: 4 },
    recentListWrap: { flex: 1, position: 'relative' },
    recentListContent: { paddingBottom: 24 },
    recentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11 },
    recentWord: { flex: 1, fontFamily: fonts.serif.regular, fontSize: 16, color: color.textBody },
    recentX: { width: 18, height: 18, borderRadius: 9, backgroundColor: palette.slate[200], alignItems: 'center', justifyContent: 'center' },
    recentLabel: { fontFamily: fonts.sans.bold, fontSize: 10, color: color.textMuted, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 10 },

    skelWrap: { paddingHorizontal: 16, paddingTop: 8 },
    skelCaption: { fontFamily: fonts.serif.regular, fontSize: 13, color: color.textMuted, marginBottom: 14 },
    skelTyped: { fontFamily: fonts.serif.regular, fontStyle: 'italic', color: color.textBody },
    skelCard: { backgroundColor: color.surfaceCard, borderWidth: theme.borderWidth.thin, borderColor: color.border, borderRadius: 18, padding: 18 },
    skelRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', marginBottom: 16 },
    skel: { backgroundColor: color.skeletonBase, borderRadius: 6 },
  };
});
