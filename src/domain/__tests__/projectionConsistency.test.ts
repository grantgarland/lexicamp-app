// `resolve()` and the forecast curve must answer the same question the same way
// (2026-08-04, Casey screenshot: the camp dot floating above its own threshold).
//
// They used to be two models. `masteredAt` — what the chart plots — counts words
// maturing from the existing library PLUS words the user has yet to save.
// `resolve` had a shortcut branch for "the existing library already covers this
// target", which answered `maturing[need - 1]` and ignored acquisition entirely.
// Whenever that branch fired, the printed ETA was later than the curve's own
// crossing, and the marker keyed to the ETA sat well above the threshold line.
//
// `resolve` now bisects `masteredAt`, so the two cannot diverge by construction.
// These tests pin that, and the statuses that must survive it.
import { forecast, librarySpanDays, masteredAt, nextMilestone, POST_SUMMIT_MILESTONES, projectionBase, resolve, SUMMIT_TARGET, type ProjectionBase } from '@/domain/projection';

const MIX = { again: 0.05, almost: 0.15, gotIt: 0.8 };

/** A learner heading for the 100-word camp whose saved library alone covers it —
 *  the branch that used to short-circuit. */
const libraryCovers: ProjectionBase = {
  mastered: 20,
  reviewsLogged: 400,
  mix: MIX,
  confidence: 'high',
  maturing: Array.from({ length: 80 }, (_, i) => 5 + (i / 79) * 35), // days 5 → 40
  capturePerDay: 2,
  fresh: 11,
};

/** …and one who needs words they have not saved yet. */
const needsFutureWords: ProjectionBase = { ...libraryCovers, maturing: [5, 9, 14], mastered: 4 };

/** Where the PLOTTED curve crosses `target` — the same linear read the chart's
 *  `dayAtValue` does, kept independent of it so this test checks the model. */
function curveCrossing(base: ProjectionBase, target: number): number | null {
  const f = forecast(base, { target });
  for (let i = 1; i < f.points.length; i += 1) {
    const a = f.points[i - 1]!;
    const b = f.points[i]!;
    if (b.mastered >= target && a.mastered < target) {
      return a.day + ((target - a.mastered) / (b.mastered - a.mastered)) * (b.day - a.day);
    }
  }
  return null;
}

describe('resolve() agrees with the curve it is drawn against', () => {
  it('counts acquisition even when the library alone could cover the target', () => {
    // Was 40 — the 80th maturing word — while the curve got there on day 26.6.
    const days = resolve(libraryCovers, 100).days!;
    const crossing = curveCrossing(libraryCovers, 100)!;
    expect(Math.abs(days - crossing)).toBeLessThanOrEqual(1); // Math.ceil only
    expect(days).toBeLessThan(40);
  });

  it('lands on the target, not far past it', () => {
    // The old answer put the user at 158 words on the day it called "100 words".
    const days = resolve(libraryCovers, 100).days!;
    expect(masteredAt(libraryCovers, days)).toBeGreaterThanOrEqual(100);
    expect(masteredAt(libraryCovers, days)).toBeLessThan(110);
  });

  it('is the FIRST day the target is reached', () => {
    const days = resolve(libraryCovers, 100).days!;
    expect(masteredAt(libraryCovers, days - 1)).toBeLessThan(100);
  });

  it('still agrees when the target needs words not yet saved', () => {
    const days = resolve(needsFutureWords, 100).days!;
    const crossing = curveCrossing(needsFutureWords, 100)!;
    expect(Math.abs(days - crossing)).toBeLessThanOrEqual(1);
  });

  it('attributes the target between existing and future words at the day reached', () => {
    // 80 words maturing, but only those matured BY the answer day count.
    const r = resolve(libraryCovers, 100);
    expect(r.fromFutureWords).toBeGreaterThan(0);
    expect(r.fromFutureWords).toBeLessThan(80);
  });

  it('keeps every non-ok status distinct', () => {
    expect(resolve(libraryCovers, 10).status).toBe('reached');
    expect(resolve({ ...libraryCovers, reviewsLogged: 0 }, 100).status).toBe('no_reviews');
    // Can't cover it from the library, and no fresh card could ever mature.
    expect(resolve({ ...needsFutureWords, fresh: null }, 100).status).toBe('low_recall');
    // Can't cover it from the library, and no new words are coming.
    expect(resolve({ ...needsFutureWords, capturePerDay: 0 }, 100).status).toBe('unreachable');
  });

  it('reports unreachable rather than a fantasy date past the horizon', () => {
    const glacial: ProjectionBase = { ...needsFutureWords, capturePerDay: 0.0001, fresh: 500 };
    expect(resolve(glacial, 3000).status).toBe('unreachable');
    expect(resolve(glacial, 3000).days).toBeNull();
  });

  it('stays monotonic — a further camp is never sooner', () => {
    const a = resolve(libraryCovers, 100).days!;
    const b = resolve(libraryCovers, 300).days!;
    const c = resolve(libraryCovers, 3000).days!;
    expect(b).toBeGreaterThanOrEqual(a);
    expect(c).toBeGreaterThanOrEqual(b);
  });

  it('holds for a real scenario built from cards, not a hand-made base', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const now = new Date();
    const cards = Array.from({ length: 120 }, (_, i) => ({
      id: `c${i}`,
      deckId: 'd',
      userId: 'u',
      translationId: 't',
      userNote: null,
      customFront: null,
      customBack: null,
      suspended: false,
      createdAt: new Date(now.getTime() - (i + 1) * DAY),
    }));
    const states = cards.map((c, i) => ({
      cardId: c.id,
      userId: 'u',
      stability: 2 + (i % 25),
      difficulty: 5,
      dueAt: new Date(now.getTime() + (i % 7) * DAY),
      lastReviewAt: new Date(now.getTime() - DAY),
      state: 2 as const,
      reps: 5,
      lapses: 0,
      learningSteps: 0,
    }));
    const base = projectionBase({ cards, states, avgAccuracy: 85, daysActive: 40, now });
    const days = resolve(base, 100).days;
    const crossing = curveCrossing(base, 100);
    if (days == null || crossing == null) return; // nothing to compare
    expect(Math.abs(days - crossing)).toBeLessThanOrEqual(1);
  });
});

