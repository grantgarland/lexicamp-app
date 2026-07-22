// Pure derivations — the read-time computations 03 specifies as "derived, not
// stored": per-word mastery tier, the MasteryCard distribution, Need-Recall
// (today/total), due-tomorrow, added-today, word lifecycle, and the per-user
// mountain tier → CEFR. Screens render these over raw domain entities; the math
// lives HERE so it stays identical no matter where the data comes from.
import { findLanguage } from '@/constants';
import i18n from '@/i18n';
import { getTierByStability, TIERS, type TierId } from '@/theme/tiers';

import type { Card, CardFsrsState, LanguageCode, Profile, SearchDirection, WordLifecycle } from './types';

/** Summit-stability threshold (days) = "mastered" (03). */
export const MASTERY_STABILITY = 30;

// ── DF-9 v2 free tier (spec 19 rev, Casey correction 2026-07-22) ─────────────
// MIRROR of the save_card cap rule in migration `daily_free_save_allowance`:
// a 50-card STARTER allotment at any pace, then at most 5 saves per day —
// the daily 5 resets each day and never banks (capacity grows only with use).
// The SERVER is authoritative (P0004 free_word_cap, profile-timezone day);
// this client copy exists only for display (Settings meter, paywall copy) and
// uses the device-local day via homeSnapshot.addedToday. Change both or neither.
export const FREE_WORD_BASE = 50;
export const FREE_DAILY_SAVES = 5;

export type FreeTierUsage =
  | { phase: 'starter'; saved: number; limit: number }
  | { phase: 'daily'; saved: number; usedToday: number; limit: number };

/** Which free-tier meter to show: the starter allotment (until 50 total) or
 *  the daily counter (after). `usedToday` clamps at the daily limit — on the
 *  day the user crosses 50, starter saves share the day (19 rev boundary note). */
export function freeTierUsage(saved: number, addedToday: number): FreeTierUsage {
  if (saved < FREE_WORD_BASE) return { phase: 'starter', saved, limit: FREE_WORD_BASE };
  return { phase: 'daily', saved, usedToday: Math.min(Math.max(0, addedToday), FREE_DAILY_SAVES), limit: FREE_DAILY_SAVES };
}

const startOfDay = (now: Date): Date => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
};

/** Word lifecycle from FSRS state (03 "Word lifecycle states"). */
export function wordLifecycle(s: CardFsrsState): WordLifecycle {
  if (s.reps === 0 || s.state === 0) return 'unseen';
  if (s.stability >= MASTERY_STABILITY) return 'mastered';
  return 'in_flight';
}

// ── Translation direction (03 SearchDirection × the user's language pair) ────
// A SearchDirection is relative to the user's profile, NOT a fixed pair:
//   native_to_target = nativeLang → targetLang;  target_to_native = the reverse.
// Every label the search UI shows (chip codes, language names, placeholder)
// derives from HERE, so a profile with a different pair (e.g. fr→de) just works.

/** Human-readable name for a BCP-47/ISO code ('es' → 'Spanish'). Prefers the active
 *  UI locale's `languages.<code>` string, then the canonical language registry's English
 *  name, and finally the uppercased code for anything unknown. */
export function languageName(code: LanguageCode): string {
  const localized = i18n.t(`languages.${code.toLowerCase()}`, { defaultValue: '' });
  if (localized !== '') return localized;
  return findLanguage(code)?.name ?? code.toUpperCase();
}

export interface DirectionLangs {
  /** Source/target ISO codes for this direction (e.g. 'en' / 'es'). */
  sourceCode: LanguageCode;
  targetCode: LanguageCode;
  /** Short uppercase chip labels (e.g. 'EN' / 'ES'). */
  sourceShort: string;
  targetShort: string;
  /** Full display names (e.g. 'English' / 'Spanish'). */
  sourceName: string;
  targetName: string;
}

/** Seed a default display name from the auth identity (18 §A7 / D1): prefer the
 *  provider-supplied name (Apple/Google, when those flows land); else prettify the
 *  email local-part — "grant.persona+tag@x.com" → "Grant Persona". Never empty:
 *  falls back to "Learner" for degenerate inputs. */
export function defaultDisplayName(email: string, providerName?: string | null): string {
  if (providerName != null && providerName.trim() !== '') return providerName.trim().slice(0, 40);
  const local = (email.split('@')[0] ?? '').split('+')[0] ?? '';
  const words = local
    .split(/[._\-]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length > 0)
    .map((w) => (/\p{L}/u.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w));
  const name = words.join(' ').slice(0, 40).trim();
  return name === '' ? 'Learner' : name;
}

