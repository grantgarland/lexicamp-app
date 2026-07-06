-- 2.2 ts-fsrs integration.
-- (1) learning_steps: ts-fsrs v5 tracks the position inside the (re)learning
-- steps; without persisting it, in-learning cards restart their steps between
-- sessions. Additive, default 0 (correct for all existing review-state rows).
alter table public.card_fsrs_state add column learning_steps integer not null default 0;

-- (2) Atomic batch commit for a completed quiz session (03 write pattern).
-- FSRS math runs CLIENT-SIDE (02 locked decision — backend stays dumb); this
-- RPC provides ownership validation + all-or-nothing persistence. A tampering
-- client can only corrupt its own scheduling state (accepted risk, 02 § FSRS).
create or replace function public.commit_quiz_session(p_reviews jsonb)
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
  values (v_uid, 'quiz_completed', jsonb_build_object('cards', v_count));
end $$;

revoke execute on function public.commit_quiz_session(jsonb) from public, anon;
grant execute on function public.commit_quiz_session(jsonb) to authenticated;;
