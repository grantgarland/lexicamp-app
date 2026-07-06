-- 03-data-model.md → DDL (rev 2026-07-04, incl. Azure Translator cache columns per 16-)
-- Reference data ---------------------------------------------------------------
create table public.languages (
  code text primary key,
  name text not null,
  native_name text not null,
  dir text not null default 'ltr' check (dir in ('ltr','rtl')),
  dictionary_with_en boolean not null default false,
  enrich boolean not null default false
);

-- Users -------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  native_lang text not null references public.languages(code),
  learning_lang text not null references public.languages(code),
  timezone text not null default 'UTC',
  onboarding_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (native_lang <> learning_lang)
);

-- Shared translation cache (GLOBAL — the cost keystone; 16 §3) -------------------
create table public.translations_cache (
  id uuid primary key default gen_random_uuid(),
  source_text text not null,            -- NFC + lowercased (Azure normalizedSource)
  display_source text not null,
  source_lang text not null references public.languages(code),
  target_lang text not null references public.languages(code),
  translation text,                     -- null on gate-rejected rows
  pos_tag text check (pos_tag in ('ADJ','ADV','CONJ','DET','MODAL','NOUN','PREP','PRON','VERB','OTHER')),
  prefix_word text,
  confidence numeric,
  alt_translations jsonb,
  back_translations jsonb,
  examples jsonb,
  entry_kind text check (entry_kind in ('word','phrase','phrase_mt')),
  gate_status text not null check (gate_status in ('allowed','rejected')),
  gate_reason text,
  provider text not null check (provider in ('azure_dictionary','azure_mt','gate')),
  metadata jsonb,
  enriched boolean not null default false,
  created_at timestamptz not null default now(),
  unique (source_text, source_lang, target_lang),
  check (gate_status <> 'allowed' or translation is not null)
);

-- Decks ---------------------------------------------------------------------------
create table public.decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  source_lang text not null references public.languages(code),
  target_lang text not null references public.languages(code),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index decks_user_name_key on public.decks (user_id, lower(trim(name)));

-- Cards -----------------------------------------------------------------------------
create table public.cards (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.decks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  translation_id uuid not null references public.translations_cache(id),
  user_note text,
  custom_front text,
  custom_back text,
  suspended boolean not null default false,
  created_at timestamptz not null default now(),
  unique (deck_id, translation_id)
);
create index cards_user_idx on public.cards (user_id);
create index cards_deck_idx on public.cards (deck_id);

create table public.card_fsrs_state (
  card_id uuid primary key references public.cards(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  stability real not null default 0,
  difficulty real not null default 5,
  due_at timestamptz not null default now(),
  last_review_at timestamptz,
  state smallint not null default 0 check (state between 0 and 3),
  reps integer not null default 0,
  lapses integer not null default 0
);
create index card_fsrs_due_idx on public.card_fsrs_state (user_id, due_at);

create table public.review_logs (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 4),
  reviewed_at timestamptz not null default now(),
  elapsed_days real not null default 0,
  scheduled_days real not null default 0,
  state_before smallint not null check (state_before between 0 and 3)
);
create index review_logs_card_idx on public.review_logs (card_id);
create index review_logs_user_time_idx on public.review_logs (user_id, reviewed_at);

-- Prefs / billing / analytics ---------------------------------------------------------
create table public.notification_prefs (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  frequency text not null default 'daily' check (frequency in ('daily','twice_daily','custom')),
  windows jsonb not null default '[{"time":"19:00"}]',
  min_due_to_notify integer not null default 1,
  quiet_hours jsonb
);

create table public.subscriptions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'free' check (status in ('free','trial','active','expired','grace')),
  plan text check (plan in ('monthly','annual')),
  platform text check (platform in ('ios','android')),
  current_period_end timestamptz,
  revenuecat_id text
);

create table public.study_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event text not null,
  props jsonb,
  occurred_at timestamptz not null default now()
);
create index study_events_user_time_idx on public.study_events (user_id, occurred_at);
create index study_events_event_time_idx on public.study_events (event, occurred_at);

-- updated_at maintenance ---------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger decks_updated_at before update on public.decks
  for each row execute function public.set_updated_at();;
