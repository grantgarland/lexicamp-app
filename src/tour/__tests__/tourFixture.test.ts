// Tour fixture — the demo session that keeps w6/w7/w8 from landing on empty
// states. These guard the two properties that matter: it looks like real study
// content, and it can never be mistaken for (or written as) real data.
import { isTourFixtureId, TOUR_FIXTURE_PROGRESS, tourFixtureCards } from '../tourFixture';

const NOW = 1_785_600_000_000; // fixed instant — the fixture must be deterministic

describe('tourFixtureCards', () => {
  it('is deterministic for a given instant', () => {
    expect(tourFixtureCards(NOW)).toEqual(tourFixtureCards(NOW));
  });

  it('yields a session long enough to demo reveal → rate → results', () => {
    expect(tourFixtureCards(NOW).length).toBeGreaterThanOrEqual(3);
  });

  it('gives every card the content the quiz UI actually renders', () => {
    for (const c of tourFixtureCards(NOW)) {
      expect(c.content.frontWord).not.toBe('');
      expect(c.content.backWord).not.toBe('');
      // The results rows show the example + part of speech; blank ones look broken.
      expect(c.content.backExample).toBeTruthy();
      expect(c.content.backPos).toBeTruthy();
    }
  });

  it('marks every card as review state so results show a real tier transition', () => {
    for (const c of tourFixtureCards(NOW)) {
      expect(c.fsrs.state).toBe(2);
      expect(c.fsrs.dueAt.getTime()).toBe(NOW);
    }
  });

  it('namespaces ids so fixture cards can never be confused with real rows', () => {
    for (const c of tourFixtureCards(NOW)) expect(isTourFixtureId(c.id)).toBe(true);
    expect(isTourFixtureId('9f1c2b3a-0000-4000-8000-000000000000')).toBe(false);
    expect(isTourFixtureId('')).toBe(false);
  });

  it('uses unique ids (duplicates would break rating buffering by cardId)', () => {
    const ids = tourFixtureCards(NOW).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('TOUR_FIXTURE_PROGRESS', () => {
  it('keeps the 5-slot tierCounts shape ProgressScreen indexes into', () => {
    expect(TOUR_FIXTURE_PROGRESS.tierCounts).toHaveLength(5);
  });

  it('is internally consistent with the demo session', () => {
    const total = TOUR_FIXTURE_PROGRESS.tierCounts.reduce((a, b) => a + b, 0);
    expect(total).toBe(TOUR_FIXTURE_PROGRESS.totalSaved);
    expect(TOUR_FIXTURE_PROGRESS.totalMastered).toBeLessThanOrEqual(TOUR_FIXTURE_PROGRESS.totalSaved);
    // RouteTab renders only when totalSaved > 0 — a zero here silently
    // reintroduces the empty state the fixture exists to prevent.
    expect(TOUR_FIXTURE_PROGRESS.totalSaved).toBeGreaterThan(0);
    expect(TOUR_FIXTURE_PROGRESS.bestStreak).toBeGreaterThanOrEqual(TOUR_FIXTURE_PROGRESS.streakDays);
    expect(TOUR_FIXTURE_PROGRESS.avgAccuracy).toBeGreaterThan(0);
    expect(TOUR_FIXTURE_PROGRESS.avgAccuracy).toBeLessThanOrEqual(1);
  });
});
