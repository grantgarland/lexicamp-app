// Progress projections — "when do I reach the next camp, and when do I summit?"
//
// Replaces the naive `mastered / daysActive` extrapolation that used to live
// inline in ProgressScreen. That model could not run until the user had already
// mastered a word (30+ days of stability), so the card sat locked for a MONTH
// of real use — exactly the window where a new user most wants to see progress.
//
// This model runs after the FIRST review session, because it projects forward
// instead of averaging backwards. Two stages (Casey 2026-07-30):
//
//   Stage A — MATURATION. Every card the user already owns is pushed through
//     the real FSRS engine, review by review, until its stability crosses the
//     mastery threshold. That yields a per-card "days until mastered", and
//     therefore a curve of how many words mature over time from the CURRENT
//     library alone. No new words assumed.
//
//   Stage B — ACQUISITION. Summit needs ~3,000 mastered words; nobody has
//     3,000 cards on day one, so the words that don't exist yet are
//     extrapolated from the user's observed capture rate (saves/day). A word
//     saved on day t matures at t + freshCardDays, where freshCardDays is the
//     same FSRS simulation run on an empty card.
//
// The projected day is the first day where (already mastered) + (Stage A
// matured by then) + (Stage B matured by then) reaches the target.
//
// ── Why this is an approximation, stated honestly ──────────────────────────
// FSRS is stochastic: the interval after a review depends on the grade, and we
// cannot know future grades. We run a MEAN-FIELD simulation — at each step the
// three possible grades are evaluated and their stability/difficulty/interval
// are combined by the user's grade probabilities. That is deterministic (hence
// testable and reproducible, matching the no-fuzz decision in fsrs.ts) and
// unbiased in the mean, but it is NOT a Monte Carlo distribution: it gives the
// expected trajectory, not a confidence interval. The confidence banding below
// is derived from SAMPLE SIZE, not from simulation variance, and the UI must
// present low-confidence results as a range rather than a precise day count.
import { applyReview } from './fsrs';
import type { Card, CardFsrsState, FsrsStateValue, Rating } from './types';

import { MASTERY_STABILITY, MOUNTAIN_TIERS, mountainTier } from './derive';
import type { TierId } from '@/theme/tiers';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Hard stop on the per-card simulation. This is a runaway guard ONLY — the
 *  binding constraint is meant to be MAX_HORIZON_DAYS below, so that a user
 *  with a weak grade mix gets a long-but-real estimate instead of being told
 *  the goal is unreachable. (At 40 this fired first and a struggling learner's
 *  projection collapsed to "unreachable" — caught by the monotonicity test.) */
const MAX_STEPS = 250;

/** Simulated-days ceiling. Beyond ~27 years the number is meaningless; we
 *  report unreachable instead of rendering a fantasy date. */
const MAX_HORIZON_DAYS = 10_000;

/** Minimum expected-stability gain per simulated review before a step counts as
 *  "no progress". Well below any real FSRS step. */
const PLATEAU_EPSILON = 0.01;

/** Consecutive no-progress steps before we call the simulation stalled.
 *  It must be > 1: expected stability legitimately DIPS once, on the
 *  learning → review transition (a fresh card goes 1.89 -> 1.78 as ts-fsrs
 *  hands off from learning steps to the review scheduler), and a 1-step guard
 *  aborted every projection right there. */
const PLATEAU_STEPS = 3;

/** Floor on the time-to-mastery of a card that is not mastered YET. A card due
 *  right now can cross the threshold at its very next review, which the
 *  simulation clocks at t=0 — but it is not mastered until that review actually
 *  happens. Without this floor the forecast curve's day-0 point counts those
 *  cards as already mastered and starts above the user's real number. */
const MIN_TIME_TO_MASTERY_DAYS = 1 / 24;

// ── Grade mix ────────────────────────────────────────────────────────────────
// The server gives us `avgAccuracy` = % of reviews graded got_it (see the
// get_study_stats RPC: "% rating >= 3"). It does NOT give a full
// again/almost/got_it histogram — that would need a new RPC field and a
// migration, deliberately not taken (2026-07-30). So p(got_it) is REAL user
// data and the remaining probability mass is split on a fixed prior.
//
// Everything is then shrunk toward a neutral prior by review volume, so a
// 3-review sample cannot swing the projection by months. This is the
// "observed mix unless it's brittle" ruling made concrete.