/** Resolve a SearchDirection against the user's profile into its source/target language pair. */
export function directionLangs(
  profile: Pick<Profile, 'nativeLang' | 'targetLang'>,
  direction: SearchDirection,
): DirectionLangs {
  const [sourceCode, targetCode] =
    direction === 'native_to_target'
      ? [profile.nativeLang, profile.targetLang]
      : [profile.targetLang, profile.nativeLang];
  return {
    sourceCode,
    targetCode,
    sourceShort: sourceCode.toUpperCase(),
    targetShort: targetCode.toUpperCase(),
    sourceName: languageName(sourceCode),
    targetName: languageName(targetCode),
  };
}

// ── Per-user mountain tier (03 "Mountain-progression tier") ──────────────────
export const MOUNTAIN_TIERS: { id: TierId; cefr: string; masteredMin: number }[] = [
  { id: 'bc', cefr: 'A1', masteredMin: 0 },
  { id: 'abc', cefr: 'A2', masteredMin: 500 },
  { id: 'hc', cefr: 'B1 / B2', masteredMin: 1500 },
  { id: 'sr', cefr: 'C1', masteredMin: 3000 },
  { id: 'summit', cefr: 'C2', masteredMin: 5000 },
];

export function mountainTier(masteredCount: number): (typeof MOUNTAIN_TIERS)[number] {
  let result = MOUNTAIN_TIERS[0];
  for (const t of MOUNTAIN_TIERS) if (masteredCount >= t.masteredMin) result = t;
  return result;
}

// ── Home snapshot (03 "Home screen derived queries") ─────────────────────────
export interface HomeSnapshot {
  /** Reps>0 word counts per tier, registry order [bc,abc,hc,sr,summit]. */
  tierCounts: number[];
  /** Total saved words (cards). */
  wordsSaved: number;
  /** Words at Summit stability (mastered). */
  masteredCount: number;
  /** Need Recall — total overdue queue (stat tile #1). */
  needRecallTotal: number;
  /** Need Recall — today (Study Card headline). */
  needRecallToday: number;
  /** Due in the next 24h (stat tile #3). */
  dueTomorrow: number;
  /** Cards saved today (stat tile #2). */
  addedToday: number;
  /** No saved words yet → new-user home variant. */
  isEmpty: boolean;
}

export function homeSnapshot(cards: Card[], states: CardFsrsState[], now: Date = new Date()): HomeSnapshot {
  const sod = startOfDay(now);
  const in24 = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // 07-17c ruling: archived words stay in EARNED counts (wordsSaved, tiers,
  // mastered, addedToday) but leave the review queue — so only the due
  // numbers below skip suspended cards.
  const suspendedIds = new Set<string>();
  for (const c of cards) if (c.suspended) suspendedIds.add(c.id);

  const tierCounts = [0, 0, 0, 0, 0];
  let masteredCount = 0;
  let needRecallTotal = 0;
  let needRecallToday = 0;
  let dueTomorrow = 0;

  for (const s of states) {
    if (s.reps > 0) {
      // Single source of banding truth (theme/tiers). getTierByStability clamps
      // anomalous inputs to the first band, so the distribution always sums to
      // the reviewed-word total (a raw findIndex would silently drop them).
      const idx = TIERS.indexOf(getTierByStability(s.stability));
      tierCounts[idx] += 1;
      if (s.stability >= MASTERY_STABILITY) masteredCount += 1;
    }
    if (s.state > 0 && !suspendedIds.has(s.cardId)) {
      if (s.dueAt.getTime() <= now.getTime()) {
        needRecallTotal += 1;
        if (s.dueAt.getTime() >= sod.getTime()) needRecallToday += 1;
      } else if (s.dueAt.getTime() <= in24.getTime()) {
        dueTomorrow += 1;
      }
    }
  }

  let addedToday = 0;
  for (const c of cards) if (c.createdAt.getTime() >= sod.getTime()) addedToday += 1;

  return {
    tierCounts,
    wordsSaved: cards.length,
    masteredCount,
    needRecallTotal,
    needRecallToday,
    dueTomorrow,
    addedToday,
    isEmpty: cards.length === 0,
  };
}
