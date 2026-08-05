-- 2026-08-04, immediately after shipping receipts. The receipts proved the
-- 12:30Z sends were rejected by Apple (InvalidProviderToken) and a 21:56Z send
-- succeeded -- with NO credential change in between (confirmed by Casey). So the
-- APNs path is INTERMITTENT, not simply broken. An intermittent auth failure is
-- worse than a hard one: it recovers on its own, so every manual test that
-- happens to land in a good window reports "fixed".
--
-- The canary exists to sample the credential path continuously instead of
-- whenever a human thinks to check. It is a CONTENT-FREE push: no title, no
-- body, _contentAvailable, so iOS displays nothing. It still traverses the exact
-- APNs credential path a real notification does, which is the thing under test.
alter table public.push_send drop constraint if exists push_send_kind_check;
alter table public.push_send add constraint push_send_kind_check
  check (kind in ('scheduled', 'test', 'canary'));

create or replace function public.push_canary()
returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare v_token record; v_req bigint; v_n int := 0;
begin
  -- One device is enough to test a PROJECT-level credential; distinct token
  -- values only, so a phone registered under two accounts is not probed twice.
  for v_token in select distinct on (token) token, user_id from public.push_tokens order by token loop
    v_req := net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
      body := jsonb_build_object('to', v_token.token, '_contentAvailable', true,
                                 'priority', 'normal', 'data', jsonb_build_object('canary', true))
    );
    insert into public.push_send (user_id, token, kind, send_request_id)
    values (v_token.user_id, v_token.token, 'canary', v_req);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('probes', v_n);
end $fn$;
revoke execute on function public.push_canary() from public, anon, authenticated;

-- Rolling credential health. This is the alerting surface: if `failed` is
-- non-zero for any recent hour, the APNs path was down during that hour even if
-- it is up right now.
create or replace view public.push_canary_health
with (security_invoker = true) as
select date_trunc('hour', created_at) as hour,
       count(*) as probes,
       count(*) filter (where receipt_status = 'ok') as ok,
       count(*) filter (where receipt_status = 'error') as failed,
       count(*) filter (where receipt_status is null) as pending,
       array_agg(distinct receipt_error) filter (where receipt_error is not null) as errors
from public.push_send where kind = 'canary'
group by 1 order by 1 desc;
comment on view public.push_canary_health is
  'Hourly APNs credential health from content-free probes. Any non-zero `failed` means push was down for real users during that hour.';;
