// mapWordListItem orientation — the word list must ALWAYS lead with the language
// being studied. translations_cache rows are stored in SEARCH direction, so
// rendering them raw made the list flip row by row depending on which way the
// user happened to search (bath/баня sitting above принимать/take).
import { mapWordListItem, type TranslationJoin } from '../mappers';

const card = {
  id: 'c1', deck_id: 'd1', user_id: 'u1', translation_id: 't1',
  user_note: null, custom_front: null, custom_back: null,
  suspended: false, created_at: '2026-08-01T00:00:00Z',
} as never;

const fsrs = {
  card_id: 'c1', user_id: 'u1', stability: 1, difficulty: 5,
  due_at: '2026-08-02T00:00:00Z', last_review_at: null, state: 2,
  reps: 3, lapses: 0, learning_steps: 0,
} as never;

/** Looked up EN→RU: display_source English, translation Russian. */
const enToRu = {
  id: 't1', display_source: 'take', translation: 'принимать',
  source_lang: 'en', target_lang: 'ru',
  pos_tag: null, prefix_word: null, examples: null, provider: 'azure_dictionary',
} as unknown as TranslationJoin;

/** Looked up RU→EN: display_source Russian, translation English. */
const ruToEn = {
  id: 't2', display_source: 'баня', translation: 'bath',
  source_lang: 'ru', target_lang: 'en',
  pos_tag: null, prefix_word: null, examples: null, provider: 'azure_dictionary',
} as unknown as TranslationJoin;

const CYRILLIC = /[Ѐ-ӿ]/;

describe('mapWordListItem orientation', () => {
  it('keeps EN→RU rows as-is (Russian is already the headword)', () => {
    const w = mapWordListItem(card, enToRu, fsrs, null, 'ru');
    expect(w.target).toBe('принимать');
    expect(w.native).toBe('take');
  });

  it('FLIPS RU→EN rows so Russian is still the headword', () => {
    const w = mapWordListItem(card, ruToEn, fsrs, null, 'ru');
    expect(w.target).toBe('баня');
    expect(w.native).toBe('bath');
  });

  it('orients both search directions identically — the list never flips per row', () => {
    const a = mapWordListItem(card, enToRu, fsrs, null, 'ru');
    const b = mapWordListItem(card, ruToEn, fsrs, null, 'ru');
    expect(CYRILLIC.test(a.target)).toBe(true);
    expect(CYRILLIC.test(b.target)).toBe(true);
    expect(CYRILLIC.test(a.native)).toBe(false);
    expect(CYRILLIC.test(b.native)).toBe(false);
  });

  it('falls back to search order when the learning language is unknown', () => {
    expect(mapWordListItem(card, ruToEn, fsrs, null, undefined).target).toBe('bath');
  });

  it('falls back when the cached row predates the lang columns', () => {
    const legacy = { ...ruToEn, source_lang: null, target_lang: null } as unknown as TranslationJoin;
    expect(mapWordListItem(card, legacy, fsrs, null, 'ru').target).toBe('bath');
  });

  it('lets a premium override replace the rendered headword, not the orientation', () => {
    const w = mapWordListItem(card, ruToEn, fsrs, 'банька', 'ru');
    expect(w.target).toBe('банька');
    expect(w.originalTarget).toBe('баня'); // the ORIENTED original, not 'bath'
    expect(w.native).toBe('bath');
  });
});
