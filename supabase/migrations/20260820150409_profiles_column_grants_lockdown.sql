-- 21 §P0-1 — the live paywall bypass. Flagged 2026-08-06, prescribed then, and
-- STILL OPEN as of 2026-08-19: the 08-15 handoff noted nobody had confirmed the
-- revoke landed, and it had not.
--
-- The chain, verified against production at the time it was written:
--   PATCH /rest/v1/profiles?id=eq.<own-uid>  {"is_dev": true}      -> succeeds
--   POST  /rest/v1/rpc/set_dev_plan          {"p_status":"active"} -> premium
--
-- RLS restricts which ROWS a user may touch; column GRANTS decide which COLUMNS.
-- `authenticated` held UPDATE on all 12 columns of `profiles`, including
-- `is_dev`, and the own-profile-update policy happily allows writing your own
-- row. `set_dev_plan` then gates on `profiles.is_dev` — which the attacker has
-- just set. No trigger guarded it.
--
-- ⚠️ This got sharper on 2026-08-19: set_dev_plan now writes a 30-day future
-- current_period_end (20260819210015), so a self-granted subscription passes the
-- is_paid_state period-end backstop cleanly instead of possibly tripping over a
-- stale date. The backstop was never a defence against this and should not be
-- mistaken for one.
--
-- Fix: revoke blanket INSERT/UPDATE and re-grant UPDATE on ONLY the three
-- columns the client actually writes (SupabaseDataSource.updateProfile):
-- display_name, quiz_length, timezone. Everything else — username, is_dev,
-- native_lang, onboarding state — already goes through SECURITY DEFINER RPCs,
-- which run as owner and are unaffected by these grants.
--
-- ⚠️ INSERT is safe to revoke: profiles rows are created by
-- `complete_onboarding` (SECURITY DEFINER), never by the client, which only ever
-- issues .update() and .select() against this table. There is no trigger on
-- auth.users creating them.
--
-- SELECT is deliberately left alone; it is gated by RLS and the leaderboard
-- reads through a definer function anyway.
--
-- Verified post-apply AS the `authenticated` role inside a rolled-back
-- transaction: the real updateProfile write succeeds, and `update profiles set
-- is_dev = true` raises insufficient_privilege.

revoke insert, update on public.profiles from anon, authenticated;

grant update (display_name, quiz_length, timezone) on public.profiles to authenticated;

comment on column public.profiles.is_dev is
  'Dev-scenario flag gating set_dev_plan / reset_dev_scenario. ⚠️ MUST NOT be '
  'client-writable — a user who can set this can grant themselves premium via '
  'set_dev_plan (21 P0-1). Column-level UPDATE grants on this table are '
  'deliberately limited to display_name, quiz_length and timezone.';
