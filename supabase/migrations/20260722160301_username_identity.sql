-- ============================================================
-- username_identity — spec 20 §3 (20-A)
-- profiles.username: unique pseudonymous public identity,
-- heroku-style generated, user-editable.
-- Errcode contract (matches free_word_cap style):
--   P0004 'username_invalid' | 'username_reserved' |
--         'username_taken'   | 'rate_limited'
-- ============================================================

-- 1 ▸ generator ------------------------------------------------
create or replace function public.generate_username()
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  -- MIRRORED in src/domain/username.ts (parity jest test) — change both or neither.
  adjs text[] := array[
    'fluent','polyglot','wandering','steady','bright','curious','alpine',
    'brave','quick','mindful','patient','bold','clever','eager','gentle',
    'hardy','keen','lively','merry','nimble','plucky','quiet','rugged',
    'sunny','swift','trusty','valiant','witty','agile','breezy','calm',
    'daring','earnest','frosty','golden','happy','intrepid','jolly','lofty',
    'mellow','noble','peppy','radiant','sturdy','upbeat','vivid','warm',
    'zealous','amber','azure','coral','crimson','emerald','indigo','ivory',
    'scarlet','silver','teal','violet','misty','snowy','starry','windswept'
  ];
  nouns text[] := array[
    'pika','marmot','ibex','chamois','lynx','falcon','raven','otter',
    'badger','ermine','hare','eagle','condor','fox','elk','owl',
    'swallow','finch','wren','robin','heron','crane','cairn','ridge',
    'summit','glacier','crag','tarn','fjord','mesa','tundra','peak',
    'trail','compass','lantern','satchel','journal','atlas','lexeme',
    'phoneme','glyph','rune','scribe','saga','fable','sonnet','proverb',
    'riddle','cipher','accent','idiom','dialect','syllable','echo','ballad',
    'lyric','verse','parable','koan','haiku','anthem','chorus','yodel'
  ];
  candidate text;
begin
  -- 5 tries plain adjective-noun
  for i in 1..5 loop
    candidate := adjs[1 + floor(random() * array_length(adjs, 1))::int]
      || '-' || nouns[1 + floor(random() * array_length(nouns, 1))::int];
    if not exists (select 1 from profiles where username = candidate) then
      return candidate;
    end if;
  end loop;
  -- 5 tries with a 2-digit suffix
  for i in 1..5 loop
    candidate := adjs[1 + floor(random() * array_length(adjs, 1))::int]
      || '-' || nouns[1 + floor(random() * array_length(nouns, 1))::int]
      || '-' || lpad(floor(random() * 100)::int::text, 2, '0');
    if not exists (select 1 from profiles where username = candidate) then
      return candidate;
    end if;
  end loop;
  -- bounded last resort (never loops)
  return 'pika-' || substr(md5(gen_random_uuid()::text), 1, 6);
end;
$fn$;

revoke all on function public.generate_username() from public, anon;
grant execute on function public.generate_username() to authenticated;

-- 2 ▸ reserved names -------------------------------------------
create table public.username_reserved (name text primary key);
alter table public.username_reserved enable row level security;
-- no policies: definer functions only; clients never read it.
insert into public.username_reserved (name) values
  ('admin'),('administrator'),('lexicamp'),('pika'),('support'),('help'),
  ('mod'),('moderator'),('official'),('staff'),('root'),('system'),
  ('api'),('null'),('undefined'),('anonymous'),('deleted'),('user');

-- 3 ▸ column + backfill + constraints ---------------------------
alter table public.profiles add column username text;
update public.profiles set username = public.generate_username()
  where username is null;
alter table public.profiles alter column username set not null;
alter table public.profiles add constraint profiles_username_format
  check (username ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
         and char_length(username) between 3 and 24);
create unique index profiles_username_key on public.profiles (username);

-- 4 ▸ auto-generate on any future profile insert ----------------
create or replace function public.set_default_username()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.username is null then
    new.username := public.generate_username();
  end if;
  return new;
end;
$fn$;

create trigger profiles_default_username
  before insert on public.profiles
  for each row execute function public.set_default_username();

-- 5 ▸ availability check (rate-limited, boolean-ish, no leakage) -
create unlogged table public.username_check_log (
  user_id uuid not null,
  checked_at timestamptz not null default now()
);
create index username_check_log_idx
  on public.username_check_log (user_id, checked_at);
alter table public.username_check_log enable row level security;
-- no policies: definer function only.

create or replace function public.check_username(p_username text)
returns text  -- 'available' | 'taken' | 'invalid' | 'reserved'
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_name text := lower(trim(p_username));
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'P0001';
  end if;
  -- 20/min per user; opportunistic pruning keeps the unlogged table tiny
  delete from username_check_log
    where user_id = v_uid and checked_at < now() - interval '10 minutes';
  if (select count(*) from username_check_log
        where user_id = v_uid
          and checked_at > now() - interval '1 minute') >= 20 then
    raise exception 'rate limited' using errcode = 'P0004',
      detail = 'rate_limited';
  end if;
  insert into username_check_log (user_id) values (v_uid);

  if v_name !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or char_length(v_name) not between 3 and 24 then
    return 'invalid';
  end if;
  if exists (select 1 from username_reserved where name = v_name) then
    return 'reserved';
  end if;
  if exists (select 1 from profiles
               where username = v_name and id <> v_uid) then
    return 'taken';
  end if;
  return 'available';
end;
$fn$;

revoke all on function public.check_username(text) from public, anon;
grant execute on function public.check_username(text) to authenticated;

-- 6 ▸ set_username ----------------------------------------------
create or replace function public.set_username(p_username text)
returns text  -- the saved username
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_name text := lower(trim(p_username));
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'P0001';
  end if;
  if v_name !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or char_length(v_name) not between 3 and 24 then
    raise exception 'invalid username' using errcode = 'P0004',
      detail = 'username_invalid';
  end if;
  if exists (select 1 from username_reserved where name = v_name) then
    raise exception 'reserved username' using errcode = 'P0004',
      detail = 'username_reserved';
  end if;
  begin
    update profiles set username = v_name where id = v_uid;
  exception when unique_violation then
    raise exception 'username taken' using errcode = 'P0004',
      detail = 'username_taken';
  end;
  return v_name;
end;
$fn$;

revoke all on function public.set_username(text) from public, anon;
grant execute on function public.set_username(text) to authenticated;;
