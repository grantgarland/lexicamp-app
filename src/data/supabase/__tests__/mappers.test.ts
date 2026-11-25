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
  overrideText,
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
      username: 'fluent-marmot',
      username_changes: 2,
      display_name: 'Casey',
      native_lang: 'en',
      learning_lang: 'es',
      timezone: 'America/New_York',
      onboarding_complete: true,
      quiz_length: 20,
      created_at: '2026-07-01T00:00:00Z',
    });
    expect(p).toEqual({
      id: 'u1',
      username: 'fluent-marmot',
      usernameChanges: 2,
      displayName: 'Casey',
      nativeLang: 'en',
      targetLang: 'es',
      timezone: 'America/New_York',
      onboardingComplete: true,
      quizLength: 20,
      createdAt: new Date('2026-07-01T00:00:00Z'),
    });
  });

  it('absent subscription row → free entitlement', () => {
    expect(mapEntitlement(null)).toEqual({ status: 'free', plan: null, platform: null, currentPeriodEnd: null, autoRenew: null });
  });

  it('active subscription row maps with a Date period end', () => {
    const e = mapEntitlement({ status: 'active', plan: 'annual', platform: 'ios', current_period_end: '2026-08-01T00:00:00Z', auto_renew: true });
    expect(e.status).toBe('active');
    expect(e.currentPeriodEnd).toBeInstanceOf(Date);
    expect(e.autoRenew).toBe(true);
  });

  it('carries auto_renew through, including the unknown state', () => {
    // 3.15: false = cancelled but still active until the period ends; null =
    // no evidence either way (rows written before the column existed), which the
    // UI must render neutrally rather than guessing "Renews".
    const row = { status: 'active', plan: 'annual', platform: 'ios', current_period_end: null } as const;
    expect(mapEntitlement({ ...row, auto_renew: false }).autoRenew).toBe(false);
    expect(mapEntitlement({ ...row, auto_renew: null }).autoRenew).toBeNull();
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

  it('Edit Translations: the override replaces the rendered target only', () => {
    const w = mapWordListItem(CARD, TR, FSRS, 'вода');
    expect(w.target).toBe('вода');
    expect(w.targetOverride).toBe('вода');
    // originalTarget is the cache/sense value — what "Reset to original" restores.
    expect(w.originalTarget).toBe(mapWordListItem(CARD, TR, FSRS).target);
    // The sense key (→ per-sense example lookup) must NOT follow the override.
    expect(w.senseTarget).toBe(mapWordListItem(CARD, TR, FSRS).senseTarget);
    expect(w.example).toBe(mapWordListItem(CARD, TR, FSRS).example);
  });

  it('Edit Translations: no override leaves target === originalTarget', () => {
    const w = mapWordListItem(CARD, TR, FSRS);
    expect(w.targetOverride).toBeNull();
    expect(w.target).toBe(w.originalTarget);
  });

  it('Edit Translations: the override drives the quiz answer (and so the recall slot count)', () => {
    const q = mapQuizItem(CARD, TR, FSRS, 'es', 'вода');
    expect(q.content.backWord).toBe('вода');
    // ...even over an A12c sense pick, which the user is explicitly re-wording.
    expect(mapQuizItem({ ...CARD, custom_back: 'housefly' }, TR, FSRS, 'es', 'house fly').content.backWord).toBe('house fly');
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

  // The card renders backExample as the LEAD and backExampleNative as the gloss
  // beneath it (Casey, 2026-08-03). Swapping the two sides here would silently
  // put the user's own language on top, which is the whole thing being fixed —
  // and nothing downstream could tell, since both are just strings.
  it('pairs the target-side lead with the source-side gloss, in that order', () => {
    const q = mapQuizItem(CARD, TR, FSRS, 'es');
    expect(q.content.backExample).toBe('A fly in the soup.'); // target — leads
    expect(q.content.backExampleNative).toBe('Una mosca en la sopa.'); // source — glosses
    const noEx = mapQuizItem(CARD, { ...TR, examples: null }, FSRS, 'es');
    expect(noEx.content.backExampleNative).toBeUndefined();
  });

  it('sibling-sense card back shows ITS sense’s example (per-sense, 2026-07-17)', () => {
    const q = mapQuizItem({ ...CARD, custom_back: 'housefly' }, TR, FSRS, 'es');
    expect(q.content.backExample).toBe('The housefly is common.');
  });
});

// Orientation (27 §13 P0-a, 2026-11-25). translations_cache rows are stored in
// SEARCH direction, so a word the user looked up learning→native (fr→en, in an
// en→fr deck) has the LEARNING language on its source side. The quiz used to read
// rows in search order and so asked "Recall the French word" while grading an
// English answer. Production had one such card when this was found.
describe('mapQuizItem orientation (learning language is always the answer)', () => {
  const bt = (displayText: string) => ({ normalizedText: displayText, displayText, numExamples: 0, frequencyCount: 0 });
  const HOUSE_EXAMPLE = {
    sourcePrefix: 'La ',
    sourceTerm: 'maison',
    sourceSuffix: ' est grande.',
    targetPrefix: 'The ',
    targetTerm: 'house',
    targetSuffix: ' is big.',
  };
  // Looked up fr→en: source = French (learning), target = English (native).
  const REVERSE: TranslationJoin = {
    id: 't2',
    display_source: 'maison',
    translation: 'house',
    source_lang: 'fr',
    target_lang: 'en',
    pos_tag: 'NOUN',
    prefix_word: null,
    alt_translations: [{ normalizedTarget: 'home', displayTarget: 'home' }],
    // Back-translations of "house" are FRENCH words, the answer among them.
    back_translations: [bt('maison'), bt('domicile')],
    examples: { house: [HOUSE_EXAMPLE] },
  };
  // The same word looked up the normal way, en→fr.
  const FORWARD: TranslationJoin = {
    id: 't3',
    display_source: 'house',
    translation: 'maison',
    source_lang: 'en',
    target_lang: 'fr',
    pos_tag: 'NOUN',
    prefix_word: 'la',
    alt_translations: [],
    back_translations: [bt('house'), bt('home'), bt('dwelling')],
    examples: {
      maison: [{ sourcePrefix: 'The ', sourceTerm: 'house', sourceSuffix: ' is big.', targetPrefix: 'La ', targetTerm: 'maison', targetSuffix: ' est grande.' }],
    },
  };
  const RECALL = { ...FSRS, stability: 20 };

  it('a learning→native row puts the native word on the front and the learning word as the answer', () => {
    const q = mapQuizItem(CARD, REVERSE, RECALL, 'fr');
    expect(q.mode).toBe('recall');
    expect(q.content.frontWord).toBe('house');
    expect(q.content.backWord).toBe('maison');
  });

  it('matches the normal-direction lookup of the same word', () => {
    const rev = mapQuizItem(CARD, REVERSE, RECALL, 'fr').content;
    const fwd = mapQuizItem(CARD, FORWARD, RECALL, 'fr').content;
    expect(rev.frontWord).toBe(fwd.frontWord);
    expect(rev.backWord).toBe(fwd.backWord);
    expect(rev.frontPrompt).toBe(fwd.frontPrompt);
    expect(rev.backExample).toBe(fwd.backExample);
    expect(rev.backExampleNative).toBe(fwd.backExampleNative);
  });

  it('example sentence: the learning-language line leads, the native line glosses', () => {
    const q = mapQuizItem(CARD, REVERSE, RECALL, 'fr');
    expect(q.content.backExample).toBe('La maison est grande.');
    expect(q.content.backExampleNative).toBe('The house is big.');
  });

  it('the front hint never leaks the answer: native sentence only, never back-translations', () => {
    const q = mapQuizItem(CARD, REVERSE, RECALL, 'fr');
    expect(q.content.frontSub).toBe('“The house is big.”');
    expect(q.content.frontSub).not.toMatch(/maison|domicile/);
    // No cached example → no hint at all, even though back-translations exist.
    const bare = mapQuizItem(CARD, { ...REVERSE, examples: null }, RECALL, 'fr');
    expect(bare.content.frontSub).toBeUndefined();
  });

  it('the normal-direction hint chain is unchanged (back-translations minus the front word)', () => {
    const q = mapQuizItem(CARD, FORWARD, RECALL, 'fr');
    expect(q.content.frontSub).toContain('home');
    expect(q.content.frontSub).toContain('dwelling');
    expect(q.content.frontSub).not.toMatch(/maison/);
  });

  it('custom_back (the sense identity) travels with its side: the front on a reversed row', () => {
    const q = mapQuizItem({ ...CARD, custom_back: 'home' }, REVERSE, RECALL, 'fr');
    expect(q.content.frontWord).toBe('home');
    expect(q.content.backWord).toBe('maison');
  });

  it('Edit Translations: the override replaces the learning-language answer on a reversed row', () => {
    const q = mapQuizItem(CARD, REVERSE, RECALL, 'fr', 'demeure');
    expect(q.content.frontWord).toBe('house');
    expect(q.content.backWord).toBe('demeure');
  });

  it('missing source/target langs fall back to search order (pre-projection rows)', () => {
    const { source_lang: _s, target_lang: _t, ...noLangs } = REVERSE;
    const q = mapQuizItem(CARD, noLangs, RECALL, 'fr');
    expect(q.content.frontWord).toBe('maison');
    expect(q.content.backWord).toBe('house');
  });

  // The two mappers orient independently; they must agree, or the word list and
  // the quiz show the same card the opposite way round.
  it.each([
    ['reverse row', REVERSE],
    ['forward row', FORWARD],
  ])('agrees with mapWordListItem on the %s', (_label, tr) => {
    const q = mapQuizItem(CARD, tr, RECALL, 'fr').content;
    const w = mapWordListItem(CARD, tr, RECALL, null, 'fr');
    expect(q.frontWord).toBe(w.native);
    expect(q.backWord).toBe(w.target);
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

describe('overrideText (PostgREST embed shapes)', () => {
  it('accepts the 1-1 object form, the array form, and absence', () => {
    expect(overrideText({ target_text: 'вода' })).toBe('вода');
    expect(overrideText([{ target_text: 'вода' }])).toBe('вода');
    expect(overrideText([])).toBeNull();
    expect(overrideText(null)).toBeNull();
    expect(overrideText(undefined)).toBeNull();
  });
  it('treats whitespace-only text as no override (the RPC never writes one, but rows predate rules)', () => {
    expect(overrideText({ target_text: '   ' })).toBeNull();
    expect(overrideText({ target_text: '  вода ' })).toBe('вода');
  });
});
