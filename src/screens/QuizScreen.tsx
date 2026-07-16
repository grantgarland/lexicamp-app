// QuizScreen (Q-01…Q-10) — the study session, assembled against quiz/Quiz.html.
// Reads the due queue through the state layer (`useDueCards`), buffers ratings
// in-memory, and commits the batch on completion (`useCommitQuizSession`) per 03's
// quiz write pattern. Composes the kit (QuizCardFront/Back, RatingButtons, TierBadge)
// + screen-specific phases built inline (top bar, end, stats, tier-promo, exit confirm).
import { useState } from 'react';
import type { TFunction } from 'i18next';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Image, Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { sessionPromotions, tierTransition, type PromotedWord } from '@/domain/fsrs';
import type { BufferedRating, QuizCardItem, UiRating } from '@/domain/quiz';
import { sessionStats, uiRatingToFsrs } from '@/domain/quiz';
import { useTranslation } from '@/i18n';
import { useCommitQuizSession, useDueCards, useEntitlement, useHomeData } from '@/query/hooks';
import { QUIZ_LENGTH_FREE, usePrefsStore } from '@/store/prefsStore';
import { type TierId } from '@/theme/tiers';
import {
  Button,
  Confetti,
  EmptyState,
  IconArrowDown,
  IconArrowUp,
  IconInfo,
  IconMountain,
  IconX,
  QuizCardBack,
  QuizCardFront,
  RatingButtons,
  RawText,
  Screen,
  TierBadge,
  Tooltip,
} from '@/ui';

// Sanctioned Pika moments only (Q-07/Q-08 end, Q-10 mastery) — assets from the brand kit.
import pikaGoodJob from '../../assets/images/pika/good-job.png';
import pikaHugs from '../../assets/images/pika/hugs.png';
import pikaCelebrate from '../../assets/images/pika/celebrate.png';

type Phase = 'quiz' | 'end' | 'stats' | 'promo';

// Summit celebration confetti (Q-10) — warm golds + a few accent flecks (milestone spec).
const SUMMIT_CONFETTI = ['#e87722', '#f7a855', '#f5b91e', '#d97706', '#2f5e7e', '#459a6b', '#f472b6'];

// Per-word review outcome for the results tooltip — the REAL FSRS tier
// transition (2.2; replaces the session-29 heuristic). Tiers are stability
// bands, so promoted/held falls out of the actual recompute the commit persists.
function outcomeTip(t: TFunction, card: QuizCardItem, rating: UiRating): { title: string; content: string } {
  const name = (id: TierId) => t(`tier.${id}.name`);
  const { from, to, promoted } = tierTransition(card.fsrs, uiRatingToFsrs(rating));
  if (promoted) {
    if (to === 'summit') return { title: t('quiz.resultSummitTitle'), content: t('quiz.resultSummit') };
    return { title: t('quiz.resultPromotedTitle'), content: t('quiz.resultPromoted', { from: name(from), to: name(to) }) };
  }
  if (rating === 'again')
    return { title: t('quiz.resultReviewedTitle'), content: t('quiz.resultLimited', { tier: name(to) }) };
  return { title: t('quiz.resultReviewedTitle'), content: t('quiz.resultHeld', { tier: name(to) }) };
}

