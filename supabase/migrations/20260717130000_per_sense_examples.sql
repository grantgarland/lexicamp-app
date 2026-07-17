-- Per-sense examples (Casey bug, 2026-07-17): sibling sense cards of one
-- headword ("house" → 집 / 주택) were sharing ONE cached example set, generated
-- against the PRIMARY sense only (the examples fn always sent row.translation
-- to Azure). translations_cache.examples becomes a jsonb MAP keyed by the
-- sense's normalized target term:
--   { "집": [UsageExample…], "주택": [UsageExample…] }
-- Legacy array rows were generated for the primary sense — key them to it.
-- The examples Edge Function now takes an optional targetTerm, validates it
-- against the row's senses, and calls dictionary/examples with THAT term.

update public.translations_cache
set examples = jsonb_build_object(lower(coalesce(translation, '')), examples)
where examples is not null
  and jsonb_typeof(examples) = 'array';
