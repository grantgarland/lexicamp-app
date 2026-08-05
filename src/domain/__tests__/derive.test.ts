// Unit tests for the pure derivations in domain/derive.ts — the formulas 03
// specifies as "derived, not stored". These are the numbers every screen renders;
// if they drift, Home/Progress/Quiz all lie at once.
import { getTier, TIERS } from '@/theme/tiers';

import {
  defaultDisplayName,
  directionLangs,
  FREE_DAILY_SAVES,
  FREE_WORD_BASE,
  freeTierUsage,
  homeSnapshot,
  languageName,
  MASTERY_STABILITY,
  MOUNTAIN_TIERS,
  SOON_WINDOW_DAYS,
  mountainTier,
  wordLifecycle,
} from '../derive';
import type { Card, CardFsrsState } from '../types';

// ── Fixture helpers ──────────────────────────────────────────────────────────
// Fixed clock: a mid-day moment so "today" boundaries are unambiguous.
const NOW = new Date('2026-07-04T12:00:00');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const state = (over: Partial<CardFsrsState> = {}): CardFsrsState => ({
  cardId: 'c1',
  userId: 'u1',
  stability: 5,
  difficulty: 5,
  dueAt: new Date(NOW.getTime() + 5 * DAY),
  lastReviewAt: new Date(NOW.getTime() - DAY),
  state: 2,
  reps: 3,
  lapses: 0,
  learningSteps: 0,
  ...over,
});

const card = (over: Partial<Card> = {}): Card => ({
  id: 'c1',
  deckId: 'd1',
  userId: 'u1',
  translationId: 't1',
  userNote: null,
  customFront: null,
  customBack: null,
  suspended: false,
  createdAt: new Date(NOW.getTime() - 10 * DAY),
  ...over,
});

// ── wordLifecycle ────────────────────────────────────────────────────────────
describe('wordLifecycle', () => {
  it('is unseen when never studied (reps 0 or FSRS state 0)', () => {
    expect(wordLifecycle(state({ reps: 0 }))).toBe('unseen');
    expect(wordLifecycle(state({ state: 0 }))).toBe('unseen');
  });

  it('is mastered at the Summit stability threshold, in_flight below it', () => {
    expect(wordLifecycle(state({ stability: MASTERY_STABILITY }))).toBe('mastered');
    expect(wordLifecycle(state({ stability: MASTERY_STABILITY - 0.01 }))).toBe('in_flight');
  });

  it('MASTERY_STABILITY matches the Summit tier band (registry cross-check)', () => {
    expect(getTier('summit').stMin).toBe(MASTERY_STABILITY);
  });
});

// ── mountainTier ─────────────────────────────────────────────────────────────
describe('mountainTier', () => {
  // Ladder rev 2026-07-30: 0 / 100 / 500 / 1500 / 3000 mastered words.
  // Every boundary is asserted on BOTH sides so an off-by-one in the loop in
  // mountainTier() cannot pass.
  it('maps mastered counts to tiers at exact thresholds', () => {
    expect(mountainTier(0).id).toBe('bc');
    expect(mountainTier(99).id).toBe('bc');
    expect(mountainTier(100).id).toBe('abc');
    expect(mountainTier(499).id).toBe('abc');
    expect(mountainTier(500).id).toBe('hc');
    expect(mountainTier(1499).id).toBe('hc');
    expect(mountainTier(1500).id).toBe('sr');
    expect(mountainTier(2999).id).toBe('sr');
    expect(mountainTier(3000).id).toBe('summit');
    expect(mountainTier(100000).id).toBe('summit');
  });

  it('pins the exact ladder so a silent threshold edit fails here', () => {
    expect(MOUNTAIN_TIERS.map((t) => [t.id, t.masteredMin])).toEqual([
      ['bc', 0],
      ['abc', 100],
      ['hc', 500],
      ['sr', 1500],
      ['summit', 3000],
    ]);
  });

  it('negative / non-finite mastered counts clamp to Base Camp', () => {
    expect(mountainTier(-1).id).toBe('bc');
    expect(mountainTier(Number.NaN).id).toBe('bc');
  });

  it('thresholds ascend and ids exist in the tier registry', () => {
    let prev = -1;
    for (const t of MOUNTAIN_TIERS) {
      expect(t.masteredMin).toBeGreaterThan(prev);
      prev = t.masteredMin;
      expect(getTier(t.id).id).toBe(t.id);
    }
  });

  // The registry mirrors the ladder on `wordCount`. These two lists drifting
  // apart is exactly the latent-reference bug this rewrite was meant to kill,
  // so assert parity in BOTH order and value.
  it('theme/tiers.ts wordCount mirrors MOUNTAIN_TIERS.masteredMin', () => {
    expect(TIERS.map((t) => t.id)).toEqual(MOUNTAIN_TIERS.map((t) => t.id));
    expect(TIERS.map((t) => t.wordCount)).toEqual(MOUNTAIN_TIERS.map((t) => t.masteredMin));
  });

  it('registry CEFR labels match the mountain ladder', () => {
    expect(TIERS.map((t) => t.cefr)).toEqual(MOUNTAIN_TIERS.map((t) => t.cefr));
  });
});

