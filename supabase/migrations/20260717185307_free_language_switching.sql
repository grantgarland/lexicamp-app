-- Free-tier language SWITCHING unlocked (Casey ruling, 2026-07-17 — revises
-- one clause of 18 §D12). Rationale: the only way a free user has multiple
-- enrolled languages is a premium demotion, and D12's covenant is that
-- demotion never takes away what a user earned. Gating the switch effectively
-- "deleted" their other languages' words from reach. Same principle as the
-- word-count/cap rulings: data (and access to it) survives demotion; only
-- ACQUISITION is premium — adding a NEW language keeps the premium gate.
--
-- Net policy: switch between ENROLLED languages = free for everyone;
-- add an UNENROLLED language past the first = premium (cap 5, unchanged).

-- Switching: auth check only. (Idempotent no-op case falls through to _impl.)
create or replace function public.switch_learning_language(p_lang text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.switch_learning_language_impl(v_uid, p_lang);
end $$;

-- add_learning_language: the already-enrolled branch no longer carries the
-- (now removed) switch gate — it just switches. New-language enrollment keeps
-- the premium gate + cap. Body otherwise identical to the live definition.
create or replace function public.add_learning_language(p_lang text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_entitled boolean;
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

  if exists (select 1 from public.profile_languages where user_id = v_uid and lang = p_lang) then
    -- Already enrolled → plain switch (free for everyone, per this migration).
    perform public.switch_learning_language_impl(v_uid, p_lang);
    return;
  end if;

  if (select count(*) from public.profile_languages where user_id = v_uid) >= 1 and not v_entitled then
    raise exception 'premium_required' using errcode = 'P0010';
  end if;
  if (select count(*) from public.profile_languages where user_id = v_uid) >= 5 then
    raise exception 'language_cap' using errcode = 'P0011';
  end if;

  -- Tail taken from the LIVE definition (pg_get_functiondef, 2026-07-17) —
  -- NOT the local mirror, which had drifted (the 17b lesson, applied).
  insert into public.profile_languages (user_id, lang) values (v_uid, p_lang);
  perform public.ensure_deck_for_language(v_uid, p_lang);
  update public.profiles set learning_lang = p_lang where id = v_uid;
end $$;;
