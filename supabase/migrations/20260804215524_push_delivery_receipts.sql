-- Push DELIVERY truth (2026-08-04).
--
-- WHAT WAS WRONG: nothing in this pipeline could tell "sent" from "delivered".
-- run_push_scheduler called net.http_post and threw the request id away, then
-- inserted a push_log row unconditionally. push_log therefore recorded INTENT.
-- Expo /push/send returns a TICKET, and a ticket only means "we accepted it";
-- actual delivery is reported later, separately, via /push/getReceipts.
--
-- WHAT THAT COST: 16 push_log rows across 14 days (2026-07-21 .. 2026-08-04) all
-- read as successes. Pulling the receipts for the 2026-08-04 tickets by hand
-- returned, for every one of them:
--     status: error, reason: InvalidProviderToken, APNs 403, InvalidCredentials
-- Apple had rejected 100% of them because the project APNs auth key was bad.
-- Push had never worked, and every signal the system produced said it had.
--
-- WHAT THIS ADDS:
--   * push_send   -- one row per (attempt, token) carrying the send request id,
--                    the Expo ticket, and the RECEIPT. The delivery record.
--   * sweep_push_delivery() -- the async collector, on cron. pg_net is
--                    fire-and-forget, so resolution is necessarily a later pass.
--   * send_test_push() -- on-demand push to your OWN device, so a credential fix
--                    is confirmable in seconds instead of waiting for 09:00.
--   * push_delivery_health -- the one view to read when asking "is push working".
--
-- DELIBERATELY NOT CHANGED: the eligibility rules in run_push_scheduler. This
-- migration only makes the outcome observable. push_log stays exactly as it was,
-- because it is the once-per-day DEDUPE key and that is all it was ever fit for.
--
-- NOTE ON net._http_response: pg_net PRUNES it (hours, not days). A push_send row
-- whose response is collected too late is unresolvable forever. That is why the
-- sweep runs every 5 minutes rather than nightly.

create table if not exists public.push_send (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- Stored per-attempt rather than joined from push_tokens: the point is to
  -- still know WHICH token failed after a bad token has been pruned.
  token text not null,
  kind text not null default 'scheduled' check (kind in ('scheduled', 'test')),
  created_at timestamptz not null default now(),
  send_request_id bigint,
  ticket_id text,
  send_error text,
  receipt_request_id bigint,
  receipt_status text check (receipt_status in ('ok', 'error')),
  receipt_error text,
  receipt_message text,
  resolved_at timestamptz
);
comment on table public.push_send is
  'One row per push attempt per device token. receipt_status is the ONLY column that means delivered; ticket_id merely means Expo accepted it.';
create index if not exists push_send_unresolved_idx on public.push_send (id) where resolved_at is null;
create index if not exists push_send_user_created_idx on public.push_send (user_id, created_at desc);
alter table public.push_send enable row level security;
drop policy if exists "own push sends" on public.push_send;
create policy "own push sends" on public.push_send for select to authenticated
  using ((select auth.uid()) = user_id);

-- ONE http_post per token, not one batched post per user. Expo does support
-- batching and returns tickets in request order, but that mapping is POSITIONAL
-- and silently wrong the moment anything reorders. With a handful of tokens the
-- extra requests cost nothing; if volume ever demands batching, add an ordinal
-- column rather than trusting array position.
create or replace function public.push_send_to_token(
  p_user_id uuid, p_token text, p_title text, p_body text, p_url text, p_kind text
) returns bigint
language plpgsql security definer set search_path = ''
as $fn$
declare v_req bigint;
begin
  v_req := net.http_post(
    url := 'https://exp.host/--/api/v2/push/send',
    headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
    body := jsonb_build_object('to', p_token, 'title', p_title, 'body', p_body,
                               'data', jsonb_build_object('url', p_url))
  );
  insert into public.push_send (user_id, token, kind, send_request_id)
  values (p_user_id, p_token, p_kind, v_req);
  return v_req;
end $fn$;
revoke execute on function public.push_send_to_token(uuid, text, text, text, text, text) from public, anon, authenticated;

