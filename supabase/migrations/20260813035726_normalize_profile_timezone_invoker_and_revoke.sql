-- Advisor fix, same shape as 20260706022005 did for set_updated_at: a trigger
-- helper needs no elevated rights and must not be exposed via RPC.
--
-- As shipped in 20260813035618 this was SECURITY DEFINER with the default
-- grants, so the linter flagged it twice — including `anon` reaching it at
-- /rest/v1/rpc/normalize_profile_timezone. Calling it there would fail anyway
-- (a trigger function cannot be invoked directly), but it has no business on
-- the public API surface and nothing in it wants definer rights: it reads
-- pg_catalog.pg_timezone_names, which every role can read, and otherwise only
-- rewrites NEW.
--
-- Revoking EXECUTE does not stop the trigger firing — Postgres checks that
-- privilege when the trigger is CREATED, not on each fire. Verified live after
-- applying: a valid zone is accepted, an unknown one falls back to the previous
-- value, and profiles_normalize_timezone is still attached.
create or replace function public.normalize_profile_timezone()
returns trigger
language plpgsql security invoker set search_path = ''
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
revoke execute on function public.normalize_profile_timezone() from public, anon, authenticated;
