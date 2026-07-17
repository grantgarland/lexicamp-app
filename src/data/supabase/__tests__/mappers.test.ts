// Row→domain mapper tests — fixture rows shaped exactly like the PostgREST
// projections the SupabaseDataSource requests. These are the seams where
// snake_case/ISO-string data becomes domain objects; a silent mis-map here
// corrupts every screen, so each field is asserted.
import {
  mapCard,
  mapEntitlement,
  mapFsrsState,
  mapProfile,
  mapQuizItem,
  mapWordListItem,
  toCommitRow,
  type CardRow,
  type FsrsRow,
  type TranslationJoin,
} from '../mappers';

const CARD: CardRow = {
  id: 'c1',
  deck_id: 'd1',
  user_id: 'u1',
  translation_id: 't1',
  user_note: null,
  custom_front: null,
  custom_back: null,
  suspended: false,
  created_at: '2026-07-01T12:00:00Z',
};

const FSRS: FsrsRow = {
  card_id: 'c1',
  user_id: 'u1',
  stability: 5,
  difficulty: 5,
  due_at: '2026-07-06T12:00:00Z',
  last_review_at: null,
  state: 2,
  reps: 3,
  lapses: 0,
  learning_steps: 0,
};

const PRIMARY_EXAMPLE = {
  sourcePrefix: 'Una ',
  sourceTerm: 'mosca',
  sourceSuffix: ' en la sopa.',
  targetPrefix: 'A ',
  targetTerm: 'fly',
  targetSuffix: ' in the soup.',
};

const HOUSEFLY_EXAMPLE = {
  sourcePrefix: 'La ',
  sourceTerm: 'mosca',
  sourceSuffix: ' doméstica es común.',
  targetPrefix: 'The ',
  targetTerm: 'housefly',
  targetSuffix: ' is common.',
};

// Per-sense examples map (2026-07-17): keyed by the sense's normalized target.
const TR: TranslationJoin = {
  id: 't1',
  display_source: 'mosca',
  translation: 'fly',
  pos_tag: 'NOUN',
  prefix_word: 'la',
  alt_translations: [{ normalizedTarget: 'housefly', displayTarget: 'housefly' }],
  examples: { fly: [PRIMARY_EXAMPLE], housefly: [HOUSEFLY_EXAMPLE] },
};

describe('mapProfile / mapEntitlement', () => {
  it('maps snake_case profile rows', () => {
    const p = mapProfile({
      id: 'u1',
      display_name: 'Casey',
      native_lang: 'en',
      learning_lang: 'es',
      timezone: 'America/New_York',
      onboarding_complete: true,
    });
    expect(p).toEqual({
      id: 'u1',
      displayName: 'Casey',
      nativeLang: 'en',
      targetLang: 'es',
      timezone: 'America/New_York',
      onboardingComplete: true,
    });
  });

  it('absent subscription row → free entitlement', () => {
    expect(mapEntitlement(null)).toEqual({ status: 'free', plan: null, platform: null, currentPeriodEnd: null });
  });

  it('active subscription row maps with a Date period end', () => {
    const e = mapEntitlement({ status: 'active', plan: 'annual', platform: 'ios', current_period_end: '2026-08-01T00:00:00Z' });
    expect(e.status).toBe('active');
    expect(e.currentPeriodEnd).toBeInstanceOf(Date);
  });
});

describe('mapCard / mapFsrsState', () => {
  it('converts timestamps to Dates and keeps ids', () => {
    const c = mapCard(CARD);
    expect(c.createdAt).toBeInstanceOf(Date);
    expect(c.translationId).toBe('t1');
    const s = mapFsrsState(FSRS);
    expect(s.dueAt.toISOString()).toBe('2026-07-06T12:00:00.000Z');
    expect(s.lastReviewAt).toBeNull();
    expect(s.state).toBe(2);
  });

  it('clamps out-of-range FSRS state to 0 (defensive)', () => {
    expect(mapFsrsState({ ...FSRS, state: 9 }).state).toBe(0);
  });
});

