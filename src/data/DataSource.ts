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
 *  `target` = its translation headword (bold), `native` = the learner's nativelanguage,  */
export interface WordListItem {
  id: string;
  /** translations_cache row id — keys the lazy examples fetch (16 §3). */
  translationId: string;
  /** Normalized target term of THIS card's sense — the examples-map key /
   *  `targetTerm` for the lazy fetch (per-sense examples, 2026-07-17). */
  senseTarget: string;
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
  /** Archived (cards.suspended, 18 §E3): kept forever, excluded from reviews. */
  suspended: boolean;
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

/** 20 §3.1: the read-only Account block in Edit Profile. `provider` is the
 *  auth path the account was created with — immutable, honest-UI displayed. */
export interface AccountIdentity {
  email: string | null;
  provider: 'apple' | 'google' | 'email';
}

/** 20 §3.3 v2 (R5): tokens `setUsername` rejects with (Error.message).
 *  `username_taken` = the drafted name was claimed between cycle and save;
 *  `username_change_limit` = free tier's single change already spent;
 *  `rate_limited` = 20 saves/day cap; `username_invalid` = name does not
 *  decompose into official-list words (impossible via the cycle UI). */
export type UsernameSaveError = 'username_taken' | 'username_invalid' | 'username_change_limit' | 'rate_limited';

/** 20 §4: one row of `get_leaderboard` — a (user, learning-language) pair
 *  ranked by mastered-word count. Pseudonymous only: username + language +
 *  count, never email/displayName/ids. `isSelf` flags the caller's own
 *  row(s) — the server includes these even outside the fetched top-N
 *  (own-row pinning, 4.3), so a UI can render a "you" row at the bottom. */
export interface LeaderboardEntry {
  rank: number;
  username: string;
  langCode: string;
  mastered: number;
  isSelf: boolean;
}

/** Buffered onboarding choices → complete_onboarding RPC (03 onboarding flow). */
export interface OnboardingInput {
  nativeLang: string;
  targetLang: string;
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
   *  The card references the cache row; the primary sense is the default card
   *  content, overridable via `custom` when the user saved a NON-primary sense
   *  (A12c — the card then renders custom_front/custom_back). Resolves the new
   *  card id (null in mock mode) so the capture flow can delete without waiting
   *  for a words refetch. */
  saveCard(translationId: string, custom?: { front?: string; back?: string }): Promise<string | null>;
  /** Delete a saved card (delete_card RPC — cascades FSRS state + logs the
   *  analytics event; A12b). Destructive: study history goes with it. */
  deleteCard(cardId: string): Promise<void>;
  /** Lazy example sentences for a saved/looked-up translation (16 §3).
   *  `targetTerm` = the sense's normalized target (per-sense examples,
   *  2026-07-17); omitted → the primary sense. */
  getExamples(translationId: string, targetTerm?: string): Promise<UsageExample[]>;
  getProfile(): Promise<Profile>;
  getEntitlement(): Promise<Entitlement>;
  /** `lang` = the caller's ACTIVE language (query-key value). Passing it explicitly
   *  removes the read-your-write race after a language switch — the server
   *  profile may not have committed yet when the new key's query fires. */
  getActiveDeck(lang?: string): Promise<Deck>;
  getDeckCards(lang?: string): Promise<DeckCards>;
  getEngagement(): Promise<Engagement>;
  /** All-time study stats for the Progress screen. */
  getProgressStats(): Promise<ProgressStats>;
  /** Custom decks (Premium feature). */
  getDecks(lang?: string): Promise<DeckSummary[]>;
  /** The user's saved words for the Word List (newest first). */
  getWords(lang?: string): Promise<WordListItem[]>;
  /** The study-session queue (18 §2c): everything due now (dueAt asc — oldest
   *  overdue first), FILLED with the next-due upcoming cards when the due count
   *  is under `limit`, so a session always uses the user's full quiz length
   *  while words exist. Returns fewer only when the deck itself is smaller. */
  getDueCards(limit: number, lang?: string): Promise<QuizCardItem[]>;
  /** Commit a completed session's buffered ratings (03 batch write). */
  commitQuizSession(payload: { ratings: BufferedRating[] }): Promise<void>;
  /** Notification prefs (2.5) — read + partial update. */
  getNotificationPrefs(): Promise<NotificationPrefs>;
  updateNotificationPrefs(prefs: Partial<NotificationPrefs>): Promise<void>;
  /** Register this device's Expo push token (called once expo-notifications
   *  lands app-side; the server scheduler no-ops for users without tokens). */
  registerPushToken(token: string, platform: 'ios' | 'android'): Promise<void>;
  // ── Phase D: multi-language (18 §2a) ──────────────────────────────────────
  /** Enrolled learning languages, oldest first. Free = 1; premium ≤ 5. */
  getLearningLanguages(): Promise<string[]>;
  /** Enroll + switch to a language (server gates: premium past the first, cap 5
   *  ACTIVE languages, idempotent re-add = switch; seeds the language's deck).
   *  Re-adding an ARCHIVED language restores it FREE of the premium gate
   *  (2026-07-21 ruling — a remove must never become a premium trap). */
  addLearningLanguage(lang: string): Promise<void>;
  /** Switch the active language (active-enrolled only; seeds the deck if missing). */
  switchLearningLanguage(lang: string): Promise<void>;
  /** ARCHIVE a non-active language (2026-07-21): the enrollment is flagged, not
   *  deleted — cards/decks/history all stay; addLearningLanguage restores. */
  removeLearningLanguage(lang: string): Promise<void>;
  /** Update editable profile fields (D6 / UX-17e). (displayName retired from
   *  UI per 20 §8 R1 — still accepted for the onboarding path.) */
  updateProfile(patch: { displayName?: string; quizLength?: number }): Promise<void>;
  // ── 20 §3 v2: username identity (cycle locally / save once) ──────────────
  /** Who am I signed in as (email + auth provider) — read-only Account block. */
  getAccountIdentity(): Promise<AccountIdentity>;
  /** Claim a CYCLED name (set_username v2 RPC — the ONLY username write).
   *  Candidates come from `domain/username.generateUsernameCandidate` (local,
   *  draft-only); the server re-validates that the name decomposes into
   *  official-list words, enforces the free tier's single lifetime change and
   *  the 20/day cap, and settles taken-races under the unique index. Resolves
   *  the saved canonical name; rejects with Error(UsernameSaveError). */
  setUsername(name: string): Promise<string>;
  // ── 20 §4: leaderboard ────────────────────────────────────────────────────
  /** `get_leaderboard` RPC. `scope` 'global' ranks every enrolled-language
   *  entry together; 'language' scopes to `lang` (the caller's ACTIVE learning
   *  language — required then). Returns the top `limit` (default 100) ordered
   *  by rank ascending, PLUS the caller's own row(s) even outside that window
   *  (own-row pinning). Zero-mastered entries are never included (4.3). */
  getLeaderboard(scope: 'global' | 'language', lang?: string, limit?: number): Promise<LeaderboardEntry[]>;
  /** 3.4 app-side analytics emits (paywall_viewed, onboarding/walkthrough
   *  funnel). Fire-and-forget; implementations must never throw into UI paths.
   *  Event names are allowlisted in the implementation — server-written events
   *  (word_saved, quiz_completed…) stay server-only. */
  logEvent(event: string, props?: Record<string, unknown>): Promise<void>;
  /** Archive / unarchive a card (18 §E3). Suspended cards keep everything but
   *  leave the review queue; unarchive restores them untouched. */
  setCardSuspended(cardId: string, suspended: boolean): Promise<void>;
}
