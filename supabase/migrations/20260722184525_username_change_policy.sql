-- ============================================================
-- username_change_policy — spec 20 §3.3 v2 (cycle locally / save once)
-- Ratified R5 (2026-07-22): NO free-form usernames. The client cycles
-- candidates locally; set_username only accepts names that DECOMPOSE into
-- official-list words (adjective-noun or adjective-noun-NN), so every
-- acceptable name is app-authored vocabulary — nothing to moderate, no
-- App Store 1.2 UGC surface. Free tier: exactly ONE change, ever
-- (P0004 'username_change_limit'); everyone: 20 saves/day
-- (P0004 'rate_limited'). Word lists move to a TABLE (single source for
-- generator + validator; parity-pinned to src/domain/username.ts).
-- Also expands the vocabulary 62×62 → 145×145 (21,025 plain combos —
-- clean two-word names deep past the 10k-user target; ~2.1M with suffix).
-- ============================================================

-- 1 ▸ the vocabulary (append-only superset of the 20-A arrays) -----
create table public.username_words (
  kind text not null check (kind in ('adj','noun')),
  word text not null check (word ~ '^[a-z]+$' and char_length(word) between 3 and 9),
  primary key (kind, word)
);
alter table public.username_words enable row level security;
-- no policies: definer functions only; clients never read it.

insert into public.username_words (kind, word) values
  ('adj','fluent'), ('adj','polyglot'), ('adj','wandering'), ('adj','steady'), ('adj','bright'), ('adj','curious'),
  ('adj','alpine'), ('adj','brave'), ('adj','quick'), ('adj','mindful'), ('adj','patient'), ('adj','bold'),
  ('adj','clever'), ('adj','eager'), ('adj','gentle'), ('adj','hardy'), ('adj','keen'), ('adj','lively'),
  ('adj','merry'), ('adj','nimble'), ('adj','plucky'), ('adj','quiet'), ('adj','rugged'), ('adj','sunny'),
  ('adj','swift'), ('adj','trusty'), ('adj','valiant'), ('adj','witty'), ('adj','agile'), ('adj','breezy'),
  ('adj','calm'), ('adj','daring'), ('adj','earnest'), ('adj','frosty'), ('adj','golden'), ('adj','happy'),
  ('adj','intrepid'), ('adj','jolly'), ('adj','lofty'), ('adj','mellow'), ('adj','noble'), ('adj','peppy'),
  ('adj','radiant'), ('adj','sturdy'), ('adj','upbeat'), ('adj','vivid'), ('adj','warm'), ('adj','zealous'),
  ('adj','amber'), ('adj','azure'), ('adj','coral'), ('adj','crimson'), ('adj','emerald'), ('adj','indigo'),
  ('adj','ivory'), ('adj','scarlet'), ('adj','silver'), ('adj','teal'), ('adj','violet'), ('adj','misty'),
  ('adj','snowy'), ('adj','starry'), ('adj','windswept'), ('adj','ardent'), ('adj','artful'), ('adj','astute'),
  ('adj','balmy'), ('adj','blithe'), ('adj','bonny'), ('adj','brisk'), ('adj','bubbly'), ('adj','candid'),
  ('adj','capable'), ('adj','cheerful'), ('adj','chipper'), ('adj','cordial'), ('adj','cozy'), ('adj','crafty'),
  ('adj','dapper'), ('adj','deft'), ('adj','devoted'), ('adj','driven'), ('adj','dutiful'), ('adj','faithful'),
  ('adj','fearless'), ('adj','festive'), ('adj','fleet'), ('adj','gallant'), ('adj','genial'), ('adj','gifted'),
  ('adj','glad'), ('adj','gleeful'), ('adj','graceful'), ('adj','gracious'), ('adj','grand'), ('adj','hearty'),
  ('adj','helpful'), ('adj','honest'), ('adj','hopeful'), ('adj','humble'), ('adj','jaunty'), ('adj','jovial'),
  ('adj','joyful'), ('adj','kindly'), ('adj','learned'), ('adj','limber'), ('adj','lucid'), ('adj','lucky'),
  ('adj','loyal'), ('adj','mighty'), ('adj','modest'), ('adj','neat'), ('adj','nifty'), ('adj','peaceful'),
  ('adj','perky'), ('adj','poised'), ('adj','polished'), ('adj','prudent'), ('adj','punctual'), ('adj','quaint'),
  ('adj','ready'), ('adj','refined'), ('adj','robust'), ('adj','rosy'), ('adj','serene'), ('adj','sharp'),
  ('adj','shrewd'), ('adj','sincere'), ('adj','skilled'), ('adj','smart'), ('adj','snug'), ('adj','spirited'),
  ('adj','spry'), ('adj','stalwart'), ('adj','stellar'), ('adj','stout'), ('adj','sunlit'), ('adj','supple'),
  ('adj','tactful'), ('adj','tidy'), ('adj','tranquil'), ('adj','vibrant'), ('adj','wise'), ('adj','zesty'),
  ('adj','onward');
