// QuizScreen (Q-01…Q-10) — the study session, assembled against quiz/Quiz.html.
// Reads the due queue through the state layer (`useDueCards`), buffers ratings
// in-memory, and commits the batch on completion (`useCommitQuizSession`) per 03's
// quiz write pattern. Composes the kit (QuizCardFront/Back, RatingButtons, TierBadge)
// + screen-specific phases built inline (top bar, end, stats, milestone, exit confirm).
import { useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Image, Keyboard, Pressable, ScrollView, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import Animated, { FadeIn, FadeInDown, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { gradeTypedAnswer } from '@/domain/answer';
import { applyReview, sessionPromotions, type PromotedWord } from '@/domain/fsrs';
import type { BufferedRating, QuizCardItem, UiRating } from '@/domain/quiz';
import { sessionStats, uiRatingToFsrs } from '@/domain/quiz';
import { useTranslation } from '@/i18n';
import { dueLabel } from '@/lib/relativeTime';
import { useCommitQuizSession, useDueCards, useEntitlement, useHomeData } from '@/query/hooks';
import { QUIZ_LENGTH_FREE, usePrefsStore } from '@/store/prefsStore';
import { useUiStore } from '@/store/uiStore';
import { tourFixtureCards } from '@/tour/tourFixture';
import { isQuizResultsStep, isQuizRevealStep, useTourScene } from '@/tour/tourScene';
import { tourTargets, useWalkthroughActive, WalkthroughOverlayHost } from '@/tour/walkthrough';
import { BRAND_MARK_KNOCKOUT_XML } from '@/ui/brandMark';
import {
  Button,
  Confetti,
  EmptyStateCard,
  IconArrowDown,
  IconArrowUp,
  IconInfo,
  IconMountain,
  IconX,
  QuizCardBack,
  QuizCardFront,
  QuizRevealButton,
  RatingButtons,
  RawText,
  Screen,
  TierBadge,
  Tooltip,
} from '@/ui';

// Sanctioned Pika moments only (Q-07/Q-08 end, Q-10 milestone) — assets from the brand kit.
import pikaGoodJob from '../../assets/images/pika/good-job.png';
import pikaHugs from '../../assets/images/pika/hugs.png';
import pikaCelebrate from '../../assets/images/pika/celebrate.png';

type Phase = 'quiz' | 'end' | 'stats' | 'promo';

// Session-milestone confetti (Q-10) — warm golds + a few accent flecks
// (milestone spec). Brand palette, not a tier's: the screen no longer belongs to
// any one camp.
const MILESTONE_CONFETTI = ['#e87722', '#f7a855', '#f5b91e', '#d97706', '#2f5e7e', '#459a6b', '#f472b6'];

// Per-word review outcome for the results screen — the ACTUAL FSRS recompute
// the commit persists, expressed as memory strength (days), never tiers.
// 18-session (Casey): tier promotion belongs exclusively to the milestone
// screen shown after results; conflating the two here was confusing, and the
// render-time tier recompute could even disagree with the milestone list.
// A single frozen `now` keeps every row consistent with the committed batch.
interface RowOutcome {
  before: number; // stability (days) going in
  after: number; // stability (days) after this rating
  gained: number; // after - before, floored at 0 for display
  nextLabel: string; // localized next-review label ("in 6 days", "Tomorrow"…)
  /** Still in FSRS learning steps: strength (days) and schedule (minutes)
   *  legitimately diverge — "grew to 2 days" while the next quick check is
   *  much sooner. The tooltip uses a variant line so it doesn't read as a
   *  contradiction — and BOTH lines state the next
   *  review from the computed dueAt (nextLabel), never assumed copy: FSRS
   *  intervals aren't knowable without the recompute. */
  learning: boolean;
}
function rowOutcome(t: TFunction, card: QuizCardItem, rating: UiRating, now: Date): RowOutcome {
  const { next } = applyReview(card.fsrs, uiRatingToFsrs(rating), now);
  const before = card.fsrs.stability;
  return {
    before,
    after: next.stability,
    gained: Math.max(0, next.stability - before),
    nextLabel: dueLabel(next.dueAt, t),
    learning: next.state === 1, // Learning (relearning=3 only follows 'again', which uses resultAgain)
  };
}
/** Whole days for copy; sub-day strength reads as "<1". */
const fmtDays = (d: number) => (d < 1 ? '<1' : String(Math.round(d)));

export interface QuizScreenProps {
  /** Scope the session to ONE custom deck's membership (2026-07-30). Omitted =
   *  the whole active language, which is Home's "Study now". */
  deckId?: string;
  /** Display-only: titles the empty state so a deck session that yields nothing
   *  says which deck. The session itself is composed from `deckId`. */
  deckName?: string;
}

export function QuizScreen({ deckId, deckName }: QuizScreenProps = {}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  // Session size = the persisted quiz-length pref (17 §S2 / 18 §2c); free tier
  // pinned. The DataSource composes the session: due-now first, filled with
  // next-due upcoming words to the cap — so "Study now" always has a session
  // while the deck has words.
  const { isPaid } = useEntitlement();
  const quizLength = usePrefsStore((s) => s.quizLength);
  const sessionCap = isPaid ? quizLength : QUIZ_LENGTH_FREE;
  const { cards: realCards, isLoading, isFetching: dueFetching } = useDueCards(sessionCap, deckId);
  // WALKTHROUGH: a brand-new account has nothing due, which left w6/w7 pointing
  // at an empty state. Substitute an in-memory demo session so the rating gutter
  // and results screen are real, tappable UI. Only when there is genuinely
  // nothing to show — a user with real due cards always studies their own words.
  const tourActive = useWalkthroughActive();
  const useFixture = tourActive && !isLoading && realCards.length === 0;
  // Frozen for this screen instance so dueAt/lastReviewAt don't drift per render.
  const [fixtureCards] = useState<QuizCardItem[]>(() => tourFixtureCards(Date.now()));
  const cards = useFixture ? fixtureCards : realCards;
  const { streakDays } = useHomeData();
  const commit = useCommitQuizSession();

  const [phase, setPhase] = useState<Phase>('quiz');
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  // Auto-traversal (2026-07-28): the grade derived from a TYPED recall answer.
  // Non-null ⇒ the matching rating button is highlighted and self-commits after
  // RatingButtons' timer. Null on every manual reveal (a tap-to-reveal card has
  // no answer to grade, so pre-selecting one would be a guess).
  const [autoRating, setAutoRating] = useState<UiRating | null>(null);
  const [ratings, setRatings] = useState<BufferedRating[]>([]);
  const [showExit, setShowExit] = useState(false);

  // Tell the root layout a session is holding unsaved work, so a light↔dark
  // change defers its rebuild instead of unmounting the navigator underneath us
  // and discarding the batch (uiStore.quizInProgress).
  const setQuizInProgress = useUiStore((st) => st.setQuizInProgress);
  useEffect(() => {
    setQuizInProgress(ratings.length > 0 && phase === 'quiz');
    return () => setQuizInProgress(false);
  }, [ratings.length, phase, setQuizInProgress]);

  // SNAPSHOT the session's cards once the queue arrives (render-adjust pattern).
  // Committing invalidates the dueCards query and the refetch may come back
  // different (ratings re-scheduled everything), so the end/stats/promo phases
  // must render from this frozen list, never the live query.
  const [sessionCards, setSessionCards] = useState<QuizCardItem[] | null>(null);
  // Session clock. The SERVER cannot measure this: commit_quiz_session writes
  // review_logs without reviewed_at, so the whole batch shares one commit-time
  // default and per-answer timing never reaches the database. Started when the
  // first card is actually on screen (not at mount, which would bill the user
  // for the queue fetch), and sent with the commit so `get_session_pace` has
  // something real to take a median of.
  // A ref, not state: the timestamp never drives render (only the commit's
  // durationMs reads it), and Date.now() is impure so it can't run during render
  // the way the render-adjust above does. The effect fires post-paint, which is
  // exactly "the first card is actually on screen."
  const startedAt = useRef<number | null>(null);
  // Snapshot only once the queue in hand was fetched FOR THIS SESSION.
  //
  // THE QUIZ-REPEAT BUG (Casey, 2026-08-04): this used to fire on the first
  // render with any cards at all. TanStack serves a cached list synchronously on
  // mount and refetches in the background, so entering the quiz right after a
  // session froze the queue to the PREVIOUS session's ten cards — and this
  // snapshot is deliberately never re-read, so the fresh list that landed
  // milliseconds later was ignored for the whole session. The user answered the
  // same ten words again; the server, which re-reads state at commit time, duly
  // logged ten reviews with elapsed_days = 0 (verified in review_logs: the
  // 16:06 and 16:12 sessions are the same ten card ids).
  //
  // Waiting for `isFetching` to clear is the whole fix: after a commit,
  // `useCommitQuizSession` invalidates ['dueCards'], so the next mount ALWAYS
  // refetches and we hold until the real queue arrives. When the cache is
  // genuinely fresh there is no refetch, isFetching is false, and the snapshot
  // is immediate as before.
  if (sessionCards == null && !dueFetching && cards.length > 0) setSessionCards(cards);
  useEffect(() => {
    if (startedAt.current == null && cards.length > 0) startedAt.current = Date.now();
  }, [cards.length]);
  // While the snapshot is deliberately being held back (above), falling through
  // to the live `cards` would put the stale queue on screen regardless — the
  // guard has to cover the render path too, not just the freeze.
  const sc = sessionCards ?? (dueFetching ? [] : cards);

  // WALKTHROUGH w7 ("Your results"): the step used to leave card 1 of N on
  // screen while the tooltip described a results view the user could not see
  // (reported 2026-08-02). Drive the demo session straight to its results and
  // synthesise the ratings those results summarise. Fixture-only — a real
  // session is never fast-forwarded, and these ratings are never committed.
  //
  // ⚠️ 'stats', NOT 'end'. There are two post-session screens: 'end' is the
  // "Great session!" splash (mascot + accuracy) and 'stats' is the per-word list
  // with each word's next interval. The tooltip says "you'll see how far each
  // word moved and when it returns", which is the LIST — pointing it at the
  // splash described a screen the user still could not see (Casey, 2026-08-03).
  const tourStepId = useTourScene((st) => st.stepId);
  // NOT gated on `useFixture`: anyone replaying the tour has real due cards, so
  // requiring the fixture meant w7 silently kept showing card 1 of N behind the
  // tooltip (reported twice, 2026-08-02). The step must demo the results view
  // over WHATEVER session is on screen. Display-only: `rate()` is never called
  // on this path so nothing is written, and the commit guard still covers the
  // fixture case.
  const showTourResults = tourActive && isQuizResultsStep(tourStepId);
  const demoRatings: BufferedRating[] = showTourResults
    ? sc.map((c, i) => ({ cardId: c.id, rating: (i % 3 === 1 ? 'almost' : 'got_it') as UiRating }))
    : [];
  const effectivePhase: Phase = showTourResults ? 'stats' : phase;
  const effectiveRatings = showTourResults ? demoRatings : ratings;
  // WALKTHROUGH w6 ("Reveal, then rate"): the step anchors the gutter and talks
  // about grading yourself, but a face-down card puts a single "Tap to reveal"
  // button there instead of the three ratings (Casey, 2026-08-03). Force the
  // flip for the duration of the step. DERIVED, not state: stepping Back leaves
  // the user's own `revealed` untouched, and nothing is rated or written.
  const effectiveRevealed = revealed || (tourActive && isQuizRevealStep(tourStepId));

  const total = sc.length;
  const card = sc[idx];
  const stats = sessionStats(showTourResults ? demoRatings : ratings);

  const closeAttempt = () => {
    // Always confirm exiting an in-progress session (even before the first rating).
    if (phase === 'quiz') setShowExit(true);
    else router.back();
  };

  const rate = (r: UiRating) => {
    if (card == null) return; // queue emptied mid-session (e.g. a refetch) — nothing to rate
    const next = [...ratings, { cardId: card.id, rating: r }];
    setRatings(next);
    setAutoRating(null);
    if (idx + 1 >= total) {
      // Session complete → batch write (03), with the measured duration.
      // EXCEPT during the walkthrough on a demo session: those cards don't exist
      // server-side, so committing would 404 and would pollute a real account's
      // history with words the user never saved.
      if (!useFixture) {
        commit.mutate({ ratings: next, durationMs: startedAt.current == null ? undefined : Date.now() - startedAt.current });
      }
      setPhase('end');
    } else {
      setIdx(idx + 1);
      setRevealed(false);
    }
  };

  // REAL promotions only (2.2): the milestone screen shows iff ≥1 word actually
  // climbed a tier band this session — not merely "was rated got_it".
  const promotions =
    effectivePhase === 'end' || effectivePhase === 'stats' || effectivePhase === 'promo'
      ? sessionPromotions(sc, effectiveRatings)
      : [];

  const done = () => {
    if (promotions.length > 0) setPhase('promo');
    else router.back();
  };
  const studyAgain = () => {
    setPhase('quiz');
    setIdx(0);
    setRevealed(false);
    setAutoRating(null);
    setRatings([]);
    setSessionCards(null); // re-snapshot whatever is due now
  };

  // EVERY early return below must keep <WalkthroughOverlayHost scope="quiz" />
  // mounted. The tour overlay is a Modal owned by whichever host is active, and
  // the quiz host lives in this component — returning a phase screen without it
  // unmounted the tooltip mid-step (w7 rendered results, then lost its own
  // overlay). Wrapping keeps the host alive across phase changes.
  if (effectivePhase === 'end') {
    return (
      <>
        <EndScreen
          good={stats.accuracy >= 60}
          accuracy={stats.accuracy}
          reviewed={effectiveRatings.length}
          streak={streakDays}
          commitError={commit.isError}
          onSeeResults={() => setPhase('stats')}
          onStudyAgain={studyAgain}
        />
        <WalkthroughOverlayHost scope="quiz" />
      </>
    );
  }
  if (effectivePhase === 'stats') {
    return (
      <>
        <StatsScreen cards={sc} ratings={effectiveRatings} onStudyAgain={studyAgain} onDone={done} />
        <WalkthroughOverlayHost scope="quiz" />
      </>
    );
  }
  if (phase === 'promo') {
    return (
      <>
        <SessionMilestoneScreen promotions={promotions} onContinue={() => router.back()} />
        <WalkthroughOverlayHost scope="quiz" />
      </>
    );
  }

  // Quiz phase but no card to show: still loading the due queue, or nothing is due
  // (fresh entry with an empty queue, or "Study again" after the commit cleared it).
  // Without this the screen renders a broken "0 / 0" quiz and rate() crashes on card.id.
  if (effectivePhase === 'quiz' && card == null) {
    return (
      <Screen edges={['top', 'bottom']}>
        {/* `dueFetching` too, not just `isLoading`: while a refetch is in
            flight we are deliberately holding the snapshot back, and without
            this the screen would flash "All caught up!" in the gap. */}
        {isLoading || dueFetching ? (
          <View style={styles.centered}>
            <ActivityIndicator />
          </View>
        ) : (
          <>
            <QuizTopBar current={0} total={0} onClose={() => router.back()} />
            <EmptyStateCard
              style={styles.emptyFill}
              illustration={<IconMountain size={44} color={theme.color.evergreen} />}
              // A deck session that yields nothing means the DECK is empty (or
              // fully archived) — "All caught up!" would be a different, and
              // wrong, claim about the user's whole library.
              title={deckId != null ? t('quiz.deckEmptyTitle') : t('quiz.caughtUpTitle')}
              body={deckId != null ? t('quiz.deckEmptyBody', { deck: deckName ?? '' }) : t('quiz.caughtUpBody')}
              cta={t('quiz.backToHome')}
              onCta={() => router.back()}
            />
          </>
        )}
        {/* Walkthrough w6/w7 land here on fresh accounts (empty queue) — the
            tooltips center (no anchor) but must still present from this modal. */}
        <WalkthroughOverlayHost scope="quiz" />
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'bottom']}>
      {/* 1-based, advances on traversal to a new card (idx+1), not on flip/reveal. */}
      <QuizTopBar current={idx + 1} total={total} onClose={closeAttempt} />
      {card != null && (
        <View style={styles.cardArea}>
          <ScrollView contentContainerStyle={styles.cardScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {!effectiveRevealed ? (
              <QuizCardFront
                key={card.id}
                tier={card.tierId}
                card={card.content}
                mode={card.mode}
                revealCta={false}
                onReveal={() => {
                  setRevealed(true);
                  setAutoRating(null);
                }}
                // Typed the last letter: grade it, flip, and let RatingButtons
                // run the override window (AUTO_ADVANCE_MS). Dismissing the keyboard here is
                // belt-and-braces — unmounting the char inputs already closes
                // it, but an explicit dismiss keeps the gutter (and its timer)
                // visible on the frame the ratings appear.
                onRecallComplete={(typed) => {
                  Keyboard.dismiss();
                  setAutoRating(gradeTypedAnswer(typed, card.content.backWord).rating);
                  setRevealed(true);
                }}
              />
            ) : (
              <Animated.View key={card.id} entering={FadeIn.duration(220)}>
                <QuizCardBack tier={card.tierId} card={card.content} />
              </Animated.View>
            )}
          </ScrollView>
          {/* Bottom gutter: reveal pre-flip, ratings post-flip — SAME position, so
              the thumb never travels (18-session ergonomics). In recall mode the
              open keyboard covers this gutter until dismissed (auto on a correct
              type-out, or manually) — intentional. */}
          {/* 18 §F2: walkthrough anchor (w6 — flip + honest self-rating). */}
          <View ref={(node) => { tourTargets.quizGutter.current = node; }} collapsable={false}>
            {effectiveRevealed ? (
              <Animated.View entering={FadeIn.duration(220)} style={styles.ratingArea}>
                {/* keyed per card so the auto-advance timer restarts cleanly */}
                <RatingButtons key={card.id} onRate={rate} highlighted={autoRating} onAutoSelect={rate} />
              </Animated.View>
            ) : (
              <View style={styles.ratingArea}>
                <QuizRevealButton tier={card.tierId} mode={card.mode} onPress={() => setRevealed(true)} style={styles.gutterReveal} />
              </View>
            )}
          </View>
        </View>
      )}

      {/* Exit confirm — rendered IN-TREE (not via the root Portal). The quiz is a
          fullScreenModal; on iOS the root PortalHost sits BEHIND that modal, so a
          portalled sheet here would be invisible and the close button would look dead.
          Keeping this inside the screen guarantees it paints above the quiz. */}
      {/* 18 §F2: quiz-scope walkthrough host — the quiz fullScreenModal paints
          above tab-tree Modals, so w6/w7 tooltips must be presented from HERE. */}
      <WalkthroughOverlayHost scope="quiz" />

      {showExit && (
        <View style={styles.exitOverlay} accessibilityViewIsModal>
          <Pressable style={styles.exitScrim} onPress={() => setShowExit(false)} accessibilityLabel={t('common.dismiss')} />
          <View style={[styles.exitSheet, { paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.exitHandle} />
            <RawText style={styles.exitTitle}>{t('quiz.exitTitle')}</RawText>
            <RawText style={styles.exitBody}>
              {ratings.length > 0 ? t('quiz.exitBodyRated', { rated: ratings.length, total }) : t('quiz.exitBodyNone')}
            </RawText>
            <Button
              title={t('quiz.exitConfirm')}
              variant="destructive"
              // Closing an in-progress session ALWAYS routes through this sheet
              // (closeAttempt above), so any flow that taps quizClose must tap
              // this too or it never leaves the modal.
              testID="quizExitConfirm"
              onPress={() => {
                setShowExit(false);
                router.back();
              }}
            />
            <View style={styles.exitCancel}>
              <Button title={t('quiz.keepStudying')} variant="secondary" onPress={() => setShowExit(false)} />
            </View>
          </View>
        </View>
      )}
    </Screen>
  );
}

// ── Top bar + progress ───────────────────────────────────────────────────────
// Exported for interaction tests (verifies the close button registers presses).
export function QuizTopBar({ current, total, onClose }: { current: number; total: number; onClose: () => void }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const pct = total > 0 ? (current / total) * 100 : 0;
  return (
    <View>
      <View style={styles.topRow}>
        <RawText style={styles.counter}>
          {current}
          <RawText style={styles.counterTotal}> / {total}</RawText>
        </RawText>
        {/* testID, not text: the accessibilityLabel collapses this Pressable into
            one iOS a11y element (see src/test/a11yCollapse.ts) and its only child
            is an icon anyway. Kept as the intended Maestro handle for leaving the
            quiz — quiz is a fullScreenModal, so Maestro's `back` (a left-edge
            swipe) does nothing here — but see .maestro/quiz.yaml: tapping it
            reports success without opening the exit sheet, so no flow uses it
            yet. */}
        <Pressable onPress={onClose} testID="quizClose" accessibilityRole="button" accessibilityLabel={t('quiz.closeQuiz')} style={styles.closeBtn}>
          <IconX size={16} color={theme.color.textMuted} />
        </Pressable>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

// ── End screen (Q-07 / Q-08) ─────────────────────────────────────────────────
function EndScreen({
  good,
  accuracy,
  reviewed,
  streak,
  onSeeResults,
  onStudyAgain,
  commitError = false,
}: {
  good: boolean;
  accuracy: number;
  reviewed: number;
  streak: number;
  onSeeResults: () => void;
  onStudyAgain: () => void;
  /** The batch write failed — progress for this session wasn't saved. */
  commitError?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.centered}>
        <Animated.View entering={ZoomIn.duration(500).delay(80)}>
          <Image
            source={good ? pikaGoodJob : pikaHugs}
            style={styles.pika}
            resizeMode="contain"
            accessibilityLabel={good ? t('quiz.pikaGoodJobA11y') : t('quiz.pikaHugsA11y')}
            accessibilityIgnoresInvertColors
          />
        </Animated.View>
        <Animated.View entering={FadeInDown.duration(400).delay(180)} style={styles.endHead}>
          <RawText style={styles.endTitle}>{good ? t('quiz.endGreat') : t('quiz.endKeepGoing')}</RawText>
          <RawText style={styles.endSub}>{good ? t('quiz.endStatsSub', { accuracy, streak }) : t('quiz.endEncourage')}</RawText>
        </Animated.View>
        <Animated.View entering={FadeInDown.duration(400).delay(300)} style={styles.endStats}>
          <EndStat label={t('quiz.accuracy')} value={`${accuracy}%`} />
          <View style={styles.endStatDivider} />
          <EndStat label={t('quiz.reviewed')} value={t('quiz.wordsValue', { count: reviewed })} />
          <View style={styles.endStatDivider} />
          <EndStat label={t('quiz.streak')} value={t('quiz.daysValue', { count: streak })} />
        </Animated.View>
        {commitError && (
          <Animated.View entering={FadeInDown.duration(300).delay(350)}>
            <RawText style={styles.commitError}>{t('quiz.commitError')}</RawText>
          </Animated.View>
        )}
        <Animated.View entering={FadeInDown.duration(400).delay(400)} style={styles.endCtas}>
          <Button title={t('quiz.seeResults')} variant="primary" onPress={onSeeResults} />
          {!good && (
            <View style={styles.endSecondary}>
              <Button title={t('quiz.studyAgain')} variant="secondary" onPress={onStudyAgain} />
            </View>
          )}
        </Animated.View>
      </View>
    </Screen>
  );
}
function EndStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.endStat}>
      <RawText style={styles.endStatValue}>{value}</RawText>
      <RawText style={styles.endStatLabel}>{label}</RawText>
    </View>
  );
}

// ── Stats screen (Q-09) ──────────────────────────────────────────────────────
function StatsScreen({ cards, ratings, onStudyAgain, onDone }: { cards: QuizCardItem[]; ratings: BufferedRating[]; onStudyAgain: () => void; onDone: () => void }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const s = sessionStats(ratings);
  // Frozen once so every row's recompute matches the committed batch (a ticking
  // `now` could otherwise drift a row's numbers between renders). State (not a
  // ref) so the value is safe to read during render.
  const [now] = useState(() => new Date());
  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.statsHeader}>
        <RawText style={styles.statsTitle}>{t('quiz.sessionResults')}</RawText>
        <View style={styles.statsSummary}>
          <View style={styles.statsSummaryItem}>
            <View style={[styles.statsDot, { backgroundColor: theme.color.successSoft }]}>
              <IconArrowUp size={10} color={theme.palette.green[600]} />
            </View>
            <RawText style={styles.statsSummaryText}>{t('quiz.strengthenedCount', { count: s.promoted })}</RawText>
          </View>
          <View style={styles.statsSummaryItem}>
            <View style={[styles.statsDot, { backgroundColor: theme.color.surfaceSunken }]}>
              <IconArrowDown size={10} color={theme.color.textMuted} />
            </View>
            <RawText style={styles.statsSummaryText}>{t('quiz.reviewAgainCount', { count: s.again })}</RawText>
          </View>
        </View>
      </View>

      <ScrollView style={styles.statsList} contentContainerStyle={styles.statsListContent}>
        {cards.map((c, i) => {
          const rating = ratings[i]?.rating ?? 'again';
          const o = rowOutcome(t, c, rating, now);
          const tip =
            rating === 'again'
              ? { title: t('quiz.resultAgainTitle'), content: t('quiz.resultAgain', { next: o.nextLabel }) }
              : {
                  title: t('quiz.resultGainTitle'),
                  // Learning-step cards: schedule (minutes) ≠ strength (days) —
                  // the variant copy explains the quick check instead of
                  // reading as a contradiction next to the +Nd pill.
                  content: o.learning
                    ? t('quiz.resultGainLearning', { before: fmtDays(o.before), after: fmtDays(o.after), next: o.nextLabel })
                    : t('quiz.resultGain', { before: fmtDays(o.before), after: fmtDays(o.after), next: o.nextLabel }),
                };
          return (
            <Tooltip
              key={c.id}
              title={tip.title}
              content={tip.content}
              indicator={false}
              anchor="end"
              accessibilityLabel={t('quiz.resultA11y', { word: c.content.backWord })}
            >
              <View style={styles.statRow}>
                <TierBadge tier={c.tierId} variant="pill" size="sm" />
                <View style={styles.statRowBody}>
                  <RawText style={styles.statWord}>{c.content.backWord}</RawText>
                  <RawText style={styles.statSource}>{c.content.frontWord}</RawText>
                </View>
                <IconInfo size={13} color={theme.color.textFaint} />
                <RatingPill rating={rating} gained={o.gained} />
              </View>
            </Tooltip>
          );
        })}
      </ScrollView>

      <View style={styles.statsFooter}>
        <View style={styles.footerBtn}>
          <Button title={t('quiz.studyAgain')} variant="secondary" onPress={onStudyAgain} />
        </View>
        <View style={styles.footerBtn}>
          <Button title={t('quiz.done')} variant="primary" onPress={onDone} />
        </View>
      </View>
    </Screen>
  );
}
// Pill = the FSRS outcome itself: "+Nd" of memory strength (green for a clean
// recall, blue for a hard one), "Review" when the word comes back. No tier
// language — the milestone screen owns promotion (18-session item 2).
function RatingPill({ rating, gained }: { rating: UiRating; gained: number }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  if (rating === 'again') {
    return (
      <View style={[styles.pill, { backgroundColor: theme.color.surfaceSunken }]}>
        <IconArrowDown size={11} color={theme.color.textMuted} />
        <RawText style={[styles.pillText, { color: theme.color.textMuted }]}>{t('quiz.pillReview')}</RawText>
      </View>
    );
  }
  const label = gained >= 1 ? t('quiz.pillGainDays', { count: Math.round(gained) }) : t('quiz.pillGainSmall');
  const strong = rating === 'got_it';
  return (
    <View style={[styles.pill, { backgroundColor: strong ? theme.color.successSoft : theme.color.brandTint }]}>
      <IconArrowUp size={11} color={strong ? theme.palette.green[600] : theme.palette.blue[500]} />
      <RawText style={[styles.pillText, { color: strong ? theme.color.onSuccessSoft : theme.color.onBrandSoft }]}>{label}</RawText>
    </View>
  );
}

