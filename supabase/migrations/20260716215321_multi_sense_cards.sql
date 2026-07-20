alter table public.cards drop constraint cards_deck_id_translation_id_key;

create unique index cards_deck_translation_sense_key
  on public.cards (deck_id, translation_id, coalesce(custom_back, ''));

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

  insert into public.cards (deck_id, user_id, translation_id, custom_front, custom_back)
  values (
    p_deck_id,
    v_uid,
    p_translation_id,
    nullif(trim(coalesce(p_custom_front, '')), ''),
    nullif(trim(coalesce(p_custom_back, '')), '')
  )
  on conflict (deck_id, translation_id, coalesce(custom_back, '')) do update
    set custom_front = excluded.custom_front
  returning id, (xmax = 0) into v_card_id, v_inserted;

  if v_inserted then
    insert into public.card_fsrs_state (card_id, user_id) values (v_card_id, v_uid);
    insert into public.study_events (user_id, event, props)
    values (v_uid, 'word_saved', jsonb_build_object('card_id', v_card_id, 'translation_id', p_translation_id));
  end if;

  return v_card_id;
end $$;;
