-- Advisor fix: trigger helper needs no elevated rights and must not be exposed via RPC.
create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;
revoke execute on function public.set_updated_at() from public, anon, authenticated;;
