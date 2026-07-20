alter table public.notification_prefs
  add column days int[] not null default '{0,1,2,3,4,5,6}'
  constraint notification_prefs_days_valid
    check (days <@ array[0,1,2,3,4,5,6] and array_length(days, 1) >= 1);

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
    where np.enabled
      -- Phase C: respect the user's weekday selection in THEIR timezone.
      and extract(dow from (now() at time zone p.timezone))::int = any (np.days)
      and exists (select 1 from public.push_tokens pt where pt.user_id = p.id)
      and not exists (
        select 1 from public.push_log pl
        where pl.user_id = p.id and pl.sent_on = (now() at time zone p.timezone)::date
      )
      and exists (
        select 1 from jsonb_array_elements(np.windows) w
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
end $$;;
