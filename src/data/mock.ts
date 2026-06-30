// Mock DataSource — seeded with real Card + CardFsrsState fixtures per the dev
// scenario, so every home/progress number is DERIVED by `derive.ts` (not hardcoded).
// Swappable for SupabaseDataSource later behind the same interface.
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
};
