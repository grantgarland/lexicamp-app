-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, and anon inherits it, so
-- granting to `authenticated` does NOT stop an unauthenticated POST to
-- /rest/v1/rpc/send_test_push. The auth.uid() guard makes such a call a no-op,
-- but an anon-reachable plpgsql endpoint is needless surface. Caught by the
-- Supabase security advisor (anon_security_definer_function_executable).
revoke execute on function public.send_test_push() from public, anon;
grant execute on function public.send_test_push() to authenticated;;
