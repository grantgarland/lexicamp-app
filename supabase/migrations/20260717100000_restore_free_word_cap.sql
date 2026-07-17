-- Restore the 3.2 free-tier word cap (REGRESSION FIX, 2026-07-17).
-- The 2026-07-16 save_card redefinitions (sense_override → sense_swap →
-- multi_sense_cards) each `create or replace`d save_card and the final version
-- silently dropped the free_word_cap block added by `free_tier_word_cap`
-- (20260706234126 — which was also never mirrored to this folder; this file is
-- now the canonical cap definition). Verified live: prod save_card had no cap.
--
-- Semantics (unchanged from 3.2 + 18 §D12):
--   · cap gates ACQUISITION only — demoted users keep every word (read/review/
--     quiz untouched); they just can't save past 50. Data never destroyed.
--   · entitlement from the subscriptions mirror: trial/active/grace = paid.
--   · errcode P0004, message contains 'free_word_cap' (client matches the
--     string and routes to /paywall — SearchScreen.tsx).
--   · NEW (rides the E3 archival ship): the count includes SUSPENDED cards.
--     Archiving must not free cap slots, or archive→save→unarchive becomes a
--     free-tier loophole; deleting (which forfeits FSRS history) is the only
--     way to reclaim a slot.
--   · idempotent re-save of an existing sense is allowed at/over the cap
--     (it creates nothing) — the cap check therefore runs BEFORE insert but
--     tolerates the exact-duplicate path via the pre-check below.

create or replace function public.save_card(
  p_translation_id uuid,
  p_deck_id uuid,
  p_custom_front text default null,
  p_custom_back text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_card_id uuid;
  v_inserted boolean;
  v_gate text;
  v_front text := nullif(trim(coalesce(p_custom_front, '')), '');
  v_back text := nullif(trim(coalesce(p_custom_back, '')), '');
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

  -- 3.2 free-tier cap: 50 cards total (all languages, archived included).
  -- Skipped when this exact sense already exists (idempotent path saves nothing).
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
