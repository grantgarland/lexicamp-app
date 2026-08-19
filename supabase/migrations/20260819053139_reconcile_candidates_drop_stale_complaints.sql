-- Fix, found on the reconciler's first real run: condition (b) re-flagged a user
-- every hour for seven days after a single `entitlement_mirror_lag`, even once
-- the webhook had long since corrected the row.
--
-- Two costs, the second worse than the first. It burns a RevenueCat API call per
-- user per hour to re-confirm something already settled — and it pins
-- `candidates` above zero forever, so the number stops meaning "something might
-- be wrong" and starts meaning "someone had a hiccup last Tuesday". A health
-- signal that is permanently non-zero is a health signal nobody reads.
--
-- The discriminator needs no new state: a complaint is STALE once the mirror has
-- been written after it. If `last_event_ts` is newer than the lag event, some
-- webhook (or an earlier reconcile) has already refreshed this row and there is
-- nothing left to chase. A NULL `last_event_ts` still qualifies — that is the
-- "no webhook ever arrived" case, which is exactly what (b) is for.
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
  limit p_limit;
$$;

revoke all on function public.reconcile_candidates(int) from public, anon, authenticated;