insert into public.username_words (kind, word) values
  ('noun','pika'), ('noun','marmot'), ('noun','ibex'), ('noun','chamois'), ('noun','lynx'), ('noun','falcon'),
  ('noun','raven'), ('noun','otter'), ('noun','badger'), ('noun','ermine'), ('noun','hare'), ('noun','eagle'),
  ('noun','condor'), ('noun','fox'), ('noun','elk'), ('noun','owl'), ('noun','swallow'), ('noun','finch'),
  ('noun','wren'), ('noun','robin'), ('noun','heron'), ('noun','crane'), ('noun','cairn'), ('noun','ridge'),
  ('noun','summit'), ('noun','glacier'), ('noun','crag'), ('noun','tarn'), ('noun','fjord'), ('noun','mesa'),
  ('noun','tundra'), ('noun','peak'), ('noun','trail'), ('noun','compass'), ('noun','lantern'), ('noun','satchel'),
  ('noun','journal'), ('noun','atlas'), ('noun','lexeme'), ('noun','phoneme'), ('noun','glyph'), ('noun','rune'),
  ('noun','scribe'), ('noun','saga'), ('noun','fable'), ('noun','sonnet'), ('noun','proverb'), ('noun','riddle'),
  ('noun','cipher'), ('noun','accent'), ('noun','idiom'), ('noun','dialect'), ('noun','syllable'), ('noun','echo'),
  ('noun','ballad'), ('noun','lyric'), ('noun','verse'), ('noun','parable'), ('noun','koan'), ('noun','haiku'),
  ('noun','anthem'), ('noun','chorus'), ('noun','yodel'), ('noun','alcove'), ('noun','aspen'), ('noun','beacon'),
  ('noun','birch'), ('noun','bluff'), ('noun','boulder'), ('noun','brook'), ('noun','bunting'), ('noun','canyon'),
  ('noun','cascade'), ('noun','cedar'), ('noun','chalet'), ('noun','cliff'), ('noun','cloud'), ('noun','clover'),
  ('noun','comet'), ('noun','cove'), ('noun','creek'), ('noun','crest'), ('noun','cuckoo'), ('noun','dale'),
  ('noun','dawn'), ('noun','delta'), ('noun','dune'), ('noun','ember'), ('noun','fern'), ('noun','firefly'),
  ('noun','ford'), ('noun','forest'), ('noun','gale'), ('noun','geyser'), ('noun','glade'), ('noun','glen'),
  ('noun','gorge'), ('noun','granite'), ('noun','grotto'), ('noun','grove'), ('noun','gull'), ('noun','harbor'),
  ('noun','hawk'), ('noun','hollow'), ('noun','horizon'), ('noun','ibis'), ('noun','inlet'), ('noun','island'),
  ('noun','juniper'), ('noun','kestrel'), ('noun','knoll'), ('noun','lagoon'), ('noun','lake'), ('noun','larch'),
  ('noun','lark'), ('noun','ledge'), ('noun','lichen'), ('noun','linnet'), ('noun','lodge'), ('noun','magpie'),
  ('noun','maple'), ('noun','meadow'), ('noun','moraine'), ('noun','moss'), ('noun','nook'), ('noun','oriole'),
  ('noun','osprey'), ('noun','pebble'), ('noun','pine'), ('noun','plover'), ('noun','prairie'), ('noun','quill'),
  ('noun','rapids'), ('noun','ravine'), ('noun','reef'), ('noun','refuge'), ('noun','river'), ('noun','saddle'),
  ('noun','sequoia'), ('noun','sierra'), ('noun','slope'), ('noun','sparrow'), ('noun','spring'), ('noun','spruce'),
  ('noun','stone');

