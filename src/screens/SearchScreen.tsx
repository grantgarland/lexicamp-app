// SearchScreen (S-01…S-04) — the capture flow, assembled against search/Search.html.
// Full-screen route (pushed from the Home FAB). Composes the kit (Screen,
// TranslationCard, EmptyState) + Search-specific pieces built inline: DirectionToggle,
// SearchBar, RecentChips, SkeletonCard. Lookup is mocked behind one seam.
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { directionLangs } from '@/domain/derive';
import type { Profile, SearchDirection } from '@/domain/types';
import { useTranslation } from '@/i18n';
import { useProfile } from '@/query/hooks';
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

// TODO(P4 data): replace with the real translate/dictionary lookup (returns null when
// the word isn't found → drives the no-results state).
function mockLookup(q: string, direction: SearchDirection): TranslationResult {
  // The translated word is in the TARGET language: native_to_target → learning
  // lang, target_to_native → native lang. For this profile that's EN→ES vs ES→EN,
  // so target_to_native is the one that resolves to English.
  const toEN = direction === 'target_to_native';
  return {
    sourceText: q,
    phonetic: toEN ? '/…/' : '/…/',
    pos: 'noun',
    translations: [
      {
        id: 't1',
        word: toEN ? 'translation' : 'traducción',
        pos: 'noun',
        example: { source: `Una frase con ${q}.`, target: `A sentence with ${q}.` },
        details: [{ label: 'gender', value: 'feminine' }],
      },
      { id: 't2', word: toEN ? 'rendering' : 'versión', pos: 'noun' },
    ],
  };
}

// SearchView — the search body. Reused both as the modal route (SearchScreen) and
// as an in-Home overlay (so the bottom nav can stay visible). Closes via `onClose`.
export function SearchView({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
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
  const result = q.length >= 2 ? mockLookup(q, direction) : null;
  const phase: 'recents' | 'typing' | 'results' | 'noresults' =
    q === '' ? 'recents' : q.length < 2 ? 'typing' : result ? 'results' : 'noresults';

  const save = (i: number) => {
    if (result == null) return;
    const id = result.translations[i].id;
    setSaved((s) => new Set(s).add(id));
    setJustSaved(id);
    setTimeout(() => setJustSaved(null), 1500);
    addRecent(q);
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
