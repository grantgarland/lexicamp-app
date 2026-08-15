// ProgressScreen (P-01…P-02) — the stats hub, assembled against progress/Progress.html
// as refined by 17-ux-refinement (§P1: the former Pace tab is dissolved — its
// projection card moved directly under "You are here" on Route, its all-time stats
// to the bottom of Route, and its fabricated reviews/day metric was cut). Two
// sub-tabs: Route (position + projection + CEFR ladder + all-time) and Inventory
// (FSRS word distribution). Reads the state layer via `useProgressData()`. The
// bottom nav is the persistent tab layout, not this screen.
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { findLanguage } from '@/constants/languages';
import type { LeaderboardEntry } from '@/data/DataSource';
import { MOUNTAIN_TIERS, mountainTier } from '@/domain/derive';
import { forecast, horizon, librarySpanDays, nextCampTarget, nextMilestone, projectionBase, resolve, SUMMIT_TARGET, type Projection, type ProjectionBase } from '@/domain/projection';
import { formatUsername } from '@/domain/username';
import { useTranslation } from '@/i18n';
import { useActiveLang, useLeaderboard, useProgressData } from '@/query/hooks';
import { LanguageIndicator } from '@/screens/shared/LanguageSwitcher';
import { usePullToRefresh } from '@/query/usePullToRefresh';
import { TOUR_FIXTURE_PROGRESS } from '@/tour/tourFixture';
import { useWalkthroughActive } from '@/tour/walkthrough';
import { useIsDark } from '@/theme/appearance';
import { TIERS, tierView } from '@/theme/tiers';
import { studyTimeParts } from '@/lib/studyTime';
import { EmptyOverlay, EmptyStateCard, GhostRows, IconBook, IconCalendar, IconChart, IconCheck, IconClock, IconInfo, IconLock, IconMountain, IconRefresh, IconStar, RawText, Screen, ForecastChart, SegmentedPills, SegmentedTabs, Sheet, TAB_BAR_FAB_OVERHANG, Tooltip } from '@/ui';

type SubTab = 'route' | 'projection' | 'leaders';
type InfoKey = 'cefr';
type LeaderScope = 'global' | 'language';

// ── Mountain-tier thresholds — SOURCE OF TRUTH is domain/derive.ts MOUNTAIN_TIERS
// (mastered-word thresholds → CEFR) + tiers.ts TIERS (registry names/colors). The
// user's position is mountainTier(masteredCount); a tier's window is [masteredMin,
// nextTier.masteredMin). Registry visuals are looked up by the shared tier id.
const masteredMinAt = (i: number) => MOUNTAIN_TIERS[i].masteredMin;
const masteredMaxAt = (i: number) => (i + 1 < MOUNTAIN_TIERS.length ? MOUNTAIN_TIERS[i + 1].masteredMin : Number.POSITIVE_INFINITY);
const tierRegistry = (i: number) => TIERS[i]; // MOUNTAIN_TIERS and TIERS share id order

/** Every query this screen renders (prefixes — see usePullToRefresh). */
const PROGRESS_REFRESH_KEYS = ['deckCards', 'progressStats', 'engagement', 'leaderboard'] as const;

export function ProgressScreen() {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const [tab, setTab] = useState<SubTab>('route');
  const [info, setInfo] = useState<InfoKey | null>(null);
  const realData = useProgressData();
  // WALKTHROUGH (w8): a brand-new account has nothing saved, so every tab fell
  // through to its empty state while the tooltip explained charts that weren't
  // there. Overlay the demo summary — only when the tour is running AND there is
  // genuinely nothing real to show. One intercept, so the tabs below stay
  // oblivious to the tour.
  const tourActive = useWalkthroughActive();
  const data = tourActive && realData.totalSaved === 0 ? { ...realData, ...TOUR_FIXTURE_PROGRESS } : realData;
  // All three tabs at once, not just the visible one: switching tabs is not a
  // refresh, so a user who pulls on Route and then taps Leaders would otherwise
  // be looking at the stale board they just tried to refresh.
  const refresh = usePullToRefresh(PROGRESS_REFRESH_KEYS);

  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        {/* Title left, language toggle LAST — the switcher holds the same
            trailing slot on every screen (2026-08-04). Progress had no toggle
            at all, so the active language was invisible on the one screen that
            reports on it. */}
        <View style={styles.titleRow}>
          <RawText style={styles.title}>{t('progress.title')}</RawText>
          <LanguageIndicator compact />
        </View>
        <SegmentedTabs
          active={tab}
          onChange={(id) => setTab(id as SubTab)}
          tabs={[
            { id: 'route', label: t('progress.tabRoute'), testID: 'progressTabRoute' },
            { id: 'projection', label: t('progress.tabProjection'), testID: 'progressTabProjection' },
            { id: 'leaders', label: t('progress.tabLeaders'), testID: 'progressTabLeaders' },
          ]}
        />
      </View>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} tintColor={theme.color.textMuted} />}
      >
        {tab === 'route' && <RouteTab data={data} t={t} onInfo={setInfo} />}
        {tab === 'projection' && <ProjectionTab data={data} t={t} />}
        {tab === 'leaders' && <LeadersTab t={t} />}
      </ScrollView>

      <InfoSheet infoKey={info} t={t} onClose={() => setInfo(null)} />
    </Screen>
  );
}

type TabProps = {
  data: ReturnType<typeof useProgressData>;
  t: TFunction;
  onInfo?: (key: InfoKey) => void;
};

