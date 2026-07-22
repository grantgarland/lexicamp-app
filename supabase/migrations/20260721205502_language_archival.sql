-- Language archival (Casey rulings, 2026-07-21):
--   1. Removing a learning language ARCHIVES the enrollment (archived_at flag)
--      instead of deleting the profile_languages row. Cards/decks/history were
--      already untouched; the flag makes the state explicit and queryable, and
--      preserves added_at across remove→re-add cycles.
--   2. FREE RESTORE: re-adding a language the user was previously enrolled in
--      bypasses the premium gate (D12 covenant — demotion never takes away what
--      was earned; a delete must not be a premium trap). The 5-language cap
--      still applies, counting ACTIVE (non-archived) enrollments only.
--   3. The active language cannot be archived (unchanged: language_active).
--
-- Function bodies derive from the LIVE definitions: add_learning_language /
-- switch_learning_language from 20260717185307 (taken from pg_get_functiondef
-- on 2026-07-17); remove_learning_language / switch_learning_language_impl
-- from 20260716210243, untouched since (list_migrations verified 2026-07-21 —
-- no later migration touches these).

alter table public.profile_languages
  add column archived_at timestamptz;

comment on column public.profile_languages.archived_at is
  'Non-null = enrollment archived (language "deleted" in UI). Cards/decks/history are kept; add_learning_language restores free of charge.';

-- Enrolled-and-active now means archived_at is null; an archived language can
-- be neither switched to nor kept as the profile''s learning_lang (the remove
-- RPC already forbids archiving the active language, so no backfill needed).
create or replace function public.switch_learning_language_impl(p_uid uuid, p_lang text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profile_languages
    where user_id = p_uid and lang = p_lang and archived_at is null
  ) then
    raise exception 'not_enrolled' using errcode = 'P0002';
  end if;
  perform public.ensure_deck_for_language(p_uid, p_lang);
  update public.profiles set learning_lang = p_lang where id = p_uid;
end $$;

-- Archive instead of delete. Idempotence: archiving an already-archived
-- language raises not_enrolled (the UI never lists archived languages).
create or replace function public.remove_learning_language(p_lang text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profile_languages
    where user_id = v_uid and lang = p_lang and archived_at is null
  ) then
    raise exception 'not_enrolled' using errcode = 'P0002';
  end if;
  if p_lang = (select learning_lang from public.profiles where id = v_uid) then
    raise exception 'language_active' using errcode = 'P0012';
  end if;

  update public.profile_languages set archived_at = now()
  where user_id = v_uid and lang = p_lang;

  insert into public.study_events (user_id, event, props)
  values (v_uid, 'language_archived', jsonb_build_object('lang', p_lang));
end $$;

-- add_learning_language, three branches:
--   active enrollment      → plain switch (free, unchanged)
--   ARCHIVED enrollment    → free restore: cap check (active count), clear the
--                            flag, ensure deck, switch. NO premium gate.
--   no enrollment          → new acquisition: premium past the first + cap
--                            (both counting active enrollments only).
create or replace function public.add_learning_language(p_lang text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_entitled boolean;
  v_active_count integer;
  v_archived boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.languages where code = p_lang) then
    raise exception 'unknown language' using errcode = 'P0002';
  end if;
  if p_lang = (select native_lang from public.profiles where id = v_uid) then
    raise exception 'native and learning language must differ' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.subscriptions
    where user_id = v_uid and status in ('trial', 'active', 'grace')
  ) into v_entitled;

  select count(*) filter (where archived_at is null)
  into v_active_count
  from public.profile_languages where user_id = v_uid;

  select (archived_at is not null) into v_archived
  from public.profile_languages
  where user_id = v_uid and lang = p_lang;

  if v_archived is false then
    -- Actively enrolled → plain switch (free for everyone, 20260717185307).
    perform public.switch_learning_language_impl(v_uid, p_lang);
    return;
  end if;

  if v_archived is true then
    -- FREE RESTORE (Casey, 2026-07-21): the language was theirs; no premium
    -- gate. Cap still enforced — restoring must not exceed 5 active languages.
    if v_active_count >= 5 then
      raise exception 'language_cap' using errcode = 'P0011';
    end if;
    update public.profile_languages set archived_at = null
    where user_id = v_uid and lang = p_lang;
    perform public.ensure_deck_for_language(v_uid, p_lang);
    update public.profiles set learning_lang = p_lang where id = v_uid;
    insert into public.study_events (user_id, event, props)
    values (v_uid, 'language_restored', jsonb_build_object('lang', p_lang));
    return;
  end if;

  -- v_archived is null → never enrolled: acquisition keeps the premium gate.
  if v_active_count >= 1 and not v_entitled then
    raise exception 'premium_required' using errcode = 'P0010';
  end if;
  if v_active_count >= 5 then
    raise exception 'language_cap' using errcode = 'P0011';
  end if;

  insert into public.profile_languages (user_id, lang) values (v_uid, p_lang);
  perform public.ensure_deck_for_language(v_uid, p_lang);
  update public.profiles set learning_lang = p_lang where id = v_uid;
end $$;;
