// The in-app App Store rating prompt (SKStoreReviewController, via
// expo-store-review).
//
// WHY IT EXISTS: a month after launch the listing had ONE rating in the US and
// none in Canada (ratings are per storefront), and the app had never asked for
// one. Rating count is the largest conversion lever on a product page and it
// gates every other acquisition effort — an ad tap or a search impression lands
// on a page that says "1 Rating".
//
// WHEN IT ASKS — all of these, and nothing else:
//   · a REAL session just finished and its commit SUCCEEDED (the caller wires
//     this to the commit's onSuccess — never ask over a "couldn't save" error);
//   · the session went well (accuracy ≥ REVIEW_MIN_ACCURACY) and was a real
//     session, not a two-card top-up (≥ REVIEW_MIN_CARDS);
//   · it is at least the user's REVIEW_MIN_SESSIONS-th finished session on this
//     device — someone who came back twice is who Apple's guidance means by
//     "demonstrated engagement", and a first-session ask rates the onboarding;
//   · it has not asked in the last REVIEW_COOLDOWN_DAYS.
//
// ⚠️ StoreKit is the real rate limiter and tells the app NOTHING. Apple shows
// the sheet at most 3 times per 365 days, and not at all if the user turned
// off in-app ratings in Settings — and `requestReview()` resolves identically
// whether or not anything appeared. So
// `reviewAskedAt` records that we REQUESTED, not that anything appeared, and
// there is no way to measure the prompt's show rate from inside the app. The
// cooldown exists so we do not spend those three slots in one week.
//
// ⚠️ Development and TestFlight differ from production: in a debug build the
// sheet appears on EVERY request, and in TestFlight it never appears at all.
// Neither is a bug in this file.
//
// The guard is keyed on USE_SUPABASE, not __DEV__ — the same axis and the same
// reason as purchases.ts: the nightly Maestro suite drives a RELEASE bundle on
// the mock DataSource, and a system sheet sliding over the end-of-session
// screen there would steal the next tap.
//
// expo-store-review is `require`d lazily so a build that fails the guard (and
// every jest suite that renders QuizScreen) never loads the native module.
import { USE_SUPABASE } from '@/data';
import { usePrefsStore } from '@/store/prefsStore';

/** Finished sessions on this device before the first ask. */
export const REVIEW_MIN_SESSIONS = 3;
/** `sessionStats().accuracy` (0–100) the just-finished session must reach. */
export const REVIEW_MIN_ACCURACY = 80;
/** Cards in the just-finished session. */
export const REVIEW_MIN_CARDS = 5;
/** Days between requests. Apple allows 3 displays per 365 days. */
export const REVIEW_COOLDOWN_DAYS = 120;
/** Let the "Great session!" screen land before a system sheet covers it. */
export const REVIEW_ASK_DELAY_MS = 1200;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReviewPromptFacts {
  /** Finished sessions on this device INCLUDING the one that just ended. */
  sessionsCompleted: number;
  /** ms epoch of the last request, or null if never requested. */
  lastAskedAt: number | null;
  /** The just-finished session's accuracy, 0–100. */
  accuracy: number;
  /** Cards rated in the just-finished session. */
  reviewed: number;
  /** ms epoch. */
  now: number;
}

/** PURE. The whole policy, so it can be tested without a store or a device. */
export function shouldAskForReview(f: ReviewPromptFacts): boolean {
  if (f.sessionsCompleted < REVIEW_MIN_SESSIONS) return false;
  if (f.reviewed < REVIEW_MIN_CARDS) return false;
  if (f.accuracy < REVIEW_MIN_ACCURACY) return false;
  if (f.lastAskedAt != null && f.now - f.lastAskedAt < REVIEW_COOLDOWN_DAYS * DAY_MS) return false;
  return true;
}

function storeReview(): typeof import('expo-store-review') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-store-review');
}

/**
 * Record a finished, SAVED session and request the rating sheet if the policy
 * above says this is the moment. Resolves true iff a request was made.
 *
 * Fire-and-forget from the caller: it never throws, and nothing here may delay
 * or fail a session that has already been committed.
 */
export async function noteSessionAndMaybeAskForReview(
  session: { accuracy: number; reviewed: number },
  delayMs: number = REVIEW_ASK_DELAY_MS,
): Promise<boolean> {
  try {
    // Counted in every build, mock included, so the number means "sessions
    // finished on this device" everywhere and the policy has one input.
    usePrefsStore.getState().noteSessionCompleted();
    if (!USE_SUPABASE) return false;

    const { sessionsCompleted, reviewAskedAt, setReviewAskedAt } = usePrefsStore.getState();
    const now = Date.now();
    if (!shouldAskForReview({ ...session, sessionsCompleted, lastAskedAt: reviewAskedAt, now })) return false;

    const review = storeReview();
    if (!(await review.isAvailableAsync())) return false;

    // Latch BEFORE asking, same reasoning as the reminders prompt: if the
    // request throws or the app dies mid-sheet, the worst case is one skipped
    // ask — never a loop that burns the year's three displays.
    setReviewAskedAt(now);
    if (delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    await review.requestReview();
    return true;
  } catch {
    return false;
  }
}