// ── Route ────────────────────────────────────────────────────────────────────
// 2026-07-30 redesign (Casey): the separate "You are here" hero card is GONE.
// It restated everything the ladder's current row already carried — tier name,
// CEFR, mastered count, distance to next — plus a progress bar, so the screen
// opened with the same information twice. The current row now absorbs the bar,
// the counts and the CEFR affordance, and Route is two blocks: the ladder and
// All-Time. The projection moved to its own tab.
function RouteTab({ data, t, onInfo }: TabProps) {
  const { theme } = useUnistyles();
  const isDark = useIsDark();
  const saved = data.totalSaved;

  if (saved === 0) {
    // No ghosts: the ladder is a one-off, not a list. A silhouette of it would
    // suggest a route that failed to load rather than one not yet started.
    return <EmptyStateCard style={styles.empty} illustration={<IconMountain size={52} color={theme.color.evergreen} />} title={t('progress.emptyRouteTitle')} body={t('progress.emptyRouteBody')} />;
  }

  // SOURCE OF TRUTH: mountain rank derives from mastered-word count (03 / derive.ts),
  // not saved words or the FSRS distribution.
  const mastered = data.totalMastered;
  const curTierId = mountainTier(mastered).id;
  const cur = MOUNTAIN_TIERS.findIndex((x) => x.id === curTierId);
  const next = MOUNTAIN_TIERS[cur + 1];
  const curMax = masteredMaxAt(cur);

  return (
    <View style={styles.pad}>
      <RawText style={styles.sectionTitle}>{t('progress.fullRoute')}</RawText>
      <View style={styles.ladder}>
        {/* Connecting route line behind the nodes */}
        <View style={styles.ladderLine} />
        {[...MOUNTAIN_TIERS].reverse().map((mt) => {
            const origIdx = MOUNTAIN_TIERS.findIndex((x) => x.id === mt.id);
            const tier = tierView(tierRegistry(origIdx), isDark);
            const completed = origIdx < cur;
            const current = origIdx === cur;
            const locked = origIdx > cur;
            const finiteMax = Number.isFinite(masteredMaxAt(origIdx));
            const node = completed
              ? { backgroundColor: theme.palette.green[500], borderColor: theme.palette.green[400] }
              : current
                ? { backgroundColor: tier.color, borderColor: tier.color }
                : { backgroundColor: theme.color.surfaceCard, borderColor: theme.color.border };
            // In-tier progress, previously the hero card's job. Summit has no
            // upper bound, so it reads as complete rather than dividing by ∞.
            const pctInTier = current
              ? Number.isFinite(curMax)
                ? Math.max(0, Math.min(100, Math.round(((mastered - masteredMinAt(cur)) / (curMax - masteredMinAt(cur))) * 100)))
                : 100
              : 0;
            return (
              <View key={tier.id} style={styles.ladderRow}>
                {/* Node stays fully opaque so the route line never bleeds through a locked tier;
                    only the text body is dimmed for locked rows. */}
                <View style={[styles.node, node, current && styles.nodeCurrent, locked && styles.nodeLocked]}>
                  {completed && <IconCheck size={14} color="#fff" />}
                  {current && <RawText style={styles.nodeNum}>{origIdx + 1}</RawText>}
                  {locked && <IconLock size={12} color={theme.color.borderStrong} />}
                </View>
                <View style={[styles.ladderBody, locked && { opacity: 0.5 }]}>
                  <View style={styles.ladderTitleRow}>
                    <RawText style={[styles.ladderTier, { color: completed ? theme.palette.green[800] : current ? theme.color.textStrong : theme.palette.slate[400] }]}>
                      {t(`tier.${tier.id}.name`)}
                    </RawText>
                    {tier.id === 'summit' && <IconStar size={13} color={theme.palette.amber[400]} />}
                    {current && <RawText style={styles.badgeCurrent}>{t('progress.current')}</RawText>}
                    {current && (
                      <Pressable
                        onPress={() => onInfo?.('cefr')}
                        accessibilityRole="button"
                        accessibilityLabel={t('progress.aboutCefr')}
                        hitSlop={10}
                        style={({ pressed }) => [styles.ladderInfo, pressed && { opacity: 0.6 }]}
                      >
                        <IconInfo size={13} color={tier.color} />
                      </Pressable>
                    )}
                  </View>
                  <RawText style={[styles.ladderCefr, { color: current ? tier.color : completed ? theme.palette.green[600] : theme.color.borderStrong }]}>
                    {t('progress.cefr', { level: tier.cefr })}
                  </RawText>
                  <RawText style={styles.ladderStatus}>
                    {locked && t('progress.unlockAt', { count: masteredMinAt(origIdx).toLocaleString() })}
                    {completed && t('progress.masteredPlus', { count: masteredMinAt(origIdx).toLocaleString() })}
                    {current && (finiteMax ? t('progress.ofWords', { count: mastered.toLocaleString(), max: masteredMaxAt(origIdx).toLocaleString() }) : t('progress.atSummitWords', { count: mastered.toLocaleString() }))}
                  </RawText>

                  {/* The current row is the ONLY one that renders progress — the
                      former hero card's bar, folded in where it belongs. And only
                      when a NEXT tier exists: at Summit the bar had no upper
                      bound to measure against, so it sat permanently full and
                      measured nothing (Casey, 2026-08-05). */}
                  {current && next != null && (
                    <>
                      <View style={[styles.ladderTrack, isDark && styles.ladderTrackDark]}>
                        <View style={[styles.ladderFill, { width: `${pctInTier}%`, backgroundColor: tier.color }]} />
                      </View>
                      <RawText style={styles.ladderPct}>{t('progress.toNext', { count: Math.max(0, curMax - mastered), tier: t(`tier.${next.id}.name`) })}</RawText>
                    </>
                  )}
                  {current && mastered === 0 && (
                    <View style={[styles.ladderHint, isDark && styles.ladderHintDark, { borderColor: tier.border }]}>
                      <RawText style={styles.ladderHintText}>{t('progress.masteredZeroHint')}</RawText>
                    </View>
                  )}
                </View>
              </View>
            );
          })}
      </View>

      {/* All-time (17 §P1). Four honest numbers: sessions, accuracy, current +
          best streak. */}
      <View style={styles.divider} />
      <RawText style={styles.sectionTitle}>{t('progress.allTime')}</RawText>
      <AllTimeGrid data={data} t={t} />
    </View>
  );
}

