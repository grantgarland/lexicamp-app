-- "Due now" means the SAME thing everywhere, new words included (2026-09-09).
--
-- `save_card` inserts each new card's schedule with `card_fsrs_state.due_at =
-- now()` and `state = 0`, and the study queue (`getDueCards`) selects on
-- `due_at <= now()` with no state predicate — so a freshly saved word IS in the
-- queue and the quiz has always served it. The scheduler's `due_count` carried
-- `s.state > 0` on top of that (from 03's "Unseen words have no due_at", which
-- the schema never made true), so a user whose only ready words were ones they
-- had just saved got no reminder at all — precisely the user a reminder is for.
-- Home's derive.ts counts drop the same filter in this change.
--
-- The join to `cards` is the other half of that alignment: `suspended` cards
-- leave the review queue (18 §E3) and are excluded by both the client counts
-- and getDueCards, but this count reached card_fsrs_state directly and so kept
-- nudging users about archived words they cannot review.
--
-- Nothing else in the function changes.
create or replace function public.run_push_scheduler()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r record; v_sent int := 0; v_token text; v_body text;
begin
  for r in
    select p.id as user_id, p.timezone, np.min_due_to_notify,
           (select count(*) from public.card_fsrs_state s
              join public.cards c on c.id = s.card_id
             where s.user_id = p.id and not c.suspended and s.due_at <= now()) as due_count,
           -- No ownership tiebreak: push_tokens is keyed by token, so a device
           -- appears under exactly one account — the one that most recently ran
           -- register_push_token, which the client now does on every session
           -- start. This list is this account's devices, full stop.
           array(select pt.token from public.push_tokens pt where pt.user_id = p.id) as tokens
    from public.profiles p
    join public.notification_prefs np on np.user_id = p.id
    left join public.subscriptions sub on sub.user_id = p.id
    cross join lateral (
      select case when public.is_paid_state(sub.status, sub.current_period_end)
                  then np.windows else '[{"time":"09:00"}]'::jsonb end as eff_windows,
             case when public.is_paid_state(sub.status, sub.current_period_end)
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
        -- Guard 2 (kept): this device has not already had today's reminder, in
        -- ITS OWN local day. Single ownership makes the two-accounts case
        -- impossible, but this still covers a scheduler re-run inside a window.
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
