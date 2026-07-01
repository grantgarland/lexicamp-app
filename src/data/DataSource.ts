// DataSource — the contract the app reads through. One implementation today
// (mock, scenario-driven via the dev store); a SupabaseDataSource will implement
// the same interface later (supabase-js + expo-sqlite cache), with no changes at
// the call sites (query hooks). Methods are param-light: under the free tier there
// is one active deck (03); the source resolves the current user/deck itself.
import type { BufferedRating, QuizCardItem } from '@/domain/quiz';
import type { Card, CardFsrsState, Deck, Entitlement, Profile } from '@/domain/types';

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
  native: string;
  target: string;
  /** Part of speech (noun / verb / adj. …). */
  pos: string;
  /** An example sentence using the word. */
  example: string;
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
}

/** All-time study signals for the Progress screen (future: derived from study_events). */
export interface ProgressStats {
  sessionsTotal: number;
  avgAccuracy: number; // 0–100
  bestStreak: number; // days
  daysActive: number;
}

export interface DataSource {
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
}