// ── directionLangs / languageName ────────────────────────────────────────────
describe('directionLangs', () => {
  const profile = { nativeLang: 'en', targetLang: 'es' };

  it('native_to_target = nativeLang → targetLang', () => {
    const d = directionLangs(profile, 'native_to_target');
    expect(d.sourceCode).toBe('en');
    expect(d.targetCode).toBe('es');
    expect(d.sourceShort).toBe('EN');
    expect(d.targetShort).toBe('ES');
  });

  it('target_to_native is the reverse', () => {
    const d = directionLangs(profile, 'target_to_native');
    expect(d.sourceCode).toBe('es');
    expect(d.targetCode).toBe('en');
  });

  it('works for an arbitrary pair (fr→de) — not hardcoded to en/es', () => {
    const d = directionLangs({ nativeLang: 'fr', targetLang: 'de' }, 'native_to_target');
    expect(d.sourceShort).toBe('FR');
    expect(d.targetShort).toBe('DE');
  });
});

describe('languageName', () => {
  it('resolves shipped locale names via i18n', () => {
    // en locale is pinned by the test setup; 'es' must have a languages.* entry.
    expect(languageName('es')).not.toBe('ES'); // resolved, not the fallback
  });

  it('falls back to the uppercased code for unknown languages', () => {
    expect(languageName('zz')).toBe('ZZ');
  });
});

