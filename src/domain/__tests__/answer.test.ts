import { gradeTypedAnswer, levenshtein, nearMissAllowance, normalizeAnswer } from '../answer';

describe('normalizeAnswer', () => {
  it('folds case and Latin diacritics', () => {
    expect(normalizeAnswer('Efímero')).toBe('efimero');
    expect(normalizeAnswer('AGRADECIDO')).toBe('agradecido');
  });
  it('folds ё to е but NEVER й to и', () => {
    expect(normalizeAnswer('идём')).toBe('идем');
    expect(normalizeAnswer('мой')).toBe('мой');
    expect(normalizeAnswer('мой')).not.toBe(normalizeAnswer('мои'));
  });
  it('drops punctuation and collapses whitespace', () => {
    expect(normalizeAnswer('  лежачий   полицейский! ')).toBe('лежачий полицейский');
    expect(normalizeAnswer("it's")).toBe('its');
  });
});

describe('levenshtein', () => {
  it('measures edits', () => {
    expect(levenshtein('abc', 'abc')).toBe(0);
    expect(levenshtein('abc', 'abd')).toBe(1);
    expect(levenshtein('abc', 'ab')).toBe(1);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });
});

describe('nearMissAllowance', () => {
  it('scales with length', () => {
    expect(nearMissAllowance(2)).toBe(0);
    expect(nearMissAllowance(3)).toBe(1);
    expect(nearMissAllowance(4)).toBe(1);
    expect(nearMissAllowance(5)).toBe(2);
  });
});

describe('gradeTypedAnswer', () => {
  it('exact match (after normalization) → got_it', () => {
    expect(gradeTypedAnswer('agradecido', 'agradecido').rating).toBe('got_it');
    expect(gradeTypedAnswer('EFIMERO', 'efímero').rating).toBe('got_it');
    expect(gradeTypedAnswer('идем', 'идём').rating).toBe('got_it');
  });
  it('1–2 characters off on a long word → almost', () => {
    expect(gradeTypedAnswer('agradesido', 'agradecido').rating).toBe('almost');
    expect(gradeTypedAnswer('agradesibo', 'agradecido').rating).toBe('almost');
    expect(gradeTypedAnswer('serendipa', 'serendipia').rating).toBe('almost');
  });
  it('3+ off → again (the "Limited" CTA)', () => {
    expect(gradeTypedAnswer('agrabebibo', 'agradecido').rating).toBe('again'); // 3 substitutions
    expect(gradeTypedAnswer('agradecidoso', 'agradecido').rating).toBe('almost'); // 2 insertions is still near
    expect(gradeTypedAnswer('mosca', 'volar').rating).toBe('again');
  });
  it('short answers get no 2-edit grace', () => {
    expect(gradeTypedAnswer('so', 'go').rating).toBe('again'); // len 2 → allowance 0
    expect(gradeTypedAnswer('sun', 'fun').rating).toBe('almost'); // len 3 → allowance 1
    expect(gradeTypedAnswer('sud', 'fun').rating).toBe('again');
  });
  it('a blank expected answer never grades as got_it', () => {
    expect(gradeTypedAnswer('', '').rating).toBe('again');
  });
  it('reports distance and expected length', () => {
    expect(gradeTypedAnswer('serendipa', 'serendipia')).toEqual({ rating: 'almost', distance: 1, expectedLength: 10 });
  });
});
