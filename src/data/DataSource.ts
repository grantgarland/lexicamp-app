// DataSource — the contract the app reads through. One implementation today
// (mock, scenario-driven via the dev store); a SupabaseDataSource will implement
// the same interface later (supabase-js + expo-sqlite cache), with no changes at
// the call sites (query hooks). Methods are param-light: under the free tier there
// is one active deck (03); the source resolves the current user/deck itself.
import type { BufferedRating, QuizCardItem } from '@/domain/quiz';
import type { LookupOutcome, UsageExample } from '@/domain/translation';
import type { Card, CardFsrsState, Deck, Entitlement, NotificationPrefs, Profile, SearchDirection } from '@/domain/types';

export interface DeckCards {
  cards: Card[];
  states: CardFsrsState[];
}

/** Engagement signals not (yet) modeled as their own table in 03 (e.g. streak is
 *  a future study_events derivation / profiles column). Kept behind the source so
 *  screens don't depend on where it comes from. */
export interface Engagement {
  streakDays: number;
}

/** A saved word resolved for the Word List (card ⋈ translations_cache ⋈ fsrs_state).
 *  `native` = the learning-language headword (bold), `target` = its translation. */
export interface WordListItem {
  id: string;
  /** translations_cache row id — keys the lazy examples fetch (16 §3). */
  translationId: string;
  native: string;
  target: string;
  /** Part of speech (noun / verb / adj. …). */
  pos: string;
  /** An example sentence using the word (source-language side). */
  example: string;
  /** The example's translation (target-language side; '' when absent). */
  exampleTranslation: string;
  /** FSRS stability (days) → drives the row's tier indicator. */
  stability: number;
  /** Completed reviews so far. */
  reps: number;
  createdAt: Date;
  /** Next scheduled review. */
  dueAt: Date;
}

/** A custom deck summary for the Word List → Decks tab (Premium). */
export interface DeckSummary {
  id: string;
  name: string;
  wordCount: number;
  /** Times the deck has been studied. */
  reviews: number;
  createdAt: Date;
  /** Last time the deck was studied (null = never). */
  lastReviewedAt: Date | null;
}

/** All-time study signals for the Progress screen (future: derived from study_events). */
export interface ProgressStats {
  sessionsTotal: number;
  avgAccuracy: number; // 0–100
  bestStreak: number; // days
  daysActive: number;
}

/** Buffered onboarding choices → complete_onboarding RPC (03 onboarding flow). */
export interface OnboardingInput {
  nativeLang: string;
  learningLang: string;
  timezone: string;
  displayName?: string | null;
  notificationsEnabled: boolean;
}

export interface DataSource {
  /** Create profile + first deck + notification prefs after auth (idempotent —
   *  safe to call after every successful sign-up OR sign-in; an existing
   *  profile is never overwritten). */
  completeOnboarding(input: OnboardingInput): Promise<void>;
  /** Search-capture lookup (16 §2): Tier-0 gate → cache → dictionary →
   *  fallback. Mock gates + serves fixtures; Supabase calls the translate
   *  Edge Function. Never resolves ungated content. */
  lookup(query: string, direction: SearchDirection): Promise<LookupOutcome>;
  /** Save a gate-approved translation to the active deck (Tier-2: save_card RPC).
   *  The card references the cache row; the primary sense is the card content. */
  saveCard(translationId: string): Promise<void>;
  /** Lazy example sentences for a saved/looked-up translation (16 §3). */
  getExamples(translationId: string): Promise<UsageExample[]>;
  getProfile(): Promise<Profile>;
  getEntitlement(): Promise<Entitlement>;
  getActiveDeck(): Promise<Deck>;
  getDeckCards(): Promise<DeckCards>;
  getEngagement(): Promise<Engagement>;
  /** All-time study stats for the Progress screen. */
  getProgressStats(): Promise<ProgressStats>;
  /** Custom decks (Premium feature). */
  getDecks(): Promise<DeckSummary[]>;
  /** The user's saved words for the Word List (newest first). */
  getWords(): Promise<WordListItem[]>;
  /** The due-now study queue, resolved to quiz view-models (capped per session). */
  getDueCards(): Promise<QuizCardItem[]>;
  /** Commit a completed session's buffered ratings (03 batch write). */
  commitQuizSession(payload: { ratings: BufferedRating[] }): Promise<void>;
  /** Notification prefs (2.5) — read + partial update. */
  getNotificationPrefs(): Promise<NotificationPrefs>;
  updateNotificationPrefs(prefs: Partial<NotificationPrefs>): Promise<void>;
  /** Register this device's Expo push token (called once expo-notifications
   *  lands app-side; the server scheduler no-ops for users without tokens). */
  registerPushToken(token: string, platform: 'ios' | 'android'): Promise<void>;
}