// ── Session milestone (Q-10) ─────────────────────────────────────────────────
// GENERICIZED 2026-08-04. This screen used to pick ONE tier — the highest any
// word reached — and frame the whole celebration around it: that tier's badge,
// and a headline that either said "You reached the Summit!" or "New camp
// reached!". A single session routinely promotes words into DIFFERENT camps, so
// the frame was wrong more often than right: three words moving into High Camp
// and one into Summit rendered a Summit badge over a Summit headline, and the
// other three words read as though they had summited too.
//
// The screen now says what actually happened — N words moved up — over the
// generic Lexicamp mark. Tier language lives where it is true: on each word's
// own row, which already carries its real from → to.
export function SessionMilestoneScreen({ promotions, onContinue }: { promotions: PromotedWord[]; onContinue: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  // 18-session (Casey): STATIC layout — mark/headline/Pika/CTA never scroll,
  // so the CTA can't fall below the fold. Only the promoted-words list scrolls,
  // in its own bounded window (flexShrink absorbs long sessions).
  return (
    <View style={styles.promoRoot}>
      <Confetti colors={MILESTONE_CONFETTI} />
      <View style={[styles.promoStatic, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 24 }]}>
        {/* Ascending stars over the mark */}
        <Animated.View entering={FadeIn.duration(400).delay(500)} style={styles.promoStars}>
          {[0, 1, 2, 3, 4].map((i) => (
            <RawText key={i} style={[styles.promoStarTop, { fontSize: 10 + i * 2 }]}>
              ★
            </RawText>
          ))}
        </Animated.View>

        {/* The Lexicamp mark, knocked out for the dark celebration surface —
            one asset for every session, whatever mix of camps it produced. */}
        <Animated.View entering={ZoomIn.duration(560).delay(150)} style={styles.promoMarkWrap}>
          <SvgXml xml={BRAND_MARK_KNOCKOUT_XML} width={104} height={104} />
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(320)} style={styles.promoHead}>
          <RawText style={styles.promoTitle}>{t('quiz.milestoneHeadline', { count: promotions.length })}</RawText>
          <RawText style={styles.promoSub}>{t('quiz.milestoneSub', { count: promotions.length })}</RawText>
        </Animated.View>

        {promotions.length > 0 && (
          <Animated.View entering={FadeInDown.duration(400).delay(440)} style={styles.promoList}>
            <RawText style={styles.promoWordsLabel}>{t('quiz.milestoneWordsLabel')}</RawText>
            <ScrollView style={styles.promoListScroll} showsVerticalScrollIndicator contentContainerStyle={styles.promoListContent}>
              {promotions.map((p) => (
                <View key={p.cardId} style={styles.promoWordRow}>
                  {/* Per-word chip: THIS word's new camp, at word scale. The
                      screen makes no claim; each row makes its own. */}
                  <TierBadge tier={p.to} variant="chip" size="sm" style={styles.promoWordChip} />
                  <View style={styles.promoWordBody}>
                    <RawText style={styles.promoWord}>{p.word}</RawText>
                    <RawText style={styles.promoWordTiers}>
                      {t(`tier.${p.from}.name`)} → {t(`tier.${p.to}.name`)}
                    </RawText>
                  </View>
                </View>
              ))}
            </ScrollView>
          </Animated.View>
        )}

        <Animated.View entering={ZoomIn.duration(520).delay(320)}>
          <Image
            source={pikaCelebrate}
            style={styles.promoPika}
            resizeMode="contain"
            accessibilityLabel={t('quiz.pikaCelebrateA11y')}
            accessibilityIgnoresInvertColors
          />
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(560)} style={styles.promoCtaWrap}>
          <Pressable onPress={onContinue} accessibilityRole="button" style={({ pressed }) => [styles.promoBtn, pressed && { transform: [{ scale: 0.97 }] }]}>
            <RawText style={styles.promoBtnText}>{t('quiz.keepClimbing')}</RawText>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}


