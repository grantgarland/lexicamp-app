-- `revoke ... from anon` did not remove anon's EXECUTE on reset_own_onboarding.
-- Postgres grants function EXECUTE to PUBLIC by default, and anon inherits it
-- through that, so revoking the role-level grant is a no-op against it.
-- Revoking PUBLIC is what actually closes it.
--
-- ⚠️ Caught by checking `has_function_privilege('anon', …)` after applying rather
-- than trusting the revoke — the `21` P0-1 lesson (RLS looked right; the GRANT
-- was wrong) applied to functions instead of tables. Never exploitable here: the
-- body raises 28000 when `auth.uid()` is null, so anon could not have used it.
revoke all on function public.reset_own_onboarding() from public;
revoke all on function public.reset_own_onboarding() from anon;
grant execute on function public.reset_own_onboarding() to authenticated;
