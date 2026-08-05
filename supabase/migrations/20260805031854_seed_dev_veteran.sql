-- dev-veteran: the past-the-summit scenario as a LIVE account (2026-08-04).
--
-- Until now 'veteran' was mock-only, because a faithful live version needs 4,300
-- cards and the production translations_cache holds 458 rows total (166 ru, the
-- largest language) -- short by ~20x. The resolution (Casey, explicit): CYCLE the
-- real translations rather than fabricate dictionary entries. translations_cache
-- is shared -- inventing rows there would put synthetic words into real users'
-- search results, which is not a trade worth making for a dev fixture.
--
-- So the word LIST repeats (~26 cards per ru translation) while every other
-- dimension is real: 4,300 rows through the real pipeline, real FSRS states,
-- real due-date spread. That is the right compromise, because what this scenario
-- exists to exercise is scale and shape -- list performance at 4,300 rows,
-- projection horizons, the mastery forecast, and copy that assumes the summit is
-- still ahead of you. None of that depends on the words being distinct.
--
-- Deterministic by construction: an md5-derived PRNG keyed on row index, not
-- random(). Mirrors mock.ts's mulberry32 discipline -- a scenario that reshuffles
-- on every reseed cannot be used to reproduce a rendering bug.
--
-- Idempotent: re-running wipes and rebuilds this account's library only.
create or replace function public.seed_dev_veteran()
returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_uid uuid;
  v_deck uuid;
  v_translations uuid[];
  v_n_tr int;
  -- Mirrors DISTRIBUTION.veteran and TIER_BANDS in src/data/mock.ts. Keep in
  -- lockstep: src/data/__tests__/veteranScenario.test.ts asserts the shape.
  v_dist int[] := array[180, 260, 340, 470, 3050];
  v_lo real[] := array[0.5, 3, 7, 14, 30];
  v_hi real[] := array[3, 7, 14, 30, 540];
  v_total int := 0;
