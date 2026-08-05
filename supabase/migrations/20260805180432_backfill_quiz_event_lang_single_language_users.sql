-- Backfill `lang` on historic quiz_completed events — ONLY where it is not a guess.
--
-- language_scoped_study_stats made Sessions and Time invested read 0 for every
-- language, because no existing event carried a lang stamp. For an account whose
-- entire review history sits in ONE target language, every session it ever
-- completed was in that language: there is no other language it could have been.
-- That is a deduction, not an attribution, so it is safe to write.
--
-- Accounts with two or more studied languages are deliberately LEFT ALONE. There
-- is no honest way to split their old sessions after the fact, and inventing one
-- would put fabricated numbers behind a metric whose whole point is that it is
-- measured. Those events stay unstamped and simply do not count toward any
-- language until new, stamped sessions accumulate.
update public.study_events e
set props = e.props || jsonb_build_object('lang', s.only_lang)
from (
  select r.user_id, min(dk.target_lang) as only_lang
  from public.review_logs r
  join public.cards c on c.id = r.card_id
  join public.decks dk on dk.id = c.deck_id
  group by r.user_id
  having count(distinct dk.target_lang) = 1
) s
where e.user_id = s.user_id
  and e.event = 'quiz_completed'
  and not coalesce(e.props ? 'lang', false);;
