// HomeScreen (H-01, "words due") — assembled against home/Home.html. Composes the
// kit (Screen, MasteryCard, TabBar) plus Home-specific pieces (greeting + streak,
// the "Ready to review" study CTA, the quick-stat tiles). Reads from the app store:
// `useHomeData()` (TanStack Query over the DataSource) returns a snapshot DERIVED
// from real card fixtures, so the DevBadge scenario drives the screen variant.
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, RefreshControl, StyleSheet as RNStyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { SOON_WINDOW_DAYS } from '@/domain/derive';
import { useIsDark } from '@/theme/appearance';
import { lh } from '@/theme/theme';
import { useTranslation } from '@/i18n';
import { useHomeData, useProgressData, useSessionPace } from '@/query/hooks';
import { usePullToRefresh } from '@/query/usePullToRefresh';
import { LanguageIndicator } from '@/screens/shared/LanguageSwitcher';
import { usePrefsStore } from '@/store/prefsStore';
import { useUiStore } from '@/store/uiStore';
import { tourTargets, useWalkthroughActive } from '@/tour/walkthrough';

import {
  BrandMark,
  HowItWorksList,
  IconArrowRight,
  IconArrowUp, IconBook,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconChevronUp,
  IconFire,
  IconInfo,
  IconMountain,
  MasteryCard,
  RawText,
  Screen,
  ScrollIntoView,
  ScrollIntoViewScrollView,
  Sheet,
  TAB_BAR_FAB_OVERHANG,
  Tooltip,
} from '@/ui';

/** Bottom clearance for the scroll content. The nav's own height is already
 *  reserved by the tabs layout's spacer, but the FAB floats above that and over
 *  the scene, so the last card needs this much room to escape it. Used TWICE and
 *  they must agree: as content padding (gives the scroll somewhere to go) and as
 *  the reveal inset (stops a `ScrollIntoView` landing content under the FAB). */
const BOTTOM_CLEARANCE = TAB_BAR_FAB_OVERHANG + 14;

/** Every query this screen renders (prefixes — see usePullToRefresh). */
const HOME_REFRESH_KEYS = ['deckCards', 'progressStats', 'engagement', 'sessionPace'] as const;

export function HomeScreen() {
  const router = useRouter();
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const { snapshot, streakDays } = useHomeData();
  const eduCardDismissed = usePrefsStore((s) => s.eduCardDismissed);
  const isEmpty = snapshot?.isEmpty ?? false;
  // The educator card is permanent while the deck is empty (first-run teaching);
  // afterwards it honors the persisted dismissal (17 §H3 — content stays
  // reachable via Settings → How Lexicamp works).
  const showEdu = isEmpty || !eduCardDismissed;
  // 18 §F2 (Casey): while the walkthrough runs, ALWAYS show the "Today's
  // review" card — w1/w5 spotlight it, and most fresh users would otherwise be
  // on the caught-up/empty variants (pointing at elements that don't exist).
  const tourActive = useWalkthroughActive();
  // Everything on this screen derives from the deck + its FSRS states, the
  // all-time stats and the streak — 'sessionPace' rides along because the study
  // card's ETA reads from it.
  const refresh = usePullToRefresh(HOME_REFRESH_KEYS);
  return (
    <Screen edges={['top']}>
      <ScrollIntoViewScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        revealInsetBottom={BOTTOM_CLEARANCE}
        refreshControl={<RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} tintColor={theme.color.textMuted} />}
      >
        <GreetingRow streakDays={streakDays} subline={isEmpty ? t('home.firstDayOnMountain') : undefined} />
        {snapshot != null && (
          <>
            <MasteryCard tierCounts={snapshot.tierCounts} wordsSaved={snapshot.wordsSaved} memoriesForming={Math.max(0, snapshot.wordsSaved - snapshot.masteredCount)} isEmpty={isEmpty} />
            {isEmpty && !tourActive ? (
              <AddFirstWordCard onAdd={() => setSearchOpen(true)} />
            ) : (
              <>
                {/* ONE due number app-wide (17 §H1/X1): everything ready now, incl. overdue. */}
                {/* collapsable={false}: Android optimizes plain Views away, which
                    breaks the walkthrough's measure() on these anchors. */}
                <View ref={(node) => { tourTargets.studyCard.current = node; }} collapsable={false}>
                  {snapshot.needRecallTotal > 0 || tourActive ? (
                    <StudyCard
                      due={snapshot.needRecallTotal}
                      dueToday={snapshot.needRecallToday}
                      dueTomorrow={snapshot.dueTomorrow}
                      onStudy={() => router.push('/quiz')}
                    />
                  ) : (
                    <CaughtUpCard dueTomorrow={snapshot.dueTomorrow} onStudyAhead={() => router.push('/quiz')} />
                  )}
                </View>
                <StatTiles almostMastered={snapshot.tierCounts[3] ?? 0} addedRecently={snapshot.addedRecently} dueSoon={snapshot.dueSoon} />
              </>
            )}
            {showEdu && <HowItWorksCard defaultOpen={isEmpty} dismissible={!isEmpty} />}
          </>
        )}
      </ScrollIntoViewScrollView>
    </Screen>
  );
}

