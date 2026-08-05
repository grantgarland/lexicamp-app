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
  /** translations_cache.provider. `azure_mt` (phrase_mt) entries can NEVER carry
   *  example sentences — supabase/functions/examples returns [] for them by
   *  contract (16 §3 forbids MT-generated examples) — so the UI hides the
   *  "Show example sentence" affordance rather than offering a dead end. */
  provider: 'azure_dictionary' | 'azure_mt';
  /** FSRS stability (days) → drives the row's tier indicator. */
  stability: number;
  /** Completed reviews so far. */
  reps: number;
  createdAt: Date;
  /** Next scheduled review. */
  dueAt: Date;
  /** Archived (cards.suspended, 18 §E3): kept forever, excluded from reviews. */
  suspended: boolean;
  /** Edit Translations (Premium, 2026-07-28): the user's own rendering of the
   *  target text (`card_target_overrides.target_text`), or null when untouched.
   *  `target` above is ALREADY resolved (override ?? original) — this exists so
   *  the edit sheet can show "edited" state and offer a reset. */
  targetOverride: string | null;
  /** The target text BEFORE any user override — the sense/cache value that
   *  "Reset to original" restores. Equals `target` when there is no override. */
  originalTarget: string;
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
  daysActive: number; // distinct local days with at least one review
  /** Individual card reviews all-time — NOT sessions. */
  reviewsTotal: number;
  /** Total study time — the sum of RECORDED session durations, never inferred
   *  (2026-08-05). Sessions predating duration recording contribute nothing, so
   *  0 means "we have no timing", not "no time spent": the UI shows an em dash
   *  rather than a zero. */
  timeInvestedMs: number;
}

/** 20 §3.1: the read-only Account block in Edit Profile. `provider` is the
 *  auth path the account was created with — immutable, honest-UI displayed.
 *  No 'google' variant: Google sign-in will not be supported (product
 *  decision 2026-07-27). */
export interface AccountIdentity {
  email: string | null;
  provider: 'apple' | 'email';
}

/** 20 §3.3 v2 (R5): tokens `setUsername` rejects with (Error.message).
 *  `username_taken` = the drafted name was claimed between cycle and save;
 *  `username_change_limit` = free tier's single change already spent;
 *  `rate_limited` = 20 saves/day cap; `username_invalid` = name does not
 *  decompose into official-list words (impossible via the cycle UI). */
/** Tokens the deck-membership RPCs reject with (Error.message), 2026-07-30.
 *  `premium_required` = custom decks are a Premium feature (server-enforced;
 *  the UI gates first); `deck_name_taken` = you already have a deck with this
 *  name IN THIS LANGUAGE; `deck_name_invalid` = empty or >40 chars after
 *  normalisation; `deck_cap_reached` = 50 custom decks per language;
 *  `main_deck_undeletable` = the hidden per-language deck can't be deleted or
 *  written to (its cascade would take every card in the language). */
