-- Deck review stats + language-scoped Progress stats (Casey, 2026-08-05).
--
-- ⚠️ RECORDING GAP. Three migrations applied through the Supabase connector
-- earlier today executed against the database but were never written to
-- supabase_migrations.schema_migrations, so `migration list` reported no drift
-- while the repo could not rebuild them: deck_review_stats,
-- language_scoped_study_stats and language_scoped_study_stats_fix. This file is
-- the recorded, replayable version of all three, collapsed into the FINAL state
-- (the broken intermediate — which held the scoped log in a temp table and
-- failed with "CREATE TABLE is not allowed in a non-volatile function" — is not
-- replayed). Every statement is idempotent, so applying it to a database that
-- already has these functions is a no-op.
--
-- Contents:
--   1. get_deck_stats()      — per-deck review count + last reviewed
--   2. get_study_stats(text) — All-Time grid, scoped to one learning language
--   3. commit_quiz_session   — stamps the session's language on the event

-- `create or replace` with a newly-defaulted parameter creates a SECOND function
-- rather than replacing the original, leaving get_study_stats() resolving to the
-- old account-wide body. A no-arg caller would have silently kept the unscoped
-- numbers this change exists to fix.
drop function if exists public.get_study_stats();

-- ── 1. Per-deck review stats ────────────────────────────────────────────────
-- getDecks returned `reviews: 0, lastReviewedAt: null` behind a TODO, so the
-- Deck detail sheet said "REVIEWS 0 / LAST REVIEWED Never" no matter how much
-- the deck had been studied — while the word rows in that same sheet showed
-- their real counts. The data existed; nothing aggregated it.
--
-- A deck is a MEMBERSHIP view over cards, not an owner of them, so a review is
-- attributed to every deck the reviewed card belongs to. A word in two decks
-- counts once for each — the honest reading of "reviews in this deck", and the
-- alternative would need a notion of a "primary" deck that does not exist.
--
-- Keyed by deck id so the client makes ONE call for the whole list.
create or replace function public.get_deck_stats()
returns jsonb
language sql
stable security definer set search_path = ''
as $function$
  select coalesce(
    jsonb_object_agg(
      d.id,
      jsonb_build_object('reviews', d.reviews, 'last_reviewed_at', d.last_reviewed_at)
    ),
    '{}'::jsonb
  )
  from (
    select dk.id,
           count(r.id)        as reviews,
           max(r.reviewed_at) as last_reviewed_at
    from public.decks dk
    left join public.deck_cards dc
      on dc.deck_id = dk.id and dc.user_id = auth.uid()
    left join public.review_logs r
      on r.card_id = dc.card_id and r.user_id = auth.uid()
    where dk.user_id = auth.uid()
    group by dk.id
  ) d;
$function$;

revoke execute on function public.get_deck_stats() from public, anon;
grant execute on function public.get_deck_stats() to authenticated;

-- ── 2. Language-scoped study stats ──────────────────────────────────────────
-- get_study_stats aggregated review_logs and study_events across the WHOLE
-- account, so switching to a language the user had never studied still showed
-- 116 reviews / 89% / 15 days active. The Route ladder was already correct (it
-- derives from the language-scoped card read), so the All-Time grid beside it
-- read as a contradiction on the same screen.
--
-- Review-derived metrics scope through cards -> decks.target_lang, the path
-- every other language-scoped read in the app uses.
--
-- Sessions and time invested live on study_events, which carried no language.
-- commit_quiz_session stamps one below; older events have none and are excluded
-- from a scoped call rather than credited to a language they may not belong to
-- — the same measured-only rule already agreed for duration_ms.
--
-- STABLE is load-bearing: this is a pure read, and an earlier revision that
-- materialised the scoped log into a temp table failed at runtime because DDL
-- is not permitted in a non-volatile function. Hence the repeated subquery.
--
-- p_lang null keeps whole-account behaviour for any caller that wants it.
create or replace function public.get_study_stats(p_lang text default null)
returns jsonb
language plpgsql
stable security definer set search_path = ''
as $function$
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

  -- Distinct local study days, scoped to the language.
  select coalesce(array_agg(day order by day), '{}') into v_days
  from (
    select distinct (r.reviewed_at at time zone v_tz)::date as day
    from public.review_logs r
    join public.cards c on c.id = r.card_id
    join public.decks dk on dk.id = c.deck_id
    where r.user_id = v_uid
      and (p_lang is null or dk.target_lang = p_lang)
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

  -- Reviews all-time + accuracy, from the same scoped set.
  select count(*),
         coalesce(round(100.0 * count(*) filter (where r.rating >= 3) / nullif(count(*), 0)), 0)
  into v_reviews, v_accuracy
  from public.review_logs r
  join public.cards c on c.id = r.card_id
  join public.decks dk on dk.id = c.deck_id
  where r.user_id = v_uid
    and (p_lang is null or dk.target_lang = p_lang);

  -- Sessions + time: study_events, scoped by the stamped lang.
  select count(*),
         coalesce(sum((props->>'duration_ms')::numeric) filter (where coalesce(props ? 'duration_ms', false)), 0)
  into v_sessions, v_time_ms
  from public.study_events
  where user_id = v_uid
    and event = 'quiz_completed'
    and (p_lang is null or props->>'lang' = p_lang);

  return jsonb_build_object(
    'streak_days', v_streak,
    'best_streak', v_best,
    'days_active', coalesce(array_length(v_days, 1), 0),
    'sessions_total', v_sessions,
    'avg_accuracy', v_accuracy,
    'reviews_total', v_reviews,
    'time_invested_ms', round(v_time_ms)
  );
end $function$;

revoke execute on function public.get_study_stats(text) from public, anon;
grant execute on function public.get_study_stats(text) to authenticated;

-- ── 3. Stamp the session's language ─────────────────────────────────────────
-- Derived from the reviewed cards themselves. The client never says which
-- language it was studying, and a client-supplied value would be unverified.
create or replace function public.commit_quiz_session(p_reviews jsonb, p_duration_ms bigint default null)
returns void
language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  r jsonb;
  v_count int := 0;
  v_lang text;
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

  -- The session's language, from the first reviewed card's deck.
  select dk.target_lang into v_lang
  from public.cards c
  join public.decks dk on dk.id = c.deck_id
  where c.id = ((p_reviews->0)->>'card_id')::uuid and c.user_id = v_uid;

  insert into public.study_events (user_id, event, props)
  values (
    v_uid,
    'quiz_completed',
    jsonb_build_object('cards', v_count)
      || case when v_lang is null then '{}'::jsonb else jsonb_build_object('lang', v_lang) end
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
end $function$;

revoke execute on function public.commit_quiz_session(jsonb, bigint) from public, anon;
grant execute on function public.commit_quiz_session(jsonb, bigint) to authenticated;
