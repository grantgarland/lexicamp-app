// The App Store rating prompt (lib/reviewPrompt).
//
// Worth pinning because the failure modes are silent and expensive: StoreKit
// reports nothing back, so a prompt that never fires and a prompt that fires on
// every session both look identical from inside the app — and the second one
// burns the three displays Apple allows per year in a single evening.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { usePrefsStore } from '@/store/prefsStore';

import {
  REVIEW_COOLDOWN_DAYS,
  REVIEW_MIN_ACCURACY,
  REVIEW_MIN_CARDS,
  REVIEW_MIN_SESSIONS,
  noteSessionAndMaybeAskForReview,
  shouldAskForReview,
} from '../reviewPrompt';

// The live-backend axis. A getter so one suite can exercise both builds.
let mockUseSupabase = true;
jest.mock('@/data', () => ({
  get USE_SUPABASE() {
    return mockUseSupabase;
  },
}));

const mockIsAvailable = jest.fn();
const mockRequestReview = jest.fn();
jest.mock(
  'expo-store-review',
  () => ({
    isAvailableAsync: () => mockIsAvailable(),
    requestReview: () => mockRequestReview(),
  }),
  { virtual: true },
);

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 12);
const good = { accuracy: 90, reviewed: 20 };
const facts = (over: Partial<Parameters<typeof shouldAskForReview>[0]> = {}) => ({
  sessionsCompleted: REVIEW_MIN_SESSIONS,
  lastAskedAt: null,
  now: NOW,
  ...good,
  ...over,
});

describe('shouldAskForReview (the policy)', () => {
  it('asks on a good session once the user has come back enough times', () => {
    expect(shouldAskForReview(facts())).toBe(true);
  });

  it('never asks before the Nth finished session', () => {
    expect(shouldAskForReview(facts({ sessionsCompleted: REVIEW_MIN_SESSIONS - 1 }))).toBe(false);
    expect(shouldAskForReview(facts({ sessionsCompleted: 0 }))).toBe(false);
  });

  it('never asks after a session that went badly, or one too short to mean anything', () => {
    expect(shouldAskForReview(facts({ accuracy: REVIEW_MIN_ACCURACY - 1 }))).toBe(false);
    expect(shouldAskForReview(facts({ accuracy: REVIEW_MIN_ACCURACY }))).toBe(true);
    expect(shouldAskForReview(facts({ reviewed: REVIEW_MIN_CARDS - 1 }))).toBe(false);
    expect(shouldAskForReview(facts({ reviewed: REVIEW_MIN_CARDS }))).toBe(true);
  });

  it('holds the cooldown to the day, then asks again', () => {
    const cooldown = REVIEW_COOLDOWN_DAYS * DAY;
    expect(shouldAskForReview(facts({ lastAskedAt: NOW - 1 }))).toBe(false);
    expect(shouldAskForReview(facts({ lastAskedAt: NOW - cooldown + 1 }))).toBe(false);
    expect(shouldAskForReview(facts({ lastAskedAt: NOW - cooldown }))).toBe(true);
  });

  it('cannot spend more than the three displays Apple allows in a year', () => {
    // The cooldown is the only thing standing between a daily learner and three
    // asks in three days. 365 / cooldown must stay at or under Apple's cap.
    expect(Math.ceil(365 / REVIEW_COOLDOWN_DAYS)).toBeLessThanOrEqual(4);
    expect(REVIEW_COOLDOWN_DAYS).toBeGreaterThanOrEqual(90);
  });
});

