-- Corrects 20260819205929, which was applied with a guard calling a helper that
-- does not exist (`public.is_dev_user`). The real check has always been the
-- `profiles.is_dev` flag, as written in 20260707152322. plpgsql does not resolve
-- function calls at CREATE time, so the mistake would have surfaced only when a
-- dev tapped a plan chip.
--
-- Restores the original guard verbatim and keeps the period-end handling that
-- migration was for:
--   * set_dev_plan('active') must set a FUTURE current_period_end, or the
--     20260818124810 backstop denies premium and the "Paid" chip silently stops
--     working on any account that previously expired.
--   * set_dev_plan('free') must CLEAR it, or it leaves status='free' beside a
--     future period end — the incoherent row observed on 2026-08-19, where a
--     scenario sign-in clobbered two applied RENEWALs and made a working
--     Restore look broken (entitlement_mirror_lag fired four times with
--     revenuecatPaid:true, exactly as designed).
--
-- ⚠️ set_dev_plan writes without touching last_event_ts, so it bypasses the
-- webhook's ordering guard by design — that is what a dev override is FOR. It
-- therefore has to leave a COHERENT row behind, because nothing downstream will
-- correct one. (The 3.14 reconciler did in fact repair this instance on its next
-- hourly run, but that is a safety net, not a licence.)
create or replace function public.set_dev_plan(p_status text)
returns void
language plpgsql
security definer
set search_path = ''
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
end $$;

revoke execute on function public.set_dev_plan(text) from public, anon;
grant execute on function public.set_dev_plan(text) to authenticated;