-- 2 ▸ change counter ------------------------------------------------
alter table public.profiles add column username_changes int not null default 0;

-- 3 ▸ generator now samples the table (trigger-only; grants revoked) -
create or replace function public.generate_username()
returns text
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_adj text;
  v_noun text;
  candidate text;
begin
  for i in 1..8 loop
    select word into v_adj from public.username_words where kind = 'adj' order by random() limit 1;
    select word into v_noun from public.username_words where kind = 'noun' order by random() limit 1;
    candidate := v_adj || '-' || v_noun;
    if not exists (select 1 from public.profiles where username = candidate) then
      return candidate;
    end if;
  end loop;
  for i in 1..8 loop
    select word into v_adj from public.username_words where kind = 'adj' order by random() limit 1;
    select word into v_noun from public.username_words where kind = 'noun' order by random() limit 1;
    candidate := v_adj || '-' || v_noun || '-' || lpad(floor(random() * 100)::int::text, 2, '0');
    if not exists (select 1 from public.profiles where username = candidate) then
      return candidate;
    end if;
  end loop;
  return 'pika-' || substr(md5(gen_random_uuid()::text), 1, 6);
end;
$fn$;

-- 4 ▸ set_username v2 — the ONLY client write path -------------------
create or replace function public.set_username(p_username text)
returns text
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_name text := lower(trim(p_username));
  v_parts text[];
  v_current text;
  v_changes int;
  v_paid boolean;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'P0001';
  end if;

  -- No-free-form guarantee: decompose into official vocabulary.
  v_parts := string_to_array(v_name, '-');
  if array_length(v_parts, 1) not in (2, 3)
     or (array_length(v_parts, 1) = 3 and v_parts[3] !~ '^[0-9]{2}$')
     or not exists (select 1 from public.username_words where kind = 'adj' and word = v_parts[1])
     or not exists (select 1 from public.username_words where kind = 'noun' and word = v_parts[2]) then
    raise exception 'invalid username' using errcode = 'P0004', detail = 'username_invalid';
  end if;

  select username, username_changes into v_current, v_changes
    from public.profiles where id = v_uid;
  if v_current is null then
    raise exception 'no profile' using errcode = 'P0002';
  end if;
  if v_name = v_current then
    return v_name; -- idempotent re-save never burns a change
  end if;

  v_paid := exists (
    select 1 from public.subscriptions
    where user_id = v_uid and status in ('trial', 'active', 'grace')
  );
  if not v_paid and v_changes >= 1 then
    raise exception 'change limit' using errcode = 'P0004', detail = 'username_change_limit';
  end if;

  -- 20 saves/day spam guard (the log doubles as the change audit trail).
  delete from public.username_check_log
    where user_id = v_uid and checked_at < now() - interval '2 days';
  if (select count(*) from public.username_check_log
        where user_id = v_uid and checked_at > now() - interval '1 day') >= 20 then
    raise exception 'rate limited' using errcode = 'P0004', detail = 'rate_limited';
  end if;

  begin
    update public.profiles
      set username = v_name, username_changes = username_changes + 1
      where id = v_uid;
  exception when unique_violation then
    raise exception 'username taken' using errcode = 'P0004', detail = 'username_taken';
  end;
  insert into public.username_check_log (user_id) values (v_uid);
  return v_name;
end;
$fn$;

revoke all on function public.set_username(text) from public, anon;
grant execute on function public.set_username(text) to authenticated;

-- 5 ▸ retire the probe surface (cycling is client-local now) ---------
revoke all on function public.check_username(text) from public, anon, authenticated;
revoke all on function public.generate_username() from public, anon, authenticated;
-- (username_reserved stays for the generator's namespace; set_username v2's
-- decomposition rule supersedes it as a save-path check.);
