-- 20-C — leaderboard server (spec 20 §4.4).
-- get_leaderboard(scope, lang, limit): (user, learning-language) entries
-- ranked by mastered-word count. Mastered = MASTERY_STABILITY threshold,
-- MIRRORS src/domain/derive.ts exactly (reps > 0 AND stability >= 30) —
-- pinned by a jest parity fixture (leaderboardParity.test.ts), same pattern
-- as captureGateParity/username parity. Per 07-17c, archived (suspended)
-- cards STILL COUNT toward mastered (archival only affects the review
-- queue, never earned counts) — no `not c.suspended` filter below.
-- Never exposes email/display_name/ids — only username + lang + count.
-- is_dev accounts are excluded entirely (never rank, never appear as "self").

-- Partial index: lets the aggregate find "mastered" rows via an index scan
-- instead of a full table scan of card_fsrs_state. Threshold hardcoded here
-- AND in the function body — MASTERY_STABILITY = 30 (domain/derive.ts).
create index card_fsrs_state_mastered_idx
  on public.card_fsrs_state (card_id)
  where reps > 0 and stability >= 30;

create or replace function public.get_leaderboard(
  p_scope text,               -- 'global' | 'language'
  p_lang text default null,   -- required when p_scope = 'language'
  p_limit int default 50
)
returns table (
  rank int,
  username text,
  lang_code text,
  mastered int,
  is_self boolean
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'P0001';
  end if;
  if p_scope not in ('global', 'language') then
    raise exception 'invalid scope' using errcode = '22023';
  end if;
  if p_scope = 'language' and (p_lang is null or not exists (select 1 from public.languages where code = p_lang)) then
    raise exception 'invalid language' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    p_limit := 50;
  end if;

  return query
  with agg as (
    select p.id as user_id, p.username, d.target_lang as lang_code,
           count(*) filter (where s.reps > 0 and s.stability >= 30)::int as mastered
    from public.cards c
    join public.decks d on d.id = c.deck_id
    join public.card_fsrs_state s on s.card_id = c.id
    join public.profiles p on p.id = c.user_id
    where not p.is_dev
    group by p.id, p.username, d.target_lang
    having count(*) filter (where s.reps > 0 and s.stability >= 30) > 0
  ),
  scoped as (
    select * from agg
    where p_scope = 'global' or lang_code = p_lang
  ),
  ranked as (
    select
      rank() over (order by mastered desc, username asc)::int as rank,
      user_id, username, lang_code, mastered
    from scoped
  )
  select r.rank, r.username, r.lang_code, r.mastered,
         coalesce(r.user_id = v_uid, false) as is_self
  from ranked r
  where r.rank <= p_limit or r.user_id = v_uid
  order by r.rank asc;
end;
$fn$;

revoke all on function public.get_leaderboard(text, text, int) from public, anon;
grant execute on function public.get_leaderboard(text, text, int) to authenticated;
;
