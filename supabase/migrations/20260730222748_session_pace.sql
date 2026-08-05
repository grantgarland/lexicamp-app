-- Session pace: make the Home study card's time estimate a MEASURED number.
--
-- WHY NOT review_logs: commit_quiz_session inserts review_logs WITHOUT
-- reviewed_at, so the column takes its `default now()` — evaluated inside one
-- loop in one transaction at COMMIT time. Ratings buffer client-side during the
-- quiz and flush once at the end, so every row in a session lands within
-- microseconds of the others. Gaps between rows measure nothing, and there is
-- no per-answer timing to back-fill.
--
-- Instead: record the duration the CLIENT measured, into the jsonb props of the
-- `quiz_completed` study_event that commit_quiz_session already writes. No new
-- table, no new column, no back-fill.

-- (1) commit_quiz_session gains an optional client-measured duration.
--
-- The old 1-arg function MUST be dropped, not merely superseded. Adding
-- commit_quiz_session(jsonb, bigint DEFAULT null) alongside
-- commit_quiz_session(jsonb) makes a one-argument call ambiguous
-- ("function is not unique"), which would break EVERY quiz commit from existing
-- clients. Dropping first, in this same transaction, means there is no window
-- where the function is missing and no ambiguity afterwards: the new 2-arg
-- version still satisfies old 1-arg callers via the default.
drop function if exists public.commit_quiz_session(jsonb);

create function public.commit_quiz_session(p_reviews jsonb, p_duration_ms bigint default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  r jsonb;
  v_count int := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if jsonb_typeof(p_reviews) <> 'array' or jsonb_array_length(p_reviews) = 0 then
    raise exception 'p_reviews must be a non-empty array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_reviews) > 100 then
    raise exception 'too many reviews in one commit' using errcode = '22023';
  end if;

  for r in select * from jsonb_array_elements(p_reviews) loop
    -- Ownership check: update only the caller's own state row.
    update public.card_fsrs_state set
      stability = (r->>'stability')::real,
      difficulty = (r->>'difficulty')::real,
      due_at = (r->>'due_at')::timestamptz,
      last_review_at = (r->>'last_review_at')::timestamptz,
      state = (r->>'state')::smallint,
      reps = (r->>'reps')::integer,
      lapses = (r->>'lapses')::integer,
      learning_steps = (r->>'learning_steps')::integer
    where card_id = (r->>'card_id')::uuid and user_id = v_uid;
    if not found then
      raise exception 'card not found: %', r->>'card_id' using errcode = 'P0002';
    end if;

    insert into public.review_logs (card_id, user_id, rating, elapsed_days, scheduled_days, state_before)
    values (
      (r->>'card_id')::uuid, v_uid,
      (r->>'rating')::smallint,
      (r->>'elapsed_days')::real,
      (r->>'scheduled_days')::real,
      (r->>'state_before')::smallint
    );
    v_count := v_count + 1;
  end loop;

  insert into public.study_events (user_id, event, props)
  values (
    v_uid,
    'quiz_completed',
    jsonb_build_object('cards', v_count)
      -- Sanity bounds: store only plausible durations rather than poisoning the
      -- median. Under 1s/card cannot be answered honestly; over 10 min/card
      -- means the app sat backgrounded mid-session.
      || case
           when p_duration_ms is not null
            and v_count > 0
            and p_duration_ms >= v_count * 1000
            and p_duration_ms <= v_count * 600000
           then jsonb_build_object('duration_ms', p_duration_ms)
           else '{}'::jsonb
         end
  );
end $$;

revoke execute on function public.commit_quiz_session(jsonb, bigint) from public, anon;
grant execute on function public.commit_quiz_session(jsonb, bigint) to authenticated;

-- (2) Median seconds per card over recent sessions, or NULL when there is not
--     enough signal to be honest about.
--
-- MEDIAN, not mean: a session left open on a locked phone is a frequent
-- outlier that would wreck an average even with the bounds above.
create or replace function public.get_session_pace()
returns jsonb
language plpgsql security definer set search_path = ''
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_median numeric;
  v_sessions int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  with recent as (
    select (props->>'duration_ms')::numeric
             / nullif((props->>'cards')::numeric, 0)
             / 1000.0 as sec_per_card
    from public.study_events
    where user_id = v_uid
      and event = 'quiz_completed'
      and props ? 'duration_ms'
      and coalesce((props->>'cards')::numeric, 0) > 0
    order by occurred_at desc
    limit 20                       -- recent behaviour only; pace drifts as users improve
  )
  select percentile_cont(0.5) within group (order by sec_per_card), count(*)
  into v_median, v_sessions
  from recent;

  -- Fewer than 3 sessions is noise. Return null rather than a number the app
  -- would have to caveat; the UI hides the estimate entirely when null.
  if v_sessions is null or v_sessions < 3 then
    return jsonb_build_object('seconds_per_card', null, 'sessions', coalesce(v_sessions, 0));
  end if;

  return jsonb_build_object('seconds_per_card', round(v_median, 2), 'sessions', v_sessions);
end $$;

revoke execute on function public.get_session_pace() from public, anon;
grant execute on function public.get_session_pace() to authenticated;;
