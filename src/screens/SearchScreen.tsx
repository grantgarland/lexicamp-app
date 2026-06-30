// SearchScreen (S-01…S-04) — the capture flow, assembled against search/Search.html.
// Full-screen route (pushed from the Home FAB). Composes the kit (Screen,
// TranslationCard, EmptyState) + Search-specific pieces built inline: DirectionToggle,
// SearchBar, RecentChips, SkeletonCard. Lookup is mocked behind one seam.
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import {
  EmptyState,
  FONT_SCALE_MAX,
  IconClock,
  IconSearch,
  IconX,
  RawText,
  Screen,
  TranslationCard,
  type TranslationDirection,
  type TranslationResult,
} from '@/ui';

const DIR_WORDS: Record<TranslationDirection, { source: string; target: string; placeholder: string }> = {
  native_to_target: { source: 'Spanish', target: 'English', placeholder: 'Type a word in Spanish…' },
  target_to_native: { source: 'English', target: 'Spanish', placeholder: 'Type a word in English…' },
};

// TODO(P4 data): replace with the real translate/dictionary lookup (returns null when
// the word isn't found → drives the no-results state).
function mockLookup(q: string, direction: TranslationDirection): TranslationResult {
  const toEN = direction === 'native_to_target';
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
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState<TranslationDirection>('native_to_target');
  const [recents, setRecents] = useState<string[]>(['montaña', 'recordar', 'fluidez']);
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
    if (!recents.includes(q)) setRecents((r) => [q, ...r].slice(0, 8));
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
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close search" style={styles.close}>
          <IconXClose />
        </Pressable>
        <DirectionToggle direction={direction} onChange={setDirection} />
        <View style={styles.headerSpacer} />
      </View>

      <SearchBar value={query} onChange={setQuery} placeholder={DIR_WORDS[direction].placeholder} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {phase === 'recents' && (
          <Animated.View key="recents" entering={FadeIn.duration(200)} exiting={FadeOut.duration(140)}>
            <RecentChips recents={recents} onTap={setQuery} onDismiss={(w) => setRecents((r) => r.filter((x) => x !== w))} />
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
              direction={direction}
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
              title="We couldn't find that one."
              body="Try checking the spelling, or this language pair may have limited coverage right now."
              networkNote="If this word should have a result, you may be offline or on a slow connection."
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

function DirectionToggle({ direction, onChange }: { direction: TranslationDirection; onChange: (d: TranslationDirection) => void }) {
  const { theme } = useUnistyles();
  const opts: { value: TranslationDirection; label: string }[] = [
    { value: 'native_to_target', label: 'ES → EN' },
    { value: 'target_to_native', label: 'EN → ES' },
  ];
  const meta = DIR_WORDS[direction];
  return (
    <View style={styles.dirWrap}>
      <View style={styles.segmented}>
        {opts.map((opt) => {
          const active = direction === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onChange(opt.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[styles.segBtn, active && { backgroundColor: theme.color.brand }]}
            >
              <RawText style={[styles.segText, { color: active ? '#fff' : theme.color.textMuted, fontFamily: active ? theme.fonts.mono.bold : theme.fonts.mono.regular }]}>
                {opt.label}
              </RawText>
            </Pressable>
          );
        })}
      </View>
      <RawText style={styles.dirHint}>Translating {meta.source} words into {meta.target}</RawText>
    </View>
  );
}

function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (s: string) => void; placeholder: string }) {
  const { theme } = useUnistyles();
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
          <Pressable onPress={() => onChange('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear" style={styles.clear}>
            <IconX size={11} color={theme.color.textMuted} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

function RecentChips({ recents, onTap, onDismiss }: { recents: string[]; onTap: (w: string) => void; onDismiss: (w: string) => void }) {
  const { theme } = useUnistyles();
  if (recents.length === 0) return null;
  return (
    <View style={styles.recentPad}>
      <RawText style={styles.recentLabel}>Recent</RawText>
      <View style={styles.chipRow}>
        {recents.map((word, i) => (
          <Animated.View key={word} entering={FadeIn.duration(180).delay(i * 40)} exiting={FadeOut.duration(120)}>
            <Pressable onPress={() => onTap(word)} accessibilityRole="button" style={styles.chip}>
              <IconClock size={12} color={theme.color.textFaint} />
              <RawText style={styles.chipText}>{word}</RawText>
              <Pressable onPress={() => onDismiss(word)} hitSlop={8} accessibilityLabel={`Remove ${word}`} style={styles.chipX}>
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
  return (
    <View style={styles.skelWrap}>
      <RawText style={styles.skelCaption}>
        Translating &ldquo;<RawText style={styles.skelTyped}>{typed}</RawText>&rdquo;…
      </RawText>
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
