-- Onboarding data flow (03): profile + first deck + notification_prefs are
-- created transactionally once the account exists. IDEMPOTENT and never
-- overwrites: an existing profile returns immediately, so the client may call
-- this after every successful auth (sign-up or sign-in) without risk of
-- clobbering a real account with a stale onboarding buffer.
create or replace function public.complete_onboarding(
  p_native_lang text,
  p_learning_lang text,
  p_timezone text,
  p_display_name text default null,
  p_notifications_enabled boolean default false
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_deck_name text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Idempotency: profile exists → onboarding already completed somewhere.
  if exists (select 1 from public.profiles where id = v_uid) then
    return;
  end if;

  if p_native_lang = p_learning_lang then
    raise exception 'native and learning language must differ' using errcode = '22023';
  end if;

  -- 1. Profile (langs FK-validated against languages).
  insert into public.profiles (id, display_name, native_lang, learning_lang, timezone, onboarding_complete)
  values (v_uid, nullif(trim(coalesce(p_display_name, '')), ''), p_native_lang, p_learning_lang,
          coalesce(nullif(trim(p_timezone), ''), 'UTC'), true);

  -- 2. First deck, seeded from the pair; named after the learning language.
  select name into v_deck_name from public.languages where code = p_learning_lang;
  insert into public.decks (user_id, name, source_lang, target_lang)
  values (v_uid, coalesce(v_deck_name, 'My words'), p_native_lang, p_learning_lang);

  -- 3. Notification prefs with the 03 onboarding defaults.
  insert into public.notification_prefs (user_id, enabled)
  values (v_uid, p_notifications_enabled)
  on conflict (user_id) do nothing;
end $$;

revoke execute on function public.complete_onboarding(text, text, text, text, boolean) from public, anon;
grant execute on function public.complete_onboarding(text, text, text, text, boolean) to authenticated;;