describe('mapWordListItem', () => {
  it('joins card + translation + fsrs into a Word List row', () => {
    const w = mapWordListItem(CARD, TR, FSRS);
    expect(w).toMatchObject({ id: 'c1', translationId: 't1', native: 'mosca', target: 'fly', stability: 5, reps: 3 });
    expect(w.example).toBe('Una mosca en la sopa.');
    expect(w.exampleTranslation).toBe('A fly in the soup.');
    expect(w.pos.length).toBeGreaterThan(0); // i18n-resolved POS label
  });

  it('no cached example → both example sides are empty strings', () => {
    const w = mapWordListItem(CARD, { ...TR, examples: null }, FSRS);
    expect(w.example).toBe('');
    expect(w.exampleTranslation).toBe('');
  });

  it('prefers user overrides (custom_front/back)', () => {
    const w = mapWordListItem({ ...CARD, custom_front: 'la mosca', custom_back: 'housefly' }, TR, FSRS);
    expect(w.native).toBe('la mosca');
    expect(w.target).toBe('housefly');
  });

  // Per-sense examples (2026-07-17) — the "two Korean houses, one example" bug.
  it('a sibling-sense card gets ITS OWN example, never the primary sense’s', () => {
    const w = mapWordListItem({ ...CARD, custom_back: 'housefly' }, TR, FSRS);
    expect(w.senseTarget).toBe('housefly');
    expect(w.exampleTranslation).toBe('The housefly is common.');
    const primary = mapWordListItem(CARD, TR, FSRS);
    expect(primary.senseTarget).toBe('fly');
    expect(primary.exampleTranslation).toBe('A fly in the soup.');
  });

  it('sibling sense with no cached entry → empty example (lazy-fetch trigger), not the primary’s', () => {
    const w = mapWordListItem({ ...CARD, custom_back: 'housefly' }, { ...TR, examples: { fly: [PRIMARY_EXAMPLE] } }, FSRS);
    expect(w.example).toBe('');
    expect(w.exampleTranslation).toBe('');
  });

  it('legacy ARRAY examples (pre-migration) map to the primary sense only', () => {
    const legacy = { ...TR, examples: [PRIMARY_EXAMPLE] };
    expect(mapWordListItem(CARD, legacy, FSRS).exampleTranslation).toBe('A fly in the soup.');
    expect(mapWordListItem({ ...CARD, custom_back: 'housefly' }, legacy, FSRS).exampleTranslation).toBe('');
  });
});

describe('mapQuizItem', () => {
  it('low-stability card → recognition mode with tier from the registry', () => {
    const q = mapQuizItem(CARD, TR, { ...FSRS, stability: 1 }, 'es');
    expect(q.tierId).toBe('bc');
    expect(q.mode).toBe('recognition');
    expect(q.content.frontWord).toBe('mosca');
    expect(q.content.backWord).toBe('fly');
    expect(q.content.frontPrompt.length).toBeGreaterThan(0);
  });

  it('high-stability card → recall mode', () => {
    const q = mapQuizItem(CARD, TR, { ...FSRS, stability: 20 }, 'es');
    expect(q.tierId).toBe('sr');
    expect(q.mode).toBe('recall');
  });

  it('maps a cached example onto the card back (target-side sentence, no fetch)', () => {
    const q = mapQuizItem(CARD, TR, FSRS, 'es');
    expect(q.content.backExample).toBe('A fly in the soup.');
    const noEx = mapQuizItem(CARD, { ...TR, examples: null }, FSRS, 'es');
    expect(noEx.content.backExample).toBeUndefined();
  });

  it('sibling-sense card back shows ITS sense’s example (per-sense, 2026-07-17)', () => {
    const q = mapQuizItem({ ...CARD, custom_back: 'housefly' }, TR, FSRS, 'es');
    expect(q.content.backExample).toBe('The housefly is common.');
  });
});

describe('toCommitRow', () => {
  it('flattens a ReviewComputation into the commit_quiz_session RPC row', () => {
    const now = new Date('2026-07-06T12:00:00Z');
    const row = toCommitRow({
      next: {
        cardId: 'c1',
        userId: 'u1',
        stability: 12.5,
        difficulty: 4.8,
        dueAt: new Date('2026-07-19T12:00:00Z'),
        lastReviewAt: now,
        state: 2,
        reps: 4,
        lapses: 0,
        learningSteps: 0,
      },
      log: { rating: 3, elapsedDays: 10, scheduledDays: 13, stateBefore: 2 },
    });
    expect(row).toEqual({
      card_id: 'c1',
      stability: 12.5,
      difficulty: 4.8,
      due_at: '2026-07-19T12:00:00.000Z',
      last_review_at: '2026-07-06T12:00:00.000Z',
      state: 2,
      reps: 4,
      lapses: 0,
      learning_steps: 0,
      rating: 3,
      elapsed_days: 10,
      scheduled_days: 13,
      state_before: 2,
    });
  });
});
