// Capture gate, Tier 0 — the client pre-gate (16 §2). Pure + deterministic:
// runs on every keystroke for instant UX feedback, and the SAME rules re-run
// authoritatively in the translate Edge Function (never trust the client).
// The structural guarantee lives in Tier 2 (cards can only FK gate-approved
// translations_cache rows); this tier exists to keep junk input from ever
// costing an API call and to give users a helpful, specific reason.
import { findLanguage, textHasScript } from '@/constants';

export type CaptureRejectReason =
  | 'empty'
  | 'too_long'
  | 'too_many_words'
  | 'sentence_like'
  | 'not_a_word'
  /** Input's script doesn't match the source language — almost always the wrong
   *  translation direction (e.g. Latin text while translating FROM Arabic). */
  | 'wrong_script';

export type CaptureVerdict =
  | {
      ok: true;
      /** Cache-key form: NFC, trimmed, whitespace-collapsed, lowercased. */
      normalized: string;
      /** Original casing preserved (Azure returns its own displaySource too). */
      display: string;
    }
  | { ok: false; reason: CaptureRejectReason };

/** i18n key for a rejection ('capture.reason.sentence_like'). */
export const captureReasonI18nKey = (r: CaptureRejectReason): string => `capture.reason.${r}`;

/** Per-language overrides. Defaults fit space-delimited Latin/Cyrillic scripts. */
export interface CaptureRules {
  /** Hard ceiling — also the Azure dictionary per-item limit. */
  maxChars: number;
  /** Max whitespace-delimited tokens (ignored for unspaced scripts). */
  maxWords: number;
  /** Scripts without word spaces (zh/ja/th): gate on grapheme count instead. */
  unspaced: boolean;
  /** Grapheme ceiling for unspaced scripts. */
  maxGraphemes: number;
}

const DEFAULT_RULES: CaptureRules = { maxChars: 100, maxWords: 5, unspaced: false, maxGraphemes: 12 };

/** Language-specific rules (launch pairs use defaults; post-MVP scripts here). */
export const LANG_CAPTURE_RULES: Record<string, Partial<CaptureRules>> = {
  zh: { unspaced: true },
  'zh-Hans': { unspaced: true },
  ja: { unspaced: true },
  th: { unspaced: true },
};

export function captureRulesFor(lang: string): CaptureRules {
  return { ...DEFAULT_RULES, ...(LANG_CAPTURE_RULES[lang] ?? LANG_CAPTURE_RULES[lang.split('-')[0]] ?? {}) };
}

// ── Normalization ─────────────────────────────────────────────────────────────
/** Zero-width + control chars (keep \s handling to the collapse step). */
const CONTROL_CHARS = /[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g;
/** Wrapping punctuation users paste in: quotes, brackets, guillemets. */
const WRAP_PUNCT = /^["'«»„“”‘’()[\]¿¡]+|["'«»„“”‘’()[\].,!?…;:]+$/g;

/** NFC + strip controls + collapse whitespace + trim + shed wrapping punctuation. */
export function normalizeCaptureInput(raw: string): { normalized: string; display: string } {
  const cleaned = raw
    .normalize('NFC')
    .replace(CONTROL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(WRAP_PUNCT, '')
    .trim();
  return { normalized: cleaned.toLowerCase(), display: cleaned };
}

// ── Non-lexical detectors ─────────────────────────────────────────────────────
const URL_LIKE = /(https?:\/\/|www\.|\S+\.(com|org|net|io|dev|app)(\/|\b))/i;
const EMAIL_LIKE = /\S+@\S+\.\S+/;
const HANDLE_LIKE = /(^|\s)@\w+/;
const DIGITS_ONLY = /^[\d\s.,-]+$/;
/** Letters in any script (Unicode property escape — Hermes supports these). */
const HAS_LETTER = /\p{L}/u;
/** Sentence-internal punctuation: clause/sentence delimiters mid-string. */
const SENTENCE_PUNCT = /[.!?…;:,]/;

// ── The gate ──────────────────────────────────────────────────────────────────
export function evaluateCaptureInput(raw: string, sourceLang: string): CaptureVerdict {
  const { normalized, display } = normalizeCaptureInput(raw);
  if (normalized === '') return { ok: false, reason: 'empty' };

  const rules = captureRulesFor(sourceLang);

  if (normalized.length > rules.maxChars) return { ok: false, reason: 'too_long' };

  if (URL_LIKE.test(normalized) || EMAIL_LIKE.test(normalized) || HANDLE_LIKE.test(normalized))
    return { ok: false, reason: 'not_a_word' };
  if (DIGITS_ONLY.test(normalized) || !HAS_LETTER.test(normalized))
    return { ok: false, reason: 'not_a_word' };

  // Internal sentence punctuation (wrapping punctuation was already shed):
  // abbreviations like "e.g." are sentence-fragment material, not vocabulary.
  if (SENTENCE_PUNCT.test(normalized)) return { ok: false, reason: 'sentence_like' };

  // Script consistency: if the source language has a known script and the input
  // carries letters but none in that script, the user is almost certainly typing
  // the wrong-direction language (e.g. Latin "rat" while translating FROM Arabic).
  // Catches that class instantly, client-side, before any API call. A single
  // matching letter passes, so scripts that mix (Japanese kana + Latin) are safe.
  const sourceScript = findLanguage(sourceLang)?.script;
  if (sourceScript != null && !textHasScript(normalized, sourceScript))
    return { ok: false, reason: 'wrong_script' };

  if (rules.unspaced) {
    // Grapheme count via Intl.Segmenter when available (Hermes ships it);
    // Array.from (code points) is an acceptable fallback for the gate's purpose.
    const count =
      typeof Intl !== 'undefined' && 'Segmenter' in Intl
        ? [...new Intl.Segmenter(sourceLang, { granularity: 'grapheme' }).segment(normalized)].length
        : Array.from(normalized).length;
    if (count > rules.maxGraphemes) return { ok: false, reason: 'too_long' };
  } else if (normalized.split(' ').length > rules.maxWords) {
    return { ok: false, reason: 'too_many_words' };
  }

  return { ok: true, normalized, display };
}