// ── Projection tab (replaces Inventory, 2026-07-30) ──────────────────────────
// Inventory's word-by-tier counts already existed on Home's Word Mastery card,
// and browsing words by tier is covered by Word List's multi-select tier
// filter — so the tab was a third copy of both.
//
// The next-camp ⇄ Summit toggle lives HERE, not inside the projection card:
// it governs the card AND the forecast curve, and nesting it in one of the two
// things it controls read as if it only controlled that one. Owning the state
// at the tab also means the FSRS simulation runs ONCE for both children
// instead of each building its own base.
function ProjectionTab({ data, t }: TabProps) {
  const { theme } = useUnistyles();
  const [view, setView] = useState<'next' | 'summit'>('next');
  // Frozen once per mount, NOT sampled inside the memo. Two reasons, and the
  // second is the one that matters:
  //   1. `new Date()` inside a useMemo factory runs during render, which is
  //      impure (react-hooks/purity) — a memo may be recomputed at any time.
  //   2. More importantly it would make the projection DRIFT: the same data
  //      could resolve to a slightly different answer on every recompute,
  //      because every card's days-to-mastery is measured from `now`.
  // Same pattern (and same reasoning) as QuizScreen's frozen `now`; state
  // rather than a ref so it is safe to read during render.
  const [now] = useState(() => new Date());

  const model = useMemo(() => {
    const base = projectionBase({
      cards: data.cards,
      states: data.states,
      avgAccuracy: data.avgAccuracy,
      daysActive: data.daysActive,
      now,
    });
    const next = nextCampTarget(base.mastered);
    return {
      base,
      nextCamp: next == null ? null : { ...resolve(base, next.target), tierId: next.id, cefr: next.cefr, target: next.target },
      summit: { ...resolve(base, SUMMIT_TARGET), tierId: TIERS[TIERS.length - 1]!.id, cefr: MOUNTAIN_TIERS[MOUNTAIN_TIERS.length - 1]!.cefr, target: SUMMIT_TARGET },
    };
  }, [data.cards, data.states, data.avgAccuracy, data.daysActive, now]);

  if (data.totalSaved === 0) {
    return <EmptyStateCard style={styles.empty} illustration={<IconChart size={48} color={theme.color.textMuted} />} title={t('progress.emptyProjectionTitle')} body={t('progress.emptyProjectionBody')} />;
  }

  // At Summit tier there is no next camp, so the toggle has nothing to switch
  // between — show the Summit view alone rather than a one-option control.
  const atSummit = model.nextCamp == null;
  const active = atSummit || view === 'summit' ? model.summit : model.nextCamp!;
  // Past the mountain the CEFR ladder is exhausted, so the chart aims at the next
  // ROUND NUMBER instead (5k, 7.5k, 10k…). Without it the curve floated with no
  // threshold and no marker — a projection toward nothing (Casey, 2026-08-05).
  const milestone = atSummit ? nextMilestone(model.base.mastered) : null;
  const chartTarget = milestone ?? active.target;

  return (
    <View style={styles.pad}>
      {!atSummit && (
        <SegmentedPills
          style={styles.projToggle}
          active={view}
          onChange={(id) => setView(id as 'next' | 'summit')}
          pills={[
            { id: 'next', label: t('progress.proj.viewNext'), a11yLabel: t('progress.proj.viewNextA11y'), testID: 'projPillNext' },
            { id: 'summit', label: t('progress.proj.viewSummit'), a11yLabel: t('progress.proj.viewSummitA11y'), testID: 'projPillSummit' },
          ]}
        />
      )}
      {atSummit ? (
        <SummitJourneyCard base={model.base} cards={data.cards} now={now} t={t} />
      ) : (
        <ProjectionCard projection={active} t={t} />
      )}
      <ForecastSection base={model.base} target={chartTarget} milestoneLabel={milestone != null ? t('progress.proj.milestoneLine', { count: milestone.toLocaleString() }) : undefined} t={t} />
    </View>
  );
}