/** Split of the non-got_it mass between `almost` and `again`. Users who miss a
 *  word more often half-remember it than blank on it entirely. */
const ALMOST_SHARE_OF_MISSES = 0.6;

/** Neutral prior used before we trust the user's own numbers. */
const PRIOR_MIX: GradeMix = { again: 0.12, almost: 0.18, gotIt: 0.7 };

/** Pseudo-count (in reviews) given to the prior. At 20 real reviews the
 *  observed mix and the prior carry equal weight. */
const PRIOR_STRENGTH = 20;

export interface GradeMix {
  again: number;
  almost: number;
  gotIt: number;
}

/** Blend the user's observed accuracy with the prior, weighted by how many
 *  reviews back it. `reviewsLogged = 0` returns the prior unchanged. */
export function gradeMix(avgAccuracy: number, reviewsLogged: number): GradeMix {
  const n = Math.max(0, reviewsLogged);
  if (n === 0) return { ...PRIOR_MIX };
  const gotIt = Math.min(1, Math.max(0, avgAccuracy / 100));
  const miss = 1 - gotIt;
  const observed: GradeMix = {
    gotIt,
    almost: miss * ALMOST_SHARE_OF_MISSES,
    again: miss * (1 - ALMOST_SHARE_OF_MISSES),
  };
  const w = n / (n + PRIOR_STRENGTH);
  return {
    again: w * observed.again + (1 - w) * PRIOR_MIX.again,
    almost: w * observed.almost + (1 - w) * PRIOR_MIX.almost,
    gotIt: w * observed.gotIt + (1 - w) * PRIOR_MIX.gotIt,
  };
}

// UI grade -> FSRS rating, mirroring quiz.ts uiRatingToFsrs (again/almost/got_it
// -> 1/2/3). Easy (4) stays unused at MVP, so it is absent here too.
const MIX_RATINGS: { rating: Rating; key: keyof GradeMix }[] = [
  { rating: 1, key: 'again' },
  { rating: 2, key: 'almost' },
  { rating: 3, key: 'gotIt' },
];

// ── Stage A: per-card maturation ─────────────────────────────────────────────

/** Days from `now` until this card's stability crosses the mastery threshold,
 *  or `null` if it does not get there inside the simulation bounds.
 *  Already-mastered cards return 0. Pure: never mutates `state`. */
