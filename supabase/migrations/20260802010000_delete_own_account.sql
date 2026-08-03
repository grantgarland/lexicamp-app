-- delete_own_account — App Store Guideline 5.1.1(v) requires in-app account
-- deletion for any app that supports account creation. The Settings button
-- existed since 2.x but its confirm handler was a no-op; this is the server half.
--
-- Deleting the auth.users row is sufficient: public.profiles.id references
-- auth.users(id) on delete cascade, and all 12 FKs pointing at profiles cascade
-- too, so every card, review log, deck, push token and pref goes with it.
--
-- security definer because authenticated users have no rights in the auth schema.
-- The function takes NO arguments and derives the target from auth.uid() alone —
-- there is deliberately no way to name a different user.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Cascades do the rest (profiles → cards, decks, review_logs, push_tokens, …).
  delete from auth.users where id = v_uid;
end $$;

revoke execute on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

comment on function public.delete_own_account() is
  'Deletes the CALLING user''s account and all cascaded data. App Store 5.1.1(v).';
