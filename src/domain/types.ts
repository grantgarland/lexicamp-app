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
  /** Public pseudonymous identity (spec 20 §3): generated at signup, unique,
   *  user-editable via set_username. THE name shown anywhere public
   *  (Settings row, leaderboard). */
  username: string;
  /** Lifetime username changes (server counter — spec 20 R5: free tier gets
   *  exactly ONE; premium is capped 20/day server-side). Drives the Edit
   *  Profile cycle/save gating. */
  usernameChanges: number;
  /** RETIRED from UI (20 §8 R1 — column frozen server-side, kept in the row
   *  mapping only so nothing breaks on old data). Do not render. */
  displayName: string | null;
  nativeLang: LanguageCode;
  targetLang: LanguageCode;
  timezone: string;
  onboardingComplete: boolean;
  /** UX-17b: server mirror of the quiz-length pref (10/20/40/80; default 20). */
  quizLength: number;
  /** Signup time (account age; the DF-9 v2 free tier no longer derives from it). */
  createdAt: Date;
}

/** subscriptions (mirror of RevenueCat) */
export type EntitlementStatus = 'free' | 'trial' | 'active' | 'expired' | 'grace';
export type SubscriptionPlan = 'monthly' | 'annual' | null;
export interface Entitlement {
  status: EntitlementStatus;
  plan: SubscriptionPlan;
  platform: 'ios' | 'android' | null;
  currentPeriodEnd: Date | null;
  /** Will the subscription RENEW at `currentPeriodEnd`, or merely end there?
   *
   *  ⚠️ `status` cannot answer this. A CANCELLATION deliberately leaves the
   *  status `active` — cancelling means "will not renew", not "access ends now"
   *  — so without this the UI could only offer the neutral "active until". NULL
   *  means genuinely unknown (rows written before 3.15, and events like
   *  BILLING_ISSUE that carry no verdict); do not render it as either promise. */
  autoRenew: boolean | null;
}
/**
 * Premium features unlocked? (trial/active/grace count as paid.)
 *
 * ⚠️ A LAPSED PERIOD IS NOT ENTITLEMENT, whatever the mirror still says.
 * `status` is only ever corrected by an inbound RevenueCat EXPIRATION, so a
 * single lost webhook — a delivery failure, a wrong shared secret, retries
 * exhausted — used to grant premium FOREVER with no way back. That is not
 * hypothetical: on 2026-08-17 a broken auth header ate one EXPIRATION and an
 * account read `active` with a period end 16 hours in the past. The period end
 * is the time-based backstop that makes the mirror self-correcting.
 *
 * `grace` is deliberately exempt: BILLING_ISSUE means "payment failed, keep
 * access while it retries", and its period end is already past by definition,
 * so including it here would revoke access the instant grace began.
 *
 * A NULL period end counts as paid — `set_dev_plan` writes status with no date,
 * and a real subscriber missing the field should not lose access over absent
 * data. The server RPCs apply the same rule; see `is_paid()` in the database.
 */
export const isPaid = (e: Entitlement): boolean => {
  if (e.status === 'grace') return true;
  if (e.status !== 'trial' && e.status !== 'active') return false;
  return e.currentPeriodEnd == null || e.currentPeriodEnd.getTime() > Date.now();
};

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
  /** e.g. [{ time: '09:00' }] (default). Local times in the user's profile timezone. */
  windows: { time: string }[];
  minDueToNotify: number;
  /** Weekdays the reminder may fire (dow 0=Sun..6=Sat, user's local tz; 18 §C1).
   *  Never empty — the server constraint rejects it. */
  days: number[];
}

// ── Derived (not stored) ─────────────────────────────────────────────────────
export type WordLifecycle = 'unseen' | 'in_flight' | 'mastered';
/** Per-word mastery tier id (= the registry TierId). */
export type WordTierId = TierId;
