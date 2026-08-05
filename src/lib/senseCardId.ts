// Which SAVED CARD does a sense chip in the search results stand for?
//
// Pure, and deliberately so: the answer feeds `delete_card`, so a predicate that
// matches the wrong row deletes the wrong word with no error anywhere — the RPC
// is happy, the count drops by one, and a word the user never touched is gone
// along with its FSRS history. The CRUD audit (2026-08-04) found exactly that
// hole, in two places at once; both rules below are the fix, and the test file
// next to this one is their spec.
//
// The one non-obvious input is `originalTarget` vs `target`: `target` carries a
// premium Edit-Translations override, i.e. the text the user chose to SEE.
// Sense identity is the text the card was SAVED as, which is `originalTarget`.
// (`savedIds` in SearchScreen has always matched on `originalTarget` for the
// same reason; the delete path used `target` and disagreed with it.)

/** The fields of a saved word row this resolution needs. `WordListItem`
 *  satisfies it structurally — kept minimal so this module stays layer-free. */
export interface SenseCardRow {
  id: string;
  translationId: string;
  /** The card's target text BEFORE any Edit-Translations override. */
  originalTarget: string;
}

/**
 * Resolve the card id for sense `senseIndex` of translation `translationId`,
 * or `undefined` when no card unambiguously IS that sense.
 *
 * Returning `undefined` is a correct, safe answer: the caller skips the delete
 * rather than guessing. Guessing is what deleted siblings.
 *
 * This MUST stay the inverse of `savedIds` in SearchScreen, which decides which
 * chip renders as saved (and therefore which chip can offer a delete at all).
 * That mapping is: a row claims the chip its `originalTarget` matches, and a row
 * matching NO chip falls back to the primary. So the whole sense list is an
 * input here — "does any other chip claim this row?" is the question that
 * separates a legacy pre-D10 card (nothing claims it → the primary owns it) from
 * a sibling sense that merely happens to be the only one saved (its own chip
 * owns it, and the primary must not touch it).
 *
 * @param senseWords  Every chip's display text, in render order.
 * @param sessionCardId  Card id captured when this exact sense was saved in the
 *   current session — authoritative when present (it came back from `save_card`).
 */
export function resolveSenseCardId(
  rows: readonly SenseCardRow[],
  translationId: string,
  senseWords: readonly string[],
  senseIndex: number,
  sessionCardId?: string,
): string | undefined {
  if (sessionCardId != null) return sessionCardId;

  const senseWord = senseWords[senseIndex];
  if (senseWord == null) return undefined;

  // Scoping to the translation is what keeps languages independent: the same
  // lemma saved in two learning languages resolves to two different
  // translations_cache rows, so neither can ever be a candidate for the other.
  const candidates = rows.filter((w) => w.translationId === translationId);

  const exact = candidates.filter((w) => w.originalTarget === senseWord);
  // >1 exact match means two cards claim the same sense — a state the save path
  // is not supposed to produce. Deleting "one of them" is a coin flip, so don't.
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1) return undefined;

  // Pre-D10 fallback: cards saved before senses existed carry no custom_back, so
  // their text need not equal any chip. Only the PRIMARY chip may claim such a
  // card, and only when exactly one card is unclaimed — "the first row for this
  // translation" was the collision that deleted the wrong sense.
  if (senseIndex !== 0) return undefined;
  const orphans = candidates.filter((w) => !senseWords.includes(w.originalTarget));
  return orphans.length === 1 ? orphans[0].id : undefined;
}
