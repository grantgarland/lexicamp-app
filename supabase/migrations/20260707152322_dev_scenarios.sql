-- DevBadge live-mode scenarios (Casey-approved design, 2026-07-06):
-- real seeded accounts (dev-<scenario>@lexicamp.app) that the __DEV__ badge
-- signs into, exercising the full real pipeline. is_dev keeps them OUT of
-- business analytics (filter convention: where not is_dev / email not like
-- 'dev-%@lexicamp.app').
alter table public.profiles add column is_dev boolean not null default false;

-- Self-service plan flip for dev accounts only → test paywall/cap live.
create or replace function public.set_dev_plan(p_status text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and is_dev) then
    raise exception 'dev accounts only' using errcode = '42501';
  end if;
  if p_status not in ('free', 'active') then
    raise exception 'status must be free|active' using errcode = '22023';
  end if;
  insert into public.subscriptions (user_id, status, plan, platform)
  values (v_uid, p_status, case when p_status = 'active' then 'monthly' end,
          case when p_status = 'active' then 'ios' end)
  on conflict (user_id) do update
    set status = excluded.status, plan = excluded.plan, platform = excluded.platform;
end $$;

-- Self-service reset: rebuild THIS dev account's scheduling state + history to
-- its canonical scenario shape (keyed by email). Cards/content stay; FSRS
-- states, review_logs, and quiz events are regenerated deterministically —
-- mirrors the mock's per-tier DISTRIBUTION / TIER_STABILITY / due spread.
create or replace function public.reset_dev_scenario()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_scenario text;
  v_dist int[];
  v_stab real[] := array[1.5, 5, 10, 20, 45];
  r record;
  g int := 0;
  v_tier int;
  v_upper int;
  v_due timestamptz;
  v_reviewed timestamptz;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select u.email into v_email from auth.users u where u.id = v_uid;
  if not exists (select 1 from public.profiles where id = v_uid and is_dev) then
    raise exception 'dev accounts only' using errcode = '42501';
  end if;

  v_scenario := split_part(split_part(v_email, '@', 1), '-', 2);
  v_dist := case v_scenario
    when 'empty' then array[0,0,0,0,0]
    when 'bc' then array[12,0,0,0,0]
    when 'abc' then array[20,18,0,0,0]
    when 'hc' then array[10,20,12,0,0]
    when 'sr' then array[10,20,12,8,0]
    when 'summit' then array[10,20,12,5,13]
    else null end;
  if v_dist is null then
    raise exception 'unknown scenario %', v_scenario using errcode = '22023';
  end if;

  delete from public.review_logs where user_id = v_uid;
  delete from public.study_events where user_id = v_uid;

  -- Walk the user's cards in creation order, assigning tier bands per the
  -- distribution; due dates spread overdue-today / backlog / next-24h / future.
  for r in select id from public.cards where user_id = v_uid order by created_at, id loop
    -- find which tier this ordinal falls into
    v_tier := 1; v_upper := v_dist[1];
    while g >= v_upper and v_tier < 5 loop
      v_tier := v_tier + 1;
      v_upper := v_upper + v_dist[v_tier];
    end loop;
    exit when g >= v_upper; -- more cards than the distribution — leave the rest new

    v_due := case g % 4
      when 0 then now() - interval '2 hours'
      when 1 then now() - interval '3 days'
      when 2 then now() + interval '6 hours'
      else now() + interval '5 days' end;
    v_reviewed := now() - ((g % 14) + 1) * interval '1 day';

    update public.card_fsrs_state set
      stability = v_stab[v_tier], difficulty = 5, due_at = v_due,
      last_review_at = v_reviewed, state = 2, reps = 3, lapses = 0, learning_steps = 0
    where card_id = r.id and user_id = v_uid;

    -- Backdated review history → streak/accuracy stats read plausibly.
    insert into public.review_logs (card_id, user_id, rating, reviewed_at, elapsed_days, scheduled_days, state_before)
    values (r.id, v_uid, case when g % 5 = 4 then 1 else 3 end, v_reviewed, 1, 1, 2);
    g := g + 1;
  end loop;

  if g > 0 then
    insert into public.study_events (user_id, event, props, occurred_at)
    select v_uid, 'quiz_completed', jsonb_build_object('cards', 10), now() - (s * interval '1 day')
    from generate_series(1, least(g / 10 + 1, 5)) s;
  end if;
end $$;

revoke execute on function public.set_dev_plan(text) from public, anon;
revoke execute on function public.reset_dev_scenario() from public, anon;
grant execute on function public.set_dev_plan(text) to authenticated;
grant execute on function public.reset_dev_scenario() to authenticated;;