// ── Summit journey card (2026-08-05) ────────────────────────────────────────
// Replaces the dead-end "Reached — you're at Summit, keep reviewing" panel,
// which restated the tier the user could already see and offered nothing.
//
// Built from the SAME parts as ProjectionCard below — tier-tinted surface, mountain
// icon, eyebrow + tier/CEFR row, one big tier-coloured number, one detail line —
// because these two cards occupy the same slot and a summited user should not be
// handed a plainer screen than everyone else (Casey, 2026-08-05).
//
// HONESTY NOTE: the schema never recorded WHEN a user crossed 3,000 mastered, so
// "time to Summit" is not computable. The oldest card is the only start date
// there is, so this says "climbing" — the span of the library — and never claims
// to be the time it took to summit.
function SummitJourneyCard({ base, cards, now, t }: { base: ProjectionBase; cards: TabProps['data']['cards']; now: Date; t: TFunction }) {
  const isDark = useIsDark();
  const tier = tierView(tierRegistry(TIERS.length - 1), isDark);
  const cefr = MOUNTAIN_TIERS[MOUNTAIN_TIERS.length - 1]!.cefr;

  const spanDays = librarySpanDays(cards, now);
  const months = spanDays / 30.44;
  const climbing = months >= 1 ? t('progress.proj.spanMonths', { count: Math.round(months) }) : t('progress.proj.spanDays', { count: Math.max(1, Math.round(spanDays)) });
  // Per week, not per day: a summited learner masters a handful a week, and
  // "0.7 a day" is a worse sentence than "5 a week".
  const perWeek = spanDays > 0 ? (base.mastered / spanDays) * 7 : 0;

  return (
    <View testID="projectionCard" style={[styles.projCard, { backgroundColor: tier.bg, borderColor: tier.border }]}>
      <View style={styles.projHead}>
        <IconMountain size={26} color={tier.color} />
        <View style={styles.projHeadBody}>
          <RawText style={[styles.projSmall, { color: tier.labelColor }]}>{t('progress.proj.journeyEyebrow')}</RawText>
          <View style={styles.projTierRow}>
            <RawText style={[styles.projTier, { color: tier.text }]}>{t(`tier.${tier.id}.name`)}</RawText>
            <RawText style={[styles.projCefr, { color: tier.color }]}>{t('progress.cefr', { level: cefr })}</RawText>
          </View>
        </View>
      </View>

      <View style={styles.projBig}>
        <RawText style={[styles.projDays, { color: tier.color }]}>{base.mastered.toLocaleString()}</RawText>
        <RawText style={styles.projDaysLabel}>{t('progress.proj.journeyBigLabel')}</RawText>
      </View>

      <RawText style={styles.projDetail}>
        {t('progress.proj.journeyDetail', {
          climbing,
          pace: t('progress.proj.perWeek', { count: Math.max(1, Math.round(perWeek)) }),
        })}
      </RawText>
    </View>
  );
}

// ── Projection card — "when do I get there?" (rebuilt 2026-07-30) ────────────
// Presentational now: the tab owns the view state and hands down ONE
// already-resolved projection. The numbers come from domain/projection.ts,
// which forward-simulates the real FSRS scheduler over the user's actual cards
// and extrapolates the words they have not saved yet from their capture rate.
//
// This replaced a backwards-looking `mastered / daysActive` average that could
// not produce a number until the user had already mastered a word — i.e. it
// stayed locked for the first ~3 weeks of use, precisely when someone most
// needs to see that the thing is working.
type ResolvedProjection = Projection & { tierId: string; cefr: string; target: number };

function ProjectionCard({ projection, t }: { projection: ResolvedProjection; t: TFunction }) {
  const { theme } = useUnistyles();
  const isDark = useIsDark();

  // Per-tier theming (Casey 2026-07-30): the card wears the colours of the tier
  // it projects TOWARD, resolved through the registry — Summit is amber, not the
  // brand blue this card used to hardcode. `tierView` supplies the dark
  // variants, so this matches how the Route ladder tints itself.
  const idx = Math.max(0, TIERS.findIndex((x) => x.id === projection.tierId));
  const tier = tierView(tierRegistry(idx), isDark);
  const heading = t(`tier.${tier.id}.name`);

  // Non-'ok' states each get their own honest message. They are deliberately
  // NOT collapsed into one "unavailable" branch: "you haven't reviewed yet",
  // "your recall is still settling" and "you've stopped saving words" have
  // completely different fixes, and telling the user the wrong one is worse
  // than telling them nothing.
  if (projection.status !== 'ok') {
    const body =
      projection.status === 'reached'
        ? t('progress.proj.reachedBody', { tier: heading })
        : projection.status === 'low_recall'
          ? t('progress.proj.lowRecallBody')
          : projection.status === 'unreachable'
            ? t('progress.proj.unreachableBody', { tier: heading })
            : t('progress.projectionLockedBody');
    const title =
      projection.status === 'reached'
        ? t('progress.proj.reachedTitle')
        : projection.status === 'low_recall'
          ? t('progress.proj.lowRecallTitle')
          : projection.status === 'unreachable'
            ? t('progress.proj.unreachableTitle')
            : t('progress.projectionLocked');
    return (
      // Same testID as the 'ok' branch below: which of the two renders depends on
      // the account's data, and a screenshot flow only needs "the card is up".
      <View testID="projectionCard" style={[styles.projCard, { backgroundColor: tier.bg, borderColor: tier.border }]}>
        <View style={styles.projLockedInner}>
          <IconMountain size={32} color={theme.color.borderStrong} />
          <RawText style={styles.projLockedTitle}>{title}</RawText>
          <RawText style={styles.projLockedBody}>{body}</RawText>
        </View>
      </View>
    );
  }

  const span = horizon(projection.days!, projection.range!, projection.confidence);
  const unit = t(`progress.proj.${span.unitKey}`, { count: span.count });
  const a11y = span.showRange
    ? t('progress.proj.a11yRange', { low: span.low, high: span.high, unit })
    : t('progress.proj.a11yPoint', { count: span.count, unit });

  return (
    <View testID="projectionCard" style={[styles.projCard, { backgroundColor: tier.bg, borderColor: tier.border }]}>
      <View style={styles.projHead}>
        <IconMountain size={26} color={tier.color} />
        <View style={styles.projHeadBody}>
          <RawText style={[styles.projSmall, { color: tier.labelColor }]}>{t('progress.proj.heading')}</RawText>
          {/* Tier name and CEFR chip are SIBLINGS, not a blended string: nesting
              them made the heading one opaque text node ("Summit CEFR C2"),
              which reads worse to a screen reader and can't be asserted on. */}
          <View style={styles.projTierRow}>
            <RawText testID="projectionTargetTier" style={[styles.projTier, { color: tier.text }]}>{heading}</RawText>
            <RawText style={[styles.projCefr, { color: tier.color }]}>{t('progress.cefr', { level: projection.cefr })}</RawText>
          </View>
        </View>
      </View>

      <View style={styles.projBig}>
        <RawText style={[styles.projDays, { color: tier.color }]} accessibilityLabel={a11y}>
          {span.value}
        </RawText>
        <RawText style={styles.projDaysLabel}>{unit}</RawText>
      </View>

      {projection.confidence !== 'high' && <RawText style={styles.projRough}>{t('progress.proj.rough')}</RawText>}

      <RawText style={styles.projDetail}>
        {projection.fromFutureWords > 0
          ? t('progress.proj.detailWithCapture', {
              words: projection.wordsToGo.toLocaleString(),
              rate: projection.capturePerDay.toFixed(1),
            })
          : t('progress.proj.detailSaved', { words: projection.wordsToGo.toLocaleString() })}
      </RawText>
    </View>
  );
}

