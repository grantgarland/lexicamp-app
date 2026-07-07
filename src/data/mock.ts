// Mock DataSource — seeded with real Card + CardFsrsState fixtures per the dev
// scenario, so every home/progress number is DERIVED by `derive.ts` (not hardcoded).
// Swappable for SupabaseDataSource later behind the same interface.
import { evaluateCaptureInput } from '@/domain/capture';
import { directionLangs } from '@/domain/derive';
import type { BufferedRating, QuizCardItem } from '@/domain/quiz';
import { assessResultQuality, type DictionarySense, type LookupOutcome, type LookupResult } from '@/domain/translation';
import type { Card, CardFsrsState, Deck, Entitlement, NotificationPrefs, Profile, SearchDirection } from '@/domain/types';
import { type DevPlan, type DevUserState, useDevStore } from '@/store/devStore';

import type { DataSource, DeckCards, DeckSummary, Engagement, ProgressStats, WordListItem } from './DataSource';

const USER_ID = 'dev-user';
const DECK_ID = 'dev-deck';

const PROFILE: Profile = {
  id: USER_ID,
  displayName: 'Casey',
  nativeLang: 'en',
  learningLang: 'es',
  timezone: 'America/New_York',
  onboardingComplete: true,
};

const DECK: Deck = { id: DECK_ID, userId: USER_ID, name: 'Spanish', sourceLang: 'en', targetLang: 'es' };

// reps>0 word counts per tier, registry order [bc, abc, hc, sr, summit].
const DISTRIBUTION: Record<DevUserState, number[]> = {
  empty: [0, 0, 0, 0, 0],
  bc: [12, 0, 0, 0, 0],
  abc: [20, 18, 0, 0, 0],
  hc: [10, 20, 12, 0, 0],
  sr: [10, 20, 12, 8, 0],
  summit: [10, 20, 12, 5, 13],
};
// A representative stability (days) inside each tier's band.
const TIER_STABILITY = [1.5, 5, 10, 20, 45];
const STREAK: Record<DevUserState, number> = { empty: 1, bc: 3, abc: 7, hc: 10, sr: 12, summit: 14 };

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function buildDeckCards(userState: DevUserState): DeckCards {
  const cards: Card[] = [];
  const states: CardFsrsState[] = [];
  const dist = DISTRIBUTION[userState];
  const now = Date.now();
  let g = 0; // global index, spreads due/created dates deterministically

  dist.forEach((count, tierIdx) => {
    for (let j = 0; j < count; j += 1, g += 1) {
      const id = `c${tierIdx}_${j}`;
      // due spread → realistic Need-Recall (today + backlog) / Due-tomorrow counts
      const dueAt =
        g % 4 === 0 ? new Date(now - 2 * HOUR) // overdue today
        : g % 4 === 1 ? new Date(now - 3 * DAY) // overdue backlog
        : g % 4 === 2 ? new Date(now + 6 * HOUR) // due in next 24h
        : new Date(now + 5 * DAY); // future
      const createdAt = g % 6 === 0 ? new Date(now - 1 * HOUR) : new Date(now - (g + 2) * DAY);

      cards.push({
        id,
        deckId: DECK_ID,
        userId: USER_ID,
        translationId: `t_${id}`,
        userNote: null,
        customFront: null,
        customBack: null,
        suspended: false,
        createdAt,
      });
      states.push({
        cardId: id,
        userId: USER_ID,
        stability: TIER_STABILITY[tierIdx],
        difficulty: 5,
        dueAt,
        lastReviewAt: new Date(now - 1 * DAY),
        state: 2, // review
        reps: 3,
        lapses: 0,
        learningSteps: 0,
      });
    }
  });

  return { cards, states };
}

function entitlementFor(plan: DevPlan): Entitlement {
  return plan === 'paid'
    ? { status: 'active', plan: 'monthly', platform: 'ios', currentPeriodEnd: new Date(Date.now() + 30 * DAY) }
    : { status: 'free', plan: null, platform: null, currentPeriodEnd: null };
}

