-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, and anon INHERITS that,
-- so granting to `authenticated` does NOT stop an unauthenticated POST to
-- /rest/v1/rpc/send_test_push. The auth.uid() guard in the function makes such a
-- call a no-op, but an anon-reachable plpgsql endpoint is needless surface.
-- Caught by the Supabase security advisor
-- (anon_security_definer_function_executable) minutes after the function shipped
-- -- worth running `get_advisors` after ANY new SECURITY DEFINER function.
revoke execute on function public.send_test_push() from public, anon;
grant execute on function public.send_test_push() to authenticated;