export type DeckWriteError = 'premium_required' | 'deck_name_taken' | 'deck_name_invalid' | 'deck_cap_reached' | 'main_deck_undeletable' | 'language_not_enrolled';

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
  /** All-time study signals, scoped to one learning language (2026-08-05).
   *  Omitting `lang` returns the whole account. */
  getProgressStats(lang?: string): Promise<ProgressStats>;
  /** Custom decks (Premium feature). */
  getDecks(lang?: string): Promise<DeckSummary[]>;
  /** Words in ONE custom deck (newest first), resolved through the `deck_cards`
   *  join. Membership is ADDITIVE — the card stays in its language's main deck
   *  via `cards.deck_id`, which is what keeps every language-scoped read intact.
   *  Returns archived words too, exactly like `getWords`: the deck's own count
   *  and its list must agree, and 18 §E3 keeps archived words in list contexts. */
  getDeckWords(deckId: string, lang?: string): Promise<WordListItem[]>;
  /** The custom decks one card belongs to — powers Add-to-Deck's "Already
   *  added" state, which until 2026-07-30 was local component state that no
   *  mutation ever wrote (and so lied after any reload). */
  getCardDeckIds(cardId: string): Promise<string[]>;
  /** Create a custom deck, optionally seeded with words (`create_deck` RPC;
   *  Premium). The server normalises the name, enforces per-language name
   *  uniqueness and the deck cap, and drops any seed card that isn't the
   *  caller's or isn't in this language. Resolves the new deck id.
   *  Rejects with Error(DeckWriteError). */
  createDeck(name: string, cardIds: string[], lang?: string): Promise<string>;
  /** Delete a custom deck (`delete_deck` RPC). The deck and its membership rows
   *  go; the WORDS are untouched — they live in the main deck. Rejects with
   *  Error('main_deck_undeletable') if pointed at the hidden main deck. */
  deleteDeck(deckId: string): Promise<void>;
  /** Add a saved word to a custom deck (`add_card_to_deck` RPC; Premium).
   *  Idempotent — a double-tap or an outbox replay is a no-op, not an error. */
  addCardToDeck(deckId: string, cardId: string): Promise<void>;
  /** Remove a word from a custom deck (`remove_card_from_deck` RPC). The word
   *  stays in the library. NEVER premium-gated — same covenant as clearing a
   *  translation override: a lapsed subscription can always undo its own state. */
  removeCardFromDeck(deckId: string, cardId: string): Promise<void>;
  /** The user's saved words for the Word List (newest first). */
  getWords(lang?: string): Promise<WordListItem[]>;
  /** The study-session queue (18 §2c): everything due now (dueAt asc — oldest
   *  overdue first), FILLED with the next-due upcoming cards when the due count
   *  is under `limit`, so a session always uses the user's full quiz length
   *  while words exist. Returns fewer only when the deck itself is smaller.
   *  `deckId` (2026-07-30) scopes the session to ONE custom deck's membership —
   *  what "Study Deck" has always claimed to do and, until deck contents became
   *  real, could not. Omitted = the whole active language (Home's "Study now"). */
  getDueCards(limit: number, lang?: string, deckId?: string): Promise<QuizCardItem[]>;
  /** Commit a completed session's buffered ratings (03 batch write).
   *  `durationMs` is the wall-clock the CLIENT measured for the session. It has
   *  to come from here: review_logs.reviewed_at is the transaction's commit
   *  time (one `default now()` for the whole batch), so the server cannot
   *  reconstruct per-answer timing. Optional — omit it and the server simply
   *  records no duration for that session. */
  commitQuizSession(payload: { ratings: BufferedRating[]; durationMs?: number }): Promise<void>;
  /** Median seconds-per-card over the user's recent sessions, or null when
   *  there isn't enough signal (fewer than 3 timed sessions). Null means HIDE
   *  the estimate — never treat it as zero. */
  getSessionPace(): Promise<number | null>;
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
  /** Edit Translations (Premium, 2026-07-28) — set (or, with null, CLEAR) the
   *  user's own target-language text for one card, via the
   *  `set_card_target_override` RPC. Additive and reversible: it writes only to
   *  `card_target_overrides` and never touches the card, its FSRS state, its
   *  review history, or the shared `translations_cache` row.
   *  Setting rejects with Error('premium_required') for free-tier users
   *  (server-enforced); CLEARING is always allowed, so a lapsed subscription
   *  can still undo its own edits. */
  setCardTargetOverride(cardId: string, target: string | null): Promise<void>;
  /** Permanently delete the CALLING user's account and every cascaded row
   *  (cards, decks, review history, push tokens, prefs). Required by App Store
   *  Guideline 5.1.1(v) for any app that supports account creation — do not
   *  remove this from the UI. Irreversible; the caller is responsible for the
   *  confirmation dialog and for signing out afterwards. */
  deleteOwnAccount(): Promise<void>;
}
