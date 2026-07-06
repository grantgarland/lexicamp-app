// Translation domain — typed to the Azure Translator v3 Dictionary Lookup
// contract (the locked provider; spec: lexicamp-project/16-translation-api-and-
// capture-gate.md). The DataSource returns these shapes whether the data came
// from the mock, the translations_cache, or a live dictionary call — screens
// never see provider internals.
import type { LanguageCode } from './types';

/** Azure posTag values. NB: tagged on the ENGLISH side of the pair (16 §1) —
 *  display metadata only, never gate logic. */
export type PosTag =
  | 'ADJ'
  | 'ADV'
  | 'CONJ'
  | 'DET'
  | 'MODAL'
  | 'NOUN'
  | 'PREP'
  | 'PRON'
  | 'VERB'
  | 'OTHER';

/** i18n key for a posTag ('pos.NOUN' → "noun" / "sustantivo"). */
export const posTagI18nKey = (tag: PosTag): string => `pos.${tag}`;

/** One sense from dictionary/lookup `translations[]`. */
export interface DictionarySense {
  normalizedTarget: string;
  displayTarget: string;
  posTag: PosTag;
  /** 0–1 "probability in the training data". */
  confidence: number;
  /** Gendered determiner for the target ('la' for mosca), '' when none. */
  prefixWord: string;
  backTranslations: BackTranslation[];
}

export interface BackTranslation {
  normalizedText: string;
  displayText: string;
  /** >0 ⇒ dictionary/examples has sentences for this pair. */
  numExamples: number;
  /** Corpus frequency — sort key (most frequent first). */
  frequencyCount: number;
}

/** dictionary/examples row (fetched lazily; cached). */
export interface UsageExample {
  sourcePrefix: string;
  sourceTerm: string;
  sourceSuffix: string;
  targetPrefix: string;
  targetTerm: string;
  targetSuffix: string;
}

/** How the entry cleared the capture gate (16 §2). */
export type EntryKind = 'word' | 'phrase' | 'phrase_mt';

/** A successful lookup — the shape TranslationCard renders. */
export interface LookupResult {
  /** translations_cache row id — the key for save_card and examples (16 §2). */
  translationId: string;
  /** Cache-key form (NFC, lowercased). */
  normalizedSource: string;
  /** User-facing form ('John' vs 'john'). */
  displaySource: string;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  /** Primary sense first, rest ordered by confidence (top 5 kept). */
  senses: DictionarySense[];
  entryKind: EntryKind;
  /** azure_dictionary | azure_mt (mirrors translations_cache.provider). */
  provider: 'azure_dictionary' | 'azure_mt';
  /** Lazily populated (16 §3). */
  examples?: UsageExample[];
}

/** Lookup outcome: found, gate-rejected (422 path), or dictionary+fallback miss. */
export type LookupOutcome =
  | { status: 'found'; result: LookupResult }
  | { status: 'rejected'; reason: import('./capture').CaptureRejectReason }
  | { status: 'not_found' };
