create or replace function public.run_push_scheduler()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_sent int := 0;
  v_body jsonb;
begin
  for r in
    select p.id as user_id, p.timezone, np.min_due_to_notify,
           (select count(*) from public.card_fsrs_state s
             where s.user_id = p.id and s.state > 0 and s.due_at <= now()) as due_count,
           array(select pt.token from public.push_tokens pt where pt.user_id = p.id) as tokens
    from public.profiles p
    join public.notification_prefs np on np.user_id = p.id
    left join public.subscriptions sub on sub.user_id = p.id
    cross join lateral (
      select case when sub.status in ('trial', 'active', 'grace')
                  then np.windows else '[{"time":"19:00"}]'::jsonb end as eff_windows,
             case when sub.status in ('trial', 'active', 'grace')
                  then np.days else array[0,1,2,3,4,5,6] end as eff_days
    ) eff
    where np.enabled
      and extract(dow from (now() at time zone p.timezone))::int = any (eff.eff_days)
      and exists (select 1 from public.push_tokens pt where pt.user_id = p.id)
      and not exists (
        select 1 from public.push_log pl
        where pl.user_id = p.id and pl.sent_on = (now() at time zone p.timezone)::date
      )
      and exists (
        select 1 from jsonb_array_elements(eff.eff_windows) w
        where abs(extract(epoch from (
          (now() at time zone p.timezone)::time - (w->>'time')::time
        ))) <= 1800
      )
  loop
    if r.due_count >= coalesce(r.min_due_to_notify, 1) and array_length(r.tokens, 1) > 0 then
      v_body := (
        select jsonb_agg(jsonb_build_object(
          'to', t,
          'title', 'Your words are ready',
          'body', r.due_count || ' word' || case when r.due_count = 1 then ' is' else 's are' end || ' ready for review',
          'data', jsonb_build_object('url', '/quiz')
        )) from unnest(r.tokens) t
      );
      perform net.http_post(
        url := 'https://exp.host/--/api/v2/push/send',
        headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
        body := v_body
      );
      insert into public.push_log (user_id, sent_on, due_count)
      values (r.user_id, (now() at time zone r.timezone)::date, r.due_count)
      on conflict do nothing;
      v_sent := v_sent + 1;
    end if;
  end loop;
  return v_sent;
end $$;

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
  if p_lang <> (select learning_lang from public.profiles where id = v_uid)
     and not exists (
       select 1 from public.subscriptions
       where user_id = v_uid and status in ('trial', 'active', 'grace')
     ) then
    raise exception 'premium_required' using errcode = 'P0010';
  end if;
  perform public.switch_learning_language_impl(v_uid, p_lang);
end $$;

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
    if p_lang <> (select learning_lang from public.profiles where id = v_uid) and not v_entitled then
      raise exception 'premium_required' using errcode = 'P0010';
    end if;
    perform public.switch_learning_language_impl(v_uid, p_lang);
    return;
  end if;

  if (select count(*) from public.profile_languages where user_id = v_uid) >= 1 and not v_entitled then
    raise exception 'premium_required' using errcode = 'P0010';
  end if;
  if (select count(*) from public.profile_languages where user_id = v_uid) >= 5 then
    raise exception 'language_cap' using errcode = 'P0011';
  end if;

  insert into public.profile_languages (user_id, lang) values (v_uid, p_lang);
  perform public.ensure_deck_for_language(v_uid, p_lang);
  update public.profiles set learning_lang = p_lang where id = v_uid;
end $$;;
