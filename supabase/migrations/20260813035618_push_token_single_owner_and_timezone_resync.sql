-- One device = one account, and a profile timezone that can be CORRECTED after
-- onboarding (2026-08-12).
--
-- ── Why the ownership tiebreak had to go ────────────────────────────────────
-- 20260805190739 fixed duplicate reminders on a shared phone by resolving a
-- shared token to whichever account registered it MOST RECENTLY. That stopped
-- the duplicates and left a quieter bug behind: "registered most recently" is
-- not "signed in right now". registerForPush() only ran at onboarding and on a
-- Settings → Reminders save, so signing back into another account left the
-- token pointing at the previous one indefinitely.
--
-- Observed 2026-08-12: token …lEeAjgIzI2i] held rows for THREE accounts. Guard 1
-- handed it to grant.persona@gmail.com — registered 08-10 19:08, window 19:00
-- daily, ZERO study events in 14 days — while the account actually in use was
-- the Apple-relay one: window 16:30 Mon–Fri, 101 study events, the last at
-- 08-12 19:55. Settings read 4:30 PM; the phone buzzed at 7:00 PM, carrying a
-- due-count computed from an account the user was not signed into. Worse: on
-- 08-12 the signed-in account WAS eligible at 16:30 and got nothing at all —
-- its token array came back empty, so it produced no send and no push_log row,
-- silently.
--
-- A token identifies a DEVICE, so it belongs to exactly one account. The primary
-- key now says so, which makes Guard 1 unnecessary BY CONSTRUCTION rather than
-- correct by argument. Guard 2 (one scheduled push per token per local day)
-- stays as a cheap backstop against a scheduler re-run inside a window.

-- Collapse existing duplicates to the most recent registration per token. Same
-- (updated_at, user_id) strict total order Guard 1 used, so this picks exactly
-- the row that was winning yesterday — a data change, not a behaviour change.
delete from public.push_tokens pt
where exists (
  select 1 from public.push_tokens other
  where other.token = pt.token
    and (other.updated_at, other.user_id) > (pt.updated_at, pt.user_id)
);

alter table public.push_tokens drop constraint push_tokens_pkey;
alter table public.push_tokens add constraint push_tokens_pkey primary key (token);
create index if not exists push_tokens_user_idx on public.push_tokens (user_id);

-- TRANSITIONAL — drop once no pre-2026-08-12 build is in the wild. Installed
-- builds register with `upsert(..., { onConflict: 'user_id,token' })`, and
-- dropping the composite PK removes the very constraint that clause names, so
-- without this they fail outright ("no unique or exclusion constraint matching
-- the ON CONFLICT specification") and a user on an old build could not opt in
-- at all. Redundant given the token PK; cheap; keeps the same-account
-- re-registration path working. A cross-account takeover still fails on those
-- builds — that is the behaviour being replaced, and it now fails loudly
-- instead of silently pointing the phone at the wrong account.
create unique index if not exists push_tokens_user_token_key on public.push_tokens (user_id, token);

-- Registration must be able to TAKE OVER a token from the account that used to
-- hold it. The own-push-tokens RLS policy blocks that by design (the pre-image
-- row fails `using auth.uid() = user_id`), so ownership transfer is a definer
-- RPC rather than a client upsert. It only ever writes auth.uid() into user_id,
-- so it cannot be used to hand a device to someone else.
create or replace function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql security definer set search_path = ''
as $fn$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_platform not in ('ios', 'android') then
    raise exception 'unsupported platform: %', p_platform using errcode = '22023';
  end if;
  if coalesce(trim(p_token), '') = '' then
    raise exception 'empty push token' using errcode = '22023';
  end if;

  insert into public.push_tokens (user_id, token, platform, updated_at)
  values (v_uid, p_token, p_platform, now())
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        updated_at = now();
end $fn$;
revoke execute on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;

-- ── Timezone: correctable, and never poisonous ──────────────────────────────
-- profiles.timezone was written once by complete_onboarding and never again —
-- updateProfile() accepted only display_name and quiz_length. Every reminder
-- resolves against a zone captured on the user's first day, so onboarding in
-- the wrong zone (or moving) put every reminder off by that offset FOREVER,
-- silently. The client now re-syncs it on session start; this trigger is what
-- makes accepting device-supplied strings safe.
--
-- It NORMALIZES rather than rejects, deliberately. run_push_scheduler() reads
-- p.timezone for every user inside ONE function call, so a single unknown zone
-- name raises invalid_parameter_value and takes down reminders for EVERYBODY —
-- a global outage from one bad row. Rejecting instead would move that failure
-- onto the user: a device reporting a zone newer than this server's tzdata
-- could not finish onboarding at all. Keep the last good value, fall back to
-- UTC, never block, never poison.
create or replace function public.normalize_profile_timezone()
returns trigger
language plpgsql security definer set search_path = ''
as $fn$
begin
  if new.timezone is not null
     and exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.timezone) then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    new.timezone := old.timezone;
  else
    new.timezone := 'UTC';
  end if;
  return new;