-- Sends only to the CALLER's own registered tokens. There is no user_id
-- parameter on purpose, so this can be granted to authenticated without
-- becoming a way to push arbitrary text at other people's phones.
create or replace function public.send_test_push()
returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_token record;
  v_n int := 0;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  -- A test button that can be held down is an abuse vector and would also blow
  -- through Expo's rate limits.
  if exists (select 1 from public.push_send
             where user_id = v_uid and kind = 'test' and created_at > now() - interval '1 minute') then
    raise exception 'a test push was already sent in the last minute' using errcode = '53400';
  end if;
  for v_token in select token from public.push_tokens where user_id = v_uid loop
    perform public.push_send_to_token(v_uid, v_token.token, 'Lexicamp test',
      'Push is working. Nothing is due - this was a test.', '/', 'test');
    v_n := v_n + 1;
  end loop;
  -- Zero tokens is a REAL answer, not an error: it means this account has never
  -- completed permission + registration on any device, which is itself the bug
  -- to chase. Callers must distinguish it from a successful send.
  return jsonb_build_object('tokens', v_n, 'sent_at', now());
end $fn$;
grant execute on function public.send_test_push() to authenticated;

-- Three phases because pg_net is fire-and-forget: the response to a call made in
-- this transaction cannot be read in this transaction. Each phase picks up where
-- the previous one left off on a later tick.
create or replace function public.sweep_push_delivery()
returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_tickets int := 0; v_requested int := 0; v_resolved int := 0; v_pruned int := 0;
  v_ids text[]; v_rows bigint[]; v_req bigint;
begin
  -- PHASE 1 -- read /push/send responses into ticket_id, or an immediate error.
  with parsed as (
    select ps.id,
           case when r.status_code = 200 and left(ltrim(r.content), 1) = '{'
                then (r.content::jsonb -> 'data' ->> 'id') end as ticket_id,
           case
             when r.status_code is distinct from 200 then
               coalesce(r.error_msg, 'http ' || coalesce(r.status_code::text, 'error'))
             when left(ltrim(r.content), 1) = '{'
                  and (r.content::jsonb -> 'data' ->> 'status') = 'error' then
               coalesce(r.content::jsonb -> 'data' -> 'details' ->> 'error',
                        r.content::jsonb -> 'data' ->> 'message')
           end as send_error
    from public.push_send ps
    join net._http_response r on r.id = ps.send_request_id
    where ps.ticket_id is null and ps.send_error is null and ps.resolved_at is null
  )
  update public.push_send ps
  set ticket_id = parsed.ticket_id,
      send_error = parsed.send_error,
      -- A send that errored outright never gets a receipt; close it here.
      receipt_status = case when parsed.send_error is not null then 'error' end,
      receipt_error = parsed.send_error,
      resolved_at = case when parsed.send_error is not null then now() end
  from parsed
  where ps.id = parsed.id and (parsed.ticket_id is not null or parsed.send_error is not null);
  get diagnostics v_tickets = row_count;

  -- PHASE 2 -- ask for receipts. Expo caps getReceipts at 1000 ids; 100 keeps
  -- each response small enough to stay comfortably parseable.
  select array_agg(ticket_id), array_agg(id) into v_ids, v_rows
  from (select ticket_id, id from public.push_send
        where ticket_id is not null and receipt_status is null and receipt_request_id is null
        order by id limit 100) batch;

  if v_ids is not null and array_length(v_ids, 1) > 0 then
    v_req := net.http_post(
      url := 'https://exp.host/--/api/v2/push/getReceipts',
      headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
      body := jsonb_build_object('ids', to_jsonb(v_ids))
    );
    update public.push_send set receipt_request_id = v_req where id = any (v_rows);
    v_requested := array_length(v_ids, 1);
  end if;

  -- PHASE 3 -- read receipts back. Keyed BY TICKET ID: Expo returns an object of
  -- ticket_id -> receipt, so there are no positional assumptions here.
  with parsed as (
    select ps.id, (r.content::jsonb -> 'data' -> ps.ticket_id) as rec
    from public.push_send ps
    join net._http_response r on r.id = ps.receipt_request_id
    where ps.receipt_status is null and ps.receipt_request_id is not null
      and r.status_code = 200 and left(ltrim(r.content), 1) = '{'
  )
  update public.push_send ps
  set receipt_status = parsed.rec ->> 'status',
      receipt_error = parsed.rec -> 'details' ->> 'error',
      receipt_message = parsed.rec ->> 'message',
      resolved_at = now()
  from parsed
  where ps.id = parsed.id and parsed.rec is not null and (parsed.rec ->> 'status') is not null;
  get diagnostics v_resolved = row_count;

  -- Stale-token pruning. DeviceNotRegistered is Expo telling us the token is
  -- dead (app deleted, notifications revoked) -- keeping it means pushing into
  -- the void forever. ONLY this error prunes: InvalidCredentials is our problem,
  -- not the device's, and pruning on it would delete every token on the estate
  -- the moment a key expires.
  delete from public.push_tokens pt
  where exists (select 1 from public.push_send ps
                where ps.token = pt.token and ps.receipt_error = 'DeviceNotRegistered'
                  and ps.resolved_at > now() - interval '7 days');
  get diagnostics v_pruned = row_count;

  return jsonb_build_object('tickets_collected', v_tickets, 'receipts_requested', v_requested,
                            'receipts_resolved', v_resolved, 'tokens_pruned', v_pruned);