// ── homeSnapshot ─────────────────────────────────────────────────────────────
describe('homeSnapshot', () => {
  it('returns the empty snapshot for a new user', () => {
    const s = homeSnapshot([], [], NOW);
    expect(s.isEmpty).toBe(true);
    expect(s.wordsSaved).toBe(0);
    expect(s.tierCounts).toEqual([0, 0, 0, 0, 0]);
    expect(s.needRecallTotal).toBe(0);
  });

  it('buckets studied words into tier bands by stability', () => {
    // One state inside each registry band.
    const stabilities = TIERS.map((t) => (t.stMax === Infinity ? t.stMin + 10 : (t.stMin + t.stMax) / 2));
    const states = stabilities.map((st, i) => state({ cardId: `c${i}`, stability: st }));
    const cards = states.map((s) => card({ id: s.cardId }));
    const snap = homeSnapshot(cards, states, NOW);
    expect(snap.tierCounts).toEqual([1, 1, 1, 1, 1]);
    expect(snap.masteredCount).toBe(1); // only the Summit-band word
    expect(snap.wordsSaved).toBe(5);
  });

  it('excludes unseen words (reps 0) from tier counts', () => {
    const snap = homeSnapshot([card()], [state({ reps: 0 })], NOW);
    expect(snap.tierCounts).toEqual([0, 0, 0, 0, 0]);
    expect(snap.masteredCount).toBe(0);
  });

  it('splits the due queue into today / backlog / next-24h', () => {
    const states = [
      state({ cardId: 'a', dueAt: new Date(NOW.getTime() - 2 * HOUR) }), // overdue, today
      state({ cardId: 'b', dueAt: new Date(NOW.getTime() - 3 * DAY) }), // overdue, backlog
      state({ cardId: 'c', dueAt: new Date(NOW.getTime() + 6 * HOUR) }), // next 24h
      state({ cardId: 'd', dueAt: new Date(NOW.getTime() + 30 * HOUR) }), // future
      state({ cardId: 'e', dueAt: new Date(NOW.getTime() - HOUR), state: 0 }), // unseen → ignored
    ];
    const cards = states.map((s) => card({ id: s.cardId }));
    const snap = homeSnapshot(cards, states, NOW);
    expect(snap.needRecallTotal).toBe(2); // a + b
    expect(snap.needRecallToday).toBe(1); // a only (b predates today)
    expect(snap.dueTomorrow).toBe(1); // c only
  });

  it('counts cards added today off the start-of-day boundary', () => {
    const cards = [
      card({ id: 'x', createdAt: new Date(NOW.getTime() - HOUR) }), // today
      card({ id: 'y', createdAt: new Date(NOW.getTime() - 2 * DAY) }), // not today
    ];
    const snap = homeSnapshot(cards, [], NOW);
    expect(snap.addedToday).toBe(1);
    expect(snap.wordsSaved).toBe(2);
  });
});

describe('defaultDisplayName (18 §A7)', () => {
  test('prettifies the email local-part', () => {
    expect(defaultDisplayName('grant.persona@gmail.com')).toBe('Grant Persona');
    expect(defaultDisplayName('casey_garland-dev@x.io')).toBe('Casey Garland Dev');
  });
  test('strips +tags and never returns empty', () => {
    expect(defaultDisplayName('grant+lexicamp@gmail.com')).toBe('Grant');
    expect(defaultDisplayName('++@x.io')).toBe('Learner');
  });
  test('prefers a provider-supplied name', () => {
    expect(defaultDisplayName('x@y.com', '  Casey G  ')).toBe('Casey G');
  });
});

describe('freeTierUsage (DF-9 v2 / spec 19 rev — mirrors the save_card cap rule)', () => {
  test('starter phase until the 50th word, at any pace', () => {
    expect(freeTierUsage(0, 0)).toEqual({ phase: 'starter', saved: 0, limit: FREE_WORD_BASE });
    // A 49-in-one-day binge is still starter — daily saves don't matter yet.
    expect(freeTierUsage(49, 49)).toEqual({ phase: 'starter', saved: 49, limit: FREE_WORD_BASE });
  });

  test('daily phase from 50 total: counter is today-only and clamps at the limit', () => {
    expect(freeTierUsage(50, 0)).toEqual({ phase: 'daily', saved: 50, usedToday: 0, limit: FREE_DAILY_SAVES });
    expect(freeTierUsage(72, 3)).toEqual({ phase: 'daily', saved: 72, usedToday: 3, limit: FREE_DAILY_SAVES });
    // Crossing-day boundary (19 rev): starter saves can share the day — clamp for display.
    expect(freeTierUsage(53, 53)).toMatchObject({ phase: 'daily', usedToday: FREE_DAILY_SAVES });
  });

  test('non-banking is structural: an idle day leaves usedToday at 0, never adds capacity', () => {
    const idle = freeTierUsage(80, 0);
    expect(idle).toEqual({ phase: 'daily', saved: 80, usedToday: 0, limit: FREE_DAILY_SAVES });
  });

  test('negative addedToday (defensive) clamps to 0', () => {
    expect(freeTierUsage(60, -2)).toMatchObject({ phase: 'daily', usedToday: 0 });
  });

  test('ratified knobs (Casey 2026-07-22 v2): 50 starter + 5/day, daily reset', () => {
    expect(FREE_WORD_BASE).toBe(50);
    expect(FREE_DAILY_SAVES).toBe(5);
  });
});

