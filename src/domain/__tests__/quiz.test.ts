// Unit tests for the quiz domain — UI-grade → FSRS rating mapping and session
// stats. The rating mapping feeds review_logs (03), so it must never drift.
import { sessionStats, uiRatingToFsrs } from '../quiz';

describe('uiRatingToFsrs', () => {
  it('maps the 3-button UI grade to FSRS ratings (1 again · 2 hard · 3 good)', () => {
    expect(uiRatingToFsrs('again')).toBe(1);
    expect(uiRatingToFsrs('almost')).toBe(2);
    expect(uiRatingToFsrs('got_it')).toBe(3);
  });
});

describe('sessionStats', () => {
  it('handles the empty session without dividing by zero', () => {
    expect(sessionStats([])).toEqual({ total: 0, promoted: 0, almost: 0, again: 0, accuracy: 0 });
  });

  it('tallies per-grade counts and computes rounded accuracy', () => {
    const stats = sessionStats([
      { cardId: 'a', rating: 'got_it' },
      { cardId: 'b', rating: 'got_it' },
      { cardId: 'c', rating: 'almost' },
      { cardId: 'd', rating: 'again' },
    ]);
    expect(stats).toEqual({ total: 4, promoted: 2, almost: 1, again: 1, accuracy: 50 });
  });

  it('rounds accuracy to the nearest integer (2/3 → 67)', () => {
    const stats = sessionStats([
      { cardId: 'a', rating: 'got_it' },
      { cardId: 'b', rating: 'got_it' },
      { cardId: 'c', rating: 'again' },
    ]);
    expect(stats.accuracy).toBe(67);
  });
});
