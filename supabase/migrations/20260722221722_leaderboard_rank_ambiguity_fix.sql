-- Fix for 20260722221525_leaderboard_server: `returns table (rank int,
-- username text, lang_code text, mastered int, is_self boolean)` creates
-- PL/pgSQL variables with those exact names, which collided with the CTE's
-- own `lang_code`/`username`/`mastered` columns (42702 "ambiguous column
-- reference") the moment the function was actually called. CTE output
-- columns renamed to uname/lcode/mcount/agg_user_id/rnk so nothing shares a
-- name with an OUT parameter — RETURN QUERY binds the final SELECT to the
-- RETURNS TABLE columns by POSITION, not name, so this is purely a rename
-- of internal working columns; the public RPC surface is unchanged.
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

  -- Note: CTE output columns are deliberately named uname/lcode/mcount/rnk
  -- (NOT rank/username/lang_code/mastered) to avoid PL/pgSQL ambiguity with
  -- this function's OUT parameters of the same names -- RETURN QUERY binds
  -- the final SELECT to the RETURNS TABLE columns by POSITION, not name.
  return query
  with agg as (
    select p.id as agg_user_id, p.username as uname, d.target_lang as lcode,
           count(*) filter (where s.reps > 0 and s.stability >= 30)::int as mcount
    from public.cards c
    join public.decks d on d.id = c.deck_id
    join public.card_fsrs_state s on s.card_id = c.id
    join public.profiles p on p.id = c.user_id
    where not p.is_dev
    group by p.id, p.username, d.target_lang
    having count(*) filter (where s.reps > 0 and s.stability >= 30) > 0
  ),
  scoped as (
    select agg.* from agg
    where p_scope = 'global' or agg.lcode = p_lang
  ),
  ranked as (
    select
      rank() over (order by scoped.mcount desc, scoped.uname asc)::int as rnk,
      scoped.agg_user_id, scoped.uname, scoped.lcode, scoped.mcount
    from scoped
  )
  select ranked.rnk, ranked.uname, ranked.lcode, ranked.mcount,
         coalesce(ranked.agg_user_id = v_uid, false)
  from ranked
  where ranked.rnk <= p_limit or ranked.agg_user_id = v_uid
  order by ranked.rnk asc;
end;
$fn$;

revoke all on function public.get_leaderboard(text, text, int) from public, anon;
grant execute on function public.get_leaderboard(text, text, int) to authenticated;
