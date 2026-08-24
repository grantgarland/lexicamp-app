-- reset_own_onboarding: drop the `is_dev` gate.
--
-- WHY IT IS BEING REMOVED, one day after being added: the gate blocked the exact
-- accounts the tool exists for. Testing the 3.5 first-run flow means signing up a
-- throwaway account — and a fresh signup has `is_dev = false`. Since the `21`
-- P0-1 lockdown (`20260820150409`) `is_dev` can only be set by the operator via
-- SQL, so the flag can never be self-served. The only accounts that passed the
-- gate were the seven seeded `dev-*` scenario accounts, which are precisely the
-- ones that must NOT be reset — they are what the 1.9 / 2.5 verification batch
-- runs on. Observed as `reset_own_onboarding is dev-only` on device.
--
-- WHY DROPPING IT IS SAFE, and this is the part worth checking rather than
-- taking on faith:
--   * The function takes NO parameters and deletes only `auth.uid()`'s own row.
--     There is nothing to point at another user, so it grants no lateral access.
--   * `public.delete_own_account()` is ALREADY ungated, callable by any
--     authenticated user, and strictly MORE destructive: it deletes the whole
--     `auth.users` row, cascading everything including the login itself. It
--     exists because Apple requires an in-app deletion path. So an ungated
--     self-scoped reset confers no capability an attacker does not already hold
--     in a larger form — it is a weaker version of a hammer that is already out.
--   * `anon` still cannot call it (see the grants re-asserted below), and the
--     body still rejects an unauthenticated caller with 28000.
--   * The DevBadge that calls it is stripped from every non-dev bundle at Metro
--     RESOLUTION time (`metro/excludedModules.js`), proven by
--     `npm run verify:bundle`, so no shipped build references it.
--
-- ⚠️ UNCHANGED AND STILL TRUE: this deletes EVERYTHING for the caller. Every FK
-- into `profiles` is ON DELETE CASCADE — cards, card_fsrs_state,
-- card_target_overrides, decks, deck_cards, review_logs, study_events,
-- notification_prefs, profile_languages, push_tokens, push_log, push_send, AND
-- `subscriptions`. Resetting a paid account drops its entitlement mirror; Restore
-- or the 3.14 reconciler rebuilds it from RevenueCat.
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

  -- Own row only. Cascades across every child table; see the header.
  delete from public.profiles where id = v_uid;
end $$;

-- Re-asserted rather than assumed. `create or replace function` preserves
-- existing privileges, so these are already correct — but ⚠️ the whole reason a
-- second migration was needed yesterday is that `revoke … from anon` silently
-- does NOT remove anon's EXECUTE (Postgres grants it to PUBLIC by default and
-- anon inherits through that). Stating both keeps the intent readable in one
-- place, and `has_function_privilege` is checked after applying.
revoke all on function public.reset_own_onboarding() from public;
revoke all on function public.reset_own_onboarding() from anon;
grant execute on function public.reset_own_onboarding() to authenticated;

comment on function public.reset_own_onboarding() is
  'Dev tooling: delete the caller''s OWN profile row (cascades all their data) so the 3.5 first-run flow can be re-tested. Keeps auth.users, so the login still works. Deliberately not is_dev-gated — see migration 20260820200000; it is strictly weaker than the ungated delete_own_account().';
