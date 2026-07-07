// Result-quality gate tests (16 §2). assessResultQuality is the shared oracle the
// mock, the client, and the Edge Function all use to decide whether a found result
// is saveable — its key job is catching identity-echoes (untranslated pass-through).
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
  it('flags an identity-echo (translation === source) as unsaveable', () => {
    expect(assessResultQuality({ normalizedSource: 'rat', senses: [sense('rat')] })).toEqual({
      quality: 'unsaveable',
      qualityReason: 'echo',
    });
  });

  it('catches single-word echoes, not just >3-token ones (the original gap)', () => {
    expect(assessResultQuality({ normalizedSource: 'fly', senses: [sense('fly')] }).quality).toBe('unsaveable');
  });

  it('allows a real translation (target differs from source)', () => {
    expect(assessResultQuality({ normalizedSource: 'fly', senses: [sense('volar')] })).toEqual({ quality: 'ok' });
  });

  it('treats an empty sense list as ok (nothing to echo)', () => {
    expect(assessResultQuality({ normalizedSource: 'fly', senses: [] })).toEqual({ quality: 'ok' });
  });

  it('only inspects the primary sense', () => {
    // Primary is a real translation; a coincidental echo lower down doesn't block.
    expect(assessResultQuality({ normalizedSource: 'fly', senses: [sense('volar'), sense('fly')] }).quality).toBe('ok');
  });
});
