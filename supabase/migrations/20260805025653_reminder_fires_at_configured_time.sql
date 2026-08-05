-- Reminders fired 30 MINUTES EARLY, every day, for every user (2026-08-04).
--
-- The window test was symmetric: abs(local - window) <= 1800. With the scheduler
-- on */15, the FIRST tick inside a 09:00 window is 08:30 -- and push_log's
-- once-per-day guard then locks that in as the day's send. Every row in push_log
-- lands at 12:30Z = 08:30 America/New_York, against a stored window of 09:00.
-- The 2026-07-21 row at 22:30Z = 18:30 local is the same bug against the old
-- 19:00 default, which rules out anything specific to the 9am migration.
-- Settings said 9:00; the phone buzzed at 8:30.
--
-- Now one-sided: fire AT or AFTER the configured time, never before. The 30
-- minutes becomes trailing tolerance so a missed cron tick does not silently
-- skip someone's day, rather than a licence to arrive early.
--
-- The wrap arm is not hypothetical tidiness: a late-night window (23:50) could
-- never fire under the old test, because after midnight the time subtraction is
-- ~-23h and abs() puts it far outside 1800s. It now fires at 00:00.
--   KNOWN EDGE, documented rather than hidden: when a window wraps past
--   midnight the dow check below reads the NEW day, so a Monday-only 23:50
--   reminder is evaluated against Tuesday. Firing slightly late on the wrong
--   dow beats never firing at all, but it is wrong; fixing it properly means
--   resolving the window to a timestamp, not a time.
create or replace function public.run_push_scheduler()
returns integer
language plpgsql security definer set search_path = ''
as $fn$
declare
  r record; v_sent int := 0; v_token text; v_body text;
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
                  then np.windows else '[{"time":"09:00"}]'::jsonb end as eff_windows,
             case when sub.status in ('trial', 'active', 'grace')
                  then np.days else array[0,1,2,3,4,5,6] end as eff_days
    ) eff
    where np.enabled
      and extract(dow from (now() at time zone p.timezone))::int = any (eff.eff_days)
      and exists (select 1 from public.push_tokens pt where pt.user_id = p.id)
      and not exists (select 1 from public.push_log pl
                      where pl.user_id = p.id and pl.sent_on = (now() at time zone p.timezone)::date)
      and exists (
        select 1
        from jsonb_array_elements(eff.eff_windows) w
        cross join lateral (
          select (w->>'time')::time as start_t,
                 ((w->>'time')::time + interval '30 minutes')::time as end_t,
                 (now() at time zone p.timezone)::time as local_t
        ) b
        where case when b.end_t > b.start_t
                   then b.local_t >= b.start_t and b.local_t < b.end_t
                   else b.local_t >= b.start_t or b.local_t < b.end_t   -- wraps midnight
              end
      )
  loop
    if r.due_count >= coalesce(r.min_due_to_notify, 1) and array_length(r.tokens, 1) > 0 then
      v_body := r.due_count || ' word' || case when r.due_count = 1 then ' is' else 's are' end || ' ready for review';
      foreach v_token in array r.tokens loop
        perform public.push_send_to_token(r.user_id, v_token, 'Your words are ready', v_body, '/quiz', 'scheduled');
      end loop;
      insert into public.push_log (user_id, sent_on, due_count)
      values (r.user_id, (now() at time zone r.timezone)::date, r.due_count)
      on conflict do nothing;
      v_sent := v_sent + 1;
    end if;
  end loop;
  return v_sent;
end $fn$;
revoke execute on function public.run_push_scheduler() from public, anon, authenticated;;
