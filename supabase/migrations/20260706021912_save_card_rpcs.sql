-- Capture gate Tier 2 (16 §2): the ONLY save path. Verifies the translation row
-- is gate-approved, the deck belongs to the caller, then creates card + FSRS
-- state + analytics event atomically.
create or replace function public.save_card(p_translation_id uuid, p_deck_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_card_id uuid;
  v_gate text;
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

  insert into public.cards (deck_id, user_id, translation_id)
  values (p_deck_id, v_uid, p_translation_id)
  returning id into v_card_id;

  insert into public.card_fsrs_state (card_id, user_id) values (v_card_id, v_uid);

  insert into public.study_events (user_id, event, props)
  values (v_uid, 'word_saved', jsonb_build_object('card_id', v_card_id, 'translation_id', p_translation_id));

  return v_card_id;
end $$;

-- Card delete + explicit analytics event (FKs cascade the dependents; 03 § cascade).
create or replace function public.delete_card(p_card_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_translation uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  delete from public.cards where id = p_card_id and user_id = v_uid
    returning translation_id into v_translation;
  if v_translation is null then
    raise exception 'card not found' using errcode = 'P0002';
  end if;
  insert into public.study_events (user_id, event, props)
  values (v_uid, 'word_deleted', jsonb_build_object('card_id', p_card_id, 'translation_id', v_translation));
end $$;

revoke execute on function public.save_card(uuid, uuid) from public, anon;
revoke execute on function public.delete_card(uuid) from public, anon;
grant execute on function public.save_card(uuid, uuid) to authenticated;
grant execute on function public.delete_card(uuid) to authenticated;;
