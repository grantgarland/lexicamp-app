// Walkthrough fixture — a tiny, self-contained study session used ONLY while the
// tour is running (2026-08-01).
//
// WHY: the tour walks a brand-new account, which by definition has zero saved
// words. w6 (quiz), w7 (results) and w8 (Progress) therefore landed on empty
// states — the quiz step showed "Nothing to study yet" with no rating gutter to
// point at, and the results/Progress steps explained charts that weren't there.
//
// The fix is data, not UI: screens read these cards when `useWalkthroughActive()`
// is true AND they have nothing real to show. Everything stays in memory —
// ratings during the tour are NEVER committed (see QuizScreen.rate) — so the
// tour cannot pollute a real account's history or FSRS state.
//
// Deliberately Spanish→English at the beginner tiers: it matches the O-05
// default target language and the tour's "your first words" framing. The words
// are ordinary A1 vocabulary, so the example sentences read as real study
// content rather than lorem ipsum.
import type { QuizCardItem } from '@/domain/quiz';
import type { CardFsrsState } from '@/domain/types';

/** Card ids are namespaced so nothing can mistake them for real rows. */
const TOUR_ID_PREFIX = 'tour-demo-';

export function isTourFixtureId(cardId: string): boolean {
  return cardId.startsWith(TOUR_ID_PREFIX);
}

/** Fixed, deterministic scheduling state. `dueAt` is derived from a caller-passed
 *  `now` so nothing here calls Date.now() at module scope (which would make the
 *  fixture non-deterministic in tests). */
function fsrsFor(cardId: string, now: number, reps: number): CardFsrsState {
  return {
    cardId,
    userId: 'tour-demo-user',
    stability: 2.4,
    difficulty: 5.1,
    dueAt: new Date(now),
    lastReviewAt: reps > 0 ? new Date(now - 86_400_000) : null,
    state: 2, // review — so the results screen shows a real tier transition
    reps,
    lapses: 0,
    learningSteps: 0,
  };
}

interface FixtureSeed {
  front: string;
  back: string;
  phonetic: string;
  pos: string;
  example: string;
  reps: number;
}

const SEEDS: readonly FixtureSeed[] = [
  { front: 'el sendero', back: 'the trail', phonetic: '/el senˈdeɾo/', pos: 'noun', example: 'Subimos por el sendero al amanecer.', reps: 3 },
  { front: 'la cumbre', back: 'the summit', phonetic: '/la ˈkumbɾe/', pos: 'noun', example: 'Llegamos a la cumbre antes del mediodía.', reps: 2 },
  { front: 'recordar', back: 'to remember', phonetic: '/rekoɾˈdaɾ/', pos: 'verb', example: 'Es más fácil recordar poco a poco.', reps: 5 },
];

/** The tour's demo session. `now` is injected so callers control time. */
export function tourFixtureCards(now: number): QuizCardItem[] {
  return SEEDS.map((s, i) => {
    const id = `${TOUR_ID_PREFIX}${i + 1}`;
    return {
      id,
      tierId: (i === 2 ? 'hc' : i === 1 ? 'abc' : 'bc') as QuizCardItem['tierId'],
      mode: 'recognition',
      content: {
        frontWord: s.front,
        frontPrompt: 'What does this mean?',
        backWord: s.back,
        backPhonetic: s.phonetic,
        backPos: s.pos,
        backExample: s.example,
      },
      fsrs: fsrsFor(id, now, s.reps),
    };
  });
}

/** Progress-screen stand-in while the tour runs on an empty account (w8).
 *  Shaped to OVERLAY the real `useProgressData()` result, so the field names and
 *  types must track that contract — `tierCounts` is the 5-slot BC/ABC/HC/SR/★
 *  array, not a keyed object. Numbers describe a plausible second week so the
 *  tier bars and stat tiles illustrate something honest rather than all zeros. */
export const TOUR_FIXTURE_PROGRESS = {
  tierCounts: [1, 1, 1, 0, 0] as [number, number, number, number, number],
  totalSaved: 3,
  totalMastered: 1,
  streakDays: 2,
  bestStreak: 4,
  sessionsTotal: 5,
  avgAccuracy: 0.82,
  daysActive: 4,
  reviewsTotal: 68,
  timeInvestedMs: 7 * 60 * 1000,

} as const;

/** The word the walkthrough types into Search for w3/w3b. Chosen because it is
 *  common enough to resolve in every supported language pair AND genuinely
 *  polysemous, so the multi-sense point w3b makes is visible in the result. */
export const TOUR_SEARCH_DEMO_WORD = 'spring';
