// Mock DataSource — seeded with real Card + CardFsrsState fixtures per the dev
// scenario, so every home/progress number is DERIVED by `derive.ts` (not hardcoded).
// Swappable for SupabaseDataSource later behind the same interface.
import type { BufferedRating, QuizCardItem } from '@/domain/quiz';
import type { Card, CardFsrsState, Deck, Entitlement, Profile } from '@/domain/types';
import { type DevPlan, type DevUserState, useDevStore } from '@/store/devStore';

import type { DataSource, DeckCards, Engagement } from './DataSource';

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
const QUIZ_SESSION: QuizCardItem[] = [
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

const scenario = () => useDevStore.getState();

export const mockDataSource: DataSource = {
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
  async getDueCards(): Promise<QuizCardItem[]> {
    return QUIZ_SESSION;
  },
  async commitQuizSession(_payload: { ratings: BufferedRating[] }): Promise<void> {
    // TODO(P4 data): batch-write per 03 (update card_fsrs_state via ts-fsrs, append
    // review_logs, write quiz_completed event) — Supabase + ts-fsrs. No-op in mock.
  },
};