describe('noteSessionAndMaybeAskForReview', () => {
  beforeEach(() => {
    mockUseSupabase = true;
    mockIsAvailable.mockResolvedValue(true);
    mockRequestReview.mockResolvedValue(undefined);
    usePrefsStore.setState({ sessionsCompleted: 0, reviewAskedAt: null });
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });
  afterEach(() => jest.restoreAllMocks());

  const finish = (session = good) => noteSessionAndMaybeAskForReview(session, 0);

  it('counts sessions and asks on the Nth good one — not before', async () => {
    for (let i = 1; i < REVIEW_MIN_SESSIONS; i++) {
      expect(await finish()).toBe(false);
    }
    expect(mockRequestReview).not.toHaveBeenCalled();

    expect(await finish()).toBe(true);
    expect(mockRequestReview).toHaveBeenCalledTimes(1);
    expect(usePrefsStore.getState().sessionsCompleted).toBe(REVIEW_MIN_SESSIONS);
    expect(usePrefsStore.getState().reviewAskedAt).toBe(NOW);
  });

  it('asks ONCE: the next good session inside the cooldown stays quiet', async () => {
    usePrefsStore.setState({ sessionsCompleted: REVIEW_MIN_SESSIONS });
    expect(await finish()).toBe(true);
    expect(await finish()).toBe(false);
    expect(await finish()).toBe(false);
    expect(mockRequestReview).toHaveBeenCalledTimes(1);
  });

  it('still counts a bad session, but does not ask on it', async () => {
    usePrefsStore.setState({ sessionsCompleted: REVIEW_MIN_SESSIONS });
    expect(await finish({ accuracy: 40, reviewed: 20 })).toBe(false);
    expect(usePrefsStore.getState().sessionsCompleted).toBe(REVIEW_MIN_SESSIONS + 1);
    expect(usePrefsStore.getState().reviewAskedAt).toBeNull();
    expect(mockRequestReview).not.toHaveBeenCalled();
  });

  it('never asks in a mock/smoke build, and never loads the native module there', async () => {
    // The nightly Maestro suite drives a RELEASE bundle on the mock DataSource;
    // a system sheet over the end-of-session screen would steal its next tap.
    mockUseSupabase = false;
    usePrefsStore.setState({ sessionsCompleted: REVIEW_MIN_SESSIONS });
    expect(await finish()).toBe(false);
    expect(mockIsAvailable).not.toHaveBeenCalled();
    expect(mockRequestReview).not.toHaveBeenCalled();
    expect(usePrefsStore.getState().reviewAskedAt).toBeNull();
  });

  it('does not latch when the store has no review sheet to show', async () => {
    // Otherwise a device that could not show the sheet today would be locked
    // out of it for the whole cooldown.
    mockIsAvailable.mockResolvedValue(false);
    usePrefsStore.setState({ sessionsCompleted: REVIEW_MIN_SESSIONS });
    expect(await finish()).toBe(false);
    expect(usePrefsStore.getState().reviewAskedAt).toBeNull();
    expect(mockRequestReview).not.toHaveBeenCalled();
  });

  it('latches BEFORE asking, and swallows a failing request', async () => {
    // A throwing request must cost one skipped ask — never a retry loop.
    mockRequestReview.mockRejectedValue(new Error('StoreKit said no'));
    usePrefsStore.setState({ sessionsCompleted: REVIEW_MIN_SESSIONS });
    await expect(finish()).resolves.toBe(false);
    expect(usePrefsStore.getState().reviewAskedAt).toBe(NOW);
    expect(await finish()).toBe(false);
    expect(mockRequestReview).toHaveBeenCalledTimes(1);
  });
});

describe('rating prompt wiring', () => {
  const ROOT = join(__dirname, '..', '..', '..');
  const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

  it('persists both facts the policy reads', () => {
    // ⚠️ A field missing from `partialize` resets on every cold start. For
    // `reviewAskedAt` that means re-requesting the sheet at every launch.
    const persist = (
      usePrefsStore as unknown as { persist: { getOptions: () => { partialize: (s: unknown) => Record<string, unknown> } } }
    ).persist;
    const kept = persist.getOptions().partialize({ ...usePrefsStore.getState(), sessionsCompleted: 7, reviewAskedAt: NOW });
    expect(kept.sessionsCompleted).toBe(7);
    expect(kept.reviewAskedAt).toBe(NOW);
  });

  it('asks from the commit SUCCESS path, and not during the walkthrough', () => {
    const quiz = src('src/screens/QuizScreen.tsx');
    const call = quiz.indexOf('noteSessionAndMaybeAskForReview({');
    expect(call).toBeGreaterThan(-1);
    const around = quiz.slice(quiz.lastIndexOf('commit.mutate(', call), call);
    // Inside commit.mutate's options, behind onSuccess, and gated on the tour.
    expect(around).toContain('onSuccess');
    expect(around).toContain('tourActive');
    // ...and nowhere else: one ask site, so the policy has one caller.
    expect(quiz.match(/noteSessionAndMaybeAskForReview\(/g)).toHaveLength(1);
  });

  it('never imports the native module at module scope', () => {
    const body = src('src/lib/reviewPrompt.ts');
    expect(body).not.toMatch(/^import .* from 'expo-store-review'/m);
    expect(body).toContain("require('expo-store-review')");
  });

  it('gates on the live-backend axis, never on __DEV__', () => {
    const body = src('src/lib/reviewPrompt.ts');
    const code = body.slice(body.indexOf('export async function noteSessionAndMaybeAskForReview'));
    expect(code).toContain('USE_SUPABASE');
    expect(code).not.toContain('__DEV__');
  });

  it('gives Settings a manual route that opens the App Store, not the in-app browser', () => {
    const settings = src('src/screens/SettingsScreen.tsx');
    const id = settings.indexOf('testID="settings-rate"');
    expect(id).toBeGreaterThan(-1);
    // To the row's own onPress — NOT to the first '/>', which is <Chevron />.
    const row = settings.slice(settings.lastIndexOf('<ListItem', id), settings.indexOf('onPress=', id) + 60);
    expect(row).toContain('handleRate');
    expect(row).not.toContain('setSheet');
    const handler = settings.slice(settings.indexOf('const handleRate'), settings.indexOf('// 20 §8 R1 revised'));
    expect(handler).toContain('Linking.openURL(APP_STORE_URLS.writeReview)');
    expect(handler).not.toContain('openWebLink');
    for (const lang of ['en', 'es']) {
      const s = JSON.parse(src(`src/i18n/locales/${lang}.json`)).settings;
      expect(s.rateApp).toBeTruthy();
      expect(s.rateAppSub).toBeTruthy();
      expect(s.rateUnavailable).toBeTruthy();
    }
  });
});
