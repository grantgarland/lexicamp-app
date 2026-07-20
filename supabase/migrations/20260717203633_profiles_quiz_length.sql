-- UX-17b: mirror the client quiz-length pref server-side so it syncs across
-- devices. Additive; default matches QUIZ_LENGTH_DEFAULT (20 — the ratified
-- recommended rung). Values locked to the 18 §2c ladder. Writes ride the
-- existing own-profile-update RLS policy (same path as display_name).
alter table public.profiles
  add column if not exists quiz_length int not null default 20
  check (quiz_length in (10, 20, 40, 80));;