// Mock study queue — a session of due cards with display content + tier + mode.
// (mode: lower tiers = recognition / tap-to-reveal; higher = recall / char input.)
// `fsrs` scheduling state is synthesized per tier at getDueCards() time.
const QUIZ_SESSION: Omit<QuizCardItem, 'fsrs'>[] = [
  { id: 'q_melancolico', tierId: 'bc', mode: 'recognition', content: { frontWord: 'melancólico', frontSub: '/me.laŋˈko.li.ko/', frontPrompt: "What's the translation?", backWord: 'melancholic', backPhonetic: '/ˌmɛl.ənˈkɒl.ɪk/', backPos: 'adjective', backExample: 'A melancholic melody filled the room.' } },
  { id: 'q_ephemeral', tierId: 'abc', mode: 'recognition', content: { frontWord: 'ephemeral', frontSub: '/ɪˈfɛm.ər.əl/', frontPrompt: 'What is the translation?', backWord: 'efímero', backPhonetic: '/eˈfi.me.ɾo/', backPos: 'adjective', backExample: 'La belleza de las flores es efímera.' } },
  { id: 'q_nostalgia', tierId: 'bc', mode: 'recognition', content: { frontWord: 'nostalgia', frontSub: '/nos.ˈtal.xja/', frontPrompt: "What's the translation?", backWord: 'nostalgia', backPhonetic: '/nɒˈstæl.dʒə/', backPos: 'noun', backExample: 'A wave of nostalgia washed over her.' } },
  { id: 'q_grateful', tierId: 'hc', mode: 'recall', content: { frontWord: 'grateful', frontSub: 'Feeling or showing thanks.', frontPrompt: 'Recall the Spanish word.', backWord: 'agradecido', backPhonetic: '/a.ɣɾa.ðeˈθi.ðo/', backPos: 'adjective', backExample: 'Estoy muy agradecido por tu ayuda.' } },
  { id: 'q_serendipity', tierId: 'sr', mode: 'recall', content: { frontWord: 'serendipity', frontSub: 'A fortunate chance discovery.', frontPrompt: 'Recall the Spanish word.', backWord: 'serendipia', backPhonetic: '/se.ɾen.ˈdi.pja/', backPos: 'noun', backExample: 'Fue pura serendipia que nos encontráramos.' } },
  { id: 'q_courage', tierId: 'summit', mode: 'recall', content: { frontWord: 'courage', frontSub: 'Bravery in the face of fear.', frontPrompt: 'Recall the Spanish word.', backWord: 'coraje', backPhonetic: '/koˈɾa.xe/', backPos: 'noun', backExample: 'Enfrentó el reto con coraje.' } },
  // Long + multi-word recall test: RU "speed bump" is literally "lying policeman".
  // Verifies horizontal scroll + edge fade + focus traversal + spaces (multi-word).
  { id: 'q_speedbump', tierId: 'summit', mode: 'recall', content: { frontWord: 'speed bump / hump', frontSub: 'A raised ridge in a road to slow traffic.', frontPrompt: 'Recall the Russian phrase.', backWord: 'лежачий полицейский', backPhonetic: '/lʲɪˈʐatɕɪj pəlʲɪˈtsɛjskʲɪj/', backPos: 'noun', backExample: 'Впереди лежачий полицейский — сбавь скорость.' } },
];

