// Tier-0 capture gate tests (16 §2). This is the user-facing edge of the gate;
// the same rules re-run in the Edge Function, so these cases double as the
// spec for that implementation.
import { captureRulesFor, evaluateCaptureInput, normalizeCaptureInput } from '../capture';

const en = (raw: string) => evaluateCaptureInput(raw, 'en');

describe('normalizeCaptureInput', () => {
  it('trims, collapses whitespace, lowercases the key, keeps display casing', () => {
    expect(normalizeCaptureInput('  Speed   Bump ')).toEqual({ normalized: 'speed bump', display: 'Speed Bump' });
  });

  it('applies NFC so composed/decomposed accents share one cache key', () => {
    const composed = 'árbol'; // U+00E1
    const decomposed = 'árbol'; // a + combining acute
    expect(normalizeCaptureInput(decomposed).normalized).toBe(normalizeCaptureInput(composed).normalized);
  });

  it('sheds wrapping quotes/brackets and trailing punctuation', () => {
    expect(normalizeCaptureInput('"perro"').normalized).toBe('perro');
    expect(normalizeCaptureInput('¿Dónde?').normalized).toBe('dónde');
    expect(normalizeCaptureInput('(fly)').normalized).toBe('fly');
    expect(normalizeCaptureInput('run.').normalized).toBe('run');
  });

  it('strips zero-width and control characters', () => {
    expect(normalizeCaptureInput('fl​y').normalized).toBe('fly');
  });
});

describe('evaluateCaptureInput — accepts vocabulary', () => {
  it.each([
    'fly',
    'árbol',
    'speed bump',
    'buenos días', // multi-word greeting
    'echar de menos', // 3-token idiom
    "s'il vous plaît", // internal apostrophe
    'well-being', // hyphenated
  ])('accepts %s', (input) => {
    expect(en(input).ok).toBe(true);
  });

  it('accepts exactly the max word count (5)', () => {
    expect(en('to make a long story').ok).toBe(true);
  });
});

describe('evaluateCaptureInput — rejects non-vocabulary', () => {
  it('rejects empty / whitespace / punctuation-only input', () => {
    expect(en('')).toEqual({ ok: false, reason: 'empty' });
    expect(en('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(en('"..."')).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejects sentence-like input (internal punctuation)', () => {
    expect(en('I went to the store, and then I came home')).toMatchObject({ ok: false });
    expect(en('Hello. How are you')).toEqual({ ok: false, reason: 'sentence_like' });
    expect(en('wait; see')).toEqual({ ok: false, reason: 'sentence_like' });
  });

  it('rejects > max words even without punctuation', () => {
    expect(en('the quick brown fox jumps over')).toEqual({ ok: false, reason: 'too_many_words' });
  });

  it('rejects > 100 chars (Azure dictionary per-item limit)', () => {
    expect(en('a'.repeat(101))).toEqual({ ok: false, reason: 'too_long' });
  });

  it('rejects URLs, emails, handles, digits, emoji-only', () => {
    expect(en('https://example.com')).toEqual({ ok: false, reason: 'not_a_word' });
    expect(en('see www.example.com now')).toEqual({ ok: false, reason: 'not_a_word' });
    expect(en('user@mail.com')).toEqual({ ok: false, reason: 'not_a_word' });
    expect(en('hey @someone')).toEqual({ ok: false, reason: 'not_a_word' });
    expect(en('12345')).toEqual({ ok: false, reason: 'not_a_word' });
    expect(en('🔥🔥🔥')).toEqual({ ok: false, reason: 'not_a_word' });
  });
});

describe('evaluateCaptureInput — unspaced scripts', () => {
  it('gates Japanese on grapheme count, not words', () => {
    expect(evaluateCaptureInput('猫', 'ja').ok).toBe(true);
    expect(evaluateCaptureInput('ありがとうございます', 'ja').ok).toBe(true); // 10 graphemes
    expect(evaluateCaptureInput('これはとてもながいぶんしょうですよね', 'ja')).toEqual({
      ok: false,
      reason: 'too_long',
    });
  });

  it('resolves zh-Hans to the zh unspaced rules', () => {
    expect(captureRulesFor('zh-Hans').unspaced).toBe(true);
    expect(captureRulesFor('es').unspaced).toBe(false);
  });
});

describe('evaluateCaptureInput — script consistency (wrong_script)', () => {
  it('rejects wrong-direction input: Latin text while translating FROM a non-Latin language', () => {
    // The reported bug: AR→EN with an English word. Caught client-side, pre-API.
    expect(evaluateCaptureInput('rat', 'ar')).toEqual({ ok: false, reason: 'wrong_script' });
    expect(evaluateCaptureInput('hello', 'ru')).toEqual({ ok: false, reason: 'wrong_script' });
    expect(evaluateCaptureInput('word', 'ja')).toEqual({ ok: false, reason: 'wrong_script' });
  });

  it('accepts input written in the source language’s own script', () => {
    expect(evaluateCaptureInput('قط', 'ar').ok).toBe(true); // Arabic
    expect(evaluateCaptureInput('по большому счёту', 'ru').ok).toBe(true); // Cyrillic multi-word
    expect(evaluateCaptureInput('γεια', 'el').ok).toBe(true); // Greek
    expect(evaluateCaptureInput('猫', 'ja').ok).toBe(true); // Japanese kanji
  });

  it('does not fire for Latin-script pairs (dictionary is the authority there)', () => {
    expect(en('perro').ok).toBe(true);
    expect(evaluateCaptureInput('perro', 'es').ok).toBe(true);
  });

  it('passes mixed-script input if it contains at least one letter in the source script', () => {
    // Japanese with an embedded Latin loanword still reads as Japanese.
    expect(evaluateCaptureInput('猫cafe', 'ja').ok).toBe(true);
  });
});