export function daysToMastery(state: CardFsrsState, mix: GradeMix, now: Date = new Date()): number | null {
  if (state.stability >= MASTERY_STABILITY) return 0;

  let cur = state;
  // Start at the card's DUE date, not `now`: a card scheduled 20 days out is
  // not reviewed today, and pretending otherwise compresses every projection.
  // Overdue cards (dueAt in the past) start immediately.
  const firstReview = Math.max(now.getTime(), state.dueAt.getTime());
  // `elapsed` is always the time until the NEXT review to be simulated. A card
  // becomes mastered AT the review whose recompute pushes stability over the
  // threshold — not one interval later. Counting that trailing interval
  // overstated every estimate by a full spacing cycle (~30+ days at the top
  // end), which is why this accumulates *before* the review, never after.
  let elapsed = (firstReview - now.getTime()) / DAY_MS;
  let clock = new Date(firstReview);
  let prevStability = state.stability;
  let stalled = 0;
  if (elapsed > MAX_HORIZON_DAYS) return null;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    let sStability = 0;
    let sDifficulty = 0;
    let sInterval = 0;
    // Structural fields (state / reps / learningSteps) are carried from the
    // got_it branch: they are discrete and cannot be averaged meaningfully,
    // and got_it is the dominant branch for any non-pathological mix.
    let carrier: CardFsrsState | null = null;

    for (const { rating, key } of MIX_RATINGS) {
      const p = mix[key];
      const next = applyReview(cur, rating, clock).next;
      const interval = Math.max(0, (next.dueAt.getTime() - clock.getTime()) / DAY_MS);
      sStability += p * next.stability;
      sDifficulty += p * next.difficulty;
      sInterval += p * interval;
      if (rating === 3) carrier = next;
    }
    if (carrier == null) return null; // unreachable; satisfies the type checker

    // The review at `clock` is what crossed the threshold, so `elapsed` — the
    // time up to and including the wait for THIS review — is the answer.
    if (sStability >= MASTERY_STABILITY) return Math.max(elapsed, MIN_TIME_TO_MASTERY_DAYS);

    // Mean-field plateau. `again` RESETS stability, so at a high enough again
    // probability the expected stability converges to a fixed point BELOW the
    // mastery threshold and simply stops climbing — the average card never
    // masters even though individual lucky runs would. Detect that and stop,
    // rather than burning MAX_STEPS to reach the same answer. Callers treat
    // null here as "this recall rate cannot mature a word", which is a
    // different and more useful statement than "the goal is unreachable".
    stalled = sStability - prevStability < PLATEAU_EPSILON ? stalled + 1 : 0;
    if (stalled >= PLATEAU_STEPS) return null;
    prevStability = sStability;

    // Not mastered: wait out the newly scheduled interval, then review again.
    // A degenerate mix could produce a zero-length interval; without the floor
    // the loop would burn every step without advancing the clock at all.
    const advance = Math.max(sInterval, 1 / 24);
    elapsed += advance;
    if (elapsed > MAX_HORIZON_DAYS) return null;

    clock = new Date(clock.getTime() + advance * DAY_MS);
    cur = {
      ...carrier,
      stability: sStability,
      difficulty: sDifficulty,
      dueAt: clock,
      lastReviewAt: new Date(clock.getTime() - advance * DAY_MS),
    };
  }
  return null;
}

/** A card the user has not saved yet: how long from capture to mastery.
 *  Drives Stage B. */
export function freshCardDays(mix: GradeMix, now: Date = new Date()): number | null {
  const empty: CardFsrsState = {
    cardId: '__projection_probe__',
    userId: '__projection_probe__',
    stability: 0,
    difficulty: 0,
    dueAt: now,
    lastReviewAt: null,
    state: 0 as FsrsStateValue,
    reps: 0,
    lapses: 0,
    learningSteps: 0,
  };
  return daysToMastery(empty, mix, now);
}

// ── Inputs / outputs ─────────────────────────────────────────────────────────

export type ProjectionConfidence = 'low' | 'medium' | 'high';

export interface ProjectionInput {
  /** Every card in the active language (for capture rate + library size). */
  cards: Card[];
  /** Matching FSRS rows. */
  states: CardFsrsState[];
  /** % of reviews graded got_it, all-time (get_study_stats). */
  avgAccuracy: number;
  /** Distinct days with >= 1 review (get_study_stats). */
  daysActive: number;
  now?: Date;
}

export type ProjectionStatus =
  /** No reviews yet — nothing to project from. */
  | 'no_reviews'
  /** Target already met. */
  | 'reached'
  /** Recall rate is too low for ANY word to reach mastery stability. Not the
   *  same as 'unreachable': the goal is fine, the current accuracy is the
   *  blocker, and it is fixable by the user. The UI should say so kindly. */
  | 'low_recall'
  /** Library can't get there and the user isn't saving new words. */
  | 'unreachable'
  | 'ok';

export interface Projection {
  status: ProjectionStatus;
  /** Target mastered-word count for this projection. */
  target: number;
  /** Mastered words today. */
  mastered: number;
  /** Estimated days until `target` is reached (null unless status === 'ok'). */
  days: number | null;
  /** Display range [low, high] widened by confidence. Null unless 'ok'. */
  range: [number, number] | null;
  confidence: ProjectionConfidence;
  /** Words still to master. */
  wordsToGo: number;
  /** Observed new-words-saved-per-day. */
  capturePerDay: number;
  /** How many of `wordsToGo` come from words not yet saved. */
  fromFutureWords: number;
  mix: GradeMix;
}

/** Confidence is a function of SAMPLE SIZE, not simulation variance — see the
 *  header note. Both axes matter: 200 reviews crammed into one day still tells
 *  us almost nothing about a sustainable pace. */
