-- P2 hygiene from the 2026-08-06 prod-readiness audit (21-ios-launch-prod-readiness.md
-- items 12 and 13). Performance only — no behaviour, no grant, no policy-scope change
-- that alters who can see what.
--
-- 1. auth_rls_initplan: five policies still call auth.uid() bare, so Postgres
--    re-evaluates it once PER ROW instead of hoisting it to an InitPlan. Every
--    other policy in this schema already uses the (select auth.uid()) form; these
--    are the stragglers from 20260728205146_card_target_overrides.sql and
--    20260716210243_multi_language_foundation.sql. Same predicate, same result set —
--    only the plan changes.
--
-- 2. cards.translation_id had no covering index. It is the one unindexed FK in the
--    schema with real cardinality (one row per saved card) and it backs the cascade
--    path from translations_cache. The other seven the linter flags all point at
--    `languages`, which has a few dozen rows — an index there would never be chosen,
--    so they are deliberately left alone.

-- ── 1. card_target_overrides (4 policies) ───────────────────────────────────
-- Also scoped to `authenticated` while being rewritten. They were created without
-- a `to` clause, so they applied to `public` (which includes `anon`). That was
-- already a no-op in practice — anon carries no JWT, so auth.uid() is null and
-- `user_id = null` never matches — but every other policy in this schema names
-- the role, and matching them removes a thing a future reader has to reason about.

drop policy if exists card_target_overrides_select_own on public.card_target_overrides;
create policy card_target_overrides_select_own on public.card_target_overrides
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists card_target_overrides_insert_own on public.card_target_overrides;
create policy card_target_overrides_insert_own on public.card_target_overrides
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists card_target_overrides_update_own on public.card_target_overrides;
create policy card_target_overrides_update_own on public.card_target_overrides
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists card_target_overrides_delete_own on public.card_target_overrides;
create policy card_target_overrides_delete_own on public.card_target_overrides
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ── 2. profile_languages (1 policy) ─────────────────────────────────────────
-- Already correctly scoped to authenticated; only the initplan form changes.

drop policy if exists profile_languages_select_own on public.profile_languages;
create policy profile_languages_select_own on public.profile_languages
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- ── 3. cards.translation_id covering index ──────────────────────────────────

create index if not exists cards_translation_idx on public.cards (translation_id);

-- ── Deliberately NOT done ───────────────────────────────────────────────────
-- • `username_check_log` "no primary key" (lint 0004) is a FALSE POSITIVE here.
--   It is an UNLOGGED sliding-window rate-limit table: the username-availability
--   check deletes everything outside the window, counts what remains, and inserts
--   one row. The rows have no identity worth addressing and never outlive the
--   window, and the (user_id, checked_at) index the limiter actually uses already
--   exists. A surrogate PK would add a sequence and a second index to a table
--   whose entire job is to be cheap.
--
-- • `push_send_user_created_idx` "unused index" (lint 0005) is also a false
--   positive. push_send holds ~121 rows, so the planner seq-scans it and the
--   index never records a use — but it covers send_test_push's dedupe probe
--   (user_id + created_at > now() - 1 minute) and will start being chosen the
--   moment the table has real volume. Dropping it now would mean re-adding it
--   later, and dropping an index you will need is the worse error.

notify pgrst, 'reload schema';