describe('homeSnapshot — archived (suspended) cards (07-17c ruling)', () => {
  it('keeps archived words in earned counts but out of the due queue', () => {
    const states = [
      state({ cardId: 'live', dueAt: new Date(NOW.getTime() - HOUR), stability: MASTERY_STABILITY }),
      state({ cardId: 'arch', dueAt: new Date(NOW.getTime() - HOUR), stability: MASTERY_STABILITY }),
    ];
    const cards = [card({ id: 'live' }), card({ id: 'arch', suspended: true })];
    const snap = homeSnapshot(cards, states, NOW);
    expect(snap.wordsSaved).toBe(2); // earned: archived counts (matches Words header + server cap)
    expect(snap.masteredCount).toBe(2); // earned: archived counts
    expect(snap.tierCounts.reduce((a, b) => a + b, 0)).toBe(2);
    expect(snap.needRecallTotal).toBe(1); // queue: archived excluded
  });
});

// ── Study-card backlog (Home CTA, 2026-07-30) ───────────────────────────────
// The card's urgency line is `needRecallTotal - needRecallToday`: words that
// came due on an EARLIER day and are still waiting. It is the only honest
// urgency signal available without inventing a metric, so the two counts it
// subtracts have to keep meaning what the card assumes they mean.
describe('homeSnapshot due-queue split (drives the study-card backlog line)', () => {
  const at = (d: Date) => d;

  it('separates words that came due today from an older backlog', () => {
    const yesterday = new Date(NOW.getTime() - 30 * HOUR);
    const earlierToday = new Date(NOW.getTime() - 2 * HOUR);
    const cards = [card({ id: 'a' }), card({ id: 'b' }), card({ id: 'c' })];
    const states = [
      state({ cardId: 'a', state: 2, reps: 3, dueAt: at(yesterday) }),
      state({ cardId: 'b', state: 2, reps: 3, dueAt: at(new Date(NOW.getTime() - 50 * HOUR)) }),
      state({ cardId: 'c', state: 2, reps: 3, dueAt: at(earlierToday) }),
    ];
    const snap = homeSnapshot(cards, states, NOW);
    expect(snap.needRecallTotal).toBe(3);
    expect(snap.needRecallToday).toBe(1); // only 'c' came due today
    expect(snap.needRecallTotal - snap.needRecallToday).toBe(2); // the backlog
  });

  it('reports no backlog when everything came due today', () => {
    const cards = [card({ id: 'a' }), card({ id: 'b' })];
    const states = [
      state({ cardId: 'a', state: 2, reps: 3, dueAt: new Date(NOW.getTime() - 1 * HOUR) }),
      state({ cardId: 'b', state: 2, reps: 3, dueAt: new Date(NOW.getTime() - 3 * HOUR) }),
    ];
    const snap = homeSnapshot(cards, states, NOW);
    expect(snap.needRecallTotal - snap.needRecallToday).toBe(0);
  });

  it('never lets the backlog go negative', () => {
    // The card clamps, but the invariant should hold at the source too:
    // today's due can never exceed the total due.
    const cards = [card({ id: 'a' }), card({ id: 'b' }), card({ id: 'c' })];
    const states = [
      state({ cardId: 'a', state: 2, reps: 3, dueAt: new Date(NOW.getTime() - 1 * HOUR) }),
      state({ cardId: 'b', state: 2, reps: 3, dueAt: new Date(NOW.getTime() - 40 * HOUR) }),
      state({ cardId: 'c', state: 2, reps: 3, dueAt: new Date(NOW.getTime() + 2 * HOUR) }),
    ];
    const snap = homeSnapshot(cards, states, NOW);
    expect(snap.needRecallToday).toBeLessThanOrEqual(snap.needRecallTotal);
  });

  it('keeps archived words out of the backlog — they never resurface', () => {
    // 07-17c: suspended cards leave the review queue, so they must not show up
    // as "waiting since yesterday" on a card the user cannot act on.
    const cards = [card({ id: 'a', suspended: true }), card({ id: 'b' })];
    const states = [
      state({ cardId: 'a', state: 2, reps: 3, dueAt: new Date(NOW.getTime() - 40 * HOUR) }),
      state({ cardId: 'b', state: 2, reps: 3, dueAt: new Date(NOW.getTime() - 40 * HOUR) }),
    ];
    const snap = homeSnapshot(cards, states, NOW);
    expect(snap.needRecallTotal).toBe(1);
    expect(snap.needRecallTotal - snap.needRecallToday).toBe(1);
  });
});

