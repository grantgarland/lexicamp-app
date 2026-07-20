-- A12c (18-ux-iteration-2): sense-granularity fix. The result card lets the user
-- choose a sense, but save_card always persisted the cache row's primary sense.
-- The card's existing custom_front/custom_back override columns are the natural
-- carrier: save_card now accepts them (default null = primary sense, unchanged
-- behavior for existing callers). Readers already prefer the custom fields.
--
-- NOTE: the old 2-arg signature is DROPPED (not overloaded) — PostgREST cannot
-- disambiguate overloads when the extra args are defaulted.

drop function if exists public.save_card(uuid, uuid);

create function public.save_card(
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
  returning id into v_card_id;

  insert into public.card_fsrs_state (card_id, user_id) values (v_card_id, v_uid);

  insert into public.study_events (user_id, event, props)
  values (v_uid, 'word_saved', jsonb_build_object('card_id', v_card_id, 'translation_id', p_translation_id));

  return v_card_id;
end $$;

revoke execute on function public.save_card(uuid, uuid, text, text) from public, anon;
grant execute on function public.save_card(uuid, uuid, text, text) to authenticated;;
