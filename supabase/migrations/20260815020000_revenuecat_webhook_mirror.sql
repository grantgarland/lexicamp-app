-- 3.1 Stage B — the server-side subscription mirror.
--
-- RevenueCat guarantees AT-LEAST-ONCE delivery, retries a failed endpoint five
-- times with growing delay, and makes no ordering promise. So the two hazards are
-- duplicates and regressions: a retried RENEWAL arriving after a CANCELLATION
-- would otherwise silently un-cancel a lapsed subscriber. Both are handled here
-- rather than in the Edge Function, so the whole apply is one transaction.
--
-- ⚠️ CANCELLATION DOES NOT MEAN EXPIRED. It means "will not renew"; the customer
-- keeps access until `expiration_at_ms`. RevenueCat sends a separate EXPIRATION
-- when access actually ends. Treating CANCELLATION as expiry is the single most
-- commonly botched mapping in this integration and would revoke premium from
-- people who are still paid up.
--
-- Note: subscriptions already CHECK-constrains status/plan/platform to exactly the
-- domain unions in src/domain/types.ts, so this migration adds no constraints —
-- it only adds the ordering/idempotency columns and the event log.

-- ── 1. The event log. This IS the idempotency key. ──────────────────────────
create table if not exists public.revenuecat_events (
  -- RevenueCat's own event id. PRIMARY KEY, so a duplicate delivery is a no-op
  -- insert rather than a second apply.
  id            text primary key,
  type          text        not null,
  app_user_id   text,
  -- Resolved from app_user_id when it maps to a real profile. Nullable on
  -- purpose: an unresolvable event must still be RECORDED, because "events are
  -- arriving but matching nobody" is a diagnosis, and dropping them hides it.
  user_id       uuid        references public.profiles(id) on delete set null,
  environment   text,
  event_ts      timestamptz not null,
  payload       jsonb       not null,
  received_at   timestamptz not null default now(),
  -- Did this event actually change the mirror, and if not, why. Turns a silent
  -- no-op into something answerable months later.
  applied       boolean     not null default false,
  note          text
);

create index if not exists revenuecat_events_user_ts_idx
  on public.revenuecat_events (user_id, event_ts desc);
create index if not exists revenuecat_events_type_ts_idx
  on public.revenuecat_events (type, event_ts desc);

-- Service-role only. RLS on with NO policies = every PostgREST role is denied,
-- which is what we want: this table is written by the webhook and read by us.
alter table public.revenuecat_events enable row level security;

-- ── 2. Ordering + idempotency columns on the mirror ─────────────────────────
alter table public.subscriptions
  add column if not exists updated_at    timestamptz not null default now(),
  add column if not exists last_event_ts timestamptz,
  add column if not exists last_event_id text;