export function projectionConfidence(reviewsLogged: number, daysActive: number): ProjectionConfidence {
  if (reviewsLogged >= 150 && daysActive >= 14) return 'high';
  if (reviewsLogged >= 30 && daysActive >= 3) return 'medium';
  return 'low';
}

/** Half-width of the displayed range, as a fraction of the point estimate. */
const RANGE_SPREAD: Record<ProjectionConfidence, number> = { low: 0.4, medium: 0.2, high: 0 };

/** Everything expensive, computed ONCE per data set: the FSRS forward-sim of
 *  every card, the capture rate, the grade mix and the confidence band. Both
 *  the next-camp and the Summit projection resolve against this same base —
 *  running the simulation twice (once per target) doubled the cost of a screen
 *  that can hold hundreds of cards, and re-ran it on every toggle tap. */
export interface ProjectionBase {
  mastered: number;
  reviewsLogged: number;
  mix: GradeMix;
  confidence: ProjectionConfidence;
  /** Ascending days-to-mastery for every card still in flight. */
  maturing: number[];
  capturePerDay: number;
  /** Capture-to-mastery time for a word not yet saved; null = recall too low. */
  fresh: number | null;
}

export function projectionBase(input: ProjectionInput): ProjectionBase {
  const now = input.now ?? new Date();
  const { cards, states, avgAccuracy, daysActive } = input;

  const reviewsLogged = states.reduce((sum, s) => sum + Math.max(0, s.reps), 0);
  const mastered = states.filter((s) => s.stability >= MASTERY_STABILITY).length;
  const mix = gradeMix(avgAccuracy, reviewsLogged);
  const confidence = projectionConfidence(reviewsLogged, daysActive);

  // Suspended (archived) cards keep their earned mastery but have left the
  // review queue, so they will never mature further — 07-17c. Excluding them
  // stops the projection waiting on words the scheduler never surfaces.
  const suspended = new Set(cards.filter((c) => c.suspended).map((c) => c.id));
  const maturing: number[] = [];
  if (reviewsLogged > 0) {
    for (const st of states) {
      if (st.stability >= MASTERY_STABILITY) continue;
      if (suspended.has(st.cardId)) continue;
      const d = daysToMastery(st, mix, now);
      if (d != null) maturing.push(d);
    }
    maturing.sort((a, b) => a - b);
  }

  // Capture rate is measured over the LIFE OF THE LIBRARY, not `daysActive`: a
  // user who saves words on days they don't study still has a real capture
  // rate, and dividing by study-days only would inflate it.
  let capturePerDay = 0;
  if (cards.length > 0) {
    let earliest = Infinity;
    for (const c of cards) earliest = Math.min(earliest, c.createdAt.getTime());
    const spanDays = Math.max(1, (now.getTime() - earliest) / DAY_MS);
    capturePerDay = cards.length / spanDays;
  }

  return {
    mastered,
    reviewsLogged,
    mix,
    confidence,
    maturing,
    capturePerDay,
    fresh: reviewsLogged > 0 ? freshCardDays(mix, now) : null,
  };
}

/** Resolve one target against a prepared base. Cheap — no simulation. */
export function resolve(base: ProjectionBase, target: number): Projection {
  const { mastered, mix, confidence, maturing, capturePerDay } = base;
  const shell = {
    target,
    mastered,
    confidence,
    mix,
    wordsToGo: Math.max(0, target - mastered),
    capturePerDay,
    fromFutureWords: 0,
  };

  if (mastered >= target) return { ...shell, status: 'reached', days: 0, range: [0, 0], wordsToGo: 0 };
  // Projecting from zero reviews would be projecting from nothing: FSRS has no
  // trajectory to extend, and a capture rate alone says nothing about recall.
  if (base.reviewsLogged === 0) return { ...shell, status: 'no_reviews', days: null, range: null };

  const need = target - mastered;

  // Enough already-saved words to cover the target on their own.
  if (maturing.length >= need) {
    const days = Math.ceil(maturing[need - 1]!);
    return { ...shell, status: 'ok', days, range: rangeFor(days, confidence), fromFutureWords: 0 };
  }

  const remaining = need - maturing.length;
  if (base.fresh == null) {
    // No new word could ever mature at this recall rate — distinguish that from
    // "you aren't saving words", because the fix is completely different.
    return { ...shell, status: 'low_recall', days: null, range: null, fromFutureWords: remaining };
  }
  if (capturePerDay <= 0) {
    return { ...shell, status: 'unreachable', days: null, range: null, fromFutureWords: remaining };
  }
  // Words saved from now mature `fresh` days later, so by day D the future
  // words that have matured number capturePerDay * (D - fresh).
  const libraryExhaustedAt = maturing.length > 0 ? maturing[maturing.length - 1]! : 0;
  const viaFuture = base.fresh + remaining / capturePerDay;
  const days = Math.ceil(Math.max(viaFuture, libraryExhaustedAt));
  if (days > MAX_HORIZON_DAYS) {
    return { ...shell, status: 'unreachable', days: null, range: null, fromFutureWords: remaining };
  }
  return { ...shell, status: 'ok', days, range: rangeFor(days, confidence), fromFutureWords: remaining };
}

