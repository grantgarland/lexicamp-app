// Answer grading — the pure rule that turns a TYPED recall answer into the
// self-grade the quiz pre-selects (quiz auto-traversal, 2026-07-28). Domain, so
// there is exactly ONE testable definition of "close enough"; the screen only
// renders what this returns.
//
// Casey's ruling (2026-07-28): case and Latin diacritics are not what recall is
// testing — "Agradecido" and "agradecido", "efimero" and "efímero" are the same
// answer. Cyrillic is folded ONLY for ё→е (the tolerance Russians actually
// expect); й is NOT folded to и even though NFD decomposes it (they are
// distinct letters, and conflating them would silently mark a wrong answer
// correct — the exact failure mode this app's Russian fixtures exist to catch).
import type { UiRating } from './quiz';

/** Comparison form: Latin diacritics stripped, ё→е, punctuation dropped,
 *  case-folded, whitespace collapsed. */
export function normalizeAnswer(input: string): string {
  return input
    .normalize('NFD')
    // Strip combining marks ONLY off Latin bases (see header note on й).
    .replace(/([A-Za-z])[\u0300-\u036f]+/g, '$1')
    .normalize('NFC')
    .toLowerCase()
    .replace(/ё/g, 'е') // ё → е
    .replace(/[^\p{L}\p{N}\s]/gu, '') // hyphens, apostrophes, stray punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

/** Classic two-row Levenshtein (edit distance). O(n·m) time, O(m) space — the
 *  strings here are single words/short phrases, so this never needs to be
 *  cleverer than this. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[b.length];
}

/** How many edits still count as "nearly had it" for an answer of this length.
 *  Scaled, not a flat 2: on a 3-letter word two wrong characters is not a near
 *  miss, it's a different word. */
export function nearMissAllowance(length: number): number {
  if (length >= 5) return 2;
  if (length >= 3) return 1;
  return 0;
}

export interface AnswerGrade {
  /** The rating the quiz pre-selects (and auto-commits if the user doesn't tap). */
  rating: UiRating;
  /** Edit distance between the normalized forms (0 = exact). */
  distance: number;
  /** Normalized length of the expected answer — what `nearMissAllowance` scaled on. */
  expectedLength: number;
}

/** Grade a typed recall answer against the card's target text.
 *    distance 0                   → got_it  ("Got it")
 *    distance ≤ nearMissAllowance → almost  ("Almost")
 *    otherwise                    → again   ("Limited")
 *  An empty expected answer can never be "got it" — it would hand out a free
 *  promotion on a malformed card. */
export function gradeTypedAnswer(typed: string, expected: string): AnswerGrade {
  const a = normalizeAnswer(typed);
  const b = normalizeAnswer(expected);
  if (b === '') return { rating: 'again', distance: a.length, expectedLength: 0 };
  const distance = levenshtein(a, b);
  const rating: UiRating = distance === 0 ? 'got_it' : distance <= nearMissAllowance(b.length) ? 'almost' : 'again';
  return { rating, distance, expectedLength: b.length };
}
