-- Fix, found by rehearsing 3.14 before wiring it up: the synthetic audit id was
-- second-granular (`reconcile:<uuid>:YYYYMMDDHH24MISS`), so two reconciliations
-- of the same user within one second collided on the primary key. The
-- `on conflict do nothing` then dropped the SECOND audit row while its
-- subscriptions write still landed — leaving `last_event_id` pointing at a row
-- that describes a different transition. A reconciler whose own log can lie is
-- worse than no log, since it is the only record of a write nobody watched.
create or replace function public.apply_revenuecat_snapshot(p_user_id uuid, p_snapshot jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ent      jsonb := p_snapshot #> '{subscriber,entitlements,premium}';
  v_expires  timestamptz;
  v_product  text;
  v_status   text;
  v_plan     text;
  v_now      timestamptz := now();
  v_before   text;
  v_id       text;
  v_changed  boolean := false;
begin
  select s.status into v_before from public.subscriptions s where s.user_id = p_user_id;

  if v_ent is null then
    v_status := 'free';
  else
    v_expires := nullif(v_ent->>'expires_date', '')::timestamptz;
    v_product := coalesce(v_ent->>'product_identifier', '');
    v_status  := case when v_expires is null or v_expires > v_now then 'active' else 'expired' end;
    v_plan    := case
                   when v_product ilike '%annual%' or v_product ilike '%year%' then 'annual'
                   when v_product ilike '%month%' then 'monthly'
                   else null
                 end;
  end if;

  if v_before is distinct from v_status then
    -- Unique by construction. The `user_id` / `app_user_id` columns already
    -- carry identity, so the id does not need to encode it.
    v_id := 'reconcile:' || extensions.gen_random_uuid()::text;

    insert into public.revenuecat_events (id, type, app_user_id, user_id, environment, event_ts, payload, applied, note)
    values (v_id, 'RECONCILE', p_user_id::text, p_user_id, 'PRODUCTION', v_now, p_snapshot, true,
            'reconciled ' || coalesce(v_before, 'none') || ' -> ' || v_status);

    insert into public.subscriptions as s (user_id, status, plan, current_period_end, last_event_ts, last_event_id)
    values (p_user_id, v_status, v_plan, v_expires, v_now, v_id)
    on conflict (user_id) do update
      set status             = excluded.status,
          plan               = coalesce(excluded.plan, s.plan),
          current_period_end = excluded.current_period_end,
          last_event_ts      = excluded.last_event_ts,
          last_event_id      = excluded.last_event_id
      where s.last_event_ts is null or excluded.last_event_ts >= s.last_event_ts;
    v_changed := found;

    -- If the ordering guard refused the write, say so in the audit row rather
    -- than leaving a RECONCILE entry that implies a change that never happened.
    if not v_changed then
      update public.revenuecat_events e
         set applied = false,
             note = 'reconcile skipped: a newer event already applied'
       where e.id = v_id;
    end if;
  end if;

  return jsonb_build_object(
    'user_id', p_user_id, 'was', v_before, 'now', v_status, 'changed', v_changed);
end
$$;

revoke all on function public.apply_revenuecat_snapshot(uuid, jsonb) from public, anon, authenticated;
