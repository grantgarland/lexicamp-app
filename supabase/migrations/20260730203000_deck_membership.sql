-- Custom deck MEMBERSHIP (2026-07-30). Until now "custom decks" were a UI
-- prototype: `DeckDetailSheet` rendered `words.slice(0, deck.wordCount)` — a
-- POSITIONAL prefix of the whole library — and "Already added" was a local
-- `Set<deckId|cardId>` that no mutation ever wrote. Three surfaces, three
-- unrelated sources of truth (Casey bug report, 2026-07-30: a word edited from
-- сахара → сахар "vanished" from its deck; the edit only forced the refetch
-- that reshuffled the positional slice).
--
-- Why a JOIN TABLE and not `cards.deck_id`: that column is already spoken for.
-- It points at the per-language MAIN deck (the hidden one `getActiveDeck` /
-- `ensure_deck_for_language` resolve as the OLDEST deck per language, 18 §E1),
-- and it carries the multi-sense uniqueness key
-- `(deck_id, translation_id, coalesce(custom_back,''))`. Moving a card into a
-- custom deck would therefore (a) drop it out of every language-scoped read —
-- they all scope through `decks!inner(target_lang)` on that FK — and (b) let the
-- same sense be saved twice. Membership is additive; the card never leaves its
-- language deck. That also makes a word joinable to MANY custom decks, which the
-- Add-to-Deck sheet has always implied.

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

-- `(select auth.uid())` — not the bare call — so the planner evaluates it once
-- as an initplan instead of per row (the convention in enable_rls_policies.sql).
-- deck_cards is scanned per deck by getDecks' `deck_cards(count)` embed.
create policy deck_cards_select_own on public.deck_cards
  for select using (user_id = (select auth.uid()));
-- Ownership of the DECK and the CARD, not just the row's user_id. A policy that
-- only checked user_id would let a caller plant membership rows pointing at
-- another user's deck, and — more importantly — let any client bypass every gate
-- in the RPCs below with a direct POST /rest/v1/deck_cards.
create policy deck_cards_insert_own on public.deck_cards
  for insert with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.decks d where d.id = deck_id and d.user_id = (select auth.uid()))
    and exists (select 1 from public.cards c where c.id = card_id and c.user_id = (select auth.uid()))
  );
create policy deck_cards_delete_own on public.deck_cards
  for delete using (user_id = (select auth.uid()));
-- No UPDATE policy on purpose: a membership row has no mutable field. Moving a
-- card between decks is delete + insert, both of which re-run the ownership and
-- language checks in the RPCs below.

-- Belt AND braces: writes go through the RPCs, which own the premium gate, the
-- deck cap, name normalisation, the language check and the main-deck guard. RLS
-- policies above are the second line, not the first — a direct table write would
-- satisfy them while skipping all of that. SELECT stays granted: the reads
-- (getDeckWords' embed, getCardDeckIds, getDecks' count) are plain PostgREST.
revoke insert, update, delete on public.deck_cards from authenticated, anon;

-- Same hole, pre-existing, on `decks` itself: the "own decks" policy is
-- `for all`, so a direct DELETE /rest/v1/decks?id=eq.<main deck> cascades away
-- every card, FSRS state and review log for that language — which delete_deck's
-- main-deck guard below only LOOKS like it prevents. Nothing in the app writes
-- this table directly (the only two `.from('decks')` call sites are selects), so
-- closing it costs nothing.
revoke insert, update, delete on public.decks from authenticated, anon;

-- Deck-name uniqueness. 03 specifies `(user_id, lower(trim(name)))`; this
-- REFINES it to include target_lang, because the Decks tab is language-scoped —
-- a "Food" deck while learning Russian and a "Food" deck while learning Spanish
-- are different decks the user can never see side by side, and colliding them
-- would be a bug, not a guardrail. Existing rows can't violate this: the only
-- decks in production are the per-language main decks, one per (user, language),
--
-- The old index is DROPPED, not merely superseded: adding a narrower unique index
-- does not relax a wider one, and leaving both would make create_deck's friendly
-- in-language pre-check pass and then trip a raw 23505 on insert — a permanent,
-- unmappable "check your connection" for the exact cross-language case this is
-- meant to allow.
drop index public.decks_user_name_key;

-- (If the new index FAILS to create, the migration rolls
-- back and the message names the duplicate — resolve by renaming, don't drop the
-- constraint: two decks with one name is exactly the ambiguity it prevents.)
create unique index decks_user_lang_name_key
  on public.decks (user_id, target_lang, lower(btrim(name)));

-- Is this deck the user's hidden MAIN deck for its language? Single source of
-- truth for the "oldest per (user, language)" rule that getActiveDeck,
-- ensure_deck_for_language and getDecks' .slice(1) all encode independently.
-- Deleting a main deck would cascade every card the user owns in that language,
-- so this is a guard, not a nicety.
-- SECURITY INVOKER on purpose: it is only ever called from inside the SECURITY
-- DEFINER functions below (where it therefore runs with their privileges, after
-- ownership has already been checked), and execute is granted to nobody, so it
-- can't be used as an oracle to probe other users' deck ids.
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

-- Cap on custom decks per language. Not a monetisation lever (custom decks are
-- already premium-gated) — an abuse ceiling, deliberately far above any real use.
create function public.custom_deck_cap() returns int
language sql immutable set search_path = '' as $$ select 50 $$;

-- create_deck(name, target_lang, card_ids[]) → new deck id
-- Premium-gated. Normalises the name (trim + collapse internal whitespace, per
-- 03's "normalize server-side, never trust the client"), then seeds membership
-- from `p_card_ids` — filtered to cards the caller owns THAT LIVE IN THAT
-- LANGUAGE, so a stale client can't stitch a Russian word into a Spanish deck.
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

  -- The language must already be seeded — the main deck supplies source_lang so
  -- a custom deck can never disagree with the pair the user is actually studying.
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
  ) > public.custom_deck_cap() then  -- > cap, not >=: the main deck is in the count
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

-- delete_deck(deck) — removes the deck and its MEMBERSHIP rows. The words
-- themselves are untouched: they live in the language's main deck via
-- cards.deck_id, which this never writes. That is what the confirm dialog
-- promises ("data removed; words kept") and it is now literally true.
-- Refuses on the main deck: that cascade would take every card in the language.
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

-- add_card_to_deck — idempotent (re-adding is a no-op, so a double-tap or an
-- outbox replay can't error). Premium-gated to match create_deck.
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
    -- Membership in the main deck is implicit (every card in the language is in
    -- it, via cards.deck_id). Writing a row would double-count getDecks.
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

-- remove_card_from_deck — NEVER premium-gated, and never idempotency-fussy.
-- Same covenant as clearing a translation override and restoring an archived
-- language: a lapsed subscription must always be able to undo its own state.
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
grant execute on function public.remove_card_from_deck(uuid, uuid) to authenticated;
