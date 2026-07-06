-- 1.4 — RLS everywhere (03 § design notes). Postgres IS the access layer.
alter table public.languages enable row level security;
alter table public.profiles enable row level security;
alter table public.translations_cache enable row level security;
alter table public.decks enable row level security;
alter table public.cards enable row level security;
alter table public.card_fsrs_state enable row level security;
alter table public.review_logs enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.subscriptions enable row level security;
alter table public.study_events enable row level security;

-- Reference data: readable by any authenticated client; writes = service role only.
create policy "languages are readable" on public.languages
  for select to authenticated, anon using (true);

-- Shared cache: readable by signed-in users; WRITABLE ONLY BY SERVICE ROLE
-- (no insert/update/delete policies on purpose — capture gate Tier 2, 16 §2).
create policy "cache is readable" on public.translations_cache
  for select to authenticated using (true);

-- Profiles: owner only (PK = auth.uid()).
create policy "own profile select" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "own profile insert" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "own profile update" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- User-owned tables: full CRUD on own rows.
create policy "own decks" on public.decks for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own cards" on public.cards for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own fsrs state" on public.card_fsrs_state for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Review logs: append-only from the client (no update/delete policies).
create policy "own review logs select" on public.review_logs for select to authenticated using ((select auth.uid()) = user_id);
create policy "own review logs insert" on public.review_logs for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "own notification prefs" on public.notification_prefs for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Subscriptions: read own; writes come from the RevenueCat webhook (service role).
create policy "own subscription select" on public.subscriptions for select to authenticated using ((select auth.uid()) = user_id);

-- Analytics: append-only + read own.
create policy "own events select" on public.study_events for select to authenticated using ((select auth.uid()) = user_id);
create policy "own events insert" on public.study_events for insert to authenticated with check ((select auth.uid()) = user_id);;
