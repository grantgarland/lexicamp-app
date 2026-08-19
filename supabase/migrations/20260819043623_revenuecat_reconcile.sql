-- 3.14 — repair mirrors that drifted, because the period-end backstop only
-- STOPS the damage.
--
-- 20260818124810 made a lapsed `current_period_end` read as unpaid, which closes
-- the "premium forever" leak. It does not FIX the row: a mirror that missed an
-- event stays wrong until another event happens to arrive, and EXPIRATION is
-- precisely the event that never comes twice. Observed 2026-08-17: one 401'd
-- delivery, five retries exhausted, state permanently wrong.
--
-- Two drift shapes, opposite directions, both real:
--   (a) mirror says PAID but the period ended  -> lost EXPIRATION. Costs nothing
--       now (the backstop denies access) but the row still lies, and any future
--       event that only touches `status` would resurrect premium.
--   (b) mirror says FREE while the customer paid -> lost INITIAL_PURCHASE. This
--       one costs a paying customer their product, and `entitlement_mirror_lag`
--       is the breadcrumb that identifies exactly who.

create or replace function public.reconcile_candidates(p_limit int default 100)
returns table (user_id uuid, revenuecat_id text, status text, current_period_end timestamptz, reason text)
language sql
stable
security definer
set search_path = ''
as $$
  -- (a) claims paid, period already over
  select s.user_id, s.revenuecat_id, s.status, s.current_period_end, 'lapsed_but_active'::text
  from public.subscriptions s
  where s.status in ('trial', 'active', 'grace')
    and s.current_period_end is not null
    and s.current_period_end < now()
  union
  -- (b) a client reported StoreKit-says-paid while our mirror disagreed, and the
  --     mirror STILL disagrees. Scoped to 7 days so this stays a small query.
  select s.user_id, s.revenuecat_id, s.status, s.current_period_end, 'client_reported_lag'::text
  from public.subscriptions s
  join public.study_events e
    on e.user_id = s.user_id
   and e.event = 'entitlement_mirror_lag'
   and e.occurred_at > now() - interval '7 days'
  where not public.is_paid_state(s.status, s.current_period_end)
  limit p_limit;
$$;

revoke all on function public.reconcile_candidates(int) from public, anon, authenticated;

comment on function public.reconcile_candidates(int) is
  '3.14: subscription rows whose mirror looks wrong, for the reconciler to check '
  'against RevenueCat. Service-role only.';

-- Apply a RevenueCat REST subscriber snapshot to the mirror.
--
-- ⚠️ Writes ONLY when the derived state actually differs, and records an audit
-- row in revenuecat_events with a synthetic `reconcile:` id. Reconciliation that
-- silently overwrites is how you lose the ability to explain a row months later
-- — the same reasoning that made the webhook log unresolvable events instead of
-- dropping them.
--
-- ⚠️ SUPERSEDED by 20260819043725, which makes the audit id unique: this version
-- collided when the same user reconciled twice within one second.
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
    v_changed := true;
    v_id := 'reconcile:' || p_user_id::text || ':' || to_char(v_now, 'YYYYMMDDHH24MISS');

    insert into public.revenuecat_events (id, type, app_user_id, user_id, environment, event_ts, payload, applied, note)
    values (v_id, 'RECONCILE', p_user_id::text, p_user_id, 'PRODUCTION', v_now, p_snapshot, true,
            'reconciled ' || coalesce(v_before, 'none') || ' -> ' || v_status)
    on conflict (id) do nothing;

    insert into public.subscriptions as s (user_id, status, plan, current_period_end, last_event_ts, last_event_id)
    values (p_user_id, v_status, v_plan, v_expires, v_now, v_id)
    on conflict (user_id) do update
      set status             = excluded.status,
          plan               = coalesce(excluded.plan, s.plan),
          current_period_end = excluded.current_period_end,
          last_event_ts      = excluded.last_event_ts,
          last_event_id      = excluded.last_event_id
      -- Same ordering guard as the webhook: never regress state written by an
      -- event NEWER than the snapshot we fetched.
      where s.last_event_ts is null or excluded.last_event_ts >= s.last_event_ts;
    v_changed := found;
  end if;

  return jsonb_build_object(
    'user_id', p_user_id, 'was', v_before, 'now', v_status, 'changed', v_changed);
end
$$;

revoke all on function public.apply_revenuecat_snapshot(uuid, jsonb) from public, anon, authenticated;

comment on function public.apply_revenuecat_snapshot(uuid, jsonb) is
  '3.14: apply a RevenueCat REST subscriber snapshot to the mirror. Writes only on '
  'a real change, logs a RECONCILE audit row, and keeps the webhook ordering guard. '
  'Service-role only — it can mint subscriptions.';
