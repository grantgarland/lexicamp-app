// tourScene — the single channel the walkthrough uses to tell screens what to
// render. These pin the step→scene mapping, because getting it wrong is silent:
// the tooltip still appears, it just describes a screen that isn't there (which
// is exactly how w7 shipped explaining an invisible results view).
import { isQuizResultsStep, isQuizRevealStep, isSearchDemoStep, useTourScene } from '../tourScene';

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
