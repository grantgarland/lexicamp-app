create table public.deck_cards (
  deck_id    uuid not null references public.decks(id) on delete cascade,
  card_id    uuid not null references public.cards(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (deck_id, card_id)
);

create index deck_cards_card_idx on public.deck_cards (card_id);
create index deck_cards_user_idx on public.deck_cards (user_id);

alter table public.deck_cards enable row level security;

create policy deck_cards_select_own on public.deck_cards
  for select using (user_id = (select auth.uid()));

create policy deck_cards_insert_own on public.deck_cards
  for insert with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.decks d where d.id = deck_id and d.user_id = (select auth.uid()))
    and exists (select 1 from public.cards c where c.id = card_id and c.user_id = (select auth.uid()))
  );

create policy deck_cards_delete_own on public.deck_cards
  for delete using (user_id = (select auth.uid()));

revoke insert, update, delete on public.deck_cards from authenticated, anon;
revoke insert, update, delete on public.decks from authenticated, anon;

drop index public.decks_user_name_key;

create unique index decks_user_lang_name_key
  on public.decks (user_id, target_lang, lower(btrim(name)));

create function public.is_main_deck(p_deck_id uuid)
returns boolean
language sql stable set search_path = ''
as $$
  select exists (
    select 1 from public.decks d
    where d.id = p_deck_id
      and d.id = (
        select d2.id from public.decks d2
        where d2.user_id = d.user_id and d2.target_lang = d.target_lang
        order by d2.created_at asc, d2.id asc
        limit 1
      )
  );
$$;

create function public.custom_deck_cap() returns int
language sql immutable set search_path = '' as $$ select 50 $$;

create function public.create_deck(p_name text, p_target_lang text, p_card_ids uuid[] default '{}')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_src  text;
  v_deck uuid;
  v_seeded int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception 'deck_name_invalid' using errcode = 'P0012';
  end if;
  if not exists (
    select 1 from public.subscriptions s
    where s.user_id = v_uid and s.status in ('trial', 'active', 'grace')
  ) then
    raise exception 'premium_required' using errcode = 'P0010';
  end if;

  select d.source_lang into v_src
  from public.decks d
  where d.user_id = v_uid and d.target_lang = p_target_lang
  order by d.created_at asc, d.id asc
  limit 1;
  if v_src is null then
    raise exception 'language_not_enrolled' using errcode = 'P0002';
  end if;

  if (
    select count(*) from public.decks d
    where d.user_id = v_uid and d.target_lang = p_target_lang
  ) > public.custom_deck_cap() then
    raise exception 'deck_cap_reached' using errcode = 'P0011';
  end if;

  if exists (
    select 1 from public.decks d
    where d.user_id = v_uid and d.target_lang = p_target_lang
      and lower(btrim(d.name)) = lower(v_name)
  ) then
    raise exception 'deck_name_taken' using errcode = 'P0013';
  end if;

  insert into public.decks (user_id, name, source_lang, target_lang)
  values (v_uid, v_name, v_src, p_target_lang)
  returning id into v_deck;

  insert into public.deck_cards (deck_id, card_id, user_id)
  select v_deck, c.id, v_uid
  from public.cards c
  join public.decks d on d.id = c.deck_id
  where c.id = any (coalesce(p_card_ids, '{}'::uuid[]))
    and c.user_id = v_uid
    and d.target_lang = p_target_lang
  on conflict do nothing;
  get diagnostics v_seeded = row_count;

  insert into public.study_events (user_id, event, props)
  values (v_uid, 'deck_created', jsonb_build_object('deck_id', v_deck, 'word_count', v_seeded));

  return v_deck;
end $$;

create function public.delete_deck(p_deck_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.decks d where d.id = p_deck_id and d.user_id = v_uid) then
    raise exception 'deck not found' using errcode = 'P0002';
  end if;
  if public.is_main_deck(p_deck_id) then
    raise exception 'main_deck_undeletable' using errcode = 'P0014';
  end if;

  delete from public.decks where id = p_deck_id and user_id = v_uid;

  insert into public.study_events (user_id, event, props)
  values (v_uid, 'deck_deleted', jsonb_build_object('deck_id', p_deck_id));
end $$;

create function public.add_card_to_deck(p_deck_id uuid, p_card_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_lang text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select d.target_lang into v_lang
  from public.decks d where d.id = p_deck_id and d.user_id = v_uid;
  if v_lang is null then
    raise exception 'deck not found' using errcode = 'P0002';
  end if;
  if public.is_main_deck(p_deck_id) then
    raise exception 'main_deck_membership_implicit' using errcode = 'P0014';
  end if;
  if not exists (
    select 1 from public.subscriptions s
    where s.user_id = v_uid and s.status in ('trial', 'active', 'grace')
  ) then
    raise exception 'premium_required' using errcode = 'P0010';
  end if;
  if not exists (
    select 1 from public.cards c
    join public.decks d on d.id = c.deck_id
    where c.id = p_card_id and c.user_id = v_uid and d.target_lang = v_lang
  ) then
    raise exception 'card not found' using errcode = 'P0002';
  end if;

  insert into public.deck_cards (deck_id, card_id, user_id)
  values (p_deck_id, p_card_id, v_uid)
  on conflict do nothing;
end $$;

create function public.remove_card_from_deck(p_deck_id uuid, p_card_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  delete from public.deck_cards
  where deck_id = p_deck_id and card_id = p_card_id and user_id = v_uid;
end $$;

revoke execute on function public.is_main_deck(uuid) from public, anon, authenticated;
revoke execute on function public.create_deck(text, text, uuid[]) from public, anon;
revoke execute on function public.delete_deck(uuid) from public, anon;
revoke execute on function public.add_card_to_deck(uuid, uuid) from public, anon;
revoke execute on function public.remove_card_from_deck(uuid, uuid) from public, anon;

grant execute on function public.create_deck(text, text, uuid[]) to authenticated;
grant execute on function public.delete_deck(uuid) to authenticated;
grant execute on function public.add_card_to_deck(uuid, uuid) to authenticated;
grant execute on function public.remove_card_from_deck(uuid, uuid) to authenticated;;