drop trigger if exists subscriptions_updated_at on public.subscriptions;
create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ── 3. Apply one event, atomically ─────────────────────────────────────────
create or replace function public.apply_revenuecat_event(p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id       text        := p_event->>'id';
  v_type     text        := upper(coalesce(p_event->>'type', ''));
  v_app_user text        := coalesce(p_event->>'app_user_id', p_event->>'original_app_user_id');
  v_env      text        := nullif(upper(coalesce(p_event->>'environment', '')), '');
  v_ts       timestamptz := to_timestamp(coalesce(nullif(p_event->>'event_timestamp_ms', '')::bigint, 0) / 1000.0);
  v_exp      timestamptz := case
                              when nullif(p_event->>'expiration_at_ms', '') is null then null
                              else to_timestamp((p_event->>'expiration_at_ms')::bigint / 1000.0)
                            end;
  v_product  text        := coalesce(p_event->>'product_id', '');
  v_store    text        := upper(coalesce(p_event->>'store', ''));
  v_period   text        := upper(coalesce(p_event->>'period_type', ''));
  v_uid      uuid;
  v_status   text;
  v_plan     text;
  v_platform text;
  v_applied  boolean := false;
  v_note     text;
  v_moved    int := 0;
begin
  if v_id is null or v_id = '' then
    raise exception 'event id required' using errcode = '22023';
  end if;

  -- Idempotency. A retry inserts nothing and returns without touching the mirror.
  insert into public.revenuecat_events (id, type, app_user_id, environment, event_ts, payload)
  values (v_id, v_type, v_app_user, v_env, v_ts, p_event)
  on conflict (id) do nothing;
  if not found then
    return jsonb_build_object('result', 'duplicate', 'event_id', v_id);
  end if;

  -- app_user_id IS the Supabase user id, because the client calls
  -- Purchases.logIn(supabaseUserId) (src/auth/sessionSync.ts). Anything else is an
  -- anonymous customer that predates sign-in, and maps to no account.
  if v_app_user ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_uid := v_app_user::uuid;
    if not exists (select 1 from public.profiles p where p.id = v_uid) then
      v_uid := null;
    end if;
  end if;

  -- TRANSFER moves a purchase between accounts. Revoke from the losing side here;
  -- the winning side is set by the events that follow it.
  if v_type = 'TRANSFER' then
    update public.subscriptions s
       set status = 'free', plan = null, platform = null, current_period_end = null,
           last_event_ts = v_ts, last_event_id = v_id
     where s.user_id in (
             select t::uuid
               from jsonb_array_elements_text(coalesce(p_event->'transferred_from', '[]'::jsonb)) as t
              where t ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
       and (s.last_event_ts is null or v_ts >= s.last_event_ts);
    get diagnostics v_moved = row_count;
    v_applied := v_moved > 0;
    v_note := 'transfer: revoked ' || v_moved || ' prior owner(s)';

  else
    v_status := case v_type
      when 'INITIAL_PURCHASE'      then case when v_period in ('TRIAL', 'INTRO') then 'trial' else 'active' end
      when 'RENEWAL'               then 'active'
      when 'UNCANCELLATION'        then case when v_period in ('TRIAL', 'INTRO') then 'trial' else 'active' end
      when 'PRODUCT_CHANGE'        then 'active'
      when 'SUBSCRIPTION_EXTENDED' then 'active'
      -- ⚠️ See the header. Still entitled until the period actually ends.
      when 'CANCELLATION'          then case
                                          when v_exp is null or v_exp > now()
                                            then case when v_period in ('TRIAL', 'INTRO') then 'trial' else 'active' end
                                          else 'expired'
                                        end
      when 'EXPIRATION'            then 'expired'
      when 'BILLING_ISSUE'         then 'grace'
      when 'SUBSCRIPTION_PAUSED'   then 'expired'
      else null
    end;

    -- Matched on the product id rather than a hardcoded list, so renaming a
    -- product inside the naming convention does not silently null the plan.
    v_plan := case
                when v_product ilike '%annual%' or v_product ilike '%year%' then 'annual'
                when v_product ilike '%month%' then 'monthly'
                else null
              end;
    v_platform := case
                    when v_store in ('APP_STORE', 'MAC_APP_STORE') then 'ios'
                    when v_store = 'PLAY_STORE' then 'android'
                    else null
                  end;

    if v_status is null then
      -- TEST, NON_RENEWING_PURCHASE, INVOICE_ISSUANCE, anything RevenueCat adds
      -- later. Recorded and acknowledged: returning non-200 would make RevenueCat
      -- retry an event we will never handle.
      v_note := 'unhandled event type';
    elsif v_uid is null then
      v_note := 'app_user_id does not resolve to a profile';
    else
      insert into public.subscriptions as s
             (user_id, status, plan, platform, current_period_end, revenuecat_id, last_event_ts, last_event_id)
      values (v_uid, v_status, v_plan, v_platform, v_exp, v_app_user, v_ts, v_id)
      on conflict (user_id) do update
        set status             = excluded.status,
            -- Absent fields must not blank existing ones: an EXPIRATION carries no
            -- product_id, and nulling the plan would lose which plan lapsed.
            plan               = coalesce(excluded.plan, s.plan),
            platform           = coalesce(excluded.platform, s.platform),
            current_period_end = coalesce(excluded.current_period_end, s.current_period_end),
            revenuecat_id      = coalesce(excluded.revenuecat_id, s.revenuecat_id),
            last_event_ts      = excluded.last_event_ts,
            last_event_id      = excluded.last_event_id
        -- THE REGRESSION GUARD. An out-of-order or replayed event that is older
        -- than what we already applied changes nothing.
        where s.last_event_ts is null or excluded.last_event_ts >= s.last_event_ts;
      v_applied := found;
      if not v_applied then
        v_note := 'stale event: older than the last one applied';
      end if;
    end if;
  end if;

  update public.revenuecat_events e
     set user_id = v_uid, applied = v_applied, note = v_note
   where e.id = v_id;

  return jsonb_build_object(
    'result', case when v_applied then 'applied' else 'ignored' end,
    'event_id', v_id, 'type', v_type, 'user_id', v_uid,
    'status', v_status, 'note', v_note);
end
$function$;

-- ⚠️ SECURITY DEFINER + PostgREST means "callable by anyone signed in" unless
-- revoked. This one must be reachable ONLY by the service role the Edge Function
-- uses; a signed-in user who could call it could grant themselves premium, which
-- is exactly the escalation shape found in 21 §P0-1.
revoke all on function public.apply_revenuecat_event(jsonb) from public, anon, authenticated;

notify pgrst, 'reload schema';
