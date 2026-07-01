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

export interface DataSource {
  getProfile(): Promise<Profile>;
  getEntitlement(): Promise<Entitlement>;
  getActiveDeck(): Promise<Deck>;
  getDeckCards(): Promise<DeckCards>;
  getEngagement(): Promise<Engagement>;
  /** The due-now study queue, resolved to quiz view-models (capped per session). */
  getDueCards(): Promise<QuizCardItem[]>;
  /** Commit a completed session's buffered ratings (03 batch write). */
  commitQuizSession(payload: { ratings: BufferedRating[] }): Promise<void>;
}