// A pool of real ES(native/headword) → EN(target) pairs. Sized to cover the largest
// scenario (summit = 60 words) so no display duplicates. Stands in for translations_cache.
const WORD_BANK: { native: string; target: string }[] = [
  { native: 'melancólico', target: 'melancholic' }, { native: 'efímero', target: 'ephemeral' },
  { native: 'nostalgia', target: 'nostalgia' }, { native: 'serendipia', target: 'serendipity' },
  { native: 'agradecido', target: 'grateful' }, { native: 'felicidad', target: 'happiness' },
  { native: 'libertad', target: 'freedom' }, { native: 'sueño', target: 'dream' },
  { native: 'esperanza', target: 'hope' }, { native: 'sabiduría', target: 'wisdom' },
  { native: 'amistad', target: 'friendship' }, { native: 'valentía', target: 'bravery' },
  { native: 'tristeza', target: 'sadness' }, { native: 'alegría', target: 'joy' },
  { native: 'recuerdo', target: 'memory' }, { native: 'paisaje', target: 'landscape' },
  { native: 'amanecer', target: 'dawn' }, { native: 'atardecer', target: 'dusk' },
  { native: 'estrella', target: 'star' }, { native: 'montaña', target: 'mountain' },
  { native: 'río', target: 'river' }, { native: 'bosque', target: 'forest' },
  { native: 'océano', target: 'ocean' }, { native: 'desierto', target: 'desert' },
  { native: 'tormenta', target: 'storm' }, { native: 'lluvia', target: 'rain' },
  { native: 'nieve', target: 'snow' }, { native: 'viento', target: 'wind' },
  { native: 'fuego', target: 'fire' }, { native: 'tierra', target: 'earth' },
  { native: 'cielo', target: 'sky' }, { native: 'corazón', target: 'heart' },
  { native: 'alma', target: 'soul' }, { native: 'mente', target: 'mind' },
  { native: 'fuerza', target: 'strength' }, { native: 'paciencia', target: 'patience' },
  { native: 'gratitud', target: 'gratitude' }, { native: 'humildad', target: 'humility' },
  { native: 'orgullo', target: 'pride' }, { native: 'destino', target: 'destiny' },
  { native: 'camino', target: 'path' }, { native: 'viaje', target: 'journey' },
  { native: 'aventura', target: 'adventure' }, { native: 'misterio', target: 'mystery' },
  { native: 'silencio', target: 'silence' }, { native: 'susurro', target: 'whisper' },
  { native: 'eco', target: 'echo' }, { native: 'sombra', target: 'shadow' },
  { native: 'reflejo', target: 'reflection' }, { native: 'destello', target: 'sparkle' },
  { native: 'anhelo', target: 'longing' }, { native: 'consuelo', target: 'comfort' },
  { native: 'asombro', target: 'awe' }, { native: 'certeza', target: 'certainty' },
  { native: 'duda', target: 'doubt' }, { native: 'verdad', target: 'truth' },
  { native: 'promesa', target: 'promise' }, { native: 'secreto', target: 'secret' },
  { native: 'tesoro', target: 'treasure' }, { native: 'anochecer', target: 'nightfall' },
];

const POS_POOL = ['noun', 'adj.', 'verb', 'adv.'];
// Parallel source/target example frames (source = ES sentence, target = its EN
// translation) so W-03 can show the pair like the search card does.
const EXAMPLE_FRAMES: { source: (w: string) => string; target: (w: string) => string }[] = [
  { source: (w) => `Uso «${w}» casi todos los días.`, target: (w) => `I use "${w}" almost every day.` },
  { source: (w) => `Esa palabra, «${w}», es muy útil.`, target: (w) => `That word, "${w}", is very useful.` },
  { source: (w) => `Aprendí «${w}» en mi última sesión.`, target: (w) => `I learned "${w}" in my last session.` },
  { source: (w) => `«${w}» apareció en la lectura de hoy.`, target: (w) => `"${w}" came up in today's reading.` },
];