const styles = StyleSheet.create((theme) => {
  const { color, fonts, radius } = theme;
  return {
    // quiz phase
    topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 },
    counter: { fontFamily: fonts.mono.bold, fontSize: 14, color: color.textStrong, letterSpacing: 0.3 },
    counterTotal: { fontFamily: fonts.mono.regular, color: color.textMuted },
    closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: color.surfaceSunken, alignItems: 'center', justifyContent: 'center' },
    progressTrack: { height: 3, backgroundColor: color.surfaceSunken },
    progressFill: { height: 3, backgroundColor: color.accent, borderTopRightRadius: 2, borderBottomRightRadius: 2 },
    cardArea: { flex: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20, gap: 14 },
    cardScroll: { flexGrow: 1, justifyContent: 'center' },
    ratingArea: {},
    gutterReveal: { marginTop: 0 },
    emptyFill: { flex: 1, justifyContent: 'center' },

    // end screen
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 8 },
    pika: { width: 160, height: 160, marginBottom: 20 },
    endHead: { alignItems: 'center' },
    endTitle: { fontFamily: fonts.serif.bold, fontSize: 30, color: color.textStrong, textAlign: 'center', letterSpacing: -0.4 },
    endSub: { fontFamily: fonts.sans.regular, fontSize: 14, lineHeight: 22, color: color.textMuted, textAlign: 'center', maxWidth: 260, marginTop: 6, marginBottom: 12 },
    endStats: { flexDirection: 'row', alignSelf: 'stretch', borderWidth: theme.borderWidth.thin, borderColor: color.border, borderRadius: radius.lg, marginBottom: 12 },
    endCtas: { alignSelf: 'stretch', width: '100%' },
    endSecondary: { marginTop: 10 },
    endStat: { flex: 1, paddingVertical: 14, alignItems: 'center' },
    endStatValue: { fontFamily: fonts.mono.bold, fontSize: 17, color: color.textStrong },
    endStatLabel: { fontFamily: fonts.sans.medium, fontSize: 11, color: color.textMuted, marginTop: 3 },
    endStatDivider: { width: 1, backgroundColor: color.border },

    // stats screen
    statsHeader: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, borderBottomWidth: theme.borderWidth.thin, borderBottomColor: color.border },
    statsTitle: { fontFamily: fonts.serif.bold, fontSize: 22, color: color.textStrong, marginBottom: 10 },
    statsSummary: { flexDirection: 'row', gap: 16 },
    statsSummaryItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    statsDot: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    statsSummaryText: { fontFamily: fonts.sans.medium, fontSize: 13, color: color.textBody },
    statsList: { flex: 1 },
    statsListContent: { paddingVertical: 4 },
    statRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 20, borderBottomWidth: theme.borderWidth.thin, borderBottomColor: color.divider },
    statRowBody: { flex: 1 },
    statWord: { fontFamily: fonts.serif.semibold, fontSize: 15, color: color.textStrong },
    statSource: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted, marginTop: 1 },
    pill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, paddingVertical: 3, paddingLeft: 6, paddingRight: 10 },
    pillText: { fontFamily: fonts.sans.bold, fontSize: 12 },
    statsFooter: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 8, borderTopWidth: theme.borderWidth.thin, borderTopColor: color.border },
    footerBtn: { flex: 1 },

    // mastery / summit celebration (Q-10)
    promoRoot: { flex: 1, backgroundColor: '#221e1b' },
    promoStatic: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
    promoListScroll: { flexGrow: 0 },
    promoListContent: { paddingBottom: 4 },
    promoStars: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginBottom: 10 },
    promoStarTop: { color: '#f7a855' },
    promoMarkWrap: { marginBottom: 18, borderRadius: 999, boxShadow: '0 0 28px rgba(232, 119, 34, 0.45)' },
    promoHead: { alignItems: 'center', marginBottom: 14 },
    promoTitle: { fontFamily: fonts.serif.bold, fontSize: 26, color: '#fff', textAlign: 'center', letterSpacing: -0.4, lineHeight: 32 },
    promoSub: { fontFamily: fonts.sans.regular, fontSize: 13, lineHeight: 20, color: 'rgba(255,255,255,0.6)', textAlign: 'center', maxWidth: 250, marginTop: 8 },
    // flexShrink + minHeight 0: the list yields space so Pika + CTA stay on-screen.
    promoList: { width: '100%', maxWidth: 320, alignSelf: 'center', marginBottom: 16, flexShrink: 1, minHeight: 0 },
    promoWordsLabel: { fontFamily: fonts.sans.bold, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginBottom: 8 },
    // Star pinned to the first line; word + tier transition stack in a flexible column
    // (minWidth:0 lets long words/expressions wrap instead of overflowing the card).
    promoWordRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, marginTop: 5 },
    promoWordChip: { marginTop: 2 },
    promoWordBody: { flex: 1, minWidth: 0 },
    promoWord: { fontFamily: fonts.serif.semibold, fontSize: 15, color: '#fff' },
    promoWordTiers: { fontFamily: fonts.mono.regular, fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
    commitError: { fontFamily: fonts.sans.medium, fontSize: 13, color: color.danger, textAlign: 'center', marginTop: 14, paddingHorizontal: 24 },
    promoPika: { width: 148, height: 148, marginBottom: 20 },
    promoCtaWrap: { alignSelf: 'stretch', width: '100%' },
    promoBtn: { alignSelf: 'stretch', backgroundColor: color.accentCta, borderRadius: 14, paddingVertical: 15, alignItems: 'center', boxShadow: '0 6px 20px rgba(232, 119, 34, 0.35)' },
    promoBtnText: { fontFamily: fonts.sans.bold, fontSize: 16, color: '#fff' },

    // exit confirm
    exitOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end', zIndex: 50 },
    exitScrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(14, 22, 36, 0.6)' },
    exitSheet: { backgroundColor: color.surfaceCard, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: 20, paddingTop: 12, gap: 10 },
    exitHandle: { width: 32, height: 4, borderRadius: 2, backgroundColor: color.borderStrong, alignSelf: 'center', marginBottom: 8 },
    exitTitle: { fontFamily: fonts.serif.semibold, fontSize: 20, color: color.textStrong },
    exitBody: { fontFamily: fonts.sans.regular, fontSize: 14, lineHeight: 23, color: color.textMuted, marginBottom: 14 },
    exitCancel: { marginTop: 8 },
  };
});
