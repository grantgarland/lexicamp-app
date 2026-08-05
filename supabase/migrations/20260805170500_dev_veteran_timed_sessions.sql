-- Dev veteran: time every seeded session (2026-08-05).
--
-- Companion to time_invested_measured_only. Time invested now sums RECORDED
-- durations and infers nothing, so the seeder's older sessions -- which were
-- deliberately left bare to exercise the estimate path -- would contribute zero
-- and understate the fixture by design. Every generated session is now timed.

create or replace function public.seed_dev_veteran()
returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_uid uuid;
  v_deck uuid;
  v_anchor uuid;
  v_words int;
  v_total int;
  -- Scaled from mock.ts DISTRIBUTION.veteran (180/260/340/470/3050 over 4,300)
  -- down to the 4,000 words available, but NOT proportionally: a proportional
  -- top tier lands at 2,837, and the mountain summit is 3,000 mastered -- the
  -- scenario would stop being past-the-summit, which is its entire purpose.
  -- Top tier is held above 3,000 and the tail absorbs the difference.
  v_dist int[] := array[100, 150, 200, 450, 3100];
  v_lo real[] := array[0.5, 3, 7, 14, 30];
  v_hi real[] := array[3, 7, 14, 30, 540];
begin
  if auth.uid() is not null then
    if not exists (select 1 from public.profiles where id = auth.uid() and is_dev) then
      raise exception 'seed_dev_veteran is dev-only' using errcode = '42501';
    end if;
    v_uid := auth.uid();
  else
    select id into v_uid from auth.users where email = 'dev-veteran@lexicamp.app';
    if v_uid is null then
      raise exception
        'dev-veteran@lexicamp.app does not exist. Create it first (Supabase dashboard > Authentication > Add user, same password as the other dev-* accounts), then re-run.'
        using errcode = 'P0002';
    end if;
  end if;

  select count(*) into v_words from public.dev_seed_words;
  if v_words = 0 then
    raise exception 'dev_seed_words is empty -- the fixture migration did not load' using errcode = 'P0002';
  end if;

  -- Every card anchors to ONE real ru translation and overrides both faces. The
  -- anchor only has to exist and be ru; nothing about it is displayed.
  select id into v_anchor from public.translations_cache where target_lang = 'ru' order by id limit 1;
  if v_anchor is null then
    raise exception 'no ru row in translations_cache to anchor cards to' using errcode = 'P0002';
  end if;

  insert into public.profiles (id, is_dev, timezone, native_lang, learning_lang, onboarding_complete, quiz_length, username)
  values (v_uid, true, 'America/New_York', 'en', 'ru', true, 10, 'veteran-climber')
  on conflict (id) do update set is_dev = true, learning_lang = 'ru', onboarding_complete = true;

  insert into public.profile_languages (user_id, lang) values (v_uid, 'ru') on conflict do nothing;
  insert into public.notification_prefs (user_id, enabled) values (v_uid, true) on conflict do nothing;
  insert into public.subscriptions (user_id, plan, status, platform)
  values (v_uid, 'monthly', 'active', 'ios')
  on conflict (user_id) do update set status = 'active', plan = 'monthly';

  select id into v_deck from public.decks where user_id = v_uid and target_lang = 'ru' order by created_at limit 1;
  if v_deck is null then
    insert into public.decks (user_id, name, source_lang, target_lang)
    values (v_uid, 'Russian', 'en', 'ru') returning id into v_deck;
  end if;

  -- Idempotent rebuild, scoped to this account only.
  delete from public.card_fsrs_state where user_id = v_uid;
  delete from public.cards where user_id = v_uid;

  -- One deterministic draw set per rank. md5-keyed, never random(): a fixture
  -- that reshuffles on every reseed cannot be used to reproduce a bug -- same
  -- discipline as mock.ts's mulberry32.
  with w as (
    select rank, target, native,
           case when rank < 100 then 1 when rank < 250 then 2 when rank < 450 then 3
                when rank < 900 then 4 else 5 end as idx,
           ('x' || substr(md5(rank::text || 'a'), 1, 8))::bit(32)::bigint / 4294967296.0 as r1,
           ('x' || substr(md5(rank::text || 'b'), 1, 8))::bit(32)::bigint / 4294967296.0 as r2,
           ('x' || substr(md5(rank::text || 'c'), 1, 8))::bit(32)::bigint / 4294967296.0 as r3,
           ('x' || substr(md5(rank::text || 'd'), 1, 8))::bit(32)::bigint / 4294967296.0 as r4
    from public.dev_seed_words
  ),
  calc as (
    select rank, target, native, idx, r2, r3, r4,
           -- Log-uniform inside the tier band: stability compounds review over
           -- review, so a real library skews hard to the low end of any band.
           (v_lo[idx] * power(v_hi[idx] / v_lo[idx], r1))::real as stability
    from w
  ),
  ins as (
    insert into public.cards (user_id, deck_id, translation_id, custom_front, custom_back, created_at)
    select v_uid, v_deck, v_anchor, native, target,
           now() - ((stability * (1.5 + r4 * 2) + 8) || ' days')::interval
    from calc
    returning id, custom_back
  )
  insert into public.card_fsrs_state (card_id, user_id, stability, difficulty, due_at, last_review_at, state, reps, lapses)
  select ins.id, v_uid, c.stability,
         least(10, greatest(1, 6.5 - (c.idx - 1) * 0.5 + (c.r4 - 0.5) * 3))::real,
         -- 8% of cards land past their due date: the overdue backlog every real
         -- library carries, and what stops the due histogram being four spikes.
         now() - (c.stability * (case when c.r2 < 0.08 then 1 + c.r3 * 0.6 else c.r3 end) || ' days')::interval
               + (c.stability || ' days')::interval,
         now() - (c.stability * (case when c.r2 < 0.08 then 1 + c.r3 * 0.6 else c.r3 end) || ' days')::interval,
         2,
         greatest(1, round(2 + log(2.0, (c.stability + 1)::numeric) * 2.2 + c.r4 * 3))::int,
         case when c.r4 < 0.35 / c.idx then 1 + floor(c.r4 * 2)::int else 0 end
  from ins join calc c on c.target = ins.custom_back;


  -- Review history (2026-08-05). The seed wrote FSRS states DIRECTLY, so this
  -- account carried 4,000 cards, 3,099 of them mastered -- and ten review_logs.
  -- Every all-time stat that reads the log was therefore reporting on a history
  -- that did not exist: 10 reviews, 1 day active, a 1-day best streak. The new
  -- Reviews / Days active / Time invested tiles made that impossible to miss.
  --
  -- Reconstructed from what the states already assert: a card with `reps` N and
  -- `lapses` L was reviewed N times, failed L of them. Deterministic, like the
  -- rest of this seeder -- no random().
  delete from public.review_logs where user_id = v_uid;
  delete from public.study_events where user_id = v_uid and event = 'quiz_completed';

  insert into public.review_logs (card_id, user_id, rating, reviewed_at, elapsed_days, scheduled_days, state_before)
  select s.card_id, v_uid,
         -- The lapses come first (a word is failed while young), then a slice of
         -- "hard", the rest "good" -- which lands avg accuracy near 90%, the band
         -- FSRS actually targets.
         case when g.i <= s.lapses then 1 when (g.i % 12) = 0 then 2 else 3 end,
         -- Squared, not linear: intervals GROW, so reviews cluster early in a
         -- card's life and thin out toward the present. A linear spread would
         -- give every card a metronome-regular history no scheduler produces.
         c.created_at + (s.last_review_at - c.created_at) * power(g.i::double precision / s.reps, 2),
         0, 0, 2
  from public.card_fsrs_state s
  join public.cards c on c.id = s.card_id
  cross join lateral generate_series(1, s.reps) as g(i)
  where s.user_id = v_uid;

  -- One session per day the log says they studied, EVERY one of them timed.
  -- Time invested counts recorded durations only (2026-08-05) -- an untimed
  -- fixture session contributes nothing, so leaving the older ones bare would
  -- hand the five-year account a few hours. 6.5s/card sits inside
  -- commit_quiz_session's own 1s-10min-per-card sanity bounds, so these
  -- durations are ones the live write path would have accepted.
  insert into public.study_events (user_id, event, props, occurred_at)
  select v_uid, 'quiz_completed',
         jsonb_build_object('cards', d.cnt, 'duration_ms', (d.cnt * 6500)::bigint),
         d.day_ts
  from (
    select date_trunc('day', reviewed_at) as day_ts, count(*)::int as cnt
    from public.review_logs where user_id = v_uid group by 1
  ) d;

  select count(*) into v_total from public.cards where user_id = v_uid;
  return jsonb_build_object(
    'user_id', v_uid,
    'cards', v_total,
    'mastered', (select count(*) from public.card_fsrs_state where user_id = v_uid and stability >= 30),
    'due_now', (select count(*) from public.card_fsrs_state where user_id = v_uid and state > 0 and due_at <= now()),
    'reviews', (select count(*) from public.review_logs where user_id = v_uid),
    'days_active', (select count(distinct reviewed_at::date) from public.review_logs where user_id = v_uid),
    'sessions', (select count(*) from public.study_events where user_id = v_uid and event = 'quiz_completed'),
    'time_invested_ms', (select coalesce(sum((props->>'duration_ms')::numeric), 0)
                         from public.study_events where user_id = v_uid and event = 'quiz_completed'));
end $fn$;
revoke execute on function public.seed_dev_veteran() from public, anon;
grant execute on function public.seed_dev_veteran() to authenticated;
