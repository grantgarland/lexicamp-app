-- Edit Translations (Premium, 2026-07-28). Per-CARD user override of the rendered
-- target-language text. Deliberately a SEPARATE table rather than a column on
-- translations_cache (that table is GLOBAL shared content, service-role-writable
-- only under the capture gate — 16 §2) and rather than reusing cards.custom_back
-- (which is semantically owned by the A12c sense selection: mappers.cardSenseKey
-- matches it against alt_translations to resolve per-sense examples, so a
-- free-form edit there would silently break example resolution).
--
-- Keyed on card_id (not user_id+translation_id) so two cards saved from two
-- senses of the SAME headword stay independently editable. user_id is carried
-- for RLS + index locality and is enforced to match the card's owner.

create table public.card_target_overrides (
  card_id     uuid primary key references public.cards(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  target_text text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint card_target_overrides_text_len
    check (char_length(btrim(target_text)) between 1 and 120)
);

create index card_target_overrides_user_idx on public.card_target_overrides (user_id);

alter table public.card_target_overrides enable row level security;

create policy card_target_overrides_select_own on public.card_target_overrides
  for select using (user_id = auth.uid());
create policy card_target_overrides_insert_own on public.card_target_overrides
  for insert with check (user_id = auth.uid());
create policy card_target_overrides_update_own on public.card_target_overrides
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy card_target_overrides_delete_own on public.card_target_overrides
  for delete using (user_id = auth.uid());

-- set_card_target_override(card, text|null)
--   text  → upsert the override (premium-gated, trimmed, ownership-checked)
--   null  → CLEAR the override (never premium-gated: a demotion must not strip
--           the ability to undo an edit — same covenant as D12 language restore)
-- Never touches cards / card_fsrs_state / review_logs: the edit is additive and
-- reversible, which is exactly what the sheet's info tooltip promises.
create function public.set_card_target_override(p_card_id uuid, p_target text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_text text := nullif(btrim(coalesce(p_target, '')), '');
  v_entitled boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.cards c where c.id = p_card_id and c.user_id = v_uid) then
    raise exception 'card not found' using errcode = 'P0002';
  end if;

  if v_text is null then
    delete from public.card_target_overrides where card_id = p_card_id and user_id = v_uid;
    insert into public.study_events (user_id, event, props)
    values (v_uid, 'translation_edit_cleared', jsonb_build_object('card_id', p_card_id));
    return;
  end if;

  select exists (
    select 1 from public.subscriptions s
    where s.user_id = v_uid and s.status in ('trial', 'active', 'grace')
  ) into v_entitled;
  if not v_entitled then
    raise exception 'premium_required' using errcode = 'P0010';
  end if;

  if char_length(v_text) > 120 then
    raise exception 'override_too_long' using errcode = 'P0012';
  end if;

  insert into public.card_target_overrides (card_id, user_id, target_text)
  values (p_card_id, v_uid, v_text)
  on conflict (card_id) do update
    set target_text = excluded.target_text, updated_at = now();

  insert into public.study_events (user_id, event, props)
  values (v_uid, 'translation_edited', jsonb_build_object('card_id', p_card_id));
end $$;

revoke execute on function public.set_card_target_override(uuid, text) from public, anon;
grant execute on function public.set_card_target_override(uuid, text) to authenticated;
