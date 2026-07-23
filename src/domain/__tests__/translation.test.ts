// Result-quality gate tests (16 §2). assessResultQuality is the shared oracle the
// mock, the client, and the Edge Function all use to decide whether a found result
// is saveable — its key job is catching identity-echoes (untranslated pass-through).
// Evaluated PER SENSE (2026-07-23 fix): senses render as independent cards (D10 —
// saving one never touches its siblings), so the gate must never let one bad sense
// block, or hide behind, a sibling sense.
import { assessResultQuality, type DictionarySense } from '../translation';

const sense = (normalizedTarget: string): DictionarySense => ({
  normalizedTarget,
  displayTarget: normalizedTarget,
  posTag: 'NOUN',
  confidence: 0.5,
  prefixWord: '',
  backTranslations: [],
});

describe('assessResultQuality', () => {
  it('flags an identity-echo (translation === source) as unsaveable on that sense', () => {
    expect(assessResultQuality({ normalizedSource: 'rat', senses: [sense('rat')] })).toEqual({
      senses: [{ ...sense('rat'), quality: 'unsaveable', qualityReason: 'echo' }],
    });
  });

  it('catches single-word echoes, not just >3-token ones (the original gap)', () => {
    const { senses } = assessResultQuality({ normalizedSource: 'fly', senses: [sense('fly')] });
    expect(senses[0].quality).toBe('unsaveable');
  });

  it('allows a real translation (target differs from source)', () => {
    expect(assessResultQuality({ normalizedSource: 'fly', senses: [sense('volar')] })).toEqual({
      senses: [sense('volar')],
    });
  });

  it('treats an empty sense list as ok (nothing to echo)', () => {
    expect(assessResultQuality({ normalizedSource: 'fly', senses: [] })).toEqual({ senses: [] });
  });

  it('inspects EVERY sense independently — a bad primary never poisons a valid secondary', () => {
    // Regression (2026-07-23): "bobcat" (EN→RU) had an untranslated-echo primary
    // sense; its second sense ("рысь") is a real translation and must stay saveable.
    const { senses } = assessResultQuality({ normalizedSource: 'bobcat', senses: [sense('bobcat'), sense('рысь')] });
    expect(senses[0].quality).toBe('unsaveable');
    expect(senses[1].quality).toBeUndefined();
  });

  it('inspects EVERY sense independently — a bad secondary never hides behind a valid primary', () => {
    // The mirror-image gap in the old primary-only check: a coincidental echo lower
    // down used to be silently marked 'ok' for the whole result.
    const { senses } = assessResultQuality({ normalizedSource: 'fly', senses: [sense('volar'), sense('fly')] });
    expect(senses[0].quality).toBeUndefined();
    expect(senses[1].quality).toBe('unsaveable');
  });
});