// Word List fixtures — same per-tier distribution as the deck (so "My Words" count
// matches Home's wordsSaved), with real display text + derived metadata. Newest first.
function buildWords(userState: DevUserState): WordListItem[] {
  const dist = DISTRIBUTION[userState];
  const now = Date.now();
  const out: WordListItem[] = [];
  let g = 0;
  dist.forEach((count, tierIdx) => {
    for (let j = 0; j < count; j += 1, g += 1) {
      const w = WORD_BANK[g % WORD_BANK.length];
      const createdAt = g % 6 === 0 ? new Date(now - 1 * HOUR) : new Date(now - (g + 2) * DAY);
      const dueAt =
        g % 4 === 0 ? new Date(now - 2 * HOUR)
        : g % 4 === 1 ? new Date(now - 3 * DAY)
        : g % 4 === 2 ? new Date(now + 6 * HOUR)
        : new Date(now + 5 * DAY);
      out.push({
        id: `w${tierIdx}_${j}`,
        translationId: `mock-t:${w.native}`,
        native: w.native,
        target: w.target,
        pos: POS_POOL[g % POS_POOL.length],
        example: EXAMPLE_FRAMES[g % EXAMPLE_FRAMES.length].source(w.native),
        exampleTranslation: EXAMPLE_FRAMES[g % EXAMPLE_FRAMES.length].target(w.target),
        stability: TIER_STABILITY[tierIdx],
        reps: 2 + (g % 9),
        createdAt,
        dueAt,
      });
    }
  });
  return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

// All-time study stats per scenario (mock; real values derive from study_events later).
const PROGRESS_STATS: Record<DevUserState, ProgressStats> = {
  empty: { sessionsTotal: 0, avgAccuracy: 0, bestStreak: 0, daysActive: 0 },
  bc: { sessionsTotal: 4, avgAccuracy: 71, bestStreak: 3, daysActive: 4 },
  abc: { sessionsTotal: 12, avgAccuracy: 76, bestStreak: 7, daysActive: 10 },
  hc: { sessionsTotal: 24, avgAccuracy: 80, bestStreak: 10, daysActive: 18 },
  sr: { sessionsTotal: 33, avgAccuracy: 82, bestStreak: 12, daysActive: 24 },
  summit: { sessionsTotal: 42, avgAccuracy: 85, bestStreak: 14, daysActive: 30 },
};

// Custom decks (Premium). Static fixtures; word membership is not modeled in the mock.
const DECKS: DeckSummary[] = [
  { id: 'd_travel', name: 'Travel', wordCount: 12, reviews: 9, createdAt: new Date(Date.now() - 24 * DAY), lastReviewedAt: new Date(Date.now() - 2 * DAY) },
  { id: 'd_business', name: 'Business', wordCount: 8, reviews: 5, createdAt: new Date(Date.now() - 12 * DAY), lastReviewedAt: new Date(Date.now() - 5 * HOUR) },
  { id: 'd_favorites', name: 'Favorites', wordCount: 5, reviews: 3, createdAt: new Date(Date.now() - 4 * DAY), lastReviewedAt: null },
];

// ── Mock dictionary (Azure dictionary/lookup-shaped, per 16 §1) ───────────────
// 'fly' senses mirror the real Azure documentation example; the generic path
// fabricates a single dictionary-shaped sense from WORD_BANK so every gate-
// passing query resolves (the real source returns not_found on dictionary+
// fallback miss — exercised via the reserved MISS token below).
const MOCK_MISS = 'fly123456'; // Azure's own docs miss-example
// Reserved token that resolves to an identity-echo (target === source) so dev/tests
// can exercise the unsaveable card path (16 §2 result-quality gate).
const MOCK_ECHO = 'echoword';
const FLY_SENSES: DictionarySense[] = [
  {
    normalizedTarget: 'volar',
    displayTarget: 'volar',
    posTag: 'VERB',
    confidence: 0.4081,
    prefixWord: '',
    backTranslations: [
      { normalizedText: 'fly', displayText: 'fly', numExamples: 15, frequencyCount: 4637 },
      { normalizedText: 'flying', displayText: 'flying', numExamples: 15, frequencyCount: 1365 },
    ],
  },
  {
    normalizedTarget: 'mosca',
    displayTarget: 'mosca',
    posTag: 'NOUN',
    confidence: 0.2668,
    prefixWord: 'la',
    backTranslations: [{ normalizedText: 'fly', displayText: 'fly', numExamples: 15, frequencyCount: 1697 }],
  },
];

function mockLookupResult(query: string, direction: SearchDirection): LookupOutcome {
  // Gate against the ACTUAL source language for this direction (real Edge Function
  // does the same) so the mock exercises script-consistency too — not hardcoded 'en'.
  const { sourceCode, targetCode } = directionLangs(PROFILE, direction);
  const verdict = evaluateCaptureInput(query, sourceCode);
  if (!verdict.ok) return { status: 'rejected', reason: verdict.reason };
  if (verdict.normalized === MOCK_MISS) return { status: 'not_found' };

  const isPhrase = verdict.normalized.includes(' ');

  let senses: DictionarySense[];
  if (verdict.normalized === MOCK_ECHO) {
    // Identity-echo: target === source (untranslated pass-through) → unsaveable card.
    senses = [
      {
        normalizedTarget: verdict.normalized,
        displayTarget: verdict.display,
        posTag: 'OTHER',
        confidence: 0.2,
        prefixWord: '',
        backTranslations: [],
      },
    ];
  } else if (verdict.normalized === 'fly') {
    senses = FLY_SENSES;
  } else {
    const hit =
      WORD_BANK.find((w) => w.native === verdict.normalized) ??
      WORD_BANK.find((w) => w.target === verdict.normalized);
    const target = hit ? (hit.native === verdict.normalized ? hit.target : hit.native) : `${verdict.normalized}·es`;
    senses = [
      {
        normalizedTarget: target,
        displayTarget: target,
        posTag: isPhrase ? 'OTHER' : 'NOUN',
        confidence: hit ? 0.7 : 0.35,
        prefixWord: '',
        backTranslations: [
          { normalizedText: verdict.normalized, displayText: verdict.display, numExamples: hit ? 5 : 0, frequencyCount: 100 },
        ],
      },
    ];
  }

  const result: LookupResult = {
    translationId: `mock-t:${verdict.normalized}`,
    normalizedSource: verdict.normalized,
    displaySource: verdict.display,
    sourceLang: sourceCode,
    targetLang: targetCode,
    senses,
    entryKind: isPhrase ? 'phrase' : 'word',
    provider: 'azure_dictionary',
    // Same result-quality rule the Edge Function applies server-side.
    ...assessResultQuality({ normalizedSource: verdict.normalized, senses }),
  };
  return { status: 'found', result };
}

const scenario = () => useDevStore.getState();

// In-memory notification prefs (03 onboarding defaults).
const mockPrefs: NotificationPrefs = { enabled: true, frequency: 'daily', windows: [{ time: '19:00' }], minDueToNotify: 1 };

export const mockDataSource: DataSource = {
  async completeOnboarding(_input) {
    // Mock profile ships onboardingComplete=true; nothing to persist.
  },
  async lookup(query, direction) {
    return mockLookupResult(query, direction);
  },
  async saveCard(_translationId) {
    // Mock: screens keep their own optimistic saved-state; nothing to persist.
  },
  async getExamples(translationId) {
    // One canned example so W-03/detail UIs have something to render.
    return translationId === 'mock-t:fly'
      ? [
          {
            sourcePrefix: 'I mean, for a guy who could ',
            sourceTerm: 'fly',
            sourceSuffix: '.',
            targetPrefix: 'Quiero decir, para un tipo que podía ',
            targetTerm: 'volar',
            targetSuffix: '.',
          },
        ]
      : [];
  },
  async getProfile() {
    return PROFILE;
  },
  async getEntitlement() {
    return entitlementFor(scenario().plan);
  },
  async getActiveDeck() {
    return DECK;
  },
  async getDeckCards() {
    return buildDeckCards(scenario().userState);
  },
  async getEngagement(): Promise<Engagement> {
    return { streakDays: STREAK[scenario().userState] };
  },
  async getProgressStats(): Promise<ProgressStats> {
    return PROGRESS_STATS[scenario().userState];
  },
  async getDecks(): Promise<DeckSummary[]> {
    // New user (empty scenario) has no decks yet → decks-tab empty state.
    return scenario().userState === 'empty' ? [] : DECKS;
  },
  async getWords(): Promise<WordListItem[]> {
    return buildWords(scenario().userState);
  },
  async getDueCards(): Promise<QuizCardItem[]> {
    // Synthesize a due, in-band scheduling state per item so the results screen
    // can compute real FSRS tier transitions (domain/fsrs.tierTransition).
    const tierIdxOf: Record<string, number> = { bc: 0, abc: 1, hc: 2, sr: 3, summit: 4 };
    const now = Date.now();
    return QUIZ_SESSION.map((q) => ({
      ...q,
      fsrs: {
        cardId: q.id,
        userId: USER_ID,
        stability: TIER_STABILITY[tierIdxOf[q.tierId] ?? 0],
        difficulty: 5,
        dueAt: new Date(now - 2 * HOUR),
        lastReviewAt: new Date(now - Math.round(TIER_STABILITY[tierIdxOf[q.tierId] ?? 0] * DAY)),
        state: 2,
        reps: 3,
        lapses: 0,
        learningSteps: 0,
      },
    }));
  },
  async getNotificationPrefs(): Promise<NotificationPrefs> {
    return { ...mockPrefs };
  },
  async updateNotificationPrefs(prefs) {
    Object.assign(mockPrefs, prefs);
  },
  async registerPushToken(_token, _platform) {
    // Mock: nothing to register.
  },
  async commitQuizSession(_payload: { ratings: BufferedRating[] }): Promise<void> {
    // TODO(P4 data): batch-write per 03 (update card_fsrs_state via ts-fsrs, append
    // review_logs, write quiz_completed event) — Supabase + ts-fsrs. No-op in mock.
  },
};
