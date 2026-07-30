// Guard: the compact chip labels the search header depends on (2026-07-30).
//
// The direction toggle renders TWO language codes plus an arrow, in a row that
// also holds a close button and the language pill. Raw BCP-47 tags reach 8
// characters ('TLH-LATN') and overflowed that row, drawing the toggle over the
// picker. `languageShortLabel` derives the primary subtag instead — which works
// only while those subtags stay short AND unique. Both are properties of the
// registry, not of the function, so they get asserted here: adding a language
// that breaks either one fails this test with the fix in the message, rather
// than shipping a header that overlaps or two chips that read identically.
import { LANGUAGES, languageShortLabel } from '@/constants';

describe('languageShortLabel', () => {
  it('maps the known awkward codes to their primary subtag', () => {
    expect(languageShortLabel('tlh-Latn')).toBe('TLH');
    expect(languageShortLabel('zh-Hans')).toBe('ZH');
    expect(languageShortLabel('sr-Latn')).toBe('SR');
    expect(languageShortLabel('mww')).toBe('MWW');
    expect(languageShortLabel('en')).toBe('EN');
  });

  it('is case-insensitive (stored codes are sometimes lowercased)', () => {
    expect(languageShortLabel('ZH-HANS')).toBe('ZH');
    expect(languageShortLabel('tlh-latn')).toBe('TLH');
  });

  it('stays within 3 characters for every registry language', () => {
    const long = LANGUAGES.filter((l) => languageShortLabel(l.code).length > 3).map(
      (l) => `${l.code} → ${languageShortLabel(l.code)}`,
    );
    expect(long).toEqual([]);
  });

  it('is unique across the registry — no two languages share a chip', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const l of LANGUAGES) {
      const short = languageShortLabel(l.code);
      const prev = seen.get(short);
      if (prev != null) clashes.push(`${short}: ${prev} vs ${l.code}`);
      else seen.set(short, l.code);
    }
    // Fix a failure by adding an explicit SHORT_OVERRIDES entry in
    // src/constants/languages.ts for the newer of the two codes.
    expect(clashes).toEqual([]);
  });

  it('never returns an empty label', () => {
    for (const l of LANGUAGES) expect(languageShortLabel(l.code).length).toBeGreaterThan(0);
  });
});
