-- Advisor fix (20-A follow-up): set_default_username is a trigger-only
-- function — it must not be callable via /rest/v1/rpc by any client role.
-- Trigger firing does not require EXECUTE on the function, so revoking all
-- is safe.
revoke all on function public.set_default_username() from public, anon, authenticated;;
