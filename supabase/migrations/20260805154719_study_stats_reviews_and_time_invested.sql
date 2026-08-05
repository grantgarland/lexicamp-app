-- All-Time grid refactor (2026-08-05): Reviews · Avg accuracy · Days active · Time invested.
--
-- Two new aggregates on get_study_stats. `reviews_total` is a plain count of
-- review_logs — individual card reviews, which is what the tile now reports
-- instead of the session count it showed before.
--
-- `time_invested_ms` is the one that needed a decision. duration_ms has only
-- been written since 20260730222748_session_pace, and that RPC deliberately
-- DROPS durations outside 1s–10min per card rather than poison the median — so
-- in practice only a minority of completed sessions carry one (10 of 44 on this
-- database at time of writing). A raw sum would report ~5 minutes for a month
-- of daily study. That is not a conservative number, it is a wrong one.
--
-- Every quiz_completed event does store `cards`. So sessions with no duration
-- are modelled at the user's OWN median ms-per-card, and the function returns
-- `time_is_estimate` so the UI can mark the value approximate rather than pass
-- a model off as a measurement. A user with no timed session has nothing to
-- model from: the modelled part stays 0 and the flag stays false, so the tile
-- shows measured time or nothing at all — never a fabricated number.
create or replace function public.get_study_stats()
returns jsonb
language plpgsql security definer set search_path = ''
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_tz text;
  v_days date[];
  v_today date;
  v_streak int := 0;
  v_best int := 0;
  v_run int := 0;
  v_prev date := null;
  d date;
  v_sessions int;
  v_accuracy numeric;
  v_reviews bigint;
  v_measured_ms numeric := 0;
  v_untimed_cards numeric := 0;
  v_timed int := 0;
  v_median_per_card numeric;
  v_modelled_ms numeric := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select coalesce(timezone, 'UTC') into v_tz from public.profiles where id = v_uid;
  v_tz := coalesce(v_tz, 'UTC');
  v_today := (now() at time zone v_tz)::date;

  select coalesce(array_agg(day order by day), '{}') into v_days
  from (
    select distinct (reviewed_at at time zone v_tz)::date as day
    from public.review_logs where user_id = v_uid
  ) t;

  -- Best streak: longest consecutive run.
  foreach d in array v_days loop
    if v_prev is not null and d = v_prev + 1 then
      v_run := v_run + 1;
    else
      v_run := 1;
    end if;
    if v_run > v_best then v_best := v_run; end if;
    v_prev := d;
  end loop;

  -- Current streak: walk back from today (a streak survives until a full local
  -- day is missed — reviewing yesterday but not yet today still counts).
  if v_days @> array[v_today] or v_days @> array[v_today - 1] then
    d := case when v_days @> array[v_today] then v_today else v_today - 1 end;
    while v_days @> array[d] loop
      v_streak := v_streak + 1;
      d := d - 1;
    end loop;
  end if;

  select count(*) into v_sessions
  from public.study_events where user_id = v_uid and event = 'quiz_completed';

  select coalesce(round(100.0 * count(*) filter (where rating >= 3) / nullif(count(*), 0)), 0)
  into v_accuracy
  from public.review_logs where user_id = v_uid;

  -- Reviews all-time: one row per card rated, not per session.
  select count(*) into v_reviews
  from public.review_logs where user_id = v_uid;

  -- Split completed sessions into "we timed it" and "we only know the card count".
  select
    coalesce(sum((props->>'duration_ms')::numeric)
             filter (where coalesce(props ? 'duration_ms', false)), 0),
    coalesce(sum((props->>'cards')::numeric)
             filter (where not coalesce(props ? 'duration_ms', false)), 0),
    count(*) filter (where coalesce(props ? 'duration_ms', false))
  into v_measured_ms, v_untimed_cards, v_timed
  from public.study_events
  where user_id = v_uid and event = 'quiz_completed';

  -- Median rather than mean: one backgrounded session inside the sanity bounds
  -- would drag a mean across every untimed session in the history.
  if v_timed > 0 then
    select percentile_cont(0.5) within group (
             order by (props->>'duration_ms')::numeric / (props->>'cards')::numeric)
    into v_median_per_card
    from public.study_events
    where user_id = v_uid
      and event = 'quiz_completed'
      and coalesce(props ? 'duration_ms', false)
      and coalesce((props->>'cards')::numeric, 0) > 0;

    v_modelled_ms := coalesce(v_median_per_card, 0) * v_untimed_cards;
  end if;

  return jsonb_build_object(
    'streak_days', v_streak,
    'best_streak', v_best,
    'days_active', coalesce(array_length(v_days, 1), 0),
    'sessions_total', v_sessions,
    'avg_accuracy', v_accuracy,
    'reviews_total', v_reviews,
    'time_invested_ms', round(v_measured_ms + v_modelled_ms),
    'time_measured_ms', round(v_measured_ms),
    'time_is_estimate', v_modelled_ms > 0
  );
end $$;

revoke execute on function public.get_study_stats() from public, anon;
grant execute on function public.get_study_stats() to authenticated;;
