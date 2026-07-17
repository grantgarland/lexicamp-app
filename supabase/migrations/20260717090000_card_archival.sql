-- Phase E (18 §E3): user-facing archival on the existing cards.suspended flag.
-- Archiving is USER INTENT, not a perf mechanism (§2b): the due queue already
-- excludes suspended cards, queries are index-backed (card_fsrs_due_idx), and
-- nothing is ever auto-removed from FSRS. The RPC exists (vs a direct update
-- under the own-cards policy) to log the analytics event.
create function public.set_card_suspended(p_card_id uuid, p_suspended boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_found uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  update public.cards set suspended = p_suspended
  where id = p_card_id and user_id = v_uid
  returning id into v_found;
  if v_found is null then
    raise exception 'card not found' using errcode = 'P0002';
  end if;
  insert into public.study_events (user_id, event, props)
  values (v_uid, case when p_suspended then 'word_archived' else 'word_unarchived' end,
          jsonb_build_object('card_id', p_card_id));
end $$;

revoke execute on function public.set_card_suspended(uuid, boolean) from public, anon;
grant execute on function public.set_card_suspended(uuid, boolean) to authenticated;
