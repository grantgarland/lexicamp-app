// FSRS engine wrapper (backlog 2.2) — the ONLY place the app touches ts-fsrs.
// Pure functions over the 03 `card_fsrs_state` contract: screens and data
// sources never import ts-fsrs directly, so the library (or its params) can be
// swapped/tuned in exactly one file.
//
// Locked decisions embodied here (02 § FSRS):
// - Scheduling is computed CLIENT-SIDE; the backend just persists (the
//   commit_quiz_session RPC validates ownership + atomicity, not the math).
//   Risk accepted: a tampering client can only corrupt its own schedule.
// - Fuzz is DISABLED: deterministic intervals → testable, reproducible, and
//   the tier system (stability bands) reads consistently. Revisit if review
//   clumping becomes a real problem post-launch.
// - Default FSRS parameters + request_retention 0.9 until we have enough
//   review_logs to optimize per-user (that optimization is the reason
//   review_logs is append-only — 03).
// - The UI's 3-button grade maps again→Again, almost→Hard, got_it→Good;
//   Easy (4) is intentionally unused at MVP (quiz.ts § uiRatingToFsrs).
import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating as FsrsRating,
  type Card as FsrsCard,
  type Grade,
} from 'ts-fsrs';

import { getTierByStability, type TierId } from '@/theme/tiers';

import { uiRatingToFsrs, type BufferedRating, type QuizCardItem } from './quiz';
import type { CardFsrsState, FsrsStateValue, Rating } from './types';

const engine = fsrs(generatorParameters({ enable_fuzz: false, request_retention: 0.9 }));

const RATING_MAP: Record<Rating, Grade> = {
  1: FsrsRating.Again,
  2: FsrsRating.Hard,
  3: FsrsRating.Good,
  4: FsrsRating.Easy,
};

/** Domain state → ts-fsrs Card. elapsed/scheduled are reconstructed from the
 *  persisted timestamps (they're derivable; we don't store them redundantly). */
export function toFsrsCard(s: CardFsrsState, now: Date): FsrsCard {
  if (s.reps === 0 && s.state === 0) {
    // Never-reviewed card: exactly what createEmptyCard produces, due per row.
    const empty = createEmptyCard(s.dueAt);
    return empty;
  }
  const last = s.lastReviewAt ?? s.dueAt;
  const msPerDay = 24 * 60 * 60 * 1000;
  return {
    due: s.dueAt,
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: Math.max(0, (now.getTime() - last.getTime()) / msPerDay),
    scheduled_days: Math.max(0, (s.dueAt.getTime() - last.getTime()) / msPerDay),
    reps: s.reps,
    lapses: s.lapses,
    state: s.state,
    last_review: s.lastReviewAt ?? undefined,
    learning_steps: s.learningSteps,
  };
}

export interface ReviewComputation {
  /** The full next scheduling state — persist this. */
  next: CardFsrsState;
  /** review_logs fields (03). */
  log: {
    rating: Rating;
    elapsedDays: number;
    scheduledDays: number;
    stateBefore: FsrsStateValue;
  };
}

/** One review: current state + rating → next state + log row. Pure. */
export function applyReview(s: CardFsrsState, rating: Rating, now: Date = new Date()): ReviewComputation {
  const { card } = engine.next(toFsrsCard(s, now), now, RATING_MAP[rating]);
  return {
    next: {
      cardId: s.cardId,
      userId: s.userId,
      stability: card.stability,
      difficulty: card.difficulty,
      dueAt: card.due,
      lastReviewAt: now,
      state: card.state as FsrsStateValue,
      reps: card.reps,
      lapses: card.lapses,
      learningSteps: card.learning_steps,
    },
    log: {
      rating,
      elapsedDays: card.elapsed_days,
      scheduledDays: card.scheduled_days,
      stateBefore: s.state,
    },
  };
}

export interface TierTransition {
  from: TierId;
  to: TierId;
  /** true when the review moved the word up at least one tier band. */
  promoted: boolean;
}

/** Real tier movement for the quiz results display (replaces the session-29
 *  heuristic): tiers are stability bands, so the transition falls out of the
 *  actual FSRS recompute. */
export function tierTransition(s: CardFsrsState, rating: Rating, now: Date = new Date()): TierTransition {
  const from = getTierByStability(s.stability).id;
  const to = getTierByStability(applyReview(s, rating, now).next.stability).id;
  const order = (id: TierId) => ['bc', 'abc', 'hc', 'sr', 'summit'].indexOf(id);
  return { from, to, promoted: order(to) > order(from) };
}

export interface PromotedWord {
  cardId: string;
  /** The learning-language headword shown on the milestone list. */
  word: string;
  from: TierId;
  to: TierId;
}

/** Words that ACTUALLY climbed a tier this session — gates the Q-10 milestone
 *  screen (shown only when this is non-empty) and feeds its promoted-words list. */
export function sessionPromotions(
  cards: QuizCardItem[],
  ratings: BufferedRating[],
  now: Date = new Date(),
): PromotedWord[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const out: PromotedWord[] = [];
  for (const r of ratings) {
    const c = byId.get(r.cardId);
    if (c == null) continue;
    const t = tierTransition(c.fsrs, uiRatingToFsrs(r.rating), now);
    if (t.promoted) out.push({ cardId: c.id, word: c.content.backWord, from: t.from, to: t.to });
  }
  return out;
}