export function QuizScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const { cards, isLoading } = useDueCards();
  const { streakDays } = useHomeData();
  const commit = useCommitQuizSession();

  const [phase, setPhase] = useState<Phase>('quiz');
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [ratings, setRatings] = useState<BufferedRating[]>([]);
  const [showExit, setShowExit] = useState(false);

  // Session size = the one persisted quiz-length pref (17 §S2/X4); free tier is
  // pinned to QUIZ_LENGTH_FREE. The due queue beyond the cap stays due — it
  // simply waits for the next session.
  const { isPaid } = useEntitlement();
  const quizLength = usePrefsStore((s) => s.quizLength);
  const sessionCap = isPaid ? quizLength : QUIZ_LENGTH_FREE;

  // SNAPSHOT the session's cards once the queue arrives (render-adjust pattern).
  // Committing invalidates the dueCards query and the refetch comes back EMPTY
  // (nothing is due anymore — FSRS worked), so the end/stats/promo phases must
  // render from this frozen list, never the live query.
  const [sessionCards, setSessionCards] = useState<QuizCardItem[] | null>(null);
  if (sessionCards == null && cards.length > 0) setSessionCards(cards.slice(0, sessionCap));
  const sc = sessionCards ?? cards.slice(0, sessionCap);

  const total = sc.length;
  const card = sc[idx];
  const stats = sessionStats(ratings);

  const closeAttempt = () => {
    // Always confirm exiting an in-progress session (even before the first rating).
    if (phase === 'quiz') setShowExit(true);
    else router.back();
  };

  const rate = (r: UiRating) => {
    if (card == null) return; // queue emptied mid-session (e.g. a refetch) — nothing to rate
    const next = [...ratings, { cardId: card.id, rating: r }];
    setRatings(next);
    if (idx + 1 >= total) {
      commit.mutate({ ratings: next }); // session complete → batch write (03)
      setPhase('end');
    } else {
      setIdx(idx + 1);
      setRevealed(false);
    }
  };

  // REAL promotions only (2.2): the milestone screen shows iff ≥1 word actually
  // climbed a tier band this session — not merely "was rated got_it".
  const promotions = phase === 'end' || phase === 'stats' || phase === 'promo' ? sessionPromotions(sc, ratings) : [];

  const done = () => {
    if (promotions.length > 0) setPhase('promo');
    else router.back();
  };
  const studyAgain = () => {
    setPhase('quiz');
    setIdx(0);
    setRevealed(false);
    setRatings([]);
    setSessionCards(null); // re-snapshot whatever is due now
  };

  if (phase === 'end') {
    return (
      <EndScreen
        good={stats.accuracy >= 60}
        accuracy={stats.accuracy}
        reviewed={ratings.length}
        streak={streakDays}
        commitError={commit.isError}
        onSeeResults={() => setPhase('stats')}
        onStudyAgain={studyAgain}
      />
    );
  }
  if (phase === 'stats') {
    return <StatsScreen cards={sc} ratings={ratings} onStudyAgain={studyAgain} onDone={done} />;
  }
  if (phase === 'promo') {
    return <TierPromoScreen promotions={promotions} onContinue={() => router.back()} />;
  }

  // Quiz phase but no card to show: still loading the due queue, or nothing is due
  // (fresh entry with an empty queue, or "Study again" after the commit cleared it).
  // Without this the screen renders a broken "0 / 0" quiz and rate() crashes on card.id.
  if (phase === 'quiz' && card == null) {
    return (
      <Screen edges={['top', 'bottom']}>
        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator />
          </View>
        ) : (
          <>
            <QuizTopBar current={0} total={0} onClose={() => router.back()} />
            <EmptyState
              style={styles.emptyFill}
              illustration={<IconMountain size={44} color={theme.color.evergreen} />}
              title={t('quiz.caughtUpTitle')}
              body={t('quiz.caughtUpBody')}
              cta={t('quiz.backToHome')}
              onCta={() => router.back()}
            />
          </>
        )}
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
            {!revealed ? (
              <QuizCardFront key={card.id} tier={card.tierId} card={card.content} mode={card.mode} onReveal={() => setRevealed(true)} />
            ) : (
              <Animated.View key={card.id} entering={FadeIn.duration(220)}>
                <QuizCardBack tier={card.tierId} card={card.content} />
              </Animated.View>
            )}
          </ScrollView>
          {revealed && (
            <Animated.View entering={FadeIn.duration(220)} style={styles.ratingArea}>
              <RatingButtons onRate={rate} />
            </Animated.View>
          )}
        </View>
      )}

      {/* Exit confirm — rendered IN-TREE (not via the root Portal). The quiz is a
          fullScreenModal; on iOS the root PortalHost sits BEHIND that modal, so a
          portalled sheet here would be invisible and the close button would look dead.
          Keeping this inside the screen guarantees it paints above the quiz. */}
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
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('quiz.closeQuiz')} style={styles.closeBtn}>
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
  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.statsHeader}>
        <RawText style={styles.statsTitle}>{t('quiz.sessionResults')}</RawText>
        <View style={styles.statsSummary}>
          <View style={styles.statsSummaryItem}>
            <View style={[styles.statsDot, { backgroundColor: theme.palette.green[100] }]}>
              <IconArrowUp size={10} color={theme.palette.green[600]} />
            </View>
            <RawText style={styles.statsSummaryText}>{t('quiz.promotedCount', { count: s.promoted })}</RawText>
          </View>
          <View style={styles.statsSummaryItem}>
            <View style={[styles.statsDot, { backgroundColor: theme.palette.slate[100] }]}>
              <IconArrowDown size={10} color={theme.color.textMuted} />
            </View>
            <RawText style={styles.statsSummaryText}>{t('quiz.reviewAgainCount', { count: s.again })}</RawText>
          </View>
        </View>
      </View>

      <ScrollView style={styles.statsList} contentContainerStyle={styles.statsListContent}>
        {cards.map((c, i) => {
          const rating = ratings[i]?.rating ?? 'again';
          const tip = outcomeTip(t, c, rating);
          return (
            <Tooltip
              key={c.id}
              title={tip.title}
              content={tip.content}
              indicator={false}
              accessibilityLabel={t('quiz.resultA11y', { word: c.content.backWord })}
            >
              <View style={styles.statRow}>
                <TierBadge tier={c.tierId} variant="pill" size="sm" />
                <View style={styles.statRowBody}>
                  <RawText style={styles.statWord}>{c.content.backWord}</RawText>
                  <RawText style={styles.statSource}>{c.content.frontWord}</RawText>
                </View>
                <IconInfo size={13} color={theme.color.textFaint} />
                <RatingPill rating={rating} />
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
function RatingPill({ rating }: { rating: UiRating }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  if (rating === 'got_it') {
    return (
      <View style={[styles.pill, { backgroundColor: theme.palette.green[100] }]}>
        <IconArrowUp size={11} color={theme.palette.green[600]} />
        <RawText style={[styles.pillText, { color: theme.palette.green[700] }]}>{t('quiz.pillPromoted')}</RawText>
      </View>
    );
  }
  if (rating === 'almost') {
    return (
      <View style={[styles.pill, { backgroundColor: theme.palette.blue[50] }]}>
        <IconArrowUp size={11} color={theme.palette.blue[500]} />
        <RawText style={[styles.pillText, { color: theme.palette.blue[700] }]}>{t('quiz.pillAlmost')}</RawText>
      </View>
    );
  }
  return (
    <View style={[styles.pill, { backgroundColor: theme.palette.slate[100] }]}>
      <IconArrowDown size={11} color={theme.color.textMuted} />
      <RawText style={[styles.pillText, { color: theme.color.textMuted }]}>{t('quiz.pillReview')}</RawText>
    </View>
  );
}

// ── Mastery / Summit celebration (Q-10) ──────────────────────────────────────
function TierPromoScreen({ promotions, onContinue }: { promotions: PromotedWord[]; onContinue: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  // Highest tier reached this session drives the badge + headline: full Summit
  // mastery celebration only when a word actually crossed into summit;
  // otherwise the generic tier-up milestone.
  const order: TierId[] = ['bc', 'abc', 'hc', 'sr', 'summit'];
  const topTier = promotions.reduce<TierId>((acc, p) => (order.indexOf(p.to) > order.indexOf(acc) ? p.to : acc), 'abc');
  const summit = topTier === 'summit';
  return (
    <View style={styles.promoRoot}>
      <Confetti colors={SUMMIT_CONFETTI} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.promoScroll, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 24 }]}
      >
        {/* Ascending stars over the badge */}
        <Animated.View entering={FadeIn.duration(400).delay(500)} style={styles.promoStars}>
          {[0, 1, 2, 3, 4].map((i) => (
            <RawText key={i} style={[styles.promoStarTop, { fontSize: 10 + i * 2 }]}>
              ★
            </RawText>
          ))}
        </Animated.View>

        {/* Badge of the highest tier reached — pops in with a gold glow */}
        <Animated.View entering={ZoomIn.duration(560).delay(150)} style={styles.promoBadgeWrap}>
          <TierBadge tier={topTier} variant="badge" px={116} />
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(320)} style={styles.promoHead}>
          <RawText style={styles.promoTitle}>{summit ? t('quiz.masteryHeadline') : t('quiz.promoHeadline')}</RawText>
          <RawText style={styles.promoSub}>{summit ? t('quiz.masterySub') : t('quiz.promoSubtitle')}</RawText>
        </Animated.View>

        {promotions.length > 0 && (
          <Animated.View entering={FadeInDown.duration(400).delay(440)} style={styles.promoList}>
            <RawText style={styles.promoWordsLabel}>{t('quiz.masteryWordsLabel')}</RawText>
            {promotions.map((p) => (
              <View key={p.cardId} style={styles.promoWordRow}>
                <RawText style={styles.promoStar}>★</RawText>
                <View style={styles.promoWordBody}>
                  <RawText style={styles.promoWord}>{p.word}</RawText>
                  <RawText style={styles.promoWordTiers}>
                    {t(`tier.${p.from}.name`)} → {t(`tier.${p.to}.name`)}
                  </RawText>
                </View>
              </View>
            ))}
          </Animated.View>
        )}

        <Animated.View entering={ZoomIn.duration(520).delay(320)}>
          <Image source={pikaCelebrate} style={styles.promoPika} resizeMode="contain" accessibilityLabel={t('quiz.pikaCelebrateA11y')} />
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(560)} style={styles.promoCtaWrap}>
          <Pressable onPress={onContinue} accessibilityRole="button" style={({ pressed }) => [styles.promoBtn, pressed && { transform: [{ scale: 0.97 }] }]}>
            <RawText style={styles.promoBtnText}>{t('quiz.keepClimbing')}</RawText>
          </Pressable>
        </Animated.View>
      </ScrollView>
    </View>
  );
}