end $fn$;

drop trigger if exists profiles_normalize_timezone on public.profiles;
create trigger profiles_normalize_timezone
  before insert or update of timezone on public.profiles
  for each row execute function public.normalize_profile_timezone();

-- ── Scheduler: Guard 1 deleted, Guard 2 kept ────────────────────────────────
create or replace function public.run_push_scheduler()
returns integer
language plpgsql security definer set search_path = ''
as $fn$
declare
  r record; v_sent int := 0; v_token text; v_body text;
begin
  for r in
    select p.id as user_id, p.timezone, np.min_due_to_notify,
           (select count(*) from public.card_fsrs_state s
             where s.user_id = p.id and s.state > 0 and s.due_at <= now()) as due_count,
           -- No ownership tiebreak: push_tokens is keyed by token, so a device
           -- appears under exactly one account — the one that most recently ran
           -- register_push_token, which the client now does on every session
           -- start. This list is this account's devices, full stop.
           array(select pt.token from public.push_tokens pt where pt.user_id = p.id) as tokens
    from public.profiles p
    join public.notification_prefs np on np.user_id = p.id
    left join public.subscriptions sub on sub.user_id = p.id
    cross join lateral (
      select case when sub.status in ('trial', 'active', 'grace')
                  then np.windows else '[{"time":"09:00"}]'::jsonb end as eff_windows,
             case when sub.status in ('trial', 'active', 'grace')
                  then np.days else array[0,1,2,3,4,5,6] end as eff_days
    ) eff
    where np.enabled
      and extract(dow from (now() at time zone p.timezone))::int = any (eff.eff_days)
      and exists (select 1 from public.push_tokens pt where pt.user_id = p.id)
      and not exists (select 1 from public.push_log pl
                      where pl.user_id = p.id and pl.sent_on = (now() at time zone p.timezone)::date)
      and exists (
        select 1
        from jsonb_array_elements(eff.eff_windows) w
        cross join lateral (
          select (w->>'time')::time as start_t,
                 ((w->>'time')::time + interval '30 minutes')::time as end_t,
                 (now() at time zone p.timezone)::time as local_t
        ) b
        where case when b.end_t > b.start_t
                   then b.local_t >= b.start_t and b.local_t < b.end_t
                   else b.local_t >= b.start_t or b.local_t < b.end_t   -- wraps midnight
              end
      )
  loop
    if r.due_count >= coalesce(r.min_due_to_notify, 1) and array_length(r.tokens, 1) > 0 then
      v_body := r.due_count || ' word' || case when r.due_count = 1 then ' is' else 's are' end || ' ready for review';
      foreach v_token in array r.tokens loop
        -- Guard 2 (kept): this device has not already had today's reminder, in
        -- ITS OWN local day. Single ownership makes the two-accounts case
        -- impossible, but this still covers a scheduler re-run inside a window.
        if not exists (
          select 1 from public.push_send ps
          where ps.token = v_token
            and ps.kind = 'scheduled'
            and (ps.created_at at time zone r.timezone)::date = (now() at time zone r.timezone)::date
        ) then
          perform public.push_send_to_token(r.user_id, v_token, 'Your words are ready', v_body, '/quiz', 'scheduled');
        end if;
      end loop;
      insert into public.push_log (user_id, sent_on, due_count)
      values (r.user_id, (now() at time zone r.timezone)::date, r.due_count)
      on conflict do nothing;
      v_sent := v_sent + 1;
    end if;
  end loop;
  return v_sent;
end $fn$;
revoke execute on function public.run_push_scheduler() from public, anon, authenticated;
