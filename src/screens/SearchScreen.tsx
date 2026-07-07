// SearchScreen (S-01…S-04) — the capture flow, assembled against search/Search.html.
// Full-screen route (pushed from the Home FAB). Composes the kit (Screen,
// TranslationCard, EmptyState) + Search-specific pieces built inline: DirectionToggle,
// SearchBar, RecentChips, SkeletonCard. Lookup flows through DataSource.lookup()
// (2.1): Tier-0 capture gate client-side for instant feedback → debounced query
// through the state layer (mock now, translate Edge Function via SupabaseDataSource).
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { captureReasonI18nKey, evaluateCaptureInput } from '@/domain/capture';
import { directionLangs } from '@/domain/derive';
import { type LookupResult, posTagI18nKey } from '@/domain/translation';
import type { Profile, SearchDirection } from '@/domain/types';
import { useTranslation } from '@/i18n';
import { useExamples, useLookup, useProfile, useSaveCard } from '@/query/hooks';
import { usePrefsStore } from '@/store/prefsStore';
import {
  EmptyState,
  FONT_SCALE_MAX,
  IconClock,
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
              target: `${example.targetPrefix}${example.targetTerm}${example.targetSuffix}`,
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
  const router = useRouter();
  // Direction + recents are per-device prefs (03) → the prefs store, not local state.
  const direction = usePrefsStore((s) => s.searchDirection);
  const setDirection = usePrefsStore((s) => s.setSearchDirection);
  const recents = usePrefsStore((s) => s.recents);
  const addRecent = usePrefsStore((s) => s.addRecent);
  const removeRecent = usePrefsStore((s) => s.removeRecent);

  // The language PAIR is a per-user fact (profiles.native_lang / learning_lang, 03);
  // direction just picks which way to read it. Resolve both into the labels the UI shows.
  const profile = useProfile();
  const langs = profile ? directionLangs(profile, direction) : null;
  const placeholder = langs ? t('search.placeholder', { lang: langs.sourceName }) : t('search.placeholderFallback');

  const [query, setQuery] = useState('');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [justSaved, setJustSaved] = useState<string | null>(null);

  const q = query.trim();
  // Tier-0 capture gate, client-side (16 §2): instant feedback, and junk input
  // never even reaches the data source. The source re-gates authoritatively.
  const verdict = q.length >= 2 && langs ? evaluateCaptureInput(q, langs.sourceCode) : null;
  const debouncedQ = useDebouncedValue(q, 250);
  const { outcome, isLoading } = useLookup(
    debouncedQ,
    direction,
    debouncedQ === q && verdict?.ok === true, // wait out the debounce + the gate
  );

  // Lazy examples (16 §3): the primary sense is expanded by default in the
  // result card (per the S-series prototype), so fetch on first found-view when
  // the cache row doesn't carry examples yet. Cached once, free thereafter.
  const { examples: fetchedExamples } = useExamples(
    outcome?.status === 'found' && outcome.result.examples == null ? outcome.result.translationId : null,
  );
  const result =
    outcome?.status === 'found'
      ? toCardResult(
          { ...outcome.result, examples: outcome.result.examples ?? fetchedExamples ?? undefined },
          t,
        )
      : null;
  const rejectReason = verdict != null && !verdict.ok ? verdict.reason : outcome?.status === 'rejected' ? outcome.reason : null;
  const phase: 'recents' | 'typing' | 'results' | 'noresults' | 'rejected' =
    q === ''
      ? 'recents'
      : rejectReason != null
        ? 'rejected'
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

  const saveCard = useSaveCard();
  const save = (i: number) => {
    if (result == null || outcome?.status !== 'found') return;
    const id = result.translations[i].id;
    // Optimistic UI on the sense chip; the persisted card references the cache
    // row (primary sense) via save_card — see DataSource.saveCard.
    setSaved((s) => new Set(s).add(id));
    setJustSaved(id);
    setTimeout(() => setJustSaved(null), 1500);
    addRecent(q);
    saveCard.mutate(outcome.result.translationId, {
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
    });
  };
  const unsave = (i: number) => {
    if (result == null) return;
    const id = result.translations[i].id;
    setSaved((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
  };

  return (
    <View style={styles.fill}>
      <View style={styles.handle} />
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.closeSearch')} style={styles.close}>
          <IconXClose />
        </Pressable>
        <DirectionToggle direction={direction} onChange={setDirection} profile={profile} />
        <View style={styles.headerSpacer} />
      </View>

      <SearchBar value={query} onChange={setQuery} placeholder={placeholder} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {phase === 'recents' && (
          <Animated.View key="recents" entering={FadeIn.duration(200)} exiting={FadeOut.duration(140)}>
            <RecentChips recents={recents} onTap={setQuery} onDismiss={removeRecent} />
          </Animated.View>
        )}
        {phase === 'typing' && (
          <Animated.View key="typing" entering={FadeIn.duration(200)} exiting={FadeOut.duration(140)}>
            <SkeletonCard typed={q} />
          </Animated.View>
        )}
        {phase === 'results' && result != null && (
          <Animated.View key="results" entering={FadeIn.duration(220)} exiting={FadeOut.duration(140)} style={styles.resultWrap}>
            <TranslationCard
              result={result}
              sourceLang={langs?.sourceShort}
              targetLang={langs?.targetShort}
              currentIdx={currentIdx}
              onSetCurrent={setCurrentIdx}
              savedIds={saved}
              justSavedId={justSaved}
              onSave={save}
              onDelete={unsave}
            />
          </Animated.View>
        )}
        {phase === 'noresults' && (
          <Animated.View key="noresults" entering={FadeIn.duration(220)} exiting={FadeOut.duration(140)}>
            <EmptyState
              title={t('search.noResultsTitle')}
              body={t('search.noResultsBody')}
              networkNote={t('search.noResultsNetwork')}
            />
          </Animated.View>
        )}
        {phase === 'rejected' && rejectReason != null && (
          <Animated.View key="rejected" entering={FadeIn.duration(220)} exiting={FadeOut.duration(140)}>
            <EmptyState title={t('capture.rejectedTitle')} body={t(captureReasonI18nKey(rejectReason))} />
          </Animated.View>
        )}
      </ScrollView>
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
  const { t } = useTranslation();
  const opts: SearchDirection[] = ['native_to_target', 'target_to_native'];
  const active = profile ? directionLangs(profile, direction) : null;
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
      {active && <RawText style={styles.dirHint}>{t('search.dirHint', { source: active.sourceName, target: active.targetName })}</RawText>}
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
          maxFontSizeMultiplier={FONT_SCALE_MAX}
          style={[styles.searchInput, { fontFamily: hasValue ? theme.fonts.serif.regular : theme.fonts.sans.regular }]}
        />
        {hasValue && (
          <Pressable onPress={() => onChange('')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('search.clear')} style={styles.clear}>
            <IconX size={11} color={theme.color.textMuted} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

function RecentChips({ recents, onTap, onDismiss }: { recents: string[]; onTap: (w: string) => void; onDismiss: (w: string) => void }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  if (recents.length === 0) return null;
  return (
    <View style={styles.recentPad}>
      <RawText style={styles.recentLabel}>{t('search.recent')}</RawText>
      <View style={styles.chipRow}>
        {recents.map((word, i) => (
          <Animated.View key={word} entering={FadeIn.duration(180).delay(i * 40)} exiting={FadeOut.duration(120)}>
            <Pressable onPress={() => onTap(word)} accessibilityRole="button" style={styles.chip}>
              <IconClock size={12} color={theme.color.textFaint} />
              <RawText style={styles.chipText}>{word}</RawText>
              <Pressable onPress={() => onDismiss(word)} hitSlop={8} accessibilityLabel={t('search.removeA11y', { word })} style={styles.chipX}>
                <IconX size={9} color={theme.color.textMuted} />
              </Pressable>
            </Pressable>
          </Animated.View>
        ))}
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
    headerSpacer: { width: 32 },

    dirWrap: { flex: 1, alignItems: 'center', gap: 7 },
    segmented: { flexDirection: 'row', backgroundColor: palette.slate[100], borderRadius: 10, padding: 3, gap: 2 },
    segBtn: { paddingVertical: 6, paddingHorizontal: 18, borderRadius: 8 },
    segText: { fontSize: 13 },
    dirHint: { fontFamily: fonts.mono.regular, fontSize: 11, color: color.textMuted, letterSpacing: 0.1 },

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

    recentPad: { paddingHorizontal: 16, paddingTop: 4 },
    recentLabel: { fontFamily: fonts.sans.bold, fontSize: 10, color: color.textMuted, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 10 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: palette.slate[50],
      borderWidth: theme.borderWidth.thin,
      borderColor: color.border,
      borderRadius: 20,
      paddingVertical: 7,
      paddingLeft: 12,
      paddingRight: 10,
    },
    chipText: { fontFamily: fonts.serif.regular, fontSize: 14, color: color.textBody },
    chipX: { width: 16, height: 16, borderRadius: 8, backgroundColor: palette.slate[200], alignItems: 'center', justifyContent: 'center' },

    skelWrap: { paddingHorizontal: 16, paddingTop: 8 },
    skelCaption: { fontFamily: fonts.serif.regular, fontSize: 13, color: color.textMuted, marginBottom: 14 },
    skelTyped: { fontFamily: fonts.serif.regular, fontStyle: 'italic', color: color.textBody },
    skelCard: { backgroundColor: color.surfaceCard, borderWidth: theme.borderWidth.thin, borderColor: color.border, borderRadius: 18, padding: 18 },
    skelRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', marginBottom: 16 },
    skel: { backgroundColor: color.skeletonBase, borderRadius: 6 },
  };
});
