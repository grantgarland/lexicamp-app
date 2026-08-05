// The 'veteran' dev scenario — a library PAST the summit (2026-08-04).
//
// The point of the scenario is scale AND spread. Flat per-tier stability (what
// every other scenario uses, and what a first cut of this one would inherit)
// makes the maturation curve step as a single cliff and puts every due date on
// the same handful of offsets — the projection chart and mastery forecast then
// render shapes no real library produces, which is precisely the thing the
// scenario is supposed to let you look at. So these assertions are about the
// DISTRIBUTION being alive, not about any particular value.
import { mockDataSource } from '@/data/mock';
import { MASTERY_STABILITY } from '@/domain/derive';
import { useDevStore } from '@/store/devStore';

const DAY = 24 * 60 * 60 * 1000;

beforeAll(() => {
  useDevStore.setState({ userState: 'veteran', plan: 'paid' });
});
afterAll(() => {
  useDevStore.setState({ userState: 'summit' });
});

describe('veteran scenario', () => {
  it('is past the summit — 3,000+ mastered', async () => {
    const { states } = await mockDataSource.getDeckCards();
    expect(states.filter((s) => s.stability >= MASTERY_STABILITY).length).toBeGreaterThanOrEqual(3000);
  });

  it('still carries a tail of unmastered words', () => {
    // A veteran keeps saving. An all-mastered library would hide every "words
    // maturing" surface the late-stage screens are built around.
    return mockDataSource.getDeckCards().then(({ states }) => {
      expect(states.filter((s) => s.stability < MASTERY_STABILITY).length).toBeGreaterThan(500);
    });
  });

  it('spreads stability instead of pinning one value per tier', async () => {
    const { states } = await mockDataSource.getDeckCards();
    const mastered = states.filter((s) => s.stability >= MASTERY_STABILITY).map((s) => s.stability);
    const distinct = new Set(mastered.map((v) => Math.round(v)));
    // Flat data would collapse to a single value here.
    expect(distinct.size).toBeGreaterThan(100);
    expect(Math.max(...mastered)).toBeGreaterThan(Math.min(...mastered) * 5);
  });

  it('spreads due dates across a real queue, backlog included', async () => {
    const { states } = await mockDataSource.getDeckCards();
    const now = Date.now();
    const overdue = states.filter((s) => s.dueAt.getTime() < now).length;
    const nextWeek = states.filter((s) => {
      const d = s.dueAt.getTime() - now;
      return d >= 0 && d < 7 * DAY;
    }).length;
    const far = states.filter((s) => s.dueAt.getTime() - now >= 30 * DAY).length;

    // All three buckets populated — the shape of a queue, not four spikes.
    expect(overdue).toBeGreaterThan(0);
    expect(nextWeek).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(0);
    // …and the daily load is a fraction of the library, not all of it. A
    // 4,300-word account whose whole library comes due at once is the flat-data
    // artifact this scenario exists to avoid.
    expect(overdue).toBeLessThan(states.length / 2);
  });

  it('varies difficulty, reps and lapses per card', async () => {
    const { states } = await mockDataSource.getDeckCards();
    expect(new Set(states.map((s) => Math.round(s.difficulty))).size).toBeGreaterThan(3);
    expect(new Set(states.map((s) => s.reps)).size).toBeGreaterThan(5);
    expect(states.some((s) => s.lapses > 0)).toBe(true);
    expect(states.some((s) => s.lapses === 0)).toBe(true);
  });

  it('is deterministic — the same scenario twice is the same library', async () => {
    // A fixture that reshuffles per render can't be used to reproduce a
    // rendering bug (same reason FSRS fuzz is off — 02).
    const a = await mockDataSource.getDeckCards();
    const b = await mockDataSource.getDeckCards();
    expect(a.states.map((s) => s.stability)).toEqual(b.states.map((s) => s.stability));
  });

  it('keeps the word list and the deck agreeing on every card', async () => {
    // Home's stats come from getDeckCards, My Words from getWords. They are
    // built by separate functions and have drifted before.
    const { states } = await mockDataSource.getDeckCards();
    const words = await mockDataSource.getWords();
    expect(words.length).toBe(states.length);

    const byStability = (xs: number[]) => xs.slice().sort((x, y) => x - y);
    expect(byStability(words.map((w) => w.stability))).toEqual(byStability(states.map((s) => s.stability)));
  });

  it('gives every word a distinct headword despite cycling the bank', async () => {
    // Duplicate display text would mask collision bugs in search, sort and the
    // delete predicates — all of which key off text.
    const words = await mockDataSource.getWords();
    expect(new Set(words.map((w) => w.native)).size).toBe(words.length);
  });
});
