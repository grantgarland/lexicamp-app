-- Deck review stats count only reviews that happened AFTER the card joined the
-- deck (Casey, 2026-08-13).
--
-- BUG. get_deck_stats (migration 20260805183000) joined review_logs to
-- deck_cards on card_id alone, with no time bound. A deck is a membership view
-- over cards, so every review a card had EVER received was attributed to every
-- deck that card is currently in — including reviews from long before the deck
-- existed. Creating a deck out of words you had already studied therefore gave
-- it a full review history on its first render: a deck created today, holding 4
-- previously-studied words, reported "REVIEWS 22 / LAST REVIEWED 4 days ago"
-- before it had ever been opened.
--
-- The membership model itself is right and is kept: a review still counts for
-- every deck the card belonged to, and a word in two decks counts once for each
-- (the alternative needs a notion of a "primary" deck that does not exist).
-- What was missing is that membership has a START. deck_cards.created_at is
-- that timestamp, and a review before it cannot have been a review *in* this
-- deck — the deck may not even have existed yet.
--
-- Consequences of the window, all intended:
--   * a newly created deck reads 0 / Never and accrues from there, matching
--     what mockDataSource.createDeck has always returned;
--   * a card added to an old deck today contributes only its future reviews;
--   * removing and re-adding a card restarts its contribution, because the
--     membership it is being counted for genuinely restarted.
--
-- Everything else — the keyed-by-deck-id shape, security, grants — is unchanged;
-- only the join predicate moves. Client mirror: SupabaseDataSource.getDecks
-- consumes this verbatim, and deckStatsMembershipWindow.test.ts fails CI if the
-- bound is dropped from this file.
create or replace function public.get_deck_stats()
returns jsonb
language sql
stable security definer set search_path = ''
as $function$
  select coalesce(
    jsonb_object_agg(
      d.id,
      jsonb_build_object('reviews', d.reviews, 'last_reviewed_at', d.last_reviewed_at)
    ),
    '{}'::jsonb
  )
  from (
    select dk.id,
           count(r.id)        as reviews,
           max(r.reviewed_at) as last_reviewed_at
    from public.decks dk
    left join public.deck_cards dc
      on dc.deck_id = dk.id and dc.user_id = auth.uid()
    left join public.review_logs r
      on r.card_id = dc.card_id
     and r.user_id = auth.uid()
     -- The membership window. Without it a brand-new deck inherits the entire
     -- review history of the words it was built from.
     and r.reviewed_at >= dc.created_at
    where dk.user_id = auth.uid()
    group by dk.id
  ) d;
$function$;
revoke execute on function public.get_deck_stats() from public, anon;
grant execute on function public.get_deck_stats() to authenticated;
