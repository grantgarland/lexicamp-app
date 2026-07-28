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

export function senseDisplayWord(s: Pick<DictionarySense, 'prefixWord' | 'displayTarget'>): string {
  return s.prefixWord ? `${s.prefixWord} ${s.displayTarget}` : s.displayTarget;
}

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
  /** Result-quality gate (16 §2), evaluated PER SENSE. A lookup can return
   *  several senses in one card and they render as independent cards (D10:
   *  saving one never touches its siblings) — so one bad (echo) sense must
   *  never block a sibling sense that's a real, distinct translation. Absent
   *  or 'ok' ⇒ saveable. */
  quality?: ResultQuality;
  qualityReason?: ResultQualityReason;
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

export type ResultQuality = 'ok' | 'unsaveable';
/** Why a found result isn't saveable. `echo` = the translation is identical to the
 *  input (untranslated pass-through — the classic wrong-direction / unknown-term
 *  failure of the /translate fallback). Extend as new signals are validated. */
export type ResultQualityReason = 'echo';

/** i18n key for a quality reason ('translationCard.unsaveable.echo'). */
export const qualityReasonI18nKey = (r: ResultQualityReason): string => `translationCard.unsaveable.${r}`;

/** Assess whether each sense of a found result is safe to save. Pure + deterministic
 *  so the Edge Function and the client agree. Today: the identity-echo check,
 *  generalized to ANY length (16 §2 originally had it only for >3-token sources — the
 *  gap that let a single untranslated word through). `normalizedTarget`/
 *  `normalizedSource` are both NFC-lowercased cache-key forms, so an exact compare is
 *  the echo test.
 *
 *  Evaluated PER SENSE, not once for the whole result (2026-07-23 fix): a dictionary
 *  lookup can return several senses in one card, and D10 already treats them as
 *  independent (saving one never touches its siblings) — so a bad primary sense must
 *  never poison a genuinely different, valid secondary sense, and vice versa. Bug:
 *  "bobcat" (EN→RU) had an untranslated-echo primary sense, which wrongly marked the
 *  whole card unsaveable even though its second sense ("рысь") was a real translation. */
export function assessResultQuality(
  r: Pick<LookupResult, 'normalizedSource' | 'senses'>,
): { senses: DictionarySense[] } {
  const senses = r.senses.map((s) =>
    s.normalizedTarget === r.normalizedSource ? { ...s, quality: 'unsaveable' as const, qualityReason: 'echo' as const } : s,
  );
  return { senses };
}

/** Lookup outcome: found, gate-rejected (422 path), or dictionary+fallback miss. */
export type LookupOutcome =
  | { status: 'found'; result: LookupResult }
  | { status: 'rejected'; reason: import('./capture').CaptureRejectReason }
  | { status: 'not_found' };
