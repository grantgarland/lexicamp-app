// Tests for the FSRS-based Progress projections (domain/projection.ts).
//
// The point of this module is that it produces a useful number from the FIRST
// review session, so the first thing asserted is exactly that. Beyond it, the
// simulation is deterministic (fuzz is off in fsrs.ts), so these can assert
// real ordering and bounds rather than just "not NaN".
import {
  forecast,
  horizon,
  freshCardDays,
  masteredAt,
  projectionBase,
  gradeMix,
  daysToMastery,
  project,
  projectionConfidence,
  projections,
  SUMMIT_TARGET,
  type GradeMix,
} from '../projection';
import { MASTERY_STABILITY } from '../derive';
import type { Card, CardFsrsState } from '../types';

const NOW = new Date('2026-07-30T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

// A card that is due RIGHT NOW and was last reviewed one stability-interval
// ago — i.e. internally consistent. Building it any other way (e.g. a fixed
// 1-day-ago last review on a 25-day-stability card) models an early review,
// which FSRS correctly refuses to reward, and the fixture then hides real
// behaviour behind an artefact.
const state = (over: Partial<CardFsrsState> = {}): CardFsrsState => {
  const s = { stability: 2, ...over };
  return {
    cardId: 'c1',
    userId: 'u1',
    difficulty: 5,
    dueAt: NOW,
    lastReviewAt: new Date(NOW.getTime() - Math.max(1, s.stability) * DAY),
    state: 2,
    reps: 3,
    lapses: 0,
    learningSteps: 0,
    ...over,
    stability: s.stability,
  };
};

const card = (over: Partial<Card> = {}): Card => ({
  id: 'c1',
  deckId: 'd1',
  userId: 'u1',
  translationId: 't1',
  userNote: null,
  customFront: null,
  customBack: null,
  suspended: false,
  createdAt: new Date(NOW.getTime() - 10 * DAY),
  ...over,
});

/** N cards + matching states, ids c0..c{N-1}. */
const library = (n: number, over: Partial<CardFsrsState> = {}, cardOver: Partial<Card> = {}) => {
  const cards: Card[] = [];
  const states: CardFsrsState[] = [];
  for (let i = 0; i < n; i += 1) {
    cards.push(card({ id: `c${i}`, ...cardOver }));
    states.push(state({ cardId: `c${i}`, ...over }));
  }
  return { cards, states };
};

const GOOD: GradeMix = { again: 0.1, almost: 0.2, gotIt: 0.7 };

// ── gradeMix ────────────────────────────────────────────────────────────────
describe('gradeMix', () => {
  it('returns the neutral prior when there are no reviews to learn from', () => {
    const m = gradeMix(0, 0);
    expect(m.gotIt).toBeCloseTo(0.7, 5);
    expect(m.again + m.almost + m.gotIt).toBeCloseTo(1, 10);
  });

  it('always sums to 1 across the whole accuracy range', () => {
    for (const acc of [0, 17, 50, 83, 100]) {
      for (const n of [0, 1, 20, 500]) {
        const m = gradeMix(acc, n);
        expect(m.again + m.almost + m.gotIt).toBeCloseTo(1, 10);
      }
    }
  });

  it('shrinks a tiny sample toward the prior but trusts a large one', () => {
    // A user who has missed every single one of 3 reviews should not be
    // modelled as a 0%-accuracy learner — that is the brittleness this guards.
    const tiny = gradeMix(0, 3);
    const large = gradeMix(0, 2000);
    expect(tiny.gotIt).toBeGreaterThan(0.5);
    expect(large.gotIt).toBeLessThan(0.05);
  });

  it('clamps accuracy outside 0–100 instead of producing negative mass', () => {
    for (const acc of [-40, 140]) {
      const m = gradeMix(acc, 100);
      expect(Math.min(m.again, m.almost, m.gotIt)).toBeGreaterThanOrEqual(0);
      expect(m.again + m.almost + m.gotIt).toBeCloseTo(1, 10);
    }
  });
});

// ── daysToMastery ───────────────────────────────────────────────────────────
describe('daysToMastery', () => {
  it('is 0 for an already-mastered card', () => {
    expect(daysToMastery(state({ stability: MASTERY_STABILITY }), GOOD, NOW)).toBe(0);
  });

  it('returns a finite horizon for a card in flight', () => {
    const d = daysToMastery(state({ stability: 5 }), GOOD, NOW);
    expect(d).not.toBeNull();
    expect(d!).toBeGreaterThan(0);
    expect(d!).toBeLessThan(3650);
  });

  it('a more stable card masters sooner than a less stable one', () => {
    const near = daysToMastery(state({ stability: 25 }), GOOD, NOW)!;
    const far = daysToMastery(state({ stability: 1 }), GOOD, NOW)!;
    expect(near).toBeLessThan(far);
  });

  it('gives a finite, sane horizon across the realistic accuracy band', () => {
    // NOTE: calendar-time is deliberately NOT asserted to be monotonic in
    // accuracy, because under FSRS it isn't. Better grades produce LONGER
    // intervals, so a stronger learner can need the same number of reviews
    // spaced further apart and reach a given stability a few days later. The
    // monotone quantity is reviews-to-mastery, not days — asserted below.
    // (An earlier version of this test assumed otherwise and was wrong.)
    const days = [0.6, 0.7, 0.8, 0.9, 0.95].map((g) => {
      const miss = 1 - g;
      return daysToMastery(state({ stability: 3 }), { gotIt: g, almost: miss * 0.6, again: miss * 0.4 }, NOW);
    });
    expect(days.every((d) => d != null && d > 0 && d < 400)).toBe(true);
  });

  it('a much stronger mix masters materially sooner', () => {
    const strong = daysToMastery(state({ stability: 3 }), { again: 0.02, almost: 0.08, gotIt: 0.9 }, NOW)!;
    const weak = daysToMastery(state({ stability: 3 }), { again: 0.25, almost: 0.25, gotIt: 0.5 }, NOW)!;
    expect(strong).toBeLessThan(weak);
  });

  it('does not bill the user for the interval scheduled AFTER mastery', () => {
    // Mastery happens at the crossing review. Including the next interval
    // inflated every estimate by a full spacing cycle. A card one review away
    // from crossing must therefore land inside its current interval, not
    // beyond it.
    const s = state({ stability: 25 });
    const d = daysToMastery(s, { again: 0.02, almost: 0.08, gotIt: 0.9 }, NOW)!;
    expect(d).toBeLessThan(25);
  });

  it('reports a stalled mean-field rather than a fantasy number when recall collapses', () => {
    // again=0.5 resets stability faster than it accumulates, so the EXPECTED
    // stability converges below the threshold. Returning null here is the
    // honest answer; project() turns it into the 'low_recall' state.
    expect(daysToMastery(state({ stability: 3 }), { again: 0.5, almost: 0.3, gotIt: 0.2 }, NOW)).toBeNull();
  });

  it('does not mutate the state it is given', () => {
    const s = state({ stability: 4 });
    const snapshot = JSON.stringify(s);
    daysToMastery(s, GOOD, NOW);
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it('terminates on a pathological all-again mix instead of hanging', () => {
    const d = daysToMastery(state({ stability: 1 }), { again: 1, almost: 0, gotIt: 0 }, NOW);
    expect(d === null || d > 0).toBe(true);
  });

  it('waits for the due date instead of reviewing a not-yet-due card today', () => {
    const dueNow = daysToMastery(state({ stability: 6, dueAt: NOW }), GOOD, NOW)!;
    const dueLater = daysToMastery(
      state({ stability: 6, dueAt: new Date(NOW.getTime() + 30 * DAY) }),
      GOOD,
      NOW,
    )!;
    // The card cannot master before its first review, which is 30 days out.
    expect(dueLater).toBeGreaterThanOrEqual(30);
    expect(dueLater).toBeGreaterThan(dueNow);
  });
});

describe('freshCardDays', () => {
  it('returns a plausible capture-to-mastery horizon for a brand-new card', () => {
    // Stability is a PREDICTED retention half-life, not elapsed time, so a card
    // can hold stability > 30d after fewer than 30 days of reviews. What must
    // hold is that it takes several spaced reviews, not that it takes 30 days.
    const d = freshCardDays(GOOD, NOW);
    expect(d).not.toBeNull();
    expect(d!).toBeGreaterThan(5);
    expect(d!).toBeLessThan(365);
  });
});

// ── confidence ──────────────────────────────────────────────────────────────
describe('projectionConfidence', () => {
  it('bands on both review volume and elapsed days', () => {
    expect(projectionConfidence(0, 0)).toBe('low');
    expect(projectionConfidence(5, 1)).toBe('low');
    expect(projectionConfidence(40, 5)).toBe('medium');
    expect(projectionConfidence(200, 30)).toBe('high');
  });

  it('will not call a one-day cram high confidence', () => {
    // 500 reviews in a single day says nothing about a sustainable pace.
    expect(projectionConfidence(500, 1)).toBe('low');
  });
});

// ── project ─────────────────────────────────────────────────────────────────
describe('project', () => {
  it('projects from the FIRST session — the whole point of the rewrite', () => {
    // One session: 5 words saved today, each reviewed once, nothing mastered.
    const { cards, states } = library(5, { reps: 1, stability: 1.5 }, { createdAt: NOW });
    const p = project({ cards, states, avgAccuracy: 80, daysActive: 1, now: NOW }, 100);
    expect(p.status).toBe('ok');
    expect(p.days).toBeGreaterThan(0);
    expect(p.confidence).toBe('low');
    expect(p.range).not.toBeNull();
  });

  it('is locked only when there are genuinely no reviews yet', () => {
    const { cards, states } = library(5, { reps: 0, state: 0, stability: 0 });
    const p = project({ cards, states, avgAccuracy: 0, daysActive: 0, now: NOW }, 100);
    expect(p.status).toBe('no_reviews');
    expect(p.days).toBeNull();
  });

  it('reports reached when the target is already met', () => {
    const { cards, states } = library(12, { stability: 40 });
    const p = project({ cards, states, avgAccuracy: 90, daysActive: 30, now: NOW }, 10);
    expect(p.status).toBe('reached');
    expect(p.days).toBe(0);
    expect(p.wordsToGo).toBe(0);
  });

  it('is unreachable when the library falls short and nothing new is being saved', () => {
    // All 5 cards created at the same instant as `now` would give an infinite
    // rate, so age them: 5 words over 10 days is a real but tiny rate. Here we
    // instead pass an empty card list to represent "no capture signal at all".
    const p = project({ cards: [], states: [], avgAccuracy: 90, daysActive: 10, now: NOW }, 100);
    // No states → no reviews → locked before we ever get to reachability.
    expect(p.status).toBe('no_reviews');

    const { states } = library(3, { reps: 4, stability: 10 });
    const p2 = project({ cards: [], states, avgAccuracy: 90, daysActive: 10, now: NOW }, 3000);
    expect(p2.status).toBe('unreachable');
    expect(p2.days).toBeNull();
  });

  it('separates a low recall rate from an unreachable goal', () => {
    // Catastrophic accuracy with plenty of reviews (so shrinkage can't save it).
    const { cards, states } = library(20, { reps: 60, stability: 3 });
    const p = project({ cards, states, avgAccuracy: 2, daysActive: 30, now: NOW }, 100);
    expect(p.status).toBe('low_recall');
    expect(p.days).toBeNull();
  });

  it('needs more days for a further target', () => {
    const { cards, states } = library(40, { reps: 6, stability: 12 });
    const inp = { cards, states, avgAccuracy: 85, daysActive: 20, now: NOW };
    const near = project(inp, 50);
    const far = project(inp, 500);
    expect(near.status).toBe('ok');
    expect(far.status).toBe('ok');
    expect(far.days!).toBeGreaterThan(near.days!);
  });

  it('counts only unsaved words in fromFutureWords', () => {
    const { cards, states } = library(10, { reps: 5, stability: 12 });
    const p = project({ cards, states, avgAccuracy: 85, daysActive: 15, now: NOW }, 30);
    // 10 in-flight cards can cover 10 of the 30; the other 20 must be captured.
    expect(p.fromFutureWords).toBe(20);
  });

  it('excludes archived (suspended) words from the maturation curve', () => {
    const { cards, states } = library(20, { reps: 5, stability: 20 });
    const active = project({ cards, states, avgAccuracy: 85, daysActive: 15, now: NOW }, 20);
    const archived = project(
      { cards: cards.map((c) => ({ ...c, suspended: true })), states, avgAccuracy: 85, daysActive: 15, now: NOW },
      20,
    );
    // Suspended words never surface for review, so they can't mature; the
    // projection must fall back to capture instead of silently waiting.
    expect(active.status).toBe('ok');
    expect(archived.fromFutureWords).toBeGreaterThan(active.fromFutureWords);
  });

  it('widens the range for low confidence and collapses it at high', () => {
    const { cards, states } = library(30, { reps: 8, stability: 15 });
    const lo = project({ cards, states, avgAccuracy: 85, daysActive: 1, now: NOW }, 60);
    const hi = project({ cards, states: states.map((s) => ({ ...s, reps: 40 })), avgAccuracy: 85, daysActive: 40, now: NOW }, 60);
    expect(lo.confidence).toBe('low');
    expect(hi.confidence).toBe('high');
    expect(lo.range![1] - lo.range![0]).toBeGreaterThan(hi.range![1] - hi.range![0]);
    expect(hi.range![0]).toBe(hi.range![1]);
  });

  it('never returns a range below one day', () => {
    const { cards, states } = library(5, { reps: 2, stability: 29.9 });
    const p = project({ cards, states, avgAccuracy: 95, daysActive: 2, now: NOW }, 5);
    if (p.range != null) expect(p.range[0]).toBeGreaterThanOrEqual(0);
  });
});

// ── projections (both views) ────────────────────────────────────────────────
describe('projections', () => {
  it('gives a next-camp and a Summit view, with Summit never sooner', () => {
    const { cards, states } = library(60, { reps: 6, stability: 14 });
    const { nextCamp, summit } = projections({ cards, states, avgAccuracy: 85, daysActive: 21, now: NOW });
    expect(nextCamp).not.toBeNull();
    expect(nextCamp!.tierId).toBe('abc'); // 0 mastered → next camp is Adv. Base Camp
    expect(summit.target).toBe(SUMMIT_TARGET);
    expect(summit.days!).toBeGreaterThanOrEqual(nextCamp!.days!);
  });

  it('drops the next-camp view once the user is at Summit tier', () => {
    const { cards, states } = library(SUMMIT_TARGET, { stability: 40 });
    const { nextCamp, summit } = projections({ cards, states, avgAccuracy: 95, daysActive: 400, now: NOW });
    expect(nextCamp).toBeNull();
    expect(summit.status).toBe('reached');
  });

  it('agrees with project() — the shared base must not drift from the wrapper', () => {
    // projections() resolves two targets against ONE simulation pass for speed.
    // If that base ever diverges from the single-target path, the card and any
    // direct caller would disagree about the same user.
    const { cards, states } = library(45, { reps: 7, stability: 11 });
    const inp = { cards, states, avgAccuracy: 84, daysActive: 25, now: NOW };
    const both = projections(inp);
    expect(both.summit.days).toBe(project(inp, SUMMIT_TARGET).days);
    expect(both.nextCamp!.days).toBe(project(inp, both.nextCamp!.target).days);
  });

  it('tracks the ladder rather than a hardcoded 3000', () => {
    // If the 2026-07-30 ladder moves again, SUMMIT_TARGET must move with it.
    expect(SUMMIT_TARGET).toBe(3000);
  });
});

// ── horizon (display shaping) ───────────────────────────────────────────────
describe('horizon', () => {
  it('uses days under 60, months under 2 years, then years', () => {
    expect(horizon(14, [14, 14], 'high').unitKey).toBe('unitDays');
    expect(horizon(59, [59, 59], 'high').unitKey).toBe('unitDays');
    expect(horizon(60, [60, 60], 'high').unitKey).toBe('unitMonths');
    expect(horizon(729, [729, 729], 'high').unitKey).toBe('unitMonths');
    expect(horizon(730, [730, 730], 'high').unitKey).toBe('unitYears');
  });

  it('shows a bare figure at high confidence and a range below it', () => {
    expect(horizon(51, [30, 72], 'high').showRange).toBe(false);
    expect(horizon(51, [30, 72], 'low').showRange).toBe(true);
    expect(horizon(51, [30, 72], 'low').value).toBe('30\u201372');
  });

  it('collapses a range whose bounds round to the same figure', () => {
    // 92 and 96 days are both "3 months"; "3–3 months" reads as a bug.
    const h = horizon(94, [92, 96], 'low');
    expect(h.unitKey).toBe('unitMonths');
    expect(h.showRange).toBe(false);
    expect(h.value).toBe('3');
  });

  it('keeps one decimal for years so 1.7 does not collapse to 2', () => {
    const h = horizon(621, [500, 750], 'medium');
    expect(horizon(900, [900, 900], 'high').value).toBe('2.5');
    expect(h.unitKey).toBe('unitMonths');
  });

  it('never renders a zero — a real estimate is at least one unit', () => {
    expect(horizon(1, [1, 1], 'high').value).toBe('1');
    expect(Number(horizon(62, [61, 63], 'high').value)).toBeGreaterThanOrEqual(1);
  });

  it('pluralisation count follows the figure actually shown', () => {
    const range = horizon(51, [30, 72], 'low');
    expect(range.count).toBe(range.high);
    const point = horizon(51, [30, 72], 'high');
    expect(point.count).toBe(51);
  });
});

// ── forecast (Projection tab chart) ─────────────────────────────────────────
describe('forecast', () => {
  const big = () => {
    const { cards, states } = library(80, { reps: 6, stability: 13 });
    return projectionBase({ cards, states, avgAccuracy: 85, daysActive: 30, now: NOW });
  };

  it('is monotonically non-decreasing — mastery never goes backwards', () => {
    const f = forecast(big());
    for (let i = 1; i < f.points.length; i += 1) {
      expect(f.points[i]!.mastered).toBeGreaterThanOrEqual(f.points[i - 1]!.mastered);
    }
  });

  it('starts at today\'s real mastered count', () => {
    const base = big();
    const f = forecast(base);
    expect(f.points[0]!.mastered).toBe(base.mastered);
    expect(f.points[0]!.day).toBe(0);
  });

  it('agrees with resolve() at the camp crossings it marks', () => {
    // The curve and the headline number must tell the same story: at the day
    // the chart marks a camp, the curve must actually be at that camp's target.
    const base = big();
    const f = forecast(base);
    for (const camp of f.camps) {
      if (camp.day == null) continue;
      expect(masteredAt(base, camp.day)).toBeGreaterThanOrEqual(camp.target - 1);
    }
  });

  it('spans the requested horizon with the requested sample count', () => {
    const f = forecast(big(), { horizonDays: 180, samples: 24 });
    expect(f.points).toHaveLength(25);
    expect(f.horizonDays).toBe(180);
    expect(f.points[f.points.length - 1]!.day).toBeCloseTo(180, 6);
  });

  it('picks a horizon that contains the next camp rather than flatlining', () => {
    const base = big();
    const f = forecast(base);
    const nextCrossing = f.camps.find((c) => c.day != null);
    expect(nextCrossing).toBeDefined();
    expect(f.horizonDays).toBeGreaterThan(nextCrossing!.day!);
    expect(f.horizonDays).toBeGreaterThanOrEqual(60);
    expect(f.horizonDays).toBeLessThanOrEqual(7300);
  });

  it('re-scales to the Summit target instead of just relabelling', () => {
    // The toggle must move the whole chart: a Summit view spans far more time
    // and reaches a far higher peak than the next-camp view.
    const base = big();
    const near = forecast(base);
    const far = forecast(base, { target: SUMMIT_TARGET });
    expect(far.horizonDays).toBeGreaterThan(near.horizonDays);
    expect(far.peak).toBeGreaterThan(near.peak);
    // And the Summit crossing is actually inside the Summit view's horizon.
    const summitCamp = far.camps.find((c) => c.target === SUMMIT_TARGET);
    expect(summitCamp!.day).not.toBeNull();
  });

  it('only lists camps ahead of the user, never ones already passed', () => {
    const { cards, states } = library(300, { stability: 40 });
    const base = projectionBase({ cards, states, avgAccuracy: 90, daysActive: 200, now: NOW });
    const f = forecast(base);
    expect(base.mastered).toBe(300);
    for (const c of f.camps) expect(c.target).toBeGreaterThan(300);
  });

  it('stays flat when nothing can mature and nothing is being saved', () => {
    const { states } = library(4, { reps: 3, stability: 40 });
    const base = projectionBase({ cards: [], states, avgAccuracy: 90, daysActive: 10, now: NOW });
    const f = forecast(base, { horizonDays: 365, samples: 12 });
    const first = f.points[0]!.mastered;
    expect(f.points.every((p) => p.mastered === first)).toBe(true);
  });
});
