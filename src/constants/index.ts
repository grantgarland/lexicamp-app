// App-level shared constants barrel. Import from `@/constants` (never reach into
// screen-local consts). Only genuinely shared, non-secret values belong here;
// screen-specific values stay co-located with their screen.
export {
  LANGUAGES,
  TRANSLATABLE_LANGUAGES,
  LOCALIZED_LANGUAGES,
  findLanguage,
  languageDisplayName,
  textHasScript,
  type Language,
  type TextDirection,
  type ScriptTag,
} from './languages';
