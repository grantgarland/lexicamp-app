-- 3.15 — record whether the subscription will RENEW or merely remain active
-- until its period ends.
--
-- ⚠️ Why this is needed: `CANCELLATION` deliberately leaves status='active'
-- (cancelling means "will not renew", NOT "access ends now"), and nothing
-- recorded the difference. So the UI could not tell "renews on the 24th" from
-- "ends on the 24th" and had to fall back to the neutral "active until {date}"
-- — see 08, 2026-08-18. The webhook already RECEIVES this signal; it was just
-- dropping it.
--
-- NULLABLE on purpose. NULL means "we do not know" — which is the honest state
-- for every row written before this migration, and for events that carry no
-- opinion about renewal intent. Defaulting existing rows to `true` would make
-- the UI confidently promise renewals it has never had evidence for, which is
-- the exact failure mode this column exists to end.
--
-- ⚠️ Display only. `is_paid_state` does NOT consult it: a user who cancels has
-- paid through the period end and keeps premium until then. Gating access on
-- auto_renew would revoke at the moment of cancelling, which is the same bug
-- the CANCELLATION mapping exists to avoid.

alter table public.subscriptions
  add column if not exists auto_renew boolean;

comment on column public.subscriptions.auto_renew is
  'true = will renew, false = cancelled or ended (access may still be live until '
  'current_period_end), NULL = unknown. Set by apply_revenuecat_event; BILLING_ISSUE '
  'deliberately leaves it unchanged, since a failed charge says nothing about intent.';

-- Patch the mapper IN PLACE, same technique and reasoning as
-- 20260818124810: retyping a SECURITY DEFINER body risks a silent regression,
-- and each replacement below is guarded to raise if it does not match.
do $$
declare
  def text;
  before text;
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'apply_revenuecat_event' and p.prokind = 'f';
  if def is null then raise exception 'apply_revenuecat_event not found'; end if;
  before := def;

  -- 1. declare the variable
  def := replace(def,
    '  v_platform text;',
    '  v_platform text;' || chr(10) || '  v_auto     boolean;');
  if def = before then raise exception 'declare block did not match'; end if;

  -- 2. TRANSFER revokes the prior owner: no opinion on renewal any more.
  before := def;
  def := replace(def,
    'set status = ''free'', plan = null, platform = null, current_period_end = null,',
    'set status = ''free'', plan = null, platform = null, current_period_end = null, auto_renew = null,');
  if def = before then raise exception 'TRANSFER branch did not match'; end if;

  -- 3. derive renewal intent alongside plan/platform.
  --    ⚠️ BILLING_ISSUE falls to NULL deliberately: a failed charge means the
  --    store is still TRYING to renew, so it carries no verdict, and the
  --    coalesce below preserves whatever we last knew.
  before := def;
  def := replace(def,
    '    if v_status is null then',
    '    v_auto := case v_type' || chr(10) ||
    '                when ''INITIAL_PURCHASE''      then true' || chr(10) ||
    '                when ''RENEWAL''               then true' || chr(10) ||
    '                when ''UNCANCELLATION''        then true' || chr(10) ||
    '                when ''PRODUCT_CHANGE''        then true' || chr(10) ||
    '                when ''SUBSCRIPTION_EXTENDED'' then true' || chr(10) ||
    '                when ''CANCELLATION''          then false' || chr(10) ||
    '                when ''EXPIRATION''            then false' || chr(10) ||
    '                when ''SUBSCRIPTION_PAUSED''   then false' || chr(10) ||
    '                else null' || chr(10) ||
    '              end;' || chr(10) || chr(10) ||
    '    if v_status is null then');
  if def = before then raise exception 'status-null branch did not match'; end if;

  -- 4. insert + upsert the new column
  before := def;
  def := replace(def,
    '(user_id, status, plan, platform, current_period_end, revenuecat_id, last_event_ts, last_event_id)',
    '(user_id, status, plan, platform, current_period_end, revenuecat_id, last_event_ts, last_event_id, auto_renew)');
  if def = before then raise exception 'insert column list did not match'; end if;

  before := def;
  def := replace(def,
    'values (v_uid, v_status, v_plan, v_platform, v_exp, v_app_user, v_ts, v_id)',
    'values (v_uid, v_status, v_plan, v_platform, v_exp, v_app_user, v_ts, v_id, v_auto)');
  if def = before then raise exception 'values list did not match'; end if;

  before := def;
  def := replace(def,
    '            revenuecat_id      = coalesce(excluded.revenuecat_id, s.revenuecat_id),',
    '            revenuecat_id      = coalesce(excluded.revenuecat_id, s.revenuecat_id),' || chr(10) ||
    '            auto_renew         = coalesce(excluded.auto_renew, s.auto_renew),');
  if def = before then raise exception 'upsert set-list did not match'; end if;

  execute def;
end $$;
