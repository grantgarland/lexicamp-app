-- `set_dev_plan` wrote status/plan/platform but never `current_period_end`,
-- which broke in two directions once 20260818124810 made the period end
-- load-bearing.
--
-- ⚠️ SUPERSEDED IMMEDIATELY by 20260819210015 — this version's guard calls
-- `public.is_dev_user`, which does not exist. plpgsql does not resolve function
-- calls at CREATE time, so it applied cleanly and would only have failed when a
-- dev tapped a plan chip. Kept in history because it was applied; the next
-- migration restores the real `profiles.is_dev` check.
create or replace function public.set_dev_plan(p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_dev_user(v_uid) then
    raise exception 'dev only' using errcode = '42501';
  end if;
  if p_status not in ('free', 'active') then
    raise exception 'status must be free|active' using errcode = '22023';
  end if;

  insert into public.subscriptions (user_id, status, plan, platform, current_period_end, auto_renew)
  values (v_uid,
          p_status,
          case when p_status = 'active' then 'monthly' end,
          case when p_status = 'active' then 'ios' end,
          case when p_status = 'active' then now() + interval '30 days' end,
          case when p_status = 'active' then true end)
  on conflict (user_id) do update
    set status             = excluded.status,
        plan               = excluded.plan,
        platform           = excluded.platform,
        current_period_end = excluded.current_period_end,
        auto_renew         = excluded.auto_renew;
end
$$;
