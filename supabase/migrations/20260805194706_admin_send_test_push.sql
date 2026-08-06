-- Fire a test push at a user's devices from the Supabase SQL editor, by email.
--
-- The recipe in docs/PUSH_VERIFICATION.md already worked, but it needed a join
-- against auth.users and push_tokens every time. This is the same thing as one
-- call, with the failure modes turned into readable errors instead of an empty
-- result set — "no rows" was itself a reported confusion, because it looks
-- identical to a send that happened silently.
--
-- ⚠️ SECURITY. This sends arbitrary text to any account's devices. It is granted
-- to service_role and postgres ONLY — never to `authenticated`, which would let
-- any signed-in user push whatever they liked to any other user. The GRANT at
-- the bottom is load-bearing; if you ever see this function callable by
-- `authenticated`, that is a vulnerability, not a convenience.
--
-- Not callable from the app for the same reason. The in-app equivalent is
-- send_test_push(), which resolves auth.uid() and can only ever reach the caller.
create or replace function public.admin_send_test_push(
  p_email text,
  p_body  text default 'Push is working. Nothing is due - this was a test.'
)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_uid uuid;
  v_token record;
  v_n int := 0;
  v_tokens jsonb := '[]'::jsonb;
begin
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email));
  if v_uid is null then
    raise exception 'no account with email %', p_email using errcode = 'P0002';
  end if;

  for v_token in select token, platform from public.push_tokens where user_id = v_uid loop
    perform public.push_send_to_token(
      v_uid, v_token.token, 'Lexicamp test', p_body, '/', 'test');
    v_n := v_n + 1;
    v_tokens := v_tokens || jsonb_build_object('platform', v_token.platform,
                                               'token_tail', right(v_token.token, 12));
  end loop;

  -- An account with no registered device is a DIFFERENT problem from a failed
  -- send, and silently returning zero rows hid that distinction (see the doc's
  -- "If the account has no token" section).
  if v_n = 0 then
    raise exception 'account % has no registered device. The app registers on '
                    'a real device only (not the simulator), with notification '
                    'permission granted and USE_SUPABASE on.', p_email
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'sent_to_devices', v_n,
    'devices', v_tokens,
    'next', 'run select public.sweep_push_delivery(); twice, then read push_send'
  );
end $$;

-- Admin-only. See the security note above: `authenticated` must NEVER appear here.
revoke all on function public.admin_send_test_push(text, text) from public, anon, authenticated;
grant execute on function public.admin_send_test_push(text, text) to service_role;;
