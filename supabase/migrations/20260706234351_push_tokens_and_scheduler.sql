-- 2.5 (server half) — quiz-delivery push infrastructure. Safe no-op until the
-- app registers Expo push tokens (that half needs expo-notifications, a native
-- module → Casey session). Design per 02 § Push: the server only asks "does
-- this user have ≥N due cards right now and is it their quiz window?"; the
-- scheduling truth stays in card_fsrs_state.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table public.push_tokens (
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);
alter table public.push_tokens enable row level security;
create policy "own push tokens" on public.push_tokens for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Dedupe/window guard: at most one quiz push per user per local day.
create table public.push_log (
  user_id uuid not null references public.profiles(id) on delete cascade,
  sent_on date not null,
  sent_at timestamptz not null default now(),
  due_count int not null,
  primary key (user_id, sent_on)
);
alter table public.push_log enable row level security;
create policy "own push log" on public.push_log for select to authenticated
  using ((select auth.uid()) = user_id);

-- The scheduler: eligible = notifications enabled, ≥min_due due cards, local
-- time within ±30min of a configured window, not already pushed today.
-- Sends via Expo's push API (exp.host — token-addressed, no auth required).
create or replace function public.run_push_scheduler()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_sent int := 0;
  v_body jsonb;
begin
  for r in
    select p.id as user_id, p.timezone, np.min_due_to_notify,
           (select count(*) from public.card_fsrs_state s
             where s.user_id = p.id and s.state > 0 and s.due_at <= now()) as due_count,
           array(select pt.token from public.push_tokens pt where pt.user_id = p.id) as tokens
    from public.profiles p
    join public.notification_prefs np on np.user_id = p.id
    where np.enabled
      and exists (select 1 from public.push_tokens pt where pt.user_id = p.id)
      and not exists (
        select 1 from public.push_log pl
        where pl.user_id = p.id and pl.sent_on = (now() at time zone p.timezone)::date
      )
      and exists (
        select 1 from jsonb_array_elements(np.windows) w
        where abs(extract(epoch from (
          (now() at time zone p.timezone)::time - (w->>'time')::time
        ))) <= 1800
      )
  loop
    if r.due_count >= coalesce(r.min_due_to_notify, 1) and array_length(r.tokens, 1) > 0 then
      v_body := (
        select jsonb_agg(jsonb_build_object(
          'to', t,
          'title', 'Pika has your words ready',
          'body', r.due_count || ' word' || case when r.due_count = 1 then '' else 's' end || ' due for review',
          'data', jsonb_build_object('url', '/quiz')
        )) from unnest(r.tokens) t
      );
      perform net.http_post(
        url := 'https://exp.host/--/api/v2/push/send',
        headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
        body := v_body
      );
      insert into public.push_log (user_id, sent_on, due_count)
      values (r.user_id, (now() at time zone r.timezone)::date, r.due_count)
      on conflict do nothing;
      v_sent := v_sent + 1;
    end if;
  end loop;
  return v_sent;
end $$;

revoke execute on function public.run_push_scheduler() from public, anon, authenticated;

-- Every 15 minutes; each user still gets ≤1 push/day via push_log.
select cron.schedule('lexicamp-push-scheduler', '*/15 * * * *', $$select public.run_push_scheduler()$$);;
