-- Intermittent APNs auth: the canary (2026-08-04, hours after the receipts landed).
--
-- WHY: receipts proved the 12:30Z scheduled sends were rejected by Apple with
-- InvalidProviderToken, and a 21:56Z send succeeded -- with NO credential change
-- in between (confirmed with Casey directly). So the APNs path is INTERMITTENT,
-- not simply broken.
--
-- An intermittent auth failure is worse than a hard one. It recovers on its own,
-- so any manual test that happens to land in a good window reports "fixed", and
-- the next morning's real notification silently does not arrive. You cannot
-- sample this by hand; something has to sample it continuously.
--
-- LEADING HYPOTHESIS (unconfirmed): Expo signs an APNs provider JWT from the .p8
-- and caches it. Apple rejects a stale/over-refreshed provider token with 403
-- InvalidProviderToken until it is regenerated -- which would produce exactly
-- this shape: a window of total failure, then spontaneous recovery, with nothing
-- changed on our side. A genuinely invalid key looks identical from receipts
-- alone, which is why the key should ALSO be re-verified in EAS.
--
-- The probe is CONTENT-FREE: no title, no body, _contentAvailable, so iOS
-- displays nothing. It still traverses the exact APNs credential path a real
-- notification takes, which is the thing under test.
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

-- The alerting surface. A non-zero `failed` for any hour means push was down for
-- REAL users during that hour, even if it is up right now.
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
  'Hourly APNs credential health from content-free probes. Any non-zero `failed` means push was down for real users during that hour.';

-- Every 15 minutes. Disable with: select cron.unschedule('lexicamp-push-canary');
select cron.unschedule('lexicamp-push-canary') where exists (select 1 from cron.job where jobname = 'lexicamp-push-canary');
select cron.schedule('lexicamp-push-canary', '*/15 * * * *', $cron$select public.push_canary()$cron$);
