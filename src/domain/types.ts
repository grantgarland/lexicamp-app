// Domain types — the app's data contracts, mirroring 03-data-model.md (DB is
// snake_case; domain is camelCase, timestamps as Date). These are the shapes every
// screen + store consumes; the data SOURCE is swappable (mock now → Supabase later),
// but these contracts do not change. Derived display values live in `derive.ts`.
import type { TierId } from '@/theme/tiers';

export type LanguageCode = string; // BCP-47 / ISO, e.g. 'es' | 'en'
export type SearchDirection = 'native_to_target' | 'target_to_native';

/** profiles */
export interface Profile {
  id: string;
  displayName: string | null;
  nativeLang: LanguageCode;
  learningLang: LanguageCode;
  timezone: string;
  onboardingComplete: boolean;
}

/** subscriptions (mirror of RevenueCat) */
export type EntitlementStatus = 'free' | 'trial' | 'active' | 'expired' | 'grace';
export type SubscriptionPlan = 'monthly' | 'annual' | null;
export interface Entitlement {
  status: EntitlementStatus;
  plan: SubscriptionPlan;
  platform: 'ios' | 'android' | null;
  currentPeriodEnd: Date | null;
}
/** Premium features unlocked? (trial/active/grace count as paid.) */
export const isPaid = (e: Entitlement): boolean =>
  e.status === 'trial' || e.status === 'active' || e.status === 'grace';

/** decks */
export interface Deck {
  id: string;
  userId: string;
  name: string;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
}

/** translations_cache (GLOBAL shared content) */
export interface TranslationContent {
  id: string;
  sourceText: string;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  translation: string;
  partOfSpeech: string | null;
  metadata: Record<string, unknown> | null;
  enriched: boolean;
}

/** cards */
export interface Card {
  id: string;
  deckId: string;
  userId: string;
  translationId: string;
  userNote: string | null;
  customFront: string | null;
  customBack: string | null;
  suspended: boolean;
  createdAt: Date;
}

/** card_fsrs_state — 0 new · 1 learning · 2 review · 3 relearning */
export type FsrsStateValue = 0 | 1 | 2 | 3;
export interface CardFsrsState {
  cardId: string;
  userId: string;
  stability: number;
  difficulty: number;
  dueAt: Date;
  lastReviewAt: Date | null;
  state: FsrsStateValue;
  reps: number;
  lapses: number;
  /** ts-fsrs v5 learning-step position (0 outside learning/relearning). Needed
   *  to resume in-learning cards faithfully across sessions. */
  learningSteps: number;
}

/** review_logs — rating: 1 again · 2 hard · 3 good · 4 easy */
export type Rating = 1 | 2 | 3 | 4;
export interface ReviewLog {
  id: string;
  cardId: string;
  userId: string;
  rating: Rating;
  reviewedAt: Date;
  elapsedDays: number;
  scheduledDays: number;
  stateBefore: FsrsStateValue;
}

/** notification_prefs (03) — drives the push/quiz scheduler. */
export interface NotificationPrefs {
  enabled: boolean;
  frequency: 'daily' | 'twice_daily' | 'custom';
  /** e.g. [{ time: '19:00' }] — local times in the user's profile timezone. */
  windows: { time: string }[];
  minDueToNotify: number;
}

// ── Derived (not stored) ─────────────────────────────────────────────────────
export type WordLifecycle = 'unseen' | 'in_flight' | 'mastered';
/** Per-word mastery tier id (= the registry TierId). */
export type WordTierId = TierId;
