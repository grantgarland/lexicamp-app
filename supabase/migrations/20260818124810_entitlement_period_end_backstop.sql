-- Entitlement period-end backstop. Follow-up to the 2026-08-17 3.1 incident.
--
-- `subscriptions.status` is only ever corrected by an inbound RevenueCat
-- EXPIRATION event. On 2026-08-17 a broken webhook shared secret ate one: the
-- delivery 401'd, RevenueCat exhausted its five retries, and the account sat on
-- status='active' with current_period_end 16 hours in the past. Premium
-- forever, with no path back, because nothing anywhere compared that date to
-- now(). Seven functions carried the same copy-pasted status test, so a single
-- lost webhook opened seven doors at once.
--
-- The fix is one definition plus a mechanical rewrite of every gate to call it.
-- The gates are edited IN PLACE (pg_get_functiondef → targeted replace →
-- execute) rather than retyped, because hand-reproducing seven SECURITY DEFINER
-- bodies risks a silent regression in code paths that have no test.

create or replace function public.is_paid_state(p_status text, p_period_end timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_status = 'grace'
      or (p_status in ('trial', 'active')
          and (p_period_end is null or p_period_end > now()));
$$;

comment on function public.is_paid_state(text, timestamptz) is
  'The single definition of "this user is paid" (mirrors isPaid() in src/domain/types.ts). '
  'grace is exempt from the period-end check on purpose: BILLING_ISSUE means keep access while '
  'payment retries, and its period end is already past by definition. A NULL period end counts '
  'as paid — set_dev_plan writes status with no date, and a real subscriber missing the field '
  'should not lose access over absent data.';

do $$
declare
  r record;
  newdef text;
  n int := 0;
begin
  for r in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace nsp on nsp.oid = p.pronamespace
    where nsp.nspname = 'public'
      and p.prokind = 'f'
      and p.proname in ('add_card_to_deck', 'add_learning_language', 'create_deck',
                        'run_push_scheduler', 'save_card', 'set_card_target_override',
                        'set_username')
  loop
    newdef := r.def;
    -- ⚠️ Aliased forms FIRST. The bare pattern is a substring of the aliased
    -- ones, so replacing it first would yield `s.public.is_paid_state(...)`.
    newdef := replace(newdef,
      'sub.status in (''trial'', ''active'', ''grace'')',
      'public.is_paid_state(sub.status, sub.current_period_end)');
    newdef := replace(newdef,
      's.status in (''trial'', ''active'', ''grace'')',
      'public.is_paid_state(s.status, s.current_period_end)');
    newdef := replace(newdef,
      'status in (''trial'', ''active'', ''grace'')',
      'public.is_paid_state(status, current_period_end)');

    -- A no-op replace means the gate text drifted; fail loudly rather than
    -- reporting success while leaving the door open.
    if newdef = r.def then
      raise exception 'no entitlement gate replaced in %() — the pattern drifted', r.proname;
    end if;

    execute newdef;
    n := n + 1;
  end loop;

  if n <> 7 then
    raise exception 'expected 7 gated functions, rewrote %', n;
  end if;
end $$;
;