end $fn$;
revoke execute on function public.sweep_push_delivery() from public, anon, authenticated;

-- Same eligibility logic as 20260722215221; the only change is that each send
-- goes through push_send_to_token so its request id is kept.
create or replace function public.run_push_scheduler()
returns integer
language plpgsql security definer set search_path = ''
as $fn$
declare
  r record; v_sent int := 0; v_token text; v_body text;
begin
  for r in
    select p.id as user_id, p.timezone, np.min_due_to_notify,
           (select count(*) from public.card_fsrs_state s
             where s.user_id = p.id and s.state > 0 and s.due_at <= now()) as due_count,
           array(select pt.token from public.push_tokens pt where pt.user_id = p.id) as tokens
    from public.profiles p
    join public.notification_prefs np on np.user_id = p.id
    left join public.subscriptions sub on sub.user_id = p.id
    cross join lateral (
      select case when sub.status in ('trial', 'active', 'grace')
                  then np.windows else '[{"time":"09:00"}]'::jsonb end as eff_windows,
             case when sub.status in ('trial', 'active', 'grace')
                  then np.days else array[0,1,2,3,4,5,6] end as eff_days
    ) eff
    where np.enabled
      and extract(dow from (now() at time zone p.timezone))::int = any (eff.eff_days)
      and exists (select 1 from public.push_tokens pt where pt.user_id = p.id)
      and not exists (select 1 from public.push_log pl
                      where pl.user_id = p.id and pl.sent_on = (now() at time zone p.timezone)::date)
      and exists (select 1 from jsonb_array_elements(eff.eff_windows) w
                  where abs(extract(epoch from ((now() at time zone p.timezone)::time - (w->>'time')::time))) <= 1800)
  loop
    if r.due_count >= coalesce(r.min_due_to_notify, 1) and array_length(r.tokens, 1) > 0 then
      v_body := r.due_count || ' word' || case when r.due_count = 1 then ' is' else 's are' end || ' ready for review';
      foreach v_token in array r.tokens loop
        perform public.push_send_to_token(r.user_id, v_token, 'Your words are ready', v_body, '/quiz', 'scheduled');
      end loop;
      insert into public.push_log (user_id, sent_on, due_count)
      values (r.user_id, (now() at time zone r.timezone)::date, r.due_count)
      on conflict do nothing;
      v_sent := v_sent + 1;
    end if;
  end loop;
  return v_sent;
end $fn$;
revoke execute on function public.run_push_scheduler() from public, anon, authenticated;

-- security_invoker so RLS applies: a user reading this through PostgREST sees
-- only their own attempts, while the SQL editor (postgres) sees the estate.
create or replace view public.push_delivery_health
with (security_invoker = true) as
select (created_at at time zone 'UTC')::date as day, kind,
       count(*) as attempts,
       count(*) filter (where receipt_status = 'ok') as delivered,
       count(*) filter (where receipt_status = 'error') as failed,
       count(*) filter (where receipt_status is null) as pending,
       array_agg(distinct receipt_error) filter (where receipt_error is not null) as errors
from public.push_send group by 1, 2 order by 1 desc, 2;
comment on view public.push_delivery_health is
  'Push health. delivered > 0 is the only evidence push works; attempts and pending prove nothing.';

select cron.unschedule('lexicamp-push-sweep') where exists (select 1 from cron.job where jobname = 'lexicamp-push-sweep');
select cron.schedule('lexicamp-push-sweep', '*/5 * * * *', $cron$select public.sweep_push_delivery()$cron$);
