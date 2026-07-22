// Canonical language registry — single source of truth for every language the app
// can translate into and/or render its UI in. Derived from the Azure Translator
// "languages" (translation) set, so `code` values are the exact BCP-47 tags the
// Translator API expects (e.g. 'zh-Hans', 'sr-Latn', 'mww'). Screens NEVER hardcode
// their own language lists — they read from here (mirrors the `TIERS` registry in
// theme/tiers.ts). Adding a language = one row here.
//
// Fields:
//   code        Azure Translator / BCP-47 tag (case-sensitive for the API).
//   name        English display name (exonym).
//   nativeName  Endonym — how speakers write the language's own name (e.g. العربية).
//   dir         Text direction; drives writingDirection/textAlign for native text.
//   script      ISO 15924 script tag. Drives the capture gate's script-consistency
//               check (16 §2 Tier 0): input that contains letters but none in the
//               source language's script is almost certainly the wrong direction.
//   translatable  Supported as a translation target by Azure Translator (capture/search).
//   localized     App interface is fully translated into this language (locale bundle
//                 exists in src/i18n/locales). Today: English + Spanish.
//   flag          Emoji flag for the leaderboard's language column (20 §4.3) — a
//                 country conventionally associated with the language, NOT a claim
//                 of national ownership. Languages with no single country mapping
//                 (stateless, fictional) get 🌐.
import type { LanguageCode } from '@/domain/types';

export type TextDirection = 'ltr' | 'rtl';

/** ISO 15924 script tags used across the registry (extend as languages are added). */
export type ScriptTag =
  | 'Latn'
  | 'Arab'
  | 'Cyrl'
  | 'Grek'
  | 'Hebr'
  | 'Deva'
  | 'Beng'
  | 'Taml'
  | 'Thai'
  | 'Hans'
  | 'Jpan'
  | 'Kore';

export interface Language {
  code: LanguageCode;
  name: string;
  nativeName: string;
  dir: TextDirection;
  script: ScriptTag;
  translatable: boolean;
  localized: boolean;
  flag: string;
}

// Tuple form keeps the table dense + auditable against the Azure Translator list.
type Row = [
  code: string,
  name: string,
  nativeName: string,
  dir: TextDirection,
  script: ScriptTag,
  translatable: boolean,
  localized: boolean,
  flag: string,
];

const ROWS: Row[] = [
  ['en', 'English', 'English', 'ltr', 'Latn', true, true, '🇺🇸'],
  ['es', 'Spanish', 'Español', 'ltr', 'Latn', true, true, '🇪🇸'],
  ['af', 'Afrikaans', 'Afrikaans', 'ltr', 'Latn', true, false, '🇿🇦'],
  ['ar', 'Arabic', 'العربية', 'rtl', 'Arab', true, false, '🇸🇦'],
  ['bg', 'Bulgarian', 'Български', 'ltr', 'Cyrl', true, false, '🇧🇬'],
  ['bn', 'Bangla', 'বাংলা', 'ltr', 'Beng', true, false, '🇧🇩'],
  ['bs', 'Bosnian', 'Bosanski', 'ltr', 'Latn', true, false, '🇧🇦'],
  ['ca', 'Catalan', 'Català', 'ltr', 'Latn', true, false, '🇦🇩'],
  ['cs', 'Czech', 'Čeština', 'ltr', 'Latn', true, false, '🇨🇿'],
  ['cy', 'Welsh', 'Cymraeg', 'ltr', 'Latn', true, false, '🇬🇧'],
  ['da', 'Danish', 'Dansk', 'ltr', 'Latn', true, false, '🇩🇰'],
  ['de', 'German', 'Deutsch', 'ltr', 'Latn', true, false, '🇩🇪'],
  ['el', 'Greek', 'Ελληνικά', 'ltr', 'Grek', true, false, '🇬🇷'],
  ['et', 'Estonian', 'Eesti', 'ltr', 'Latn', true, false, '🇪🇪'],
  ['fa', 'Persian', 'فارسی', 'rtl', 'Arab', true, false, '🇮🇷'],
  ['fi', 'Finnish', 'Suomi', 'ltr', 'Latn', true, false, '🇫🇮'],
  ['fr', 'French', 'Français', 'ltr', 'Latn', true, false, '🇫🇷'],
  ['he', 'Hebrew', 'עברית', 'rtl', 'Hebr', true, false, '🇮🇱'],
  ['hi', 'Hindi', 'हिन्दी', 'ltr', 'Deva', true, false, '🇮🇳'],
  ['hr', 'Croatian', 'Hrvatski', 'ltr', 'Latn', true, false, '🇭🇷'],
  ['hu', 'Hungarian', 'Magyar', 'ltr', 'Latn', true, false, '🇭🇺'],
  ['id', 'Indonesian', 'Indonesia', 'ltr', 'Latn', true, false, '🇮🇩'],
  ['is', 'Icelandic', 'Íslenska', 'ltr', 'Latn', true, false, '🇮🇸'],
  ['it', 'Italian', 'Italiano', 'ltr', 'Latn', true, false, '🇮🇹'],
  ['ja', 'Japanese', '日本語', 'ltr', 'Jpan', true, false, '🇯🇵'],
  ['ko', 'Korean', '한국어', 'ltr', 'Kore', true, false, '🇰🇷'],
  ['lt', 'Lithuanian', 'Lietuvių', 'ltr', 'Latn', true, false, '🇱🇹'],
  ['lv', 'Latvian', 'Latviešu', 'ltr', 'Latn', true, false, '🇱🇻'],
  ['ms', 'Malay', 'Melayu', 'ltr', 'Latn', true, false, '🇲🇾'],
  ['mt', 'Maltese', 'Malti', 'ltr', 'Latn', true, false, '🇲🇹'],
  ['mww', 'Hmong Daw', 'Hmong Daw', 'ltr', 'Latn', true, false, '🌐'],
  ['nb', 'Norwegian', 'Norsk Bokmål', 'ltr', 'Latn', true, false, '🇳🇴'],
  ['nl', 'Dutch', 'Nederlands', 'ltr', 'Latn', true, false, '🇳🇱'],
  ['pl', 'Polish', 'Polski', 'ltr', 'Latn', true, false, '🇵🇱'],
  ['pt', 'Portuguese (Brazil)', 'Português (Brasil)', 'ltr', 'Latn', true, false, '🇧🇷'],
  ['ro', 'Romanian', 'Română', 'ltr', 'Latn', true, false, '🇷🇴'],
  ['ru', 'Russian', 'Русский', 'ltr', 'Cyrl', true, false, '🇷🇺'],
  ['sk', 'Slovak', 'Slovenčina', 'ltr', 'Latn', true, false, '🇸🇰'],
  ['sl', 'Slovenian', 'Slovenščina', 'ltr', 'Latn', true, false, '🇸🇮'],
  ['sr-Latn', 'Serbian', 'Srpski', 'ltr', 'Latn', true, false, '🇷🇸'],
  ['sv', 'Swedish', 'Svenska', 'ltr', 'Latn', true, false, '🇸🇪'],
  ['sw', 'Swahili', 'Kiswahili', 'ltr', 'Latn', true, false, '🇹🇿'],
  ['ta', 'Tamil', 'தமிழ்', 'ltr', 'Taml', true, false, '🇮🇳'],
  ['th', 'Thai', 'ไทย', 'ltr', 'Thai', true, false, '🇹🇭'],
  ['tlh-Latn', 'Klingon', 'Klingon', 'ltr', 'Latn', true, false, '🌐'],
  ['tr', 'Turkish', 'Türkçe', 'ltr', 'Latn', true, false, '🇹🇷'],
  ['uk', 'Ukrainian', 'Українська', 'ltr', 'Cyrl', true, false, '🇺🇦'],
  ['ur', 'Urdu', 'اردو', 'rtl', 'Arab', true, false, '🇵🇰'],
  ['vi', 'Vietnamese', 'Tiếng Việt', 'ltr', 'Latn', true, false, '🇻🇳'],
  ['zh-Hans', 'Chinese', '中文 (简体)', 'ltr', 'Hans', true, false, '🇨🇳'],
];

