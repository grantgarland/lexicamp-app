// HomeScreen (H-01, "words due") — assembled against home/Home.html. Composes the
// kit (Screen, MasteryCard, TabBar) plus Home-specific pieces (greeting + streak,
// the "Ready to review" study CTA, the quick-stat tiles). Reads from the app store:
// `useHomeData()` (TanStack Query over the DataSource) returns a snapshot DERIVED
// from real card fixtures, so the DevBadge scenario drives the screen variant.
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet as RNStyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { useHomeData, useProgressData } from '@/query/hooks';
import { LanguageIndicator } from '@/screens/shared/LanguageSwitcher';
import { usePrefsStore } from '@/store/prefsStore';
import { useUiStore } from '@/store/uiStore';

import {
  HowItWorksList,
  IconArrowRight,
  IconBook,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconFire,
  IconInfo,
  IconMountain,
  MasteryCard,
  RawText,
  Screen,
  Sheet,
  Tooltip,
} from '@/ui';

// Day/month names are localized (`date.days` / `date.months` arrays); the label shape
// is its own key so word order can differ per language ("June 30" vs "30 de junio").
function todayLabel(t: TFunction) {
  const d = new Date();
  const days = t('date.days', { returnObjects: true }) as string[];
  const months = t('date.months', { returnObjects: true }) as string[];
  return t('date.todayLabel', { weekday: days[d.getDay()], month: months[d.getMonth()], day: d.getDate() });
}

