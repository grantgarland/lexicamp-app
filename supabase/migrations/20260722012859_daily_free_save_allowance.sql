-- daily_free_save_allowance — DF-9 v2 (Casey correction, 2026-07-22; spec 19 rev).
-- SUPERSEDES growing_free_word_cap's additive formula. The free tier is:
--   · a 50-card STARTER allotment, usable at any pace, then
--   · at most 5 saves per day — the daily 5 RESETS each day and NEVER banks,
--     so total capacity grows only when the user actually saves.
-- Enforcement: reject when (total cards ≥ 50) AND (cards created "today" ≥ 5),
-- where "today" is the user's profile timezone day (falls back to UTC on a
-- missing/invalid tz). Entitled users (trial/active/grace) and idempotent
-- re-saves are exempt, as before. Client contract UNCHANGED (P0004
-- 'free_word_cap'). Boundary note (spec 19 rev): on the day the user crosses
-- 50, base saves and daily saves can share the day — intended simplicity.
-- Everything below is identical to growing_free_word_cap except the cap block.

create or replace function public.save_card(
  p_translation_id uuid,
  p_deck_id uuid,
  p_custom_front text default null,
  p_custom_back text default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := auth.uid();
  v_card_id uuid;
  v_inserted boolean;
  v_gate text;
  v_front text := nullif(trim(coalesce(p_custom_front, '')), '');
  v_back text := nullif(trim(coalesce(p_custom_back, '')), '');
  v_tz text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select gate_status into v_gate from public.translations_cache where id = p_translation_id;
  if v_gate is null then
    raise exception 'unknown translation' using errcode = 'P0002';
  end if;
  if v_gate <> 'allowed' then
    raise exception 'translation not saveable (gate)' using errcode = 'P0003';
  end if;

  if not exists (select 1 from public.decks where id = p_deck_id and user_id = v_uid) then
    raise exception 'deck not found' using errcode = 'P0002';
  end if;

  -- DF-9 v2 free tier (19 rev): 50-card starter, then 5/day (daily reset,
  -- non-banking). Counts ALL cards (all languages, archived included —
  -- 07-17c ruling); deletes reclaim both total and today's slots.
  select coalesce(nullif(trim(p.timezone), ''), 'UTC') into v_tz
    from public.profiles p where p.id = v_uid;
  v_tz := coalesce(v_tz, 'UTC');
  begin
    perform now() at time zone v_tz; -- validate; invalid tz name → fall back
  exception when others then
    v_tz := 'UTC';
  end;

  if not exists (
       select 1 from public.cards
       where deck_id = p_deck_id and translation_id = p_translation_id
         and coalesce(custom_back, '') = coalesce(v_back, '')
     )
     and not exists (
       select 1 from public.subscriptions
       where user_id = v_uid and status in ('trial', 'active', 'grace')
     )
     and (select count(*) from public.cards where user_id = v_uid) >= 50
     and (
       select count(*) from public.cards c
       where c.user_id = v_uid
         and (c.created_at at time zone v_tz)::date = (now() at time zone v_tz)::date
     ) >= 5
  then
    raise exception 'free_word_cap' using errcode = 'P0004';
  end if;

  insert into public.cards (deck_id, user_id, translation_id, custom_front, custom_back)
  values (p_deck_id, v_uid, p_translation_id, v_front, v_back)
  on conflict (deck_id, translation_id, coalesce(custom_back, '')) do update
    set custom_front = excluded.custom_front -- no-op refresh; arbiter needs a DO UPDATE to return the row
  returning id, (xmax = 0) into v_card_id, v_inserted;

  if v_inserted then
    insert into public.card_fsrs_state (card_id, user_id) values (v_card_id, v_uid);
    insert into public.study_events (user_id, event, props)
    values (v_uid, 'word_saved', jsonb_build_object('card_id', v_card_id, 'translation_id', p_translation_id));
  end if;

  return v_card_id;
end $$;
