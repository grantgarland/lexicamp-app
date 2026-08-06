-- One scheduled reminder per DEVICE, not per account (Casey, 2026-08-05).
--
-- Reported: two identical push notifications on one phone this morning. The log
-- shows both sends at 06:00:00.223234 — the same millisecond, the same token,
-- two different user_ids, both delivered:
--
--   id 64  user 5e8ffa94  token …lEeAjgIzI2i]  scheduled  receipt ok
--   id 65  user 1e416122  token …lEeAjgIzI2i]  scheduled  receipt ok
--
-- Not a duplicated cron entry: that would produce two DISTINCT timestamps and
-- would double every user's reminder, not one device's. The scheduler loops per
-- USER and pushes to each of that user's tokens, and `push_log` dedupes per
-- user_id — so one phone signed into two accounts is two independent sends that
-- nothing downstream could recognise as the same device.
--
-- signOut() never deleted the push_tokens row (fixed client-side separately), so
-- every account that has ever signed in on a phone keeps a live registration.
-- That makes this a server problem too: the fix has to work for tokens already
-- in the table, on builds already shipped.
--
-- TWO guards, because they fail differently:
--
--   1. OWNERSHIP. A token belongs to whichever account registered it most
--      recently — the one actually using the phone. Older registrations are
--      skipped. Ordered by (updated_at, user_id) so the comparison is a strict
--      TOTAL order: with a plain updated_at, two rows written in the same
--      transaction could tie and both win, which is the exact bug again.
--
--   2. ONE PER DEVICE PER LOCAL DAY. Even if ownership somehow resolves to two
--      accounts, a token that already received a 'scheduled' push today is
--      skipped. This also covers a re-run of the scheduler within a window.
create or replace function public.run_push_scheduler()
returns integer
language plpgsql security definer set search_path = ''
as $function$
declare
  r record; v_sent int := 0; v_token text; v_body text;
begin
  for r in
    select p.id as user_id, p.timezone, np.min_due_to_notify,
           (select count(*) from public.card_fsrs_state s
             where s.user_id = p.id and s.state > 0 and s.due_at <= now()) as due_count,
           -- Guard 1: only tokens this account most recently registered.
           array(
             select pt.token from public.push_tokens pt
             where pt.user_id = p.id
               and not exists (
                 select 1 from public.push_tokens other
                 where other.token = pt.token
                   and (other.updated_at, other.user_id) > (pt.updated_at, pt.user_id)
               )
           ) as tokens
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
        -- Guard 2: this device has not already had today's reminder, in ITS
        -- OWN local day (the two accounts on one phone may sit in different
        -- timezones, so a UTC day boundary would not be the same question).
        if not exists (
          select 1 from public.push_send ps
          where ps.token = v_token
            and ps.kind = 'scheduled'
            and (ps.created_at at time zone r.timezone)::date = (now() at time zone r.timezone)::date
        ) then
          perform public.push_send_to_token(r.user_id, v_token, 'Your words are ready', v_body, '/quiz', 'scheduled');
        end if;
      end loop;
      insert into public.push_log (user_id, sent_on, due_count)
      values (r.user_id, (now() at time zone r.timezone)::date, r.due_count)
      on conflict do nothing;
      v_sent := v_sent + 1;
    end if;
  end loop;
  return v_sent;
end $function$;

revoke execute on function public.run_push_scheduler() from public, anon, authenticated;;