function GreetingRow({ streakDays, subline }: { streakDays: number; subline?: string }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const [streakOpen, setStreakOpen] = useState(false);
  // Measured, not hardcoded: the brand mark is specified as "same height as the
  // streak badge", and the badge's height comes from its padding + type. A
  // literal would silently drift the first time either changes.
  const [badgeHeight, setBadgeHeight] = useState(0);
  // bestStreak rides the already-cached progress-stats query (17 §H4).
  const { bestStreak } = useProgressData();
  const isDark = useIsDark();
  // A streak of ONE is still a streak (Casey, 2026-08-04): the badge used to go
  // brand only above 1, so a user's first day — the day the habit is most
  // fragile — got the same disabled grey as no streak at all.
  const hot = streakDays > 0;
  const fg = hot ? theme.color.accentStrong : theme.palette.slate[500];
  return (
    // App-wide header shape (2026-08-04): the language toggle is ALWAYS the last
    // element of the header flex, on every screen. Here that meant giving up the
    // date — it was the widest thing in the row and shoved the toggle around as
    // the weekday name changed length — and promoting the streak badge into its
    // place, with the brand mark centred between them. Three cells: the outer
    // two flex evenly, so the mark sits on the true centre line whatever the
    // side widths do.
    <View>
      <View style={styles.greetRow}>
        <View style={styles.greetSide}>
          <Pressable
            onLayout={(e) => setBadgeHeight(e.nativeEvent.layout.height)}
            onPress={() => setStreakOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t('home.dayStreakA11y', { count: streakDays })}
            style={({ pressed }) => [
              styles.streak,
              {
                backgroundColor: hot ? theme.color.accentTint : theme.color.surfaceSunken,
                borderColor: hot ? theme.color.accentSoft : theme.color.border,
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
        </View>

        {/* 0 until the badge reports its height — render nothing rather than
            flash a wrong-sized mark on the first frame. */}
        {badgeHeight > 0 && <BrandMark size={badgeHeight} />}

        <View style={[styles.greetSide, styles.greetSideEnd]}>
          {/* Phase D: global active-language indicator (18 §D5) */}
          <LanguageIndicator />
        </View>
      </View>
      {/* First-run line. It used to sit under the date; with the date gone it
          takes its own centred row rather than crowding the header flex. */}
      {subline != null && <RawText style={styles.subline}>{subline}</RawText>}

      <Sheet visible={streakOpen} onClose={() => setStreakOpen(false)} title={t('home.streakTitle')}>
        <View style={styles.streakStatsRow}>
          <View style={[styles.streakStat, isDark && styles.streakStatDark]}>
            <RawText style={styles.streakStatNum}>{streakDays}</RawText>
            <RawText style={styles.streakStatLabel}>{t('home.streakCurrent')}</RawText>
          </View>
          <View style={[styles.streakStat, isDark && styles.streakStatDark]}>
            <RawText style={styles.streakStatNum}>{Math.max(bestStreak, streakDays)}</RawText>
            <RawText style={styles.streakStatLabel}>{t('home.streakBest')}</RawText>
          </View>
        </View>
        <RawText style={styles.streakRule}>{t('home.streakRule')}</RawText>
      </Sheet>
    </View>
  );
}

// The primary CTA on the primary screen. Redesigned 2026-07-30 (Casey): the
// card only ever said HOW MANY words were waiting, never why now — so the one
// thing Lexicamp does better than a flashcard pile, scheduling each word to the
// moment it is about to slip, was invisible on the surface that matters most.
//
// It now shows PERISHABILITY, and only from numbers already derived in
// `homeSnapshot` — no invented metrics (17 §X3 cut a fabricated reviews/day
// stat once already):
//   - `needRecallTotal - needRecallToday` = words that came due on an EARLIER
//     day and are still waiting. Real evidence the schedule is tracking time,
//     and the honest form of urgency: these are past their best moment.
//   - `dueTomorrow` = what the scheduler already has queued next, shown when
//     there is no backlog, so the card reads as a schedule rather than a pile.
//
// The WHOLE CARD is the tap target now; the button stays as the affordance.
function StudyCard({
  due,
  dueToday,
  dueTomorrow,
  onStudy,
}: {
  due: number;
  dueToday: number;
  dueTomorrow: number;
  onStudy: () => void;
}) {
  const { theme } = useUnistyles();
  const isDark = useIsDark();
  const { t } = useTranslation();
  // MEASURED, never guessed: median seconds/card over the user's own recent
  // sessions (get_session_pace). Null until they have 3 timed sessions, and
  // null means HIDE — showing "0 min" or a hardcoded constant would be the
  // fabricated-metric mistake 17 §X3 already cut once.
  const secondsPerCard = useSessionPace();
  const estMinutes =
    secondsPerCard == null ? null : Math.max(1, Math.round((due * secondsPerCard) / 60));

  // Anything due that did NOT come due today has been waiting at least a day.
  // Clamped: the two counts come from the same pass, but a clock change between
  // them should degrade to "no backlog", never to a negative.
  const backlog = Math.max(0, due - dueToday);
  const scheduleNote =
    backlog > 0
      ? t('home.studyBacklog', { count: backlog })
      : dueTomorrow > 0
        ? t('home.studyNextUp', { count: dueTomorrow })
        : null;

  return (
    <Pressable
      onPress={onStudy}
      accessibilityRole="button"
      // Maestro hook. MUST live on THIS node, not on the inner `studyCtaButton`
      // view: the explicit accessibilityLabel below makes this Pressable a single
      // iOS accessibility element, so nothing inside it — text OR testID — is
      // exposed in the hierarchy Maestro reads.
      testID="studyCard"
      // The label carries the count and the backlog, because a screen reader
      // user gets one announcement for the whole card rather than reading the
      // number, the unit and the note as three separate stops.
      accessibilityLabel={
        scheduleNote == null
          ? `${t('home.studyNow')}. ${t('home.wordsReadyA11y', { count: due })}`
          : `${t('home.studyNow')}. ${t('home.wordsReadyA11y', { count: due })} ${scheduleNote}`
      }
      style={({ pressed }) => [styles.studyCard, pressed && styles.studyCardPressed]}
    >
      <Svg style={RNStyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id="study" x1="0" y1="0" x2="1" y2="1">
            {/* Deeper navy gradient in dark so the hero reads as a rich card, not a washed mid-blue on near-black. */}
            <Stop offset="0" stopColor={isDark ? theme.palette.blue[800] : theme.palette.blue[600]} />
            <Stop offset="1" stopColor={isDark ? theme.palette.blue[600] : theme.palette.blue[500]} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" rx={theme.radius.lg} ry={theme.radius.lg} fill="url(#study)" />
      </Svg>
      <View style={styles.studyContent}>
        <RawText style={styles.studyEyebrow}>{t('home.ready')}</RawText>
        <RawText style={styles.studyNumber}>{due}</RawText>
        <RawText style={styles.studyDue}>
          {t('home.wordsReady')}
          {estMinutes != null && (
            <RawText style={styles.studyEta}>{t('home.studyEta', { count: estMinutes })}</RawText>
          )}
        </RawText>

        {scheduleNote != null && (
          <View testID="studyScheduleNote" style={styles.studyNote}>
            <IconClock size={13} color={backlog > 0 ? theme.palette.amber[300] : 'rgba(255, 255, 255, 0.85)'} />
            <RawText style={[styles.studyNoteText, backlog > 0 && { color: theme.palette.amber[300] }]}>
              {scheduleNote}
            </RawText>
          </View>
        )}

        {/* Not a Pressable any more — the card handles the press. Kept as the
            visual affordance so the action still reads as a button. */}
        <View testID="studyCtaButton" style={styles.studyBtn}>
          <RawText style={styles.studyBtnText}>{t('home.studyNow')}</RawText>
          <IconArrowRight size={16} color={theme.color.textOnAccentCta} />
        </View>
      </View>
    </Pressable>
  );
}

// Tile trio (17 §H2): Added today · Due tomorrow · Mastered. "Need recall" was cut —
// its number now IS the StudyCard hero (X1). The row reads as one horizon: what you
// added in the last few days, what falls due in the next few, and what is about to
// tip over into mastered — all sharing the Base Camp window (SOON_WINDOW_DAYS).
function StatTiles({ almostMastered, addedRecently, dueSoon }: { almostMastered: number; addedRecently: number; dueSoon: number }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const tiles = [
    {
      label: t('home.statAddedRecently'), value: addedRecently, icon: <IconBook size={15} color={theme.color.brand} />, bg: theme.color.brandTint, border: theme.color.brandSoft,
      tip: t('home.statAddedRecentlyTip', { count: SOON_WINDOW_DAYS }),
    },
    {
      label: t('home.statDueSoon'), value: dueSoon, icon: <IconCalendar size={15} color={theme.color.textMuted} />, bg: theme.color.surfaceSunken, border: theme.color.border,
      tip: t('home.statDueSoonTip', { count: SOON_WINDOW_DAYS }),
    },
    {
      // Was Mastered, which the Word Mastery card directly above already reports
      // (Casey, 2026-08-05) — the same number twice on one screen. Summit Ridge
      // is the cohort ONE good review away from mastered, so the tile now points
      // forward instead of restating an achievement. Arrow, not mountain: these
      // words are climbing, not arrived.
      label: t('home.statAlmostMastered'), value: almostMastered, icon: <IconArrowUp size={15} color={theme.color.evergreen} />, bg: theme.color.evergreenTint, border: theme.color.evergreenSoft,
      tip: t('home.statAlmostMasteredTip'),
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
//
// It is the LAST thing on Home, so opening it always reveals content below the
// fold — hence the `ScrollIntoView`. `revealOnGrowth={false}`: it reveals once,
// on open, and then hands off to the per-section `ScrollIntoView`s inside
// `HowItWorksList`. Left on, this card grows whenever one of those sections
// expands and would scroll back to the card instead of to the open section.
function HowItWorksCard({ defaultOpen = false, dismissible = false }: { defaultOpen?: boolean; dismissible?: boolean }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  const setEduCardDismissed = usePrefsStore((s) => s.setEduCardDismissed);
  // 18 §F2: guided-tour CTA inside the accordion; already on Home, so just flag it.
  const setWalkthroughRequested = useUiStore((s) => s.setWalkthroughRequested);
  return (
    <ScrollIntoView enabled={open} revealOnGrowth={false} style={styles.eduCard}>
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
          <HowItWorksList onStartTour={() => setWalkthroughRequested(true)} />
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
    </ScrollIntoView>
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
  // Same shape as StudyCard (2026-07-30): whole card is the tap target, the
  // button is the affordance, and the schedule note sits in the same slot — so
  // the two states read as one component rather than two designs. Only the
  // surface differs: calm/light when there is nothing due, the blue hero when
  // there is.
  return (
    <Pressable
      onPress={onStudyAhead}
      accessibilityRole="button"
      accessibilityLabel={`${t('home.studyAheadA11y')}. ${
        dueTomorrow > 0 ? t('home.caughtUpTomorrow', { count: dueTomorrow }) : t('home.caughtUpNothing')
      }`}
      style={({ pressed }) => [styles.caughtUpCard, pressed && styles.studyCardPressed]}
    >
      <View style={styles.caughtUpBadge}>
        <IconCheck size={18} color={theme.color.evergreen} />
      </View>
      <RawText style={styles.caughtUpTitle}>{t('home.caughtUpTitle')}</RawText>
      <RawText style={styles.caughtUpBody}>
        {dueTomorrow > 0 ? t('home.caughtUpTomorrow', { count: dueTomorrow }) : t('home.caughtUpNothing')}
      </RawText>
      <View style={styles.caughtUpBtn}>
        <RawText style={styles.caughtUpBtnText}>{t('home.studyAhead')}</RawText>
        <IconArrowRight size={16} color={theme.color.textOnAccentCta} />
      </View>
    </Pressable>
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

// One spacing value for the whole study card, so the rhythm is even by
// construction rather than by four hand-tuned margins that drift apart.
const STUDY_GAP = 14;

// The hero number needs care that the other rows don't.
//
// A tight lineHeight CLIPS it: at 44px, the design system's `tight` leading
// (1.12) gives a 49px line box, which Spectral Bold's digits overflow — the
// glyph gets cut. Every other 44px serif in the app (ProgressScreen's
// `projDays`) sets no lineHeight at all for exactly this reason.
//
// But leaving it unset is what produced the original uneven rhythm: the natural
// box adds ~1.5x of leading that no margin accounts for, so the gap under the
// number was visibly the largest on the card while declaring the smallest
// margin. So: take a leading that CANNOT clip, then subtract the half-leading
// it adds above and below from the gaps either side. The visual rhythm ends up
// even, and the number is never cut.
const STUDY_NUM_SIZE = 44;
const STUDY_NUM_LEADING = lh(STUDY_NUM_SIZE, 'normal'); // 1.5x — comfortably above the face's natural box
const STUDY_NUM_HALF_LEADING = Math.round((STUDY_NUM_LEADING - STUDY_NUM_SIZE) / 2);
/** Gap either side of the number, less the leading the line box already adds. */
const STUDY_NUM_GAP = Math.max(0, STUDY_GAP - STUDY_NUM_HALF_LEADING);

const styles = StyleSheet.create((theme) => {
  const { color, fonts } = theme;
  return {
    content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: BOTTOM_CLEARANCE, gap: 14 },

    greetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    greetSide: { flex: 1, flexDirection: 'row', alignItems: 'center' },
    greetSideEnd: { justifyContent: 'flex-end' },
    subline: { fontFamily: fonts.sans.regular, fontSize: 13, color: color.textMuted, marginTop: 8, textAlign: 'center' },
    streak: { alignItems: 'center', gap: 1, borderWidth: theme.borderWidth.base, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12 },
    streakTop: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    streakNum: { fontFamily: fonts.mono.bold, fontSize: 18 },
    streakLabel: { fontFamily: fonts.sans.semibold, fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase' },
    streakStatsRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
    streakStat: { flex: 1, alignItems: 'center', backgroundColor: color.accentTint, borderWidth: theme.borderWidth.thin, borderColor: color.accentSoft, borderRadius: theme.radius.md, paddingVertical: 14 },
    // Dark-only: accentTint (#211809) reads near-black as a card; a warmer, lighter
    // amber-brown gives the streak stat cards presence without changing light mode.
    streakStatDark: { backgroundColor: '#3a2a12', borderColor: '#55401c' },
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
    caughtUpBadge: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.surfaceCard, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
    caughtUpTitle: { fontFamily: fonts.serif.semibold, fontSize: 20, color: color.textStrong, textAlign: 'center', marginBottom: 6 },
    caughtUpBody: { fontFamily: fonts.sans.regular, fontSize: 13, lineHeight: 20, color: color.textMuted, textAlign: 'center', maxWidth: 260, marginBottom: 16 },
    caughtUpBtn: {
      alignSelf: 'stretch',
      flexDirection: 'row',
      gap: 8,
      backgroundColor: color.accentCta,
      borderRadius: theme.radius.md,
      paddingVertical: 13,
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: theme.shadow.accent,
    },
    caughtUpBtnText: { fontFamily: fonts.sans.bold, fontSize: 16, color: color.textOnAccentCta },

    // No `overflow: hidden` — that would clip the Study button's glow. The gradient is
    // rounded via the SVG Rect's rx/ry instead, so the card corners still read clean.
    // No `overflow: 'hidden'` — the gradient <Rect> already has rx/ry, so the
    // corners are rounded without it, and clipping would cut off the CTA's
    // orange glow (boxShadow) at the card edges.
    studyCard: { borderRadius: theme.radius.lg, boxShadow: theme.shadow.brand },
    studyCardPressed: { transform: [{ scale: 0.985 }], opacity: 0.95 },
    // Schedule note: amber when there is a backlog (past its best moment),
    // plain white when it is just the next-up preview.
    studyEta: { fontFamily: fonts.sans.regular, fontSize: 15, lineHeight: 20, color: 'rgba(255, 255, 255, 0.8)' },
    studyNote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: STUDY_GAP },
    studyNoteText: { fontFamily: fonts.sans.semibold, fontSize: 13, lineHeight: 18, color: 'rgba(255, 255, 255, 0.85)' },
    studyContent: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 20 },
    studyEyebrow: { fontFamily: fonts.sans.medium, fontSize: 12, lineHeight: 16, letterSpacing: 0.5, textTransform: 'uppercase', color: 'rgba(255, 255, 255, 0.65)', marginBottom: STUDY_NUM_GAP },
    // See STUDY_NUM_* above: a clip-proof line box, with its own leading
    // subtracted from the gaps either side so the rhythm still reads even.
    studyNumber: { fontFamily: fonts.serif.bold, fontSize: STUDY_NUM_SIZE, lineHeight: STUDY_NUM_LEADING, letterSpacing: -0.9, color: '#fff', marginBottom: STUDY_NUM_GAP },
    studyDue: { fontFamily: fonts.sans.semibold, fontSize: 15, lineHeight: 20, color: '#fff', marginBottom: STUDY_GAP },
    studyBtn: {
      backgroundColor: color.accentCta,
      borderRadius: theme.radius.md,
      paddingVertical: 13,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    studyBtnPressed: { transform: [{ scale: 0.98 }] },
    studyBtnText: { fontFamily: fonts.sans.bold, fontSize: 16, color: color.textOnAccentCta },

    emptyCard: {
      backgroundColor: color.brandTint,
      borderWidth: theme.borderWidth.base,
      borderColor: color.brandSoft,
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
      backgroundColor: color.accentCta,
      borderRadius: theme.radius.md,
      paddingVertical: 13,
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: theme.shadow.accent,
    },
    emptyBtnText: { fontFamily: fonts.sans.bold, fontSize: 16, color: color.textOnAccentCta },

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
      backgroundColor: color.brandTint,
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