/** Days until the user has `target` mastered words. Convenience wrapper — if
 *  you need more than one target, build the base once and `resolve` each. */
export function project(input: ProjectionInput, target: number): Projection {
  return resolve(projectionBase(input), target);
}

function rangeFor(days: number, confidence: ProjectionConfidence): [number, number] {
  const spread = RANGE_SPREAD[confidence];
  if (spread === 0) return [days, days];
  return [Math.max(1, Math.floor(days * (1 - spread))), Math.ceil(days * (1 + spread))];
}

// ── The two projections the Progress card toggles between ────────────────────

/** Mastered-word count that unlocks the user's NEXT camp, or null at Summit. */
export function nextCampTarget(mastered: number): { id: string; cefr: string; target: number } | null {
  const curId = mountainTier(mastered).id;
  const i = MOUNTAIN_TIERS.findIndex((t) => t.id === curId);
  const next = MOUNTAIN_TIERS[i + 1];
  return next == null ? null : { id: next.id, cefr: next.cefr, target: next.masteredMin };
}

/** Summit = the top of the mountain ladder (currently 3,000 mastered words).
 *  Read from the registry, never hardcoded — the ladder moved on 2026-07-30
 *  and will move again. */
export const SUMMIT_TARGET = MOUNTAIN_TIERS[MOUNTAIN_TIERS.length - 1]!.masteredMin;

export interface Projections {
  nextCamp: (Projection & { tierId: string; cefr: string }) | null;
  summit: Projection;
}

/** Both projections in one pass. `nextCamp` is null only when the user is
 *  already at Summit tier, in which case the card shows the Summit view alone. */
export function projections(input: ProjectionInput): Projections {
  // ONE simulation pass, two targets resolved against it.
  const base = projectionBase(input);
  const next = nextCampTarget(base.mastered);
  return {
    nextCamp: next == null ? null : { ...resolve(base, next.target), tierId: next.id, cefr: next.cefr },
    summit: resolve(base, SUMMIT_TARGET),
  };
}

// ── Display shaping ──────────────────────────────────────────────────────────
// Kept in the domain layer (returning a UNIT KEY, never a translated string) so
// the unit-selection and range-collapse rules are unit-testable. The screen
// maps `unitKey` through i18n; domain code never calls `t()`.

const DAYS_PER_MONTH = 30.44;
const DAYS_PER_YEAR = 365.25;

export type HorizonUnit = 'unitDays' | 'unitMonths' | 'unitYears';

export interface Horizon {
  /** Rendered figure: "51" or "4–7". */
  value: string;
  unitKey: HorizonUnit;
  /** Count to drive i18n pluralisation (the upper bound when a range). */
  count: number;
  showRange: boolean;
  low: number;
  high: number;
}

/** A 631-day Summit estimate is correct and unreadable. Pick a unit from the
 *  point estimate, then express BOTH bounds in that same unit so the two
 *  numbers stay comparable. */