const styles = StyleSheet.create((theme) => {
  const { color, palette, fonts, radius } = theme;
  return {
    // quiz phase
    topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 },
    counter: { fontFamily: fonts.mono.bold, fontSize: 14, color: color.textStrong, letterSpacing: 0.3 },
    counterTotal: { fontFamily: fonts.mono.regular, color: color.textMuted },
    closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: palette.slate[100], alignItems: 'center', justifyContent: 'center' },
    progressTrack: { height: 3, backgroundColor: palette.slate[100] },
    progressFill: { height: 3, backgroundColor: color.accent, borderTopRightRadius: 2, borderBottomRightRadius: 2 },
    cardArea: { flex: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20, gap: 14 },
    cardScroll: { flexGrow: 1, justifyContent: 'center' },
    ratingArea: {},
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
    promoScroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
    promoStars: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginBottom: 10 },
    promoStarTop: { color: '#f7a855' },
    promoBadgeWrap: { marginBottom: 18, borderRadius: 999, boxShadow: '0 0 28px rgba(232, 119, 34, 0.45)' },
    promoHead: { alignItems: 'center', marginBottom: 14 },
    promoTitle: { fontFamily: fonts.serif.bold, fontSize: 26, color: '#fff', textAlign: 'center', letterSpacing: -0.4, lineHeight: 32 },
    promoSub: { fontFamily: fonts.sans.regular, fontSize: 13, lineHeight: 20, color: 'rgba(255,255,255,0.6)', textAlign: 'center', maxWidth: 250, marginTop: 8 },
    promoList: { width: '100%', maxWidth: 320, alignSelf: 'center', marginBottom: 16 },
    promoWordsLabel: { fontFamily: fonts.sans.bold, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginBottom: 8 },
    // Star pinned to the first line; word + tier transition stack in a flexible column
    // (minWidth:0 lets long words/expressions wrap instead of overflowing the card).
    promoWordRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, marginTop: 5 },
    promoStar: { fontSize: 12, color: '#f7a855', marginTop: 3 },
    promoWordBody: { flex: 1, minWidth: 0 },
    promoWord: { fontFamily: fonts.serif.semibold, fontSize: 15, color: '#fff' },
    promoWordTiers: { fontFamily: fonts.mono.regular, fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
    commitError: { fontFamily: fonts.sans.medium, fontSize: 13, color: color.danger, textAlign: 'center', marginTop: 14, paddingHorizontal: 24 },
    promoPika: { width: 148, height: 148, marginBottom: 20 },
    promoCtaWrap: { alignSelf: 'stretch', width: '100%' },
    promoBtn: { alignSelf: 'stretch', backgroundColor: color.accent, borderRadius: 14, paddingVertical: 15, alignItems: 'center', boxShadow: '0 6px 20px rgba(232, 119, 34, 0.35)' },
    promoBtnText: { fontFamily: fonts.sans.bold, fontSize: 16, color: '#fff' },

    // exit confirm
    exitOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end', zIndex: 50 },
    exitScrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(14, 22, 36, 0.6)' },
    exitSheet: { backgroundColor: color.surfaceCard, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: 20, paddingTop: 12, gap: 10 },
    exitHandle: { width: 32, height: 4, borderRadius: 2, backgroundColor: palette.slate[300], alignSelf: 'center', marginBottom: 8 },
    exitTitle: { fontFamily: fonts.serif.semibold, fontSize: 20, color: color.textStrong },
    exitBody: { fontFamily: fonts.sans.regular, fontSize: 14, lineHeight: 23, color: color.textMuted, marginBottom: 14 },
    exitCancel: { marginTop: 8 },
  };
});
