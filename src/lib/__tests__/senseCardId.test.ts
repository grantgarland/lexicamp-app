// Spec for the sense → card-id predicate that feeds `delete_card`.
//
// These are the "delete the RIGHT row" cases from the CRUD audit (2026-08-04).
// Every one of them was a silent wrong-row delete before the fix: the RPC only
// checks ownership, so any card id the client hands it is deleted without
// complaint, taking that word's whole FSRS history with it.
import { resolveSenseCardId, type SenseCardRow } from '@/lib/senseCardId';

const row = (id: string, translationId: string, originalTarget: string): SenseCardRow => ({ id, translationId, originalTarget });

// The chips a two-sense Spanish "to go" lookup renders.
const SENSES = ['ir', 'andar'];

describe('resolveSenseCardId', () => {
  it('prefers the id captured when the sense was saved this session', () => {
    // Server truth hasn't refetched yet, so `rows` is empty — the save's own id
    // is the only thing that can identify the card, and it is authoritative.
    expect(resolveSenseCardId([], 't1', SENSES, 0, 'card-just-saved')).toBe('card-just-saved');
  });

  it('matches a sense to its own card, leaving siblings alone', () => {
    // D10: one headword, multiple senses, one card each.
    const rows = [row('c-ir', 't1', 'ir'), row('c-andar', 't1', 'andar')];
    expect(resolveSenseCardId(rows, 't1', SENSES, 1)).toBe('c-andar');
    expect(resolveSenseCardId(rows, 't1', SENSES, 0)).toBe('c-ir');
  });

  it('does not fall back to a sibling when the sense itself is unsaved', () => {
    // THE bug: only the sibling is saved, so the primary chip matched nothing
    // and the old fallback handed back the first row for the translation —
    // deleting "andar" when the user asked to un-save "ir". The sibling is
    // claimed by its OWN chip, so the primary may not have it.
    const rows = [row('c-andar', 't1', 'andar')];
    expect(resolveSenseCardId(rows, 't1', SENSES, 0)).toBeUndefined();
  });

  it('resolves by saved identity, not by the edited text on screen', () => {
    // Edit Translations changes `target`, never `originalTarget`. Matching on the
    // rendered text ("me voy") missed this card and dropped through to the
    // sibling; `originalTarget` still says which sense the card IS.
    const rows = [row('c-ir', 't1', 'ir'), row('c-andar', 't1', 'andar')];
    expect(resolveSenseCardId(rows, 't1', SENSES, 0)).toBe('c-ir');
  });

  it('treats the same lemma in another language as a different word', () => {
    // Two learning languages, same spelling, different translations_cache rows.
    // Deleting one must never resolve to the other.
    const rows = [row('c-es', 't-es', 'lima'), row('c-pt', 't-pt', 'lima')];
    expect(resolveSenseCardId(rows, 't-es', ['lima'], 0)).toBe('c-es');
    expect(resolveSenseCardId(rows, 't-pt', ['lima'], 0)).toBe('c-pt');
  });

  it('lets the primary chip claim a lone pre-D10 card whose text differs', () => {
    // Cards saved before senses existed carry no custom_back, so their text need
    // not equal any chip. Nothing else claims this row, so the primary owns it —
    // mirroring the chip `savedIds` marks saved.
    const rows = [row('c-legacy', 't1', 'el ir')];
    expect(resolveSenseCardId(rows, 't1', SENSES, 0)).toBe('c-legacy');
  });

  it('still claims the lone unclaimed card when a sibling is also saved', () => {
    // The sibling has its own chip; the legacy row is the only orphan, so the
    // primary can still resolve it unambiguously.
    const rows = [row('c-legacy', 't1', 'el ir'), row('c-andar', 't1', 'andar')];
    expect(resolveSenseCardId(rows, 't1', SENSES, 0)).toBe('c-legacy');
    expect(resolveSenseCardId(rows, 't1', SENSES, 1)).toBe('c-andar');
  });

  it('refuses to choose between two unclaimed cards', () => {
    const rows = [row('c-legacy', 't1', 'el ir'), row('c-other', 't1', 'irse')];
    expect(resolveSenseCardId(rows, 't1', SENSES, 0)).toBeUndefined();
  });

  it('never lets a non-primary chip claim a card it does not match', () => {
    const rows = [row('c-legacy', 't1', 'el ir')];
    expect(resolveSenseCardId(rows, 't1', SENSES, 1)).toBeUndefined();
  });

  it('refuses to pick between two cards claiming the same sense', () => {
    const rows = [row('c-a', 't1', 'ir'), row('c-b', 't1', 'ir')];
    expect(resolveSenseCardId(rows, 't1', SENSES, 0)).toBeUndefined();
  });

  it('resolves nothing for a sense index the result no longer has', () => {
    const rows = [row('c-ir', 't1', 'ir')];
    expect(resolveSenseCardId(rows, 't1', SENSES, 7)).toBeUndefined();
  });
});
