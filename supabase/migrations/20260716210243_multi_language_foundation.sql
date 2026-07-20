create table public.profile_languages (
  user_id uuid not null references public.profiles(id) on delete cascade,
  lang text not null references public.languages(code),
  added_at timestamptz not null default now(),
  primary key (user_id, lang)
);

alter table public.profile_languages enable row level security;
create policy profile_languages_select_own on public.profile_languages
  for select to authenticated using (auth.uid() = user_id);

insert into public.profile_languages (user_id, lang)
select id, learning_lang from public.profiles
on conflict do nothing;

create function public.ensure_deck_for_language(p_uid uuid, p_lang text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_native text;
  v_deck_name text;
begin
  select native_lang into v_native from public.profiles where id = p_uid;
  if not exists (
    select 1 from public.decks where user_id = p_uid and target_lang = p_lang
  ) then
    select name into v_deck_name from public.languages where code = p_lang;
    insert into public.decks (user_id, name, source_lang, target_lang)
    values (p_uid, coalesce(v_deck_name, 'My words'), v_native, p_lang);
  end if;
end $$;

create function public.switch_learning_language_impl(p_uid uuid, p_lang text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.profile_languages where user_id = p_uid and lang = p_lang) then
    raise exception 'not_enrolled' using errcode = 'P0002';
  end if;
  perform public.ensure_deck_for_language(p_uid, p_lang);
  update public.profiles set learning_lang = p_lang where id = p_uid;
end $$;

create function public.add_learning_language(p_lang text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
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
  if exists (select 1 from public.profile_languages where user_id = v_uid and lang = p_lang) then
    perform public.switch_learning_language_impl(v_uid, p_lang);
    return;
  end if;
  if (select count(*) from public.profile_languages where user_id = v_uid) >= 1
     and not exists (
       select 1 from public.subscriptions
       where user_id = v_uid and status in ('trial', 'active', 'grace')
     ) then
    raise exception 'premium_required' using errcode = 'P0010';
  end if;
  if (select count(*) from public.profile_languages where user_id = v_uid) >= 5 then
    raise exception 'language_cap' using errcode = 'P0011';
  end if;

  insert into public.profile_languages (user_id, lang) values (v_uid, p_lang);
  perform public.ensure_deck_for_language(v_uid, p_lang);
  update public.profiles set learning_lang = p_lang where id = v_uid;
end $$;

create function public.switch_learning_language(p_lang text)
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

create function public.remove_learning_language(p_lang text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profile_languages where user_id = v_uid and lang = p_lang) then
    raise exception 'not_enrolled' using errcode = 'P0002';
  end if;
  if p_lang = (select learning_lang from public.profiles where id = v_uid) then
    raise exception 'language_active' using errcode = 'P0012';
  end if;
  delete from public.profile_languages where user_id = v_uid and lang = p_lang;
end $$;

create or replace function public.complete_onboarding(
  p_native_lang text, p_learning_lang text, p_timezone text,
  p_display_name text default null, p_notifications_enabled boolean default false
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_deck_name text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if exists (select 1 from public.profiles where id = v_uid) then
    return;
  end if;

  if p_native_lang = p_learning_lang then
    raise exception 'native and learning language must differ' using errcode = '22023';
  end if;

  insert into public.profiles (id, display_name, native_lang, learning_lang, timezone, onboarding_complete)
  values (v_uid, nullif(trim(coalesce(p_display_name, '')), ''), p_native_lang, p_learning_lang,
          coalesce(nullif(trim(p_timezone), ''), 'UTC'), true);

  select name into v_deck_name from public.languages where code = p_learning_lang;
  insert into public.decks (user_id, name, source_lang, target_lang)
  values (v_uid, coalesce(v_deck_name, 'My words'), p_native_lang, p_learning_lang);

  insert into public.profile_languages (user_id, lang)
  values (v_uid, p_learning_lang)
  on conflict do nothing;

  insert into public.notification_prefs (user_id, enabled)
  values (v_uid, p_notifications_enabled)
  on conflict (user_id) do nothing;
end $$;

revoke execute on function public.ensure_deck_for_language(uuid, text) from public, anon, authenticated;
revoke execute on function public.switch_learning_language_impl(uuid, text) from public, anon, authenticated;
revoke execute on function public.add_learning_language(text) from public, anon;
revoke execute on function public.switch_learning_language(text) from public, anon;
revoke execute on function public.remove_learning_language(text) from public, anon;
grant execute on function public.add_learning_language(text) to authenticated;
grant execute on function public.switch_learning_language(text) to authenticated;
grant execute on function public.remove_learning_language(text) to authenticated;;