// Past Summit the CEFR ladder is exhausted, so the Projection tab had nothing to
// aim at: the curve floated with no threshold and the card said "Reached" and
// stopped (Casey, 2026-08-05). These round numbers are the continuation — and
// they are explicitly NOT tiers, so nothing here may leak CEFR or camp language.
describe('post-summit milestones', () => {
  it('hands back the next round number above where you are', () => {
    expect(nextMilestone(3_099)).toBe(5_000);
    expect(nextMilestone(5_000)).toBe(7_500);
    expect(nextMilestone(7_499)).toBe(7_500);
    expect(nextMilestone(9_000)).toBe(10_000);
  });

  it('is strictly ABOVE the current count, never equal', () => {
    // Equal would render a milestone the user has already passed, with a
    // threshold line sitting under the curve's starting point. (The LAST rung
    // has no successor — that is the next test's job, not a violation here.)
    for (const m of POST_SUMMIT_MILESTONES.slice(0, -1)) expect(nextMilestone(m)).toBeGreaterThan(m);
  });

  it('runs out rather than inventing a target', () => {
    expect(nextMilestone(POST_SUMMIT_MILESTONES[POST_SUMMIT_MILESTONES.length - 1]!)).toBeNull();
    expect(nextMilestone(1_000_000)).toBeNull();
  });

  it('starts past the Summit target, so the ladder never doubles back', () => {
    expect(POST_SUMMIT_MILESTONES[0]).toBeGreaterThan(SUMMIT_TARGET);
    const sorted = [...POST_SUMMIT_MILESTONES].sort((a, b) => a - b);
    expect(sorted).toEqual([...POST_SUMMIT_MILESTONES]);
  });
});

// "Time to Summit" is not in the schema — we never recorded the crossing. The
// oldest card is the only start date there is, so the card says "climbing for".
describe('librarySpanDays', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const card = (daysAgo: number) => ({
    id: `c${daysAgo}`, deckId: 'd', userId: 'u', translationId: 't',
    userNote: null, customFront: null, customBack: null, suspended: false,
    createdAt: new Date(Date.now() - daysAgo * DAY),
  });

  it('measures from the OLDEST card, not the newest', () => {
    const now = new Date();
    expect(librarySpanDays([card(10), card(200), card(3)], now)).toBeCloseTo(200, 0);
  });

  it('is zero for an empty library rather than Infinity', () => {
    expect(librarySpanDays([], new Date())).toBe(0);
  });

  it('never goes negative on a clock skew', () => {
    const past = new Date(Date.now() - 5 * DAY);
    expect(librarySpanDays([card(1)], past)).toBeGreaterThanOrEqual(0);
  });
});
