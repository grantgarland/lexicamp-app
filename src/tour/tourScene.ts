// Tour scene — the one channel through which the walkthrough tells a SCREEN what
// to render (2026-08-02).
//
// WHY a store rather than props: the tour drives screens it does not own and
// cannot reach through the tree — the quiz is a native fullScreenModal, Search
// is a route-modal, Progress is a tab. Threading tour state through all of them
// would couple every screen to the tour. Instead the controller publishes the
// CURRENT STEP ID here and each screen decides, in one place, what that means
// for it. Screens stay ignorant of the tour's order and of each other.
//
// ⚠️ Nothing here may write to the database. Everything the tour shows is
// fixture data (see tourFixture.ts) — the walkthrough must leave no trace on a
// real account.
import { create } from 'zustand';

interface TourSceneState {
  /** Current walkthrough step id ('w1'…'w9'), or null when the tour is idle. */
  stepId: string | null;
  setStepId: (id: string | null) => void;
}

export const useTourScene = create<TourSceneState>((set) => ({
  stepId: null,
  setStepId: (stepId) => set({ stepId }),
}));

/** Steps during which the quiz must display its per-word RESULTS LIST rather
 *  than a card. w7 explains what happens after a session — it used to leave card
 *  1 of 20 on screen behind the tooltip, explaining a screen the user could not
 *  see. ⚠️ It maps to the 'stats' phase (the list of words with their next
 *  intervals), not 'end' (the "Great session!" splash) — the tooltip promises
 *  "how far each word moved and when it returns", which only the list shows. */
const QUIZ_RESULTS_STEPS = new Set(['w7']);

export function isQuizResultsStep(stepId: string | null): boolean {
  return stepId != null && QUIZ_RESULTS_STEPS.has(stepId);
}

/** Steps during which Search shows its demo query + result, so the "search and
 *  save" beat has something real on screen instead of an empty field. */
const SEARCH_DEMO_STEPS = new Set(['w3', 'w3b']);

export function isSearchDemoStep(stepId: string | null): boolean {
  return stepId != null && SEARCH_DEMO_STEPS.has(stepId);
}

/** Steps during which the quiz card must already be FLIPPED. w6 is "reveal,
 *  then rate" and anchors the gutter — with the card face-down the gutter shows
 *  a single "Tap to reveal" button, so the step described three rating buttons
 *  that were not on screen (Casey, 2026-08-03). Display-only: forcing the flip
 *  never calls `rate()`, so nothing is buffered or written. */
export function isQuizRevealStep(stepId: string | null): boolean {
  return stepId === 'w6';
}

/** Whether the quiz is running on TOUR FIXTURE cards rather than the user's own.
 *
 *  This is the predicate the commit guard keys on, and it is the single most
 *  consequential line in the tour: fixture cards do not exist server-side, so
 *  committing a fixture session would 404 AND pollute a real account's FSRS
 *  history with words the user never saved. `QuizScreen.rate()` writes only
 *  `if (!usesTourFixture(...))`.
 *
 *  ⚠️ The `realCardCount === 0` term is what keeps the tour honest: a user who
 *  HAS due cards always studies their own words, and only a genuinely empty
 *  queue falls back to the demo session. DF-4's requirement — never show someone
 *  fabricated data as if it were theirs — is satisfied by that term, not by
 *  skipping the step.
 *
 *  ⚠️ `isLoading` must be false. Without it, the first frame of a real session
 *  (queue not yet fetched, so `realCardCount === 0`) would look like an empty
 *  queue and swap in fixtures under a user who has real words due. */
export function usesTourFixture(opts: {
  tourActive: boolean;
  isLoading: boolean;
  realCardCount: number;
}): boolean {
  return opts.tourActive && !opts.isLoading && opts.realCardCount === 0;
}
