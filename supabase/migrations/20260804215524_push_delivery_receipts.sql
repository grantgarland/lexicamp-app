-- Push DELIVERY truth (2026-08-04). See supabase/migrations for the full rationale.
create table if not exists public.push_send (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
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
  if exists (select 1 from public.push_send
             where user_id = v_uid and kind = 'test' and created_at > now() - interval '1 minute') then
    raise exception 'a test push was already sent in the last minute' using errcode = '53400';
  end if;
  for v_token in select token from public.push_tokens where user_id = v_uid loop
    perform public.push_send_to_token(v_uid, v_token.token, 'Lexicamp test',
      'Push is working. Nothing is due - this was a test.', '/', 'test');
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('tokens', v_n, 'sent_at', now());
end $fn$;
grant execute on function public.send_test_push() to authenticated;

create or replace function public.sweep_push_delivery()
returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_tickets int := 0; v_requested int := 0; v_resolved int := 0; v_pruned int := 0;
  v_ids text[]; v_rows bigint[]; v_req bigint;
begin
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
      receipt_status = case when parsed.send_error is not null then 'error' end,
      receipt_error = parsed.send_error,
      resolved_at = case when parsed.send_error is not null then now() end
  from parsed
  where ps.id = parsed.id and (parsed.ticket_id is not null or parsed.send_error is not null);
  get diagnostics v_tickets = row_count;

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

  delete from public.push_tokens pt
  where exists (select 1 from public.push_send ps
                where ps.token = pt.token and ps.receipt_error = 'DeviceNotRegistered'
                  and ps.resolved_at > now() - interval '7 days');
  get diagnostics v_pruned = row_count;

  return jsonb_build_object('tickets_collected', v_tickets, 'receipts_requested', v_requested,
                            'receipts_resolved', v_resolved, 'tokens_pruned', v_pruned);
end $fn$;
revoke execute on function public.sweep_push_delivery() from public, anon, authenticated;

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
select cron.schedule('lexicamp-push-sweep', '*/5 * * * *', $cron$select public.sweep_push_delivery()$cron$);;
