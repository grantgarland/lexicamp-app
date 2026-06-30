// HomeScreen (H-01, "words due") — assembled against home/Home.html. Composes the
// kit (Screen, MasteryCard, TabBar) plus Home-specific pieces (greeting + streak,
// the "Ready to review" study CTA, the quick-stat tiles). Reads from the app store:
// `useHomeData()` (TanStack Query over the DataSource) returns a snapshot DERIVED
// from real card fixtures, so the DevBadge scenario drives the screen variant.
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet as RNStyleSheet, View } from 'react-native';
import Animated, { SlideInDown, SlideOutDown } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useHomeData } from '@/query/hooks';
import { SearchView } from './SearchScreen';

import {
  IconArrowRight,
  IconBook,
  IconCalendar,
  IconClock,
  IconFire,
  MasteryCard,
  RawText,
  Screen,
  TabBar,
} from '@/ui';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function todayLabel() {
  const d = new Date();
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function HomeScreen() {
  const [searchOpen, setSearchOpen] = useState(false);
  const { snapshot, streakDays } = useHomeData();
  const isEmpty = snapshot?.isEmpty ?? false;
  return (
    <Screen edges={['top']}>
      {/* Content area. The search overlay fills THIS (above the nav); the TabBar is a
          later sibling, so it + the FAB paint on top of the overlay → nav stays visible. */}
      <View style={styles.body}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <GreetingRow dateLabel={todayLabel()} streakDays={streakDays} subline={isEmpty ? 'First day on the mountain' : undefined} />
          {snapshot != null && (
            <>
              <MasteryCard tierCounts={snapshot.tierCounts} wordsSaved={snapshot.wordsSaved} isEmpty={isEmpty} />
              {isEmpty ? (
                <AddFirstWordCard onAdd={() => setSearchOpen(true)} />
              ) : (
                <>
                  <StudyCard due={snapshot.needRecallToday} onStudy={() => {}} />
                  <StatTiles needRecall={snapshot.needRecallTotal} addedToday={snapshot.addedToday} dueTomorrow={snapshot.dueTomorrow} />
                </>
              )}
            </>
          )}
        </ScrollView>
        {searchOpen && (
          <Animated.View
            entering={SlideInDown.duration(300)}
            exiting={SlideOutDown.duration(240)}
            style={styles.searchOverlay}
          >
            <SearchView onClose={() => setSearchOpen(false)} />
          </Animated.View>
        )}
      </View>
      <TabBar activeTab="home" sheetOpen={searchOpen} onFabPress={() => setSearchOpen((o) => !o)} />
    </Screen>
  );
}

function GreetingRow({ dateLabel, streakDays, subline }: { dateLabel: string; streakDays: number; subline?: string }) {
  const { theme } = useUnistyles();
  const hot = streakDays > 1;
  const fg = hot ? theme.palette.amber[600] : theme.palette.slate[500];
  return (
    <View style={styles.greetRow}>
      <View style={styles.greetText}>
        <RawText style={styles.date}>{dateLabel}</RawText>
        {subline != null && <RawText style={styles.subline}>{subline}</RawText>}
      </View>
      <View
        style={[
          styles.streak,
          {
            backgroundColor: hot ? theme.palette.amber[50] : theme.palette.slate[50],
            borderColor: hot ? theme.palette.amber[200] : theme.palette.slate[200],
          },
        ]}
        accessibilityLabel={`${streakDays} day streak`}
      >
        <View style={styles.streakTop}>
          <IconFire size={18} color={hot ? theme.color.accent : theme.palette.slate[400]} />
          <RawText style={[styles.streakNum, { color: fg }]}>{streakDays}</RawText>
        </View>
        <RawText style={[styles.streakLabel, { color: fg }]}>day streak</RawText>
      </View>
    </View>
  );
}

function StudyCard({ due, onStudy }: { due: number; onStudy: () => void }) {
  const { theme } = useUnistyles();
  return (
    <View style={styles.studyCard}>
      <Svg style={RNStyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id="study" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={theme.palette.blue[600]} />
            <Stop offset="1" stopColor={theme.palette.blue[500]} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" rx={theme.radius.lg} ry={theme.radius.lg} fill="url(#study)" />
      </Svg>
      <View style={styles.studyContent}>
        <RawText style={styles.studyEyebrow}>Ready to review</RawText>
        <RawText style={styles.studyNumber}>{due}</RawText>
        <RawText style={styles.studyDue}>words due today</RawText>
        <RawText style={styles.studySub}>Sharpen your memory before they fade.</RawText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Study now"
          onPress={onStudy}
          style={({ pressed }) => [styles.studyBtn, pressed && styles.studyBtnPressed]}
        >
          <RawText style={styles.studyBtnText}>Study now</RawText>
          <IconArrowRight size={16} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

function StatTiles({ needRecall, addedToday, dueTomorrow }: { needRecall: number; addedToday: number; dueTomorrow: number }) {
  const { theme } = useUnistyles();
  const tiles = [
    { label: 'Need recall', value: needRecall, icon: <IconClock size={15} color={theme.color.accent} />, bg: theme.palette.amber[50], border: theme.palette.amber[100] },
    { label: 'Added today', value: addedToday, icon: <IconBook size={15} color={theme.color.brand} />, bg: theme.palette.blue[50], border: theme.palette.blue[100] },
    { label: 'Due tomorrow', value: dueTomorrow, icon: <IconCalendar size={15} color={theme.color.textMuted} />, bg: theme.palette.slate[50], border: theme.palette.slate[200] },
  ];
  return (
    <View style={styles.statRow}>
      {tiles.map((t) => (
        <View key={t.label} style={[styles.statTile, { backgroundColor: t.bg, borderColor: t.border }]}>
          <View style={styles.statIcon}>{t.icon}</View>
          <RawText style={styles.statValue}>{t.value}</RawText>
          <RawText style={styles.statLabel}>{t.label}</RawText>
        </View>
      ))}
    </View>
  );
}

function AddFirstWordCard({ onAdd }: { onAdd: () => void }) {
  return (
    <View style={styles.emptyCard}>
      <RawText style={styles.emptyTitle}>Add your first word{'\n'}to start climbing</RawText>
      <RawText style={styles.emptyBody}>Tap below to search for a word and save it to your deck.</RawText>
      <Pressable
        onPress={onAdd}
        accessibilityRole="button"
        accessibilityLabel="Add a word"
        style={({ pressed }) => [styles.emptyBtn, pressed && { transform: [{ scale: 0.98 }] }]}
      >
        <RawText style={styles.emptyBtnText}>Add a word +</RawText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, palette, fonts } = theme;
  return {
    body: { flex: 1 },
    searchOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: color.canvas,
      borderTopLeftRadius: theme.radius.xl,
      borderTopRightRadius: theme.radius.xl,
      overflow: 'hidden',
      boxShadow: theme.shadow.xl,
    },
    content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, gap: 14 },

    greetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    greetText: { flex: 1 },
    date: { fontFamily: fonts.serif.semibold, fontSize: 24, lineHeight: 28, letterSpacing: -0.2, color: color.textStrong },
    subline: { fontFamily: fonts.sans.regular, fontSize: 13, color: color.textMuted, marginTop: 3 },
    streak: { alignItems: 'center', gap: 1, borderWidth: theme.borderWidth.base, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12 },
    streakTop: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    streakNum: { fontFamily: fonts.mono.bold, fontSize: 18 },
    streakLabel: { fontFamily: fonts.sans.semibold, fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase' },

    // No `overflow: hidden` — that would clip the Study button's glow. The gradient is
    // rounded via the SVG Rect's rx/ry instead, so the card corners still read clean.
    studyCard: { borderRadius: theme.radius.lg, boxShadow: theme.shadow.brand },
    studyContent: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 20 },
    studyEyebrow: { fontFamily: fonts.sans.medium, fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase', color: 'rgba(255, 255, 255, 0.65)', marginBottom: 4 },
    studyNumber: { fontFamily: fonts.serif.bold, fontSize: 44, letterSpacing: -0.9, color: '#fff', marginBottom: 2 },
    studyDue: { fontFamily: fonts.sans.semibold, fontSize: 15, color: '#fff', marginBottom: 3 },
    studySub: { fontFamily: fonts.sans.regular, fontSize: 13, color: 'rgba(255, 255, 255, 0.65)', marginBottom: 18 },
    studyBtn: {
      backgroundColor: color.accent,
      borderRadius: theme.radius.md,
      paddingVertical: 13,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      boxShadow: '0 4px 12px rgba(232, 119, 34, 0.4)',
    },
    studyBtnPressed: { transform: [{ scale: 0.98 }] },
    studyBtnText: { fontFamily: fonts.sans.bold, fontSize: 16, color: '#fff' },

    emptyCard: {
      backgroundColor: palette.blue[50],
      borderWidth: theme.borderWidth.base,
      borderColor: palette.blue[200],
      borderStyle: 'dashed',
      borderRadius: theme.radius.lg,
      paddingHorizontal: 22,
      paddingVertical: 28,
      alignItems: 'center',
    },
    emptyTitle: { fontFamily: fonts.serif.semibold, fontSize: 20, color: color.textStrong, textAlign: 'center', marginBottom: 8 },
    emptyBody: { fontFamily: fonts.sans.regular, fontSize: 13, lineHeight: 20, color: color.textMuted, textAlign: 'center', maxWidth: 240, marginBottom: 20 },
    emptyBtn: {
      alignSelf: 'stretch',
      backgroundColor: color.accent,
      borderRadius: theme.radius.md,
      paddingVertical: 13,
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: theme.shadow.accent,
    },
    emptyBtnText: { fontFamily: fonts.sans.bold, fontSize: 16, color: '#fff' },

    statRow: { flexDirection: 'row', gap: 10 },
    statTile: { flex: 1, borderWidth: theme.borderWidth.thin, borderRadius: theme.radius.md, paddingVertical: 11, paddingHorizontal: 8, alignItems: 'center' },
    statIcon: { marginBottom: 4 },
    statValue: { fontFamily: fonts.mono.bold, fontSize: 17, color: color.textStrong },
    statLabel: { fontFamily: fonts.sans.medium, fontSize: 10, color: color.textMuted, marginTop: 3 },
  };
});
