-- 3.2 — free-tier limit enforcement, server-side (the app also pre-checks for
-- UX, but the RPC is the guard that can't be bypassed). Working free tier (00):
-- ~50 saved words. Entitlement source: subscriptions mirror (absent row = free;
-- trial/active/grace = paid). Cap lives in one place here — change via migration.
create or replace function public.save_card(p_translation_id uuid, p_deck_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_card_id uuid;
  v_gate text;
  v_status text;
  v_count int;
  c_free_cap constant int := 50;
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

  -- Free-tier word cap (paid = trial/active/grace).
  select status into v_status from public.subscriptions where user_id = v_uid;
  if coalesce(v_status, 'free') not in ('trial', 'active', 'grace') then
    select count(*) into v_count from public.cards where user_id = v_uid;
    if v_count >= c_free_cap then
      raise exception 'free_word_cap' using errcode = 'P0004';
    end if;
  end if;

  insert into public.cards (deck_id, user_id, translation_id)
  values (p_deck_id, v_uid, p_translation_id)
  returning id into v_card_id;

  insert into public.card_fsrs_state (card_id, user_id) values (v_card_id, v_uid);

  insert into public.study_events (user_id, event, props)
  values (v_uid, 'word_saved', jsonb_build_object('card_id', v_card_id, 'translation_id', p_translation_id));

  return v_card_id;
end $$;;