// Home's stat row was retimed (Casey, 2026-08-05): Added today -> Added recently,
// Due tomorrow -> Due soon, both on the Base Camp window. The two ORIGINAL fields
// survive untouched because each has a non-display consumer that would break if
// widened — that is what most of this block is guarding.
describe('the rolling Home window', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = new Date('2026-08-05T12:00:00Z');
  const card = (id: string, agoMs: number) => ({
    id, deckId: 'd', userId: 'u', translationId: 't', userNote: null,
    customFront: null, customBack: null, suspended: false,
    createdAt: new Date(now.getTime() - agoMs),
  });
  const state = (cardId: string, dueInMs: number, stability = 5) => ({
    cardId, userId: 'u', stability, difficulty: 5,
    dueAt: new Date(now.getTime() + dueInMs), lastReviewAt: new Date(now.getTime() - DAY),
    state: 2 as const, reps: 3, lapses: 0, learningSteps: 0,
  });

  it('mirrors the Base Camp band rather than hardcoding a number', () => {
    // If Base Camp is ever retuned, the tiles follow it. This is the whole
    // reason SOON_WINDOW_DAYS is not the literal 3.
    expect(SOON_WINDOW_DAYS).toBe(TIERS[0].stMax);
  });

  it('counts words added inside the window and drops those outside it', () => {
    const cards = [card('a', 0), card('b', 2 * DAY), card('c', 2.9 * DAY), card('d', 4 * DAY)];
    expect(homeSnapshot(cards, [], now).addedRecently).toBe(3);
  });

  it('counts words due inside the window, including ones already overdue', () => {
    // A word that came due yesterday is not less due than one due tomorrow.
    const cards = ['a', 'b', 'c', 'd'].map((id) => card(id, 10 * DAY));
    const states = [state('a', -2 * DAY), state('b', 0.5 * DAY), state('c', 2.9 * DAY), state('d', 5 * DAY)];
    expect(homeSnapshot(cards, states, now).dueSoon).toBe(3);
  });

  it('leaves addedToday alone — the free-tier meter mirrors the server on it', () => {
    // Widening this to the tile's window would silently hand free users extra
    // daily saves in the UI while save_card kept refusing them.
    const cards = [card('a', 1 * 60 * 60 * 1000), card('b', 2 * DAY)];
    const snap = homeSnapshot(cards, [], now);
    expect(snap.addedToday).toBe(1);
    expect(snap.addedRecently).toBe(2);
  });

  it('leaves dueTomorrow alone — the Study and caught-up cards say "tomorrow"', () => {
    const cards = ['a', 'b'].map((id) => card(id, 10 * DAY));
    const states = [state('a', 0.5 * DAY), state('b', 2.5 * DAY)];
    const snap = homeSnapshot(cards, states, now);
    expect(snap.dueTomorrow).toBe(1);
    expect(snap.dueSoon).toBe(2);
  });

  it('excludes archived words from due soon, like every other queue count', () => {
    const cards = [{ ...card('a', 10 * DAY), suspended: true }, card('b', 10 * DAY)];
    expect(homeSnapshot(cards, [state('a', DAY), state('b', DAY)], now).dueSoon).toBe(1);
  });

  it('reports zero rather than NaN for an empty library', () => {
    const snap = homeSnapshot([], [], now);
    expect(snap.addedRecently).toBe(0);
    expect(snap.dueSoon).toBe(0);
  });
});
