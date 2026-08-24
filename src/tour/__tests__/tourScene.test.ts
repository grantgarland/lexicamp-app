// tourScene — the single channel the walkthrough uses to tell screens what to
// render. These pin the step→scene mapping, because getting it wrong is silent:
// the tooltip still appears, it just describes a screen that isn't there (which
// is exactly how w7 shipped explaining an invisible results view).
import { isQuizResultsStep, isQuizRevealStep, isSearchDemoStep, useTourScene, usesTourFixture } from '../tourScene';

describe('isQuizResultsStep', () => {
  it('is true for w7, the "Session results" step', () => {
    expect(isQuizResultsStep('w7')).toBe(true);
  });

  it('is false for w6 — that step explains the rating gutter, not results', () => {
    expect(isQuizResultsStep('w6')).toBe(false);
  });

  it('is false when the tour is idle', () => {
    expect(isQuizResultsStep(null)).toBe(false);
  });
});

describe('search demo steps', () => {
  it('covers both the search beat and the save beat', () => {
    expect(isSearchDemoStep('w3')).toBe(true);
    expect(isSearchDemoStep('w3b')).toBe(true);
  });

  it('marks only the save beat as saved', () => {
    expect(isQuizRevealStep('w6')).toBe(true);
    expect(isQuizRevealStep('w5')).toBe(false);
    expect(isQuizRevealStep('w7')).toBe(false);
  });

  it('is inert outside the tour', () => {
    expect(isSearchDemoStep(null)).toBe(false);
    expect(isQuizRevealStep(null)).toBe(false);
  });
});

describe('useTourScene', () => {
  afterEach(() => useTourScene.getState().setStepId(null));

  it('starts idle so screens read real data by default', () => {
    expect(useTourScene.getState().stepId).toBeNull();
  });

  it('publishes and clears the current step', () => {
    useTourScene.getState().setStepId('w7');
    expect(useTourScene.getState().stepId).toBe('w7');
    useTourScene.getState().setStepId(null);
    expect(useTourScene.getState().stepId).toBeNull();
  });
});

describe('usesTourFixture — the quiz commit guard (DF-4)', () => {
  const base = { tourActive: true, isLoading: false, realCardCount: 0 };

  it('uses fixtures only when the tour is running AND the queue is genuinely empty', () => {
    expect(usesTourFixture(base)).toBe(true);
  });

  it('never swaps in fixtures outside the tour', () => {
    // The guard that keeps demo words out of a real session.
    expect(usesTourFixture({ ...base, tourActive: false })).toBe(false);
  });

  it('leaves a user with real due cards studying their OWN words', () => {
    // DF-4's actual requirement: never present fabricated data as the user's.
    // Real data always wins; the fixture is a fallback, not a substitute.
    expect(usesTourFixture({ ...base, realCardCount: 3 })).toBe(false);
  });

  it('does NOT treat a still-loading queue as an empty one', () => {
    // ⚠️ Without the isLoading term, the first frame of a real session — queue
    // not yet fetched, so realCardCount is 0 — would look empty and swap demo
    // cards in under someone who has real words due.
    expect(usesTourFixture({ ...base, isLoading: true })).toBe(false);
  });

  it('is false in every combination that must reach the server', () => {
    // Inverted statement of the same invariant: QuizScreen commits iff this is
    // false, so anything here returning true silently drops a real session.
    for (const realCardCount of [1, 20]) {
      for (const isLoading of [true, false]) {
        for (const tourActive of [true, false]) {
          expect(usesTourFixture({ tourActive, isLoading, realCardCount })).toBe(false);
        }
      }
    }
  });
});