// ── Forecast curve (Progress → Projection) ───────────────────────────────────
// The same model as the card above, sampled over time rather than solved for a
// single target — and aimed at the SAME target the toggle selected, so
// switching to Summit re-scales the curve instead of just relabelling it.
// One series, so no legend: the section title names it.
function ForecastSection({ base, target, milestoneLabel, t }: { base: ProjectionBase; target: number; milestoneLabel?: string; t: TFunction }) {
  const isDark = useIsDark();
  const f = useMemo(() => forecast(base, { target }), [base, target]);

  // Nothing to plot before the first review, or when the curve is flat.
  if (base.reviewsLogged === 0 || f.peak <= base.mastered) return null;

  // Past Summit the target is a round-number milestone, not a camp, so
  // `f.camps` has no entry for it — synthesise the threshold from the curve so
  // the chart still draws a line and a marker to aim at.
  const campFromLadder = f.camps.find((c) => c.target === target) ?? null;
  const camp =
    campFromLadder ??
    (milestoneLabel == null ? null : { id: 'summit', target, day: resolve(base, target).days });
  const tierIdx = camp == null ? TIERS.length - 1 : TIERS.findIndex((x) => x.id === camp.id);
  const tier = tierView(tierRegistry(Math.max(0, tierIdx)), isDark);

  const fmt = (days: number) => {
    const h = horizon(days, [days, days], 'high');
    return `${h.value} ${t(`progress.proj.${h.unitKey}`, { count: h.count })}`;
  };
  const endLabel = fmt(f.horizonDays);

  return (
    <View style={styles.forecastBlock}>
      <RawText style={styles.sectionTitle}>{t('progress.forecast.title')}</RawText>
      <RawText style={styles.sectionSub}>{t('progress.forecast.sub')}</RawText>
      <View style={styles.forecastCard}>
        <ForecastChart
          points={f.points}
          horizonDays={f.horizonDays}
          color={tier.color}
          threshold={
            camp == null
              ? null
              : {
                  value: camp.target,
                  day: camp.day,
                  axisLabel: t('progress.forecast.axisWords', { count: camp.target.toLocaleString() }),
                  caption:
                    milestoneLabel != null
                      ? camp.day != null
                        ? t('progress.forecast.milestoneEtaCaption', { count: camp.target.toLocaleString(), span: fmt(camp.day) })
                        : milestoneLabel
                      : camp.day != null
                        ? t('progress.forecast.campEta', { tier: t(`tier.${camp.id}.name`), span: fmt(camp.day) })
                        : t('progress.forecast.campLine', { tier: t(`tier.${camp.id}.name`), count: camp.target.toLocaleString() }),
                }
          }
          startLabel={t('progress.forecast.today')}
          endLabel={endLabel}
          accessibilityLabel={t('progress.forecast.a11y', {
            from: Math.round(base.mastered).toLocaleString(),
            to: Math.round(f.peak).toLocaleString(),
            span: endLabel,
          })}
        />
      </View>
      <RawText style={styles.forecastNote}>{t('progress.forecast.note')}</RawText>
    </View>
  );
}

