-- Third drift shape, found on 2026-08-19: a TRANSFER revokes the prior owner but
-- never grants the new one.
--
-- `apply_revenuecat_event` resolves the subject from `app_user_id` /
-- `original_app_user_id`, and a TRANSFER payload carries NEITHER — it has
-- `transferred_from` and `transferred_to` arrays instead. So the handler
-- correctly clears the old owner and silently does nothing for the recipient.
-- The event also carries no `product_id` and no `expiration_at_ms`, so even
-- reading `transferred_to` would not tell us WHAT they are entitled to; only
-- RevenueCat can answer that.
--
-- Which makes this the reconciler's job: the TRANSFER says "someone received
-- this", and the hourly run determines what. Observed live — a device signed
-- into a second account moved the receipt, the recipient sat at `free` while
-- RevenueCat considered them entitled, and the only reason it got repaired was
-- that the user happened to tap Restore and fire `entitlement_mirror_lag`.
-- ⚠️ A user who simply signs in and never opens the paywall emits nothing, so
-- for an annual plan they could stay wrongly free until the next renewal — a
-- year away. That is a paying customer locked out of what they bought.
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
  -- (b) a client reported StoreKit-says-paid while our mirror disagreed, the
  --     mirror STILL disagrees, and NOTHING has updated it since the complaint.
  select s.user_id, s.revenuecat_id, s.status, s.current_period_end, 'client_reported_lag'::text
  from public.subscriptions s
  join public.study_events e
    on e.user_id = s.user_id
   and e.event = 'entitlement_mirror_lag'
   and e.occurred_at > now() - interval '7 days'
  where not public.is_paid_state(s.status, s.current_period_end)
    and e.occurred_at > coalesce(s.last_event_ts, '-infinity'::timestamptz)
  union
  -- (c) received a subscription by TRANSFER and is not paid in our mirror.
  --     ⚠️ LEFT JOIN on purpose — the recipient may have no subscriptions row at
  --     all, which is exactly the case that would otherwise never be noticed.
  --     `is_paid_state` returns NULL for a missing row, so the coalesce matters.
  select p.id, s.revenuecat_id, s.status, s.current_period_end, 'transfer_recipient'::text
  from public.revenuecat_events e
  cross join lateral jsonb_array_elements_text(
    coalesce(e.payload->'transferred_to', '[]'::jsonb)) as t(uid)
  join public.profiles p
    on t.uid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   and p.id = t.uid::uuid
  left join public.subscriptions s on s.user_id = p.id
  where e.type = 'TRANSFER'
    and e.event_ts > now() - interval '7 days'
    and not coalesce(public.is_paid_state(s.status, s.current_period_end), false)
    and e.event_ts > coalesce(s.last_event_ts, '-infinity'::timestamptz)
  limit p_limit;
$$;

revoke all on function public.reconcile_candidates(int) from public, anon, authenticated;