export function HomeScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const { snapshot, streakDays } = useHomeData();
  const eduCardDismissed = usePrefsStore((s) => s.eduCardDismissed);
  const isEmpty = snapshot?.isEmpty ?? false;
  // The educator card is permanent while the deck is empty (first-run teaching);
  // afterwards it honors the persisted dismissal (17 §H3 — content stays
  // reachable via Settings → How Lexicamp works).
  const showEdu = isEmpty || !eduCardDismissed;
  return (
    <Screen edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <GreetingRow dateLabel={todayLabel(t)} streakDays={streakDays} subline={isEmpty ? t('home.firstDayOnMountain') : undefined} />
        {snapshot != null && (
          <>
            <MasteryCard tierCounts={snapshot.tierCounts} wordsSaved={snapshot.wordsSaved} isEmpty={isEmpty} />
            {isEmpty ? (
              <AddFirstWordCard onAdd={() => setSearchOpen(true)} />
            ) : (
              <>
                {/* ONE due number app-wide (17 §H1/X1): everything ready now, incl. overdue. */}
                {snapshot.needRecallTotal > 0 ? (
                  <StudyCard due={snapshot.needRecallTotal} onStudy={() => router.push('/quiz')} />
                ) : (
                  <CaughtUpCard dueTomorrow={snapshot.dueTomorrow} onStudyAhead={() => router.push('/quiz')} />
                )}
                <StatTiles mastered={snapshot.masteredCount} addedToday={snapshot.addedToday} dueTomorrow={snapshot.dueTomorrow} />
              </>
            )}
            {showEdu && <HowItWorksCard defaultOpen={isEmpty} dismissible={!isEmpty} />}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function GreetingRow({ dateLabel, streakDays, subline }: { dateLabel: string; streakDays: number; subline?: string }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const [streakOpen, setStreakOpen] = useState(false);
  // bestStreak rides the already-cached progress-stats query (17 §H4).
  const { bestStreak } = useProgressData();
  const hot = streakDays > 1;
  const fg = hot ? theme.palette.amber[600] : theme.palette.slate[500];
  return (
    <View style={styles.greetRow}>
      <View style={styles.greetText}>
        <RawText style={styles.date}>{dateLabel}</RawText>
        {subline != null && <RawText style={styles.subline}>{subline}</RawText>}
      </View>
      {/* Phase D: global active-language indicator (18 §D5) */}
      <View style={styles.greetLang}>
        <LanguageIndicator />
      </View>
      <Pressable
        onPress={() => setStreakOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t('home.dayStreakA11y', { count: streakDays })}
        style={({ pressed }) => [
          styles.streak,
          {
            backgroundColor: hot ? theme.palette.amber[50] : theme.palette.slate[50],
            borderColor: hot ? theme.palette.amber[200] : theme.palette.slate[200],
          },
          pressed && { opacity: 0.7 },
        ]}
      >
        <View style={styles.streakTop}>
          <IconFire size={18} color={hot ? theme.color.accent : theme.palette.slate[400]} />
          <RawText style={[styles.streakNum, { color: fg }]}>{streakDays}</RawText>
        </View>
        <RawText style={[styles.streakLabel, { color: fg }]}>{t('home.dayStreak')}</RawText>
      </Pressable>

      <Sheet visible={streakOpen} onClose={() => setStreakOpen(false)} title={t('home.streakTitle')}>
        <View style={styles.streakStatsRow}>
          <View style={styles.streakStat}>
            <RawText style={styles.streakStatNum}>{streakDays}</RawText>
            <RawText style={styles.streakStatLabel}>{t('home.streakCurrent')}</RawText>
          </View>
          <View style={styles.streakStat}>
            <RawText style={styles.streakStatNum}>{Math.max(bestStreak, streakDays)}</RawText>
            <RawText style={styles.streakStatLabel}>{t('home.streakBest')}</RawText>
          </View>
        </View>
        <RawText style={styles.streakRule}>{t('home.streakRule')}</RawText>
      </Sheet>
    </View>
  );
}

function StudyCard({ due, onStudy }: { due: number; onStudy: () => void }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
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
        <RawText style={styles.studyEyebrow}>{t('home.ready')}</RawText>
        <RawText style={styles.studyNumber}>{due}</RawText>
        <RawText style={styles.studyDue}>{t('home.wordsReady')}</RawText>
        <RawText style={styles.studySub}>{t('home.studySub')}</RawText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('home.studyNow')}
          onPress={onStudy}
          style={({ pressed }) => [styles.studyBtn, pressed && styles.studyBtnPressed]}
        >
          <RawText style={styles.studyBtnText}>{t('home.studyNow')}</RawText>
          <IconArrowRight size={16} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

// Tile trio (17 §H2): Added today · Due tomorrow · Mastered. "Need recall" was cut —
// its number now IS the StudyCard hero (X1) — and Mastered ties the daily glance to
// the mountain goal, mirroring Progress.
function StatTiles({ mastered, addedToday, dueTomorrow }: { mastered: number; addedToday: number; dueTomorrow: number }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const tiles = [
    {
      label: t('home.statAddedToday'), value: addedToday, icon: <IconBook size={15} color={theme.color.brand} />, bg: theme.palette.blue[50], border: theme.palette.blue[100],
      tip: t('home.statAddedTodayTip'),
    },
    {
      label: t('home.statDueTomorrow'), value: dueTomorrow, icon: <IconCalendar size={15} color={theme.color.textMuted} />, bg: theme.palette.slate[50], border: theme.palette.slate[200],
      tip: t('home.statDueTomorrowTip'),
    },
    {
      label: t('home.statMastered'), value: mastered, icon: <IconMountain size={15} color={theme.color.evergreen} />, bg: theme.color.evergreenTint, border: theme.color.evergreenSoft,
      tip: t('home.statMasteredTip'),
    },
  ];
  return (
    <View style={styles.statCard}>
      <RawText style={styles.statCardHeader}>{t('home.wordTilesHeader')}</RawText>
      <View style={styles.statRow}>
        {tiles.map((tile) => (
        // The WHOLE tile is the tooltip trigger (press anywhere on the card). The ⓘ in
        // the corner is a static cue — the Tooltip's own indicator is off since the tile
        // isn't a tiny target.
        <Tooltip
          key={tile.label}
          content={tile.tip}
          indicator={false}
          style={styles.statTileTrigger}
          accessibilityLabel={t('home.statInfoA11y', { label: tile.label })}
        >
          <View style={[styles.statTile, { backgroundColor: tile.bg, borderColor: tile.border }]}>
            <View style={styles.statInfo} pointerEvents="none">
              <IconInfo size={13} color={theme.color.textMuted} />
            </View>
            <View style={styles.statIcon}>{tile.icon}</View>
            <RawText style={styles.statValue}>{tile.value}</RawText>
            <RawText style={styles.statLabel}>{tile.label}</RawText>
          </View>
        </Tooltip>
        ))}
      </View>
    </View>
  );
}

// "How Lexicamp works" educator — collapsible card (default collapsed → title +
// teaser). The accordion content is the shared `HowItWorksList` (also served from
// Settings → How Lexicamp works). Once the user has saved words it becomes
// dismissible ("Got it") with the dismissal persisted (17 §H3).
function HowItWorksCard({ defaultOpen = false, dismissible = false }: { defaultOpen?: boolean; dismissible?: boolean }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  const setEduCardDismissed = usePrefsStore((s) => s.setEduCardDismissed);
  return (
    <View style={styles.eduCard}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t('home.edu.title')}
        style={({ pressed }) => [styles.eduHeader, pressed && { opacity: 0.6 }]}
      >
        <View style={styles.eduIcon}>
          <IconMountain size={16} color={theme.color.brand} />
        </View>
        <View style={styles.eduHeaderText}>
          <RawText style={styles.eduTitle}>{t('home.edu.title')}</RawText>
          {!open && <RawText style={styles.eduTeaser}>{t('home.edu.teaser')}</RawText>}
        </View>
        {open ? (
          <IconChevronUp size={16} color={theme.color.textMuted} />
        ) : (
          <IconChevronDown size={16} color={theme.color.textMuted} />
        )}
      </Pressable>
      {open && (
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(140)} style={styles.eduList}>
          <HowItWorksList />
          {dismissible && (
            <Pressable
              onPress={() => setEduCardDismissed(true)}
              accessibilityRole="button"
              accessibilityLabel={t('home.edu.dismissA11y')}
              style={({ pressed }) => [styles.eduDismiss, pressed && { opacity: 0.6 }]}
            >
              <IconCheck size={14} color={theme.color.brand} />
              <RawText style={styles.eduDismissText}>{t('home.edu.dismiss')}</RawText>
            </Pressable>
          )}
        </Animated.View>
      )}
    </View>
  );
}

// Zero-due state (17 §H1, revised 18 §B3 + B6) — the most-seen daily surface for
// a healthy user. ONE CTA: "Study ahead" (a session filled with the next-due
// words — legitimate early review; the queue is FSRS-ordered, never arbitrary).
// No capture CTA here: this card only renders when words exist, and the nav's
// search FAB already owns capture — stacking a second add-word button was
// competing with prime real estate (Casey, 2026-07-16).
function CaughtUpCard({ dueTomorrow, onStudyAhead }: { dueTomorrow: number; onStudyAhead: () => void }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  return (
    <View style={styles.caughtUpCard}>
      <View style={styles.caughtUpBadge}>
        <IconCheck size={18} color={theme.color.evergreen} />
      </View>
      <RawText style={styles.caughtUpTitle}>{t('home.caughtUpTitle')}</RawText>
      <RawText style={styles.caughtUpBody}>
        {dueTomorrow > 0 ? t('home.caughtUpTomorrow', { count: dueTomorrow }) : t('home.caughtUpNothing')}
      </RawText>
      <Pressable
        onPress={onStudyAhead}
        accessibilityRole="button"
        accessibilityLabel={t('home.studyAheadA11y')}
        style={({ pressed }) => [styles.caughtUpBtn, pressed && { transform: [{ scale: 0.98 }] }]}
      >
        <RawText style={styles.caughtUpBtnText}>{t('home.studyAhead')}</RawText>
      </Pressable>
    </View>
  );
}

function AddFirstWordCard({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.emptyCard}>
      <RawText style={styles.emptyTitle}>{t('home.emptyTitle')}</RawText>
      <RawText style={styles.emptyBody}>{t('home.emptyBody')}</RawText>
      <Pressable
        onPress={onAdd}
        accessibilityRole="button"
        accessibilityLabel={t('home.addWordA11y')}
        style={({ pressed }) => [styles.emptyBtn, pressed && { transform: [{ scale: 0.98 }] }]}
      >
        <RawText style={styles.emptyBtnText}>{t('home.addWord')}</RawText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, palette, fonts } = theme;
  return {
    content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, gap: 14 },

    greetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    greetText: { flex: 1 },
    greetLang: { alignSelf: 'flex-start', marginTop: 2 },
    date: { fontFamily: fonts.serif.semibold, fontSize: 24, lineHeight: 28, letterSpacing: -0.2, color: color.textStrong },
    subline: { fontFamily: fonts.sans.regular, fontSize: 13, color: color.textMuted, marginTop: 3 },
    streak: { alignItems: 'center', gap: 1, borderWidth: theme.borderWidth.base, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12 },
    streakTop: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    streakNum: { fontFamily: fonts.mono.bold, fontSize: 18 },
    streakLabel: { fontFamily: fonts.sans.semibold, fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase' },
    streakStatsRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
    streakStat: { flex: 1, alignItems: 'center', backgroundColor: palette.amber[50], borderWidth: theme.borderWidth.thin, borderColor: palette.amber[200], borderRadius: theme.radius.md, paddingVertical: 14 },
    streakStatNum: { fontFamily: fonts.serif.bold, fontSize: 30, color: color.textStrong },
    streakStatLabel: { fontFamily: fonts.sans.semibold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: color.textMuted, marginTop: 3 },
    streakRule: { fontFamily: fonts.sans.regular, fontSize: 13, lineHeight: 20, color: color.textMuted },

    caughtUpCard: {
      backgroundColor: color.evergreenTint,
      borderWidth: theme.borderWidth.base,
      borderColor: color.evergreenSoft,
      borderRadius: theme.radius.lg,
      paddingHorizontal: 22,
      paddingVertical: 24,
      alignItems: 'center',
    },
    caughtUpBadge: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
    caughtUpTitle: { fontFamily: fonts.serif.semibold, fontSize: 20, color: color.textStrong, textAlign: 'center', marginBottom: 6 },
    caughtUpBody: { fontFamily: fonts.sans.regular, fontSize: 13, lineHeight: 20, color: color.textMuted, textAlign: 'center', maxWidth: 260, marginBottom: 16 },
    caughtUpBtn: {
      alignSelf: 'stretch',
      backgroundColor: color.accent,
      borderRadius: theme.radius.md,
      paddingVertical: 13,
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: theme.shadow.accent,
    },
    caughtUpBtnText: { fontFamily: fonts.sans.bold, fontSize: 16, color: '#fff' },

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

    eduCard: {
      backgroundColor: color.surfaceCard,
      borderWidth: theme.borderWidth.thin,
      borderColor: color.border,
      borderRadius: theme.radius.lg,
      paddingHorizontal: 16,
      paddingVertical: 14,
      boxShadow: theme.shadow.xs,
    },
    eduHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    eduIcon: {
      width: 34,
      height: 34,
      borderRadius: theme.radius.md,
      backgroundColor: palette.blue[50],
      alignItems: 'center',
      justifyContent: 'center',
    },
    eduHeaderText: { flex: 1 },
    eduTitle: { fontFamily: fonts.sans.bold, fontSize: 14, color: color.textStrong },
    eduTeaser: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted, marginTop: 2 },
    eduList: { marginTop: 8 },
    eduDismiss: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderTopWidth: theme.borderWidth.thin, borderTopColor: color.divider, paddingTop: 12, paddingBottom: 2 },
    eduDismissText: { fontFamily: fonts.sans.semibold, fontSize: 13, color: color.brand },

    statCard: { backgroundColor: color.surfaceCard, borderWidth: theme.borderWidth.thin, borderColor: color.border, borderRadius: theme.radius.lg, padding: 12 },
    statCardHeader: { fontFamily: fonts.sans.bold, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', color: color.textMuted, marginBottom: 10, marginLeft: 2 },
    statRow: { flexDirection: 'row', gap: 10 },
    statTileTrigger: { flex: 1 },
    statTile: { position: 'relative', borderWidth: theme.borderWidth.thin, borderRadius: theme.radius.md, paddingVertical: 11, paddingHorizontal: 8, alignItems: 'center' },
    statInfo: { position: 'absolute', top: 5, right: 5, zIndex: 1 },
    statIcon: { marginBottom: 4 },
    statValue: { fontFamily: fonts.mono.bold, fontSize: 17, color: color.textStrong },
    statLabel: { fontFamily: fonts.sans.medium, fontSize: 10, color: color.textMuted, marginTop: 3 },
  };
});