// ── All-time stats grid — Reviews · Avg accuracy · Days active · Time invested ──
// 18 §A5: each tile is pressable → an explainer tooltip (same whole-tile pattern as
// the Home stat tiles). Copy rule: honest, sourced claims only — dynamic where cheap.
//
// Refactored 2026-08-05. The two streak tiles left: Home already carries a live
// streak badge, so the grid was spending half its space restating it. What
// replaced them is cumulative rather than fragile — a missed day dents a streak
// but cannot take reviews, active days or hours away from you.
function AllTimeGrid({ data, t }: TabProps) {
  const { theme } = useUnistyles();
  const reviewsPerDay = data.daysActive > 0 ? data.reviewsTotal / data.daysActive : 0;
  // `time` is null below a minute — see lib/studyTime. An em dash is the honest
  // render for "we have no timing for this account", which is every user whose
  // sessions all predate duration recording. It is NOT rendered as "0m": we do
  // not know is a different claim from you studied for zero minutes.
  const time = studyTimeParts(data.timeInvestedMs);
  const timeValue = time.key == null ? '—' : t(`progress.time.${time.key}`, { hours: time.hours, minutes: time.minutes });
  const tiles: { label: string; value: string; Icon: typeof IconBook; color: string; tip: string }[] = [
    {
      label: t('progress.reviews'), value: data.reviewsTotal > 0 ? data.reviewsTotal.toLocaleString() : '—',
      Icon: IconRefresh, color: theme.palette.blue[500],
      // Every rating is one retrieval attempt, and retrieval — not re-reading —
      // is what the testing-effect literature finds does the work.
      tip: reviewsPerDay >= 1 ? t('progress.reviewsTipRate', { rate: Math.round(reviewsPerDay) }) : t('progress.reviewsTip'),
    },
    {
      label: t('progress.avgAccuracy'), value: data.avgAccuracy > 0 ? `${data.avgAccuracy}%` : '—', Icon: IconCheck, color: theme.palette.green[600],
      tip: t('progress.accuracyTip'),
    },
    {
      label: t('progress.daysActive'), value: data.daysActive > 0 ? data.daysActive.toLocaleString() : '—',
      Icon: IconCalendar, color: theme.color.accent,
      // Deliberately NOT a streak: this counts every day you showed up, and
      // missing today can never subtract from it.
      tip: t('progress.daysActiveTip'),
    },
    {
      label: t('progress.timeInvested'), value: timeValue, Icon: IconClock, color: theme.palette.amber[500],
      tip: t('progress.timeInvestedTip', { count: data.sessionsTotal }),
    },
  ];
  return (
    <View style={styles.tileGrid}>
      {tiles.map(({ label, value, Icon, color, tip }) => (
        <Tooltip
          key={label}
          content={tip}
          indicator={false}
          style={styles.allTileTrigger}
          accessibilityLabel={t('home.statInfoA11y', { label })}
        >
          <View style={styles.allTile}>
            <View style={styles.allInfo} pointerEvents="none">
              <IconInfo size={13} color={theme.color.textMuted} />
            </View>
            <Icon size={20} color={color} />
            <RawText style={styles.allValue}>{value}</RawText>
            <RawText style={styles.allLabel}>{label}</RawText>
          </View>
        </Tooltip>
      ))}
    </View>
  );
}

// ── Leaders (20 §4) — Global / own-language toggle, ranked rows, ghost empty ──
function LeadersTab({ t }: { t: TFunction }) {
  const { theme } = useUnistyles();
  const [scope, setScope] = useState<LeaderScope>('global');
  const activeLang = useActiveLang();
  const { entries, isLoading } = useLeaderboard(scope, activeLang);
  const lang = activeLang != null ? findLanguage(activeLang) : undefined;

  // 4.3 (REVISED 2026-07-24, Casey): the ghost/"mountain is quiet" state is
  // for a genuinely empty board only — nobody, including the caller, has a
  // qualifying mastered word in this scope yet. If the caller has ANY
  // entries (e.g. they're the only one on the board so far), that's a real
  // 1-row leaderboard, not a cold-start — render it normally below.
  const showEmpty = !isLoading && entries.length === 0;

  return (
    <View style={styles.pad}>
      <View style={styles.leaderToggle}>
        <Pressable
          onPress={() => setScope('global')}
          style={[styles.leaderChip, scope === 'global' && styles.leaderChipActive]}
          accessibilityRole="button"
          accessibilityState={{ selected: scope === 'global' }}
          accessibilityLabel={t('progress.leaders.global')}
        >
          <RawText style={[styles.leaderChipText, scope === 'global' && styles.leaderChipTextActive]}>🌍 {t('progress.leaders.global')}</RawText>
        </Pressable>
        {lang != null && (
          <Pressable
            onPress={() => setScope('language')}
            style={[styles.leaderChip, scope === 'language' && styles.leaderChipActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: scope === 'language' }}
            accessibilityLabel={lang.name}
          >
            <RawText style={[styles.leaderChipText, scope === 'language' && styles.leaderChipTextActive]} numberOfLines={1}>
              {lang.flag} {lang.name}
            </RawText>
          </Pressable>
        )}
      </View>

      {isLoading ? (
        <GhostRows variant="leader" count={10} animated />
      ) : showEmpty ? (
        // Cold-start empty (4.3): the SAME leader silhouettes, standing still,
        // with the message card over them — for an empty global OR language view.
        // Static is the whole point: a pulse would promise rows that aren't coming.
        // 2026-07-24 fix preserved: the caller's own row is deliberately NOT
        // pinned into this overlay — "you: #1, 26 mastered" directly under "the
        // mountain is quiet" read as contradictory. The self row still appears
        // normally once the board has ≥1 OTHER entry (the branch below).
        <EmptyOverlay ghost={<GhostRows variant="leader" count={12} />}>
          <EmptyStateCard illustration={<IconMountain size={40} color={theme.color.evergreen} />} title={t('progress.leaders.emptyTitle')} />
        </EmptyOverlay>
      ) : (
        <View style={styles.leaderRows}>
          {entries.map((e, i) => (
            <LeaderRow key={`${e.username}-${e.langCode}-${e.rank}`} entry={e} prevRank={i > 0 ? entries[i - 1].rank : undefined} t={t} />
          ))}
        </View>
      )}
    </View>
  );
}

