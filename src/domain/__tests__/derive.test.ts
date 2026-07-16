// Unit tests for the pure derivations in domain/derive.ts — the formulas 03
// specifies as "derived, not stored". These are the numbers every screen renders;
// if they drift, Home/Progress/Quiz all lie at once.
import { getTier, TIERS } from '@/theme/tiers';

import {
  defaultDisplayName,
  directionLangs,
  homeSnapshot,
  languageName,
  MASTERY_STABILITY,
  MOUNTAIN_TIERS,
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
  it('maps mastered counts to tiers at exact thresholds', () => {
    expect(mountainTier(0).id).toBe('bc');
    expect(mountainTier(499).id).toBe('bc');
    expect(mountainTier(500).id).toBe('abc');
    expect(mountainTier(1499).id).toBe('abc');
    expect(mountainTier(1500).id).toBe('hc');
    expect(mountainTier(2999).id).toBe('hc');
    expect(mountainTier(3000).id).toBe('sr');
    expect(mountainTier(5000).id).toBe('summit');
    expect(mountainTier(100000).id).toBe('summit');
  });

  it('thresholds ascend and ids exist in the tier registry', () => {
    let prev = -1;
    for (const t of MOUNTAIN_TIERS) {
      expect(t.masteredMin).toBeGreaterThan(prev);
      prev = t.masteredMin;
      expect(getTier(t.id).id).toBe(t.id);
    }
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
