-- growing_free_word_cap — DF-9 / spec 19 (ratified 2026-07-21: BASE=50, RATE=5).
-- Replaces the FLAT 50-card free cap in save_card with a GROWING allowance:
--   cap = 50 + 5 × full UTC days since profiles.created_at
-- Rationale (19 §4): base absorbs the day-1 binge; +5/day is ~2× the pace the
-- free 20-card session can teach, so only sustained above-pace savers meet the
-- wall — and it moves daily. Client contract UNCHANGED (P0004, 'free_word_cap').
-- Missing profile row degrades safely to the flat base (coalesce → 0 days).
-- Everything below is identical to restore_free_word_cap except the cap block.

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
  v_cap int;
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

  -- DF-9 growing free allowance (19 §4): 50 + 5/day since signup. Counts ALL
  -- cards (all languages, archived included — 07-17c ruling); idempotent
  -- re-saves of the same sense are exempt, as before.
  select 50 + 5 * greatest(0, coalesce(
           floor(extract(epoch from (now() - p.created_at)) / 86400)::int, 0))
    into v_cap
    from public.profiles p
   where p.id = v_uid;
  v_cap := coalesce(v_cap, 50);

  if not exists (
       select 1 from public.cards
       where deck_id = p_deck_id and translation_id = p_translation_id
         and coalesce(custom_back, '') = coalesce(v_back, '')
     )
     and not exists (
       select 1 from public.subscriptions
       where user_id = v_uid and status in ('trial', 'active', 'grace')
     )
     and (select count(*) from public.cards where user_id = v_uid) >= v_cap
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
end $$;;