function LeaderRow({ entry, prevRank, t }: { entry: LeaderboardEntry; prevRank?: number; t: TFunction }) {
  const { theme } = useUnistyles();
  const medalColor = entry.rank === 1 ? theme.palette.amber[400] : entry.rank === 2 ? theme.palette.slate[400] : entry.rank === 3 ? theme.palette.amber[700] : null;
  const lang = findLanguage(entry.langCode);
  // Own-row pinning (4.3): a gap between the fetched top-N and the caller's
  // real rank renders as a divider, so the pinned row never looks adjacent.
  const showGap = prevRank != null && entry.rank > prevRank + 1;
  return (
    <>
      {showGap && (
        <View style={styles.leaderGap}>
          <RawText style={styles.leaderGapText}>⋯</RawText>
        </View>
      )}
      <View style={[styles.leaderRow, entry.isSelf && styles.leaderRowSelf]}>
        <View style={[styles.leaderRank, medalColor != null && { backgroundColor: medalColor }]}>
          <RawText style={[styles.leaderRankText, medalColor != null && styles.leaderRankTextMedal]}>{entry.rank}</RawText>
        </View>
        <RawText style={styles.leaderFlag}>{lang?.flag ?? '🌐'}</RawText>
        <RawText style={styles.leaderName} numberOfLines={1}>
          {formatUsername(entry.username)}
        </RawText>
        <View style={styles.leaderCountWrap}>
          <RawText style={styles.leaderCount}>{entry.mastered.toLocaleString()}</RawText>
          <RawText style={styles.leaderCountLabel}>{t('progress.wordsSuffix')}</RawText>
        </View>
      </View>
    </>
  );
}

