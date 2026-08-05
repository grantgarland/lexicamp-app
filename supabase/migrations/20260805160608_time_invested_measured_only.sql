-- Time invested is a MEASUREMENT, not a model (Casey, 2026-08-05).
--
-- The previous revision filled untimed sessions in at the user's median
-- ms-per-card, because only 10 of 44 completed sessions carried a duration and a
-- raw sum read as ~5 minutes for a month of study. That was a stopgap for a
-- backfill problem, and it bought honesty about the past at the cost of a number
-- nobody can reason about: half measured, half inferred, permanently prefixed
-- with a tilde.
--
-- commit_quiz_session has recorded duration_ms since 20260730222748, so every
-- session from here on is timed. The metric is now exactly what it claims to be:
-- the sum of the durations we actually recorded. Sessions predating that
-- migration contribute nothing and the total is understated until the history
-- turns over — a known, self-correcting gap, and a smaller cost than a permanent
-- estimate. `time_is_estimate` and `time_measured_ms` are gone with the model;
-- `time_invested_ms` IS the measured time.
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
  v_time_ms numeric := 0;
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

  -- Time invested: recorded durations only. No inference.
  select coalesce(sum((props->>'duration_ms')::numeric), 0)
  into v_time_ms
  from public.study_events
  where user_id = v_uid
    and event = 'quiz_completed'
    and coalesce(props ? 'duration_ms', false);

  return jsonb_build_object(
    'streak_days', v_streak,
    'best_streak', v_best,
    'days_active', coalesce(array_length(v_days, 1), 0),
    'sessions_total', v_sessions,
    'avg_accuracy', v_accuracy,
    'reviews_total', v_reviews,
    'time_invested_ms', round(v_time_ms)
  );
end $$;

revoke execute on function public.get_study_stats() from public, anon;
grant execute on function public.get_study_stats() to authenticated;;
