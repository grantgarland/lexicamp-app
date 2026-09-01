-- 21 §P0-1 — close the verified paywall bypass.
--
-- THE BUG (proven against prod 2026-08-06 in a rolled-back transaction):
--   PATCH /rest/v1/profiles?id=eq.<own-uid>  {"is_dev": true}   -> succeeded
--   POST  /rest/v1/rpc/set_dev_plan          {"p_status":"active"}
-- ...which writes subscriptions.status='active'. save_card skips the free cap on
-- that status and every premium surface unlocks. Two requests, public anon key,
-- permanent, for free.
--
-- ⚠️ THE POLICY WAS NEVER THE WEAK LINK. `own profile update` is correct:
-- `(select auth.uid()) = id`. RLS answers WHICH ROWS; column grants answer WHICH
-- COLUMNS. `authenticated` held a column-level UPDATE grant on EVERY column of
-- profiles, is_dev included, and no trigger guarded it. A privilege flag living on
-- a user-writable row needs both halves.
--
-- Pre-flight (memory: prod-migration-checklist item 4): every function that writes
-- profiles — add_learning_language, complete_onboarding, seed_dev_veteran,
-- set_username, switch_learning_language_impl — is SECURITY DEFINER, so it runs as
-- the owner and ignores these grants entirely. The ONLY direct client write is
-- SupabaseDataSource.updateProfile, which sets exactly display_name and
-- quiz_length. Those two are granted back below; nothing else needs to be.
--
-- INSERT is revoked outright: the client never inserts a profile. complete_onboarding
-- (DEFINER) does it.

revoke insert, update on public.profiles from anon, authenticated;
grant update (display_name, quiz_length) on public.profiles to authenticated;

notify pgrst, 'reload schema';