// ── Info sheets (CEFR ladder / FSRS stability) ────────────────────────────────
function InfoSheet({ infoKey, t, onClose }: { infoKey: InfoKey | null; t: TFunction; onClose: () => void }) {
  const isDark = useIsDark();
  // Only the CEFR ladder remains: the FSRS stability explainer was retired with
  // the Inventory tab (Casey 2026-07-30).
  return (
    <Sheet visible={infoKey != null} onClose={onClose} title={t('progress.cefrTitle')}>
      <RawText style={styles.infoIntro}>{t('progress.cefrIntro')}</RawText>
      <View style={styles.infoList}>
        {TIERS.map((tier, i) => {
          const tv = tierView(tier, isDark);
          return (
            <View key={tier.id} style={[styles.infoRow, { backgroundColor: tv.bg, borderColor: tv.border }]}>
              <View style={[styles.infoDotRound, { backgroundColor: tv.color }]} />
              <View style={styles.infoRowBody}>
                <RawText style={styles.infoTier}>{t(`tier.${tier.id}.name`)}</RawText>
                <RawText style={styles.infoDesc}>{t('progress.masteredThreshold', { count: masteredMinAt(i).toLocaleString() })}</RawText>
              </View>
              <RawText style={styles.infoMeta}>{t('progress.cefr', { level: MOUNTAIN_TIERS[i].cefr })}</RawText>
            </View>
          );
        })}
      </View>
      <RawText style={styles.infoNote}>{t('progress.cefrNote')}</RawText>
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, palette, fonts, radius } = theme;
  return {
    // No backgroundColor on purpose — matches the Word List header, which sits
    // directly on the screen background. surfaceCard read as a lighter slab
    // floating above the page in dark mode (Casey, 2026-08-05).
    header: { borderBottomWidth: theme.borderWidth.thin, borderBottomColor: color.border, paddingHorizontal: 16, paddingTop: 6 },
    titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    title: { fontFamily: fonts.sans.extra, fontSize: 22, letterSpacing: -0.3, color: color.textStrong },

    // + the FAB's overhang: the nav's height is spacer-reserved, the FAB is not.
    scroll: { paddingBottom: 20 + TAB_BAR_FAB_OVERHANG },
    pad: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
    empty: { paddingTop: 56 },
    sectionTitle: { fontFamily: fonts.sans.bold, fontSize: 15, color: color.textStrong },
    sectionSub: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted, marginTop: 2, marginBottom: 14 },
    divider: { height: 1, backgroundColor: color.border, marginVertical: 20 },

    // Route — you are here
    // Dark-only: the light rgba-white overlays become a light box that hides the
    // (now light) muted text on the dark tier card — flip them to faint light-on-dark.

    // Route — ladder
    ladder: { marginTop: 12, gap: 20, position: 'relative' },
    ladderLine: { position: 'absolute', left: 18, top: 19, bottom: 19, width: 2, backgroundColor: color.border, borderRadius: 1 },
    ladderRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
    node: { width: 38, height: 38, borderRadius: 19, borderWidth: 3, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
    nodeCurrent: { boxShadow: `0 0 0 5px ${color.brandSoft}` },
    // Opaque muted fill for locked nodes — hides the route line behind them without using
    // row opacity (which would let the line show through).
    nodeLocked: { backgroundColor: color.surfaceSunken, borderColor: color.border },
    nodeNum: { fontFamily: fonts.sans.bold, fontSize: 12, color: '#fff' },
    ladderBody: { flex: 1, paddingTop: 4 },
    ladderTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
    ladderTier: { fontFamily: fonts.sans.semibold, fontSize: 15 },
    badgeCurrent: { fontFamily: fonts.sans.bold, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: color.onBrandSoft, backgroundColor: color.brandSoft, paddingVertical: 2, paddingHorizontal: 7, borderRadius: 4, overflow: 'hidden' },
    badgeDone: { fontFamily: fonts.sans.bold, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: color.onSuccessSoft, backgroundColor: color.successSoft, paddingVertical: 2, paddingHorizontal: 7, borderRadius: 4, overflow: 'hidden' },
    ladderCefr: { fontFamily: fonts.sans.semibold, fontSize: 11, letterSpacing: 0.4, marginBottom: 4 },
    ladderStatus: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted },

    // Inventory

    // Projection (on Route) + all-time
    projCard: { backgroundColor: color.brandTint, borderWidth: 1.5, borderColor: color.brandSoft, borderRadius: radius.lg, padding: 18, marginBottom: 24 },
    projHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
    projSmall: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted, marginBottom: 2 },
    projTier: { fontFamily: fonts.sans.bold, fontSize: 16, color: color.textStrong },
    projCefr: { fontFamily: fonts.sans.semibold, fontSize: 13, color: color.brand },
    projBig: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 6 },
    projDays: { fontFamily: fonts.serif.bold, fontSize: 44, color: color.brand },
    projDaysLabel: { fontFamily: fonts.sans.semibold, fontSize: 18, color: color.textMuted, paddingBottom: 5 },
    projDetail: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted },
    projToggle: { marginBottom: 16 },
    ladderInfo: { marginLeft: 2, padding: 2 },
    // In-tier progress, folded out of the retired "You are here" card. The old
    // track was translucent WHITE because it sat on a tinted hero surface; on
    // the ladder's page background that would be invisible in light mode, so
    // these are re-tokened against the page instead of carried over verbatim.
    ladderTrack: { height: 8, backgroundColor: color.surfaceSunken, borderWidth: theme.borderWidth.thin, borderColor: color.border, borderRadius: 6, overflow: 'hidden', marginTop: 8 },
    ladderTrackDark: { backgroundColor: color.divider },
    ladderFill: { height: '100%', borderRadius: 6 },
    ladderPct: { fontFamily: fonts.sans.regular, fontSize: 11, color: color.textMuted, marginTop: 5 },
    ladderHint: { marginTop: 10, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: theme.borderWidth.thin, backgroundColor: color.surfaceSunken },
    ladderHintDark: { backgroundColor: color.divider },
    ladderHintText: { fontFamily: fonts.sans.regular, fontSize: 12, lineHeight: 18, color: color.textMuted },
    forecastBlock: { marginTop: 4 },
    forecastCard: { backgroundColor: color.surfaceCard, borderWidth: theme.borderWidth.thin, borderColor: color.border, borderRadius: radius.lg, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 12, marginTop: 12 },
    forecastNote: { fontFamily: fonts.sans.regular, fontSize: 11, lineHeight: 16, fontStyle: 'italic', color: color.textMuted, marginTop: 10 },
    projHeadBody: { flex: 1 },
    projTierRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' },
    projRough: { fontFamily: fonts.sans.regular, fontSize: 11, fontStyle: 'italic', color: color.textMuted, marginBottom: 6 },
    projLockedInner: { alignItems: 'center', paddingVertical: 8 },
    projLockedTitle: { fontFamily: fonts.sans.semibold, fontSize: 14, color: color.textMuted, marginTop: 10, marginBottom: 6 },
    projLockedBody: { fontFamily: fonts.sans.regular, fontSize: 12, lineHeight: 18, color: color.textMuted, textAlign: 'center', maxWidth: 220 },
    tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
    allTileTrigger: { width: '47.5%', flexGrow: 1 },
    allTile: { position: 'relative', backgroundColor: color.surfaceCard, borderWidth: theme.borderWidth.thin, borderColor: color.border, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 14 },
    allInfo: { position: 'absolute', top: 6, right: 6, zIndex: 1 },
    allValue: { fontFamily: fonts.serif.bold, fontSize: 26, color: color.textStrong, marginTop: 8, marginBottom: 4 },
    allLabel: { fontFamily: fonts.sans.semibold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: color.textMuted },

    // Info sheets (CEFR / FSRS)
    infoIntro: { fontFamily: fonts.sans.regular, fontSize: 13, lineHeight: 20, color: color.textMuted, marginBottom: 14 },
    infoList: { gap: 8 },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: theme.borderWidth.thin, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 12 },
    infoDotRound: { width: 8, height: 8, borderRadius: 4 },
    infoRowBody: { flex: 1 },
    infoTier: { fontFamily: fonts.sans.bold, fontSize: 13, color: color.textStrong },
    infoDesc: { fontFamily: fonts.sans.regular, fontSize: 11, lineHeight: 15, color: color.textMuted, marginTop: 1 },
    infoMeta: { fontFamily: fonts.mono.regular, fontSize: 11, color: color.textMuted, textAlign: 'right' },
    infoNote: { fontFamily: fonts.sans.regular, fontSize: 11, lineHeight: 16, fontStyle: 'italic', color: color.textMuted, marginTop: 12 },


    // Leaders (20 §4)
    leaderToggle: { flexDirection: 'row', gap: 8, marginBottom: 16 },
    leaderChip: { flexShrink: 1, paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: color.surfaceSunken, borderWidth: theme.borderWidth.thin, borderColor: 'transparent' },
    leaderChipActive: { backgroundColor: color.brandSoft, borderColor: palette.blue[300] },
    leaderChipText: { fontFamily: fonts.sans.semibold, fontSize: 13, color: color.textMuted },
    leaderChipTextActive: { color: color.brandStrong },
    leaderRows: { gap: 8 },
    leaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: color.surfaceCard, borderWidth: theme.borderWidth.thin, borderColor: color.border, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 12 },
    leaderRowSelf: { backgroundColor: color.brandTint, borderColor: color.brandSoft },
    leaderRank: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surfaceSunken },
    leaderRankText: { fontFamily: fonts.mono.bold, fontSize: 12, color: color.textMuted },
    leaderRankTextMedal: { color: '#fff' },
    leaderFlag: { fontSize: 17 },
    leaderName: { flex: 1, fontFamily: fonts.sans.semibold, fontSize: 14, color: color.textStrong },
    leaderCountWrap: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
    leaderCount: { fontFamily: fonts.mono.bold, fontSize: 15, color: color.textStrong },
    leaderCountLabel: { fontFamily: fonts.sans.regular, fontSize: 11, color: color.textMuted },
    leaderGap: { alignItems: 'center', paddingVertical: 2 },
    leaderGapText: { fontFamily: fonts.sans.bold, fontSize: 14, color: color.borderStrong, letterSpacing: 2 },
  };
});
