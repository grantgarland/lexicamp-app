-- reset_own_onboarding — dev tooling for testing the 3.5 register-first flow.
--
-- WHY IT EXISTS: since 3.5 (spec `24`) the first-run gate routes on the ABSENCE
-- of a `profiles` row, so re-testing onboarding means removing that row. The
-- client cannot do it directly: `profiles` has no DELETE policy, so RLS denies
-- the delete even though the role holds the table grant. Hence a definer RPC.
--
-- SAFETY, and why this is not an escalation:
--   * It only ever touches `auth.uid()`'s OWN row. There is no parameter, so
--     there is nothing to point at another user.
--   * It is strictly LESS destructive than `delete_own_account()`, which is
--     already callable by any authenticated user and deletes the whole
--     `auth.users` row. This keeps the login and drops the profile.
--   * It is `is_dev`-gated anyway, as defence in depth and to match the house
--     pattern for dev RPCs. ⚠️ `is_dev` stopped being self-grantable when the
--     `21` P0-1 column lockdown landed (`20260820150409`), which is what makes
--     that gate meaningful rather than decorative.
--
-- ⚠️ WHAT IT DELETES: everything. Every FK into `profiles` is ON DELETE CASCADE
-- — cards, card_fsrs_state, card_target_overrides, decks, deck_cards,
-- review_logs, study_events, notification_prefs, profile_languages, push_tokens,
-- push_log, push_send, AND `subscriptions`. Resetting a paid test account
-- therefore drops its entitlement mirror; Restore or the 3.14 reconciler will
-- rebuild it from RevenueCat, but do not be surprised by it.
create or replace function public.reset_own_onboarding()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if not exists (select 1 from public.profiles where id = v_uid and is_dev) then
    raise exception 'reset_own_onboarding is dev-only' using errcode = '42501';
  end if;

  -- Cascades across every child table; see the header.
  delete from public.profiles where id = v_uid;
end $$;

-- Callable by a signed-in dev account only. `anon` has no business here, and the
-- explicit revoke keeps this off the anon surface even though the body would
-- reject it — the `21` P0-1 lesson is that grants and policies drift apart, so
-- say it in both places.
-- ⚠️ See the follow-up migration `..192518_reset_own_onboarding_revoke_public`:
-- this revoke alone did NOT remove anon's EXECUTE. Postgres grants function
-- EXECUTE to PUBLIC by default and anon inherits it through that, so the PUBLIC
-- grant is the one that has to go. Left as authored for the record.
revoke all on function public.reset_own_onboarding() from anon;
grant execute on function public.reset_own_onboarding() to authenticated;

comment on function public.reset_own_onboarding() is
  'Dev-only: delete the caller''s own profile row (cascades all their data) so the 3.5 first-run flow can be re-tested. Keeps auth.users, so the login still works.';
