// Pure derivations — the read-time computations 03 specifies as "derived, not
// stored": per-word mastery tier, the MasteryCard distribution, Need-Recall
// (today/total), due-tomorrow, added-today, word lifecycle, and the per-user
// mountain tier → CEFR. Screens render these over raw domain entities; the math
// lives HERE so it stays identical no matter where the data comes from.
import { TIERS, type TierId } from '@/theme/tiers';

import type { Card, CardFsrsState, LanguageCode, Profile, SearchDirection, WordLifecycle } from './types';

/** Summit-stability threshold (days) = "mastered" (03). */
export const MASTERY_STABILITY = 30;

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
//   native_to_target = nativeLang → learningLang;  target_to_native = the reverse.
// Every label the search UI shows (chip codes, language names, placeholder)
// derives from HERE, so a profile with a different pair (e.g. fr→de) just works.
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  // …extend as translation coverage grows; unknown codes fall back to the code itself.
};

/** Human-readable name for a BCP-47/ISO code ('es' → 'Spanish'); falls back to the uppercased code. */
export function languageName(code: LanguageCode): string {
  return LANGUAGE_NAMES[code.toLowerCase()] ?? code.toUpperCase();
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

/** Resolve a SearchDirection against the user's profile into its source/target language pair. */
export function directionLangs(
  profile: Pick<Profile, 'nativeLang' | 'learningLang'>,
  direction: SearchDirection,
): DirectionLangs {
  const [sourceCode, targetCode] =
    direction === 'native_to_target'
      ? [profile.nativeLang, profile.learningLang]
      : [profile.learningLang, profile.nativeLang];
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

  const tierCounts = [0, 0, 0, 0, 0];
  let masteredCount = 0;
  let needRecallTotal = 0;
  let needRecallToday = 0;
  let dueTomorrow = 0;

  for (const s of states) {
    if (s.reps > 0) {
      const idx = TIERS.findIndex((t) => s.stability >= t.stMin && s.stability < t.stMax);
      if (idx >= 0) tierCounts[idx] += 1;
      if (s.stability >= MASTERY_STABILITY) masteredCount += 1;
    }
    if (s.state > 0) {
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
