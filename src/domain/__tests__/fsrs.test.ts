// FSRS wrapper tests — fuzz is disabled, so every assertion is deterministic.
// These pin the behaviors the product depends on (tier movement, lapse
// handling, log fidelity), not ts-fsrs internals.
import { applyReview, sessionPromotions, tierTransition, toFsrsCard } from '../fsrs';
import type { QuizCardItem } from '../quiz';
import type { CardFsrsState } from '../types';

const NOW = new Date('2026-07-06T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const newCard: CardFsrsState = {
  cardId: 'c1',
  userId: 'u1',
  stability: 0,
  difficulty: 5,
  dueAt: NOW,
  lastReviewAt: null,
  state: 0,
  reps: 0,
  lapses: 0,
  learningSteps: 0,
};

const reviewCard: CardFsrsState = {
  ...newCard,
  stability: 10,
  difficulty: 5,
  dueAt: NOW,
  lastReviewAt: new Date(NOW.getTime() - 10 * DAY),
  state: 2,
  reps: 5,
  lapses: 0,
};

describe('applyReview — new card', () => {
  it('good on a new card enters learning with a short interval and reps=1', () => {
    const { next, log } = applyReview(newCard, 3, NOW);
    expect(next.reps).toBe(1);
    expect(next.state).toBeGreaterThan(0); // no longer "new"
    expect(next.lastReviewAt).toEqual(NOW);
    expect(next.dueAt.getTime()).toBeGreaterThan(NOW.getTime());
    expect(next.stability).toBeGreaterThan(0);
    expect(log.stateBefore).toBe(0);
    expect(log.rating).toBe(3);
  });
});

describe('applyReview — review card', () => {
  it('good grows stability and schedules further out', () => {
    const { next } = applyReview(reviewCard, 3, NOW);
    expect(next.stability).toBeGreaterThan(reviewCard.stability);
    expect(next.dueAt.getTime()).toBeGreaterThan(NOW.getTime() + DAY); // > 1 day out
    expect(next.reps).toBe(6);
    expect(next.lapses).toBe(0);
  });

  it('again lapses the card: relearning state, lapse count up, stability down', () => {
    const { next } = applyReview(reviewCard, 1, NOW);
    expect(next.state).toBe(3); // relearning
    expect(next.lapses).toBe(1);
    expect(next.stability).toBeLessThan(reviewCard.stability);
    // Due again quickly (minutes-scale), not days out.
    expect(next.dueAt.getTime() - NOW.getTime()).toBeLessThan(DAY);
  });

  it('hard schedules sooner than good (monotone in rating)', () => {
    const hard = applyReview(reviewCard, 2, NOW).next;
    const good = applyReview(reviewCard, 3, NOW).next;
    expect(hard.dueAt.getTime()).toBeLessThanOrEqual(good.dueAt.getTime());
    expect(hard.stability).toBeLessThanOrEqual(good.stability);
  });

  it('is deterministic (fuzz disabled)', () => {
    const a = applyReview(reviewCard, 3, NOW).next;
    const b = applyReview(reviewCard, 3, NOW).next;
    expect(a.dueAt).toEqual(b.dueAt);
    expect(a.stability).toBe(b.stability);
  });

  it('log captures elapsed/scheduled days from the timestamps', () => {
    const { log } = applyReview(reviewCard, 3, NOW);
    expect(log.elapsedDays).toBeCloseTo(10, 0);
    expect(log.scheduledDays).toBeGreaterThanOrEqual(0);
  });
});

describe('toFsrsCard', () => {
  it('reconstructs elapsed/scheduled from timestamps for reviewed cards', () => {
    const c = toFsrsCard(reviewCard, NOW);
    expect(c.elapsed_days).toBeCloseTo(10, 5);
    expect(c.reps).toBe(5);
    expect(c.learning_steps).toBe(0);
  });

  it('treats a never-reviewed row as an empty card', () => {
    const c = toFsrsCard(newCard, NOW);
    expect(c.reps).toBe(0);
    expect(c.state).toBe(0);
  });
});

describe('tierTransition (quiz results display)', () => {
  it('a lapse ("again") on a High-Camp word drops it down the bands', () => {
    const t = tierTransition(reviewCard, 1, NOW); // stability 10 = hc band
    expect(t.from).toBe('hc');
    expect(t.promoted).toBe(false);
  });

  it('good on a band-edge word can promote it', () => {
    // stability 13.5 sits just under the sr band (14); a good review crosses it.
    const nearEdge = { ...reviewCard, stability: 13.5, lastReviewAt: new Date(NOW.getTime() - 14 * DAY) };
    const t = tierTransition(nearEdge, 3, NOW);
    expect(t.from).toBe('hc');
    expect(t.promoted).toBe(true);
  });

  it('sessionPromotions gates the milestone screen: only real band-crossings', () => {
    const item = (id: string, fsrs: CardFsrsState): QuizCardItem => ({
      id,
      tierId: 'hc',
      mode: 'recall',
      content: { frontWord: id, frontPrompt: '?', backWord: `${id}-target` },
      fsrs: { ...fsrs, cardId: id },
    });
    const nearEdge = { ...reviewCard, stability: 13.5, lastReviewAt: new Date(NOW.getTime() - 14 * DAY) };
    const cards = [item('a', nearEdge), item('b', reviewCard)];
    const promos = sessionPromotions(
      cards,
      [
        { cardId: 'a', rating: 'got_it' }, // band-edge good → promotes
        { cardId: 'b', rating: 'again' }, // lapse → never promotes
      ],
      NOW,
    );
    expect(promos).toHaveLength(1);
    // Destination band is parameter-sensitive (a well-timed good can jump
    // multiple bands); the contract is: promoted, upward, from hc.
    expect(promos[0]).toMatchObject({ cardId: 'a', word: 'a-target', from: 'hc' });
    expect(promos[0].to).not.toBe('hc');
  });

  it('an early hard review reports held, not promoted (the session-29 heuristic bug)', () => {
    // Reviewed only 1 day into a 10-day schedule: retrievability is high, so a
    // "hard" grade grows stability only slightly — the word stays in its band.
    const early = { ...reviewCard, stability: 8, lastReviewAt: new Date(NOW.getTime() - 1 * DAY) };
    const t = tierTransition(early, 2, NOW);
    expect(t.from).toBe('hc');
    expect(t.promoted).toBe(false);
  });
});