export function horizon(days: number, range: [number, number], confidence: ProjectionConfidence): Horizon {
  const scale = days < 60 ? 1 : days < 730 ? DAYS_PER_MONTH : DAYS_PER_YEAR;
  const unitKey: HorizonUnit = scale === 1 ? 'unitDays' : scale === DAYS_PER_MONTH ? 'unitMonths' : 'unitYears';
  // Years carry one decimal ("1.7 years"); days and months are whole numbers.
  const round = (d: number) => (scale === DAYS_PER_YEAR ? Math.round((d / scale) * 10) / 10 : Math.max(1, Math.round(d / scale)));

  const point = round(days);
  const low = round(range[0]);
  const high = round(range[1]);
  // Collapse a range whose bounds round to the same figure in this unit —
  // "3–3 months" reads as a bug, not as precision.
  const showRange = confidence !== 'high' && low !== high;
  return {
    value: showRange ? `${low}\u2013${high}` : `${point}`,
    unitKey,
    count: showRange ? high : point,
    showRange,
    low,
    high,
  };
}

// ── Forecast series (Progress → Projection chart) ────────────────────────────
// The same two-stage model the headline number comes from, sampled over time
// instead of solved for one target. Shape to expect: a STEPPED near-term rise
// as words already in flight mature, then a straight acquisition tail whose
// slope is the capture rate. Showing both is the honest picture — it makes
// clear that the near term is already banked and the long term is a choice.

export interface ForecastPoint {
  /** Days from now. */
  day: number;
  /** Projected mastered-word count at that day. */
  mastered: number;
}

export interface ForecastCamp {
  id: TierId;
  target: number;
  /** Day the curve crosses this camp, or null if not within the horizon. */
  day: number | null;
}

export interface Forecast {
  points: ForecastPoint[];
  camps: ForecastCamp[];
  horizonDays: number;
  /** Max y across the series — the chart's scale ceiling. */
  peak: number;
}

/** Mastered-word count projected at `day`, from a prepared base. */
export function masteredAt(base: ProjectionBase, day: number): number {
  let matured = 0;
  // maturing is sorted ascending, so this could binary-search; at realistic
  // library sizes (hundreds) the linear scan is not worth the extra surface.
  for (const d of base.maturing) {
    if (d > day) break;
    matured += 1;
  }
  const fromFuture =
    base.fresh == null || base.capturePerDay <= 0 ? 0 : base.capturePerDay * Math.max(0, day - base.fresh);
  return base.mastered + matured + fromFuture;
}

export interface ForecastOptions {
  /** Mastered-word target the chart is aimed at — the toggle's current view.
   *  Defaults to the next camp. Drives the horizon AND the threshold line, so
   *  switching to Summit re-scales the whole chart rather than just relabelling
   *  it. */
  target?: number;
  /** Override the computed horizon (mostly for tests). */
  horizonDays?: number;
  samples?: number;
}

/** Sample the projection into a plottable series, aimed at `target`.
 *  The horizon is chosen to comfortably contain the target crossing, clamped so
 *  the chart neither flatlines nor compresses the interesting part into the
 *  first pixel. */
export function forecast(base: ProjectionBase, opts: ForecastOptions = {}): Forecast {
  const samples = opts.samples ?? 48;
  const next = nextCampTarget(base.mastered);
  const target = opts.target ?? next?.target ?? SUMMIT_TARGET;

  let horizon = opts.horizonDays;
  if (horizon == null) {
    const toTarget = resolve(base, target).days;
    horizon = toTarget == null ? 365 : Math.min(7300, Math.max(60, Math.ceil(toTarget * 1.2)));
  }

  const points: ForecastPoint[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const day = (horizon * i) / samples;
    points.push({ day, mastered: masteredAt(base, day) });
  }

  // Camps still ahead of the user, with their crossing day when it falls inside
  // the horizon. The chart draws only the one matching `target`, but the rest
  // are cheap and let a caller annotate more if it wants to.
  const camps: ForecastCamp[] = MOUNTAIN_TIERS.filter((mt) => mt.masteredMin > base.mastered).map((mt) => {
    const days = resolve(base, mt.masteredMin).days;
    return { id: mt.id, target: mt.masteredMin, day: days != null && days <= horizon! ? days : null };
  });

  return {
    points,
    camps,
    horizonDays: horizon,
    peak: points[points.length - 1]?.mastered ?? base.mastered,
  };
}