/** Every known language, registry order. */
export const LANGUAGES: Language[] = ROWS.map(([code, name, nativeName, dir, script, translatable, localized, flag]) => ({
  code,
  name,
  nativeName,
  dir,
  script,
  translatable,
  localized,
  flag,
}));

// Case-insensitive lookup: API tags are case-sensitive but callers often pass
// lowercased codes (e.g. stored 'zh-hans'), so we index by lowercase.
const BY_CODE: Record<string, Language> = Object.fromEntries(LANGUAGES.map((l) => [l.code.toLowerCase(), l]));

/** Resolve a language by code (case-insensitive); undefined if unknown. */
export function findLanguage(code: LanguageCode): Language | undefined {
  return BY_CODE[code.toLowerCase()];
}

/** English display name for a code, falling back to the uppercased code. */
export function languageDisplayName(code: LanguageCode): string {
  return findLanguage(code)?.name ?? code.toUpperCase();
}

// Unicode Script property matchers per ISO 15924 tag. Japanese spans three scripts
// (kanji + kana); everything else maps to a single \p{Script=…} class.
const SCRIPT_MATCHER: Record<ScriptTag, RegExp> = {
  Latn: /\p{Script=Latin}/u,
  Arab: /\p{Script=Arabic}/u,
  Cyrl: /\p{Script=Cyrillic}/u,
  Grek: /\p{Script=Greek}/u,
  Hebr: /\p{Script=Hebrew}/u,
  Deva: /\p{Script=Devanagari}/u,
  Beng: /\p{Script=Bengali}/u,
  Taml: /\p{Script=Tamil}/u,
  Thai: /\p{Script=Thai}/u,
  Hans: /\p{Script=Han}/u,
  Jpan: /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u,
  Kore: /\p{Script=Hangul}/u,
};

/** True if `text` contains at least one letter in the given script. */
export function textHasScript(text: string, script: ScriptTag): boolean {
  return SCRIPT_MATCHER[script].test(text);
}

/** Languages selectable as a translation/learning target (Azure Translator set). */
export const TRANSLATABLE_LANGUAGES: Language[] = LANGUAGES.filter((l) => l.translatable);

/** Languages the app UI is fully localized into (locale bundles present). */
export const LOCALIZED_LANGUAGES: Language[] = LANGUAGES.filter((l) => l.localized);