begin
  select id into v_uid from auth.users where email = 'dev-veteran@lexicamp.app';
  if v_uid is null then
    raise exception
      'dev-veteran@lexicamp.app does not exist. Create it first (Supabase dashboard > Authentication > Add user, same password as the other dev-* accounts), then re-run.'
      using errcode = 'P0002';
  end if;

  select array_agg(id order by id) into v_translations
  from public.translations_cache where target_lang = 'ru';
  v_n_tr := coalesce(array_length(v_translations, 1), 0);
  if v_n_tr = 0 then
    raise exception 'no ru translations in translations_cache to build a library from' using errcode = 'P0002';
  end if;

  insert into public.profiles (id, is_dev, timezone, native_lang, learning_lang, onboarding_complete, quiz_length, username)
  values (v_uid, true, 'America/New_York', 'en', 'ru', true, 10, 'veteran-climber')
  on conflict (id) do update set is_dev = true, learning_lang = 'ru', onboarding_complete = true;

  insert into public.profile_languages (user_id, lang) values (v_uid, 'ru') on conflict do nothing;
  insert into public.notification_prefs (user_id, enabled) values (v_uid, true) on conflict do nothing;
  insert into public.subscriptions (user_id, plan, status, platform)
  values (v_uid, 'monthly', 'active', 'ios')
  on conflict (user_id) do update set status = 'active', plan = 'monthly';

  select id into v_deck from public.decks where user_id = v_uid and target_lang = 'ru';
  if v_deck is null then
    insert into public.decks (user_id, name, source_lang, target_lang)
    values (v_uid, 'Russian', 'en', 'ru') returning id into v_deck;
  end if;

  -- Idempotent rebuild, scoped to this account.
  delete from public.card_fsrs_state where user_id = v_uid;
  delete from public.cards where user_id = v_uid;

  with tiers as (
    select t.idx, v_dist[t.idx] as cnt, v_lo[t.idx] as lo, v_hi[t.idx] as hi
    from generate_series(1, 5) as t(idx)
  ),
  rows as (
    select tiers.idx, tiers.lo, tiers.hi,
           row_number() over (order by tiers.idx, j) - 1 as g
    from tiers, generate_series(1, tiers.cnt) as j
  ),
  rnd as (
    select r.*,
           -- Four independent deterministic draws per row, md5-keyed on (g, salt).
           ('x' || substr(md5(r.g::text || 'a'), 1, 8))::bit(32)::bigint / 4294967296.0 as r1,
           ('x' || substr(md5(r.g::text || 'b'), 1, 8))::bit(32)::bigint / 4294967296.0 as r2,
           ('x' || substr(md5(r.g::text || 'c'), 1, 8))::bit(32)::bigint / 4294967296.0 as r3,
           ('x' || substr(md5(r.g::text || 'd'), 1, 8))::bit(32)::bigint / 4294967296.0 as r4
    from rows r
  ),
  calc as (
    select g, idx,
           -- Log-uniform inside the band: stability compounds review over review,
           -- so the real distribution skews hard to the low end. Uniform sampling
           -- would render as many 400-day words as 40-day ones.
           (lo * power(hi / lo, r1))::real as stability,
           -- 8% land past 1.0 -- the overdue backlog every real library carries.
           case when r2 < 0.08 then 1 + r3 * 0.6 else r3 end as elapsed_frac,
           r4
    from rnd
  )
  insert into public.cards (user_id, deck_id, translation_id, created_at)
  select v_uid, v_deck,
         v_translations[(g % v_n_tr) + 1],
         now() - ((stability * (1.5 + r4 * 2) + 8) || ' days')::interval
  from calc order by g;

  -- FSRS state, recomputed from the SAME deterministic draws so the two tables
  -- cannot disagree (the mock has the identical constraint between buildDeckCards
  -- and buildWords).
  with c as (
    select id, row_number() over (order by created_at desc, id) - 1 as g from public.cards where user_id = v_uid
  ),
  rnd as (
    select c.id, c.g,
           ('x' || substr(md5(c.g::text || 'a'), 1, 8))::bit(32)::bigint / 4294967296.0 as r1,
           ('x' || substr(md5(c.g::text || 'b'), 1, 8))::bit(32)::bigint / 4294967296.0 as r2,
           ('x' || substr(md5(c.g::text || 'c'), 1, 8))::bit(32)::bigint / 4294967296.0 as r3,
           ('x' || substr(md5(c.g::text || 'd'), 1, 8))::bit(32)::bigint / 4294967296.0 as r4
    from c
  ),
  tier_of as (
    select rnd.*,
           case when g < 180 then 1 when g < 440 then 2 when g < 780 then 3
                when g < 1250 then 4 else 5 end as idx
    from rnd
  ),
  calc as (
    select id, idx,
           (v_lo[idx] * power(v_hi[idx] / v_lo[idx], r1))::real as stability,
           case when r2 < 0.08 then 1 + r3 * 0.6 else r3 end as elapsed_frac,
           r4
    from tier_of
  )
  insert into public.card_fsrs_state (card_id, user_id, stability, difficulty, due_at, last_review_at, state, reps, lapses)
  select id, v_uid, stability,
         least(10, greatest(1, 6.5 - (idx - 1) * 0.5 + (r4 - 0.5) * 3))::real,
         now() - (stability * elapsed_frac || ' days')::interval + (stability || ' days')::interval,
         now() - (stability * elapsed_frac || ' days')::interval,
         2,                                             -- review state
         greatest(1, round(2 + log(2.0, (stability + 1)::numeric) * 2.2 + r4 * 3))::int,
         case when r4 < 0.35 / idx then 1 + floor(r4 * 2)::int else 0 end
  from calc;

  select count(*) into v_total from public.cards where user_id = v_uid;
  return jsonb_build_object(
    'user_id', v_uid, 'cards', v_total,
    'mastered', (select count(*) from public.card_fsrs_state where user_id = v_uid and stability >= 30),
    'unique_words', v_n_tr);
end $fn$;

revoke execute on function public.seed_dev_veteran() from public, anon, authenticated;;
