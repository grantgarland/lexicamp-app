# Supabase — lexicamp-prod (`wtscflpwxqwpciwtsdid`)

Schema source of truth: `lexicamp-project/03-data-model.md` (+ `16-…` for the
translation cache/gate).

## Migrations mirror (`migrations/`)

The committed mirror of the remote migration history. **Rule:** any session
that applies a migration through the Supabase connector ends by refreshing the
mirror (`npx supabase migration fetch`) and committing it. Verify sync with
`npx supabase migration list`.

**⚠️ UNTRACKED MIGRATION (2026-08-20) — `20260820200000_reset_own_onboarding_drop_dev_gate`.**
The SQL was applied **by hand in the Supabase SQL editor**, which does NOT write a
row into `supabase_migrations.schema_migrations`. So the local file exists and the
change is live, but `npx supabase migration list` will show it as local-only and
`db push` will offer to re-apply it.

**Re-applying is harmless** — the file is `create or replace` plus idempotent
revoke/grant — so this drift is benign, unlike the 2026-08-13 case where a
timestamp mismatch meant `db push` would genuinely re-run a migration. To
reconcile it properly, record it:

```sql
insert into supabase_migrations.schema_migrations (version, name)
values ('20260820200000', 'reset_own_onboarding_drop_dev_gate')
on conflict do nothing;
```

Verified live after applying: the `is_dev` gate is gone, the 28000
unauthenticated check remains, the delete is still scoped to `auth.uid()`, and
`anon` still cannot execute.

**Mirror status (2026-07-28, post-`card_target_overrides`):** all 36
live migrations are mirrored. `card_target_overrides` (2026-07-28, Edit
Translations / Premium) was hand-written from the exact applied SQL — the
device sandbox running that session had no network, so `migration fetch` was
not available; verify with `npx supabase migration list`. It adds the
per-card `card_target_overrides` table (PK = card_id, own-row RLS on all four
verbs, 1–120 char CHECK) plus the `set_card_target_override(uuid, text)` RPC:
premium-gated on SET, ungated on CLEAR (a lapsed subscriber must still be able
to undo their own edit), and additive — it never writes to `cards`,
`card_fsrs_state`, `review_logs` or `translations_cache`. Prior: all 35
live migrations were mirrored as of 2026-07-22. The 07-22 additions (`daily_free_save_allowance`,
`username_identity` + `username_trigger_fn_lockdown`,
`username_change_policy` — the R5 cycle/save redesign: `username_words`
table, list-decomposition validation in `set_username` v2, free lifetime-1 +
20/day caps, probe RPCs revoked — `default_reminder_time_9am` — the
study-reminder default moved 7pm → 9am: `notification_prefs.windows` column
default + `run_push_scheduler()`'s free-tier effective-windows fallback,
kept in lockstep; existing users' stored windows untouched — `leaderboard_server`
+ `leaderboard_rank_ambiguity_fix` — 20-C: `get_leaderboard(scope, lang, limit)`
SECURITY DEFINER RPC, (user, learning-language) entries ranked by mastered-word
count, is_dev excluded, own-row pinned outside top-N; the fix migration renames
internal CTE columns to resolve a PL/pgSQL OUT-parameter name collision the
original definition hit on first call — and `leaderboard_dev_preview` (20-D
follow-up): the is_dev exclusion is now CALLER-AWARE — a dev account previewing
its own board also sees the other seeded dev-scenario accounts (real mastered
counts from dogfood testing, no fake data needed), while every real caller's
view is byte-for-byte unchanged) were hand-written from the exact applied SQL —
verify with `npx supabase migration list`. The vocabulary is parity-pinned to
`src/domain/username.ts` by `username.test.ts` (20 §3.4); the leaderboard's
mastery threshold AND the caller-aware dev clause are parity-pinned to
`src/domain/derive.ts`'s `MASTERY_STABILITY` by `leaderboardParity.test.ts`
(20 §4.4).

*(Prior: fetched 2026-07-21 post-`growing_free_word_cap` — Casey's fetch
closed both the 07-18 six-file gap and the 07-21 pair.)*

*(Resolved 2026-07-22: the stray `20260721191732_language_archival.sql` — an
authored-but-superseded duplicate of `20260721205502`, SQL-identical — was
moved to `_to_delete/`; `npx supabase migration list` is clean.)*

⚠️ Lesson (2026-07-17, cap regression): any `create or replace` of an RPC must
start from the LIVE definition (`pg_get_functiondef`), never the last local
mirror — an unmirrored change is silently reverted otherwise.

## Auth

Email confirmation is **OFF** (2026-07-05 — fast TTFV; OAuth emails
pre-verified; see `00` infra decisions).

## Edge Functions (`functions/`)

- **`translate`** (verify_jwt ON): requires an authenticated user JWT (anon key
  → 401), enforces the Tier-0/1 capture gate (mirror of `src/domain/capture.ts`
  — parity is CI-enforced by `src/test`-side `captureGateParity.test.ts`),
  caches everything (incl. negative results), rate-limits uncached lookups to
  60/hr/user via `study_events`. Secrets: `AZURE_TRANSLATOR_KEY`,
  `AZURE_TRANSLATOR_REGION`.
- **`examples`** (verify_jwt ON): lazy per-translation fetch of Azure
  dictionary examples, cached per-sense on `translations_cache.examples`
  (jsonb map keyed by normalized target term). Validates the requested sense
  against the cached row before spending an Azure call.
- Deploying via the MCP connector: pass `functions/deno.json` in the files
  array AND set `import_map_path` (bare `@supabase/supabase-js` specifier) —
  the CLI resolves it implicitly, the connector does not.

Known nuance: the `lookup_uncached` rate-limit event insert no-ops for users
without a `profiles` row (FK) — real users always have one after onboarding.

## Dev scenario accounts (DevBadge live-mode)

`dev-{empty,bc,abc,hc,sr,summit}@lexicamp.app`, targets ru/zh-Hans/ar/ko/hi/ru,
`profiles.is_dev = true` (**exclude from all analytics**: `where not is_dev`).
Password in `.env.local` (`EXPO_PUBLIC_DEV_SCENARIO_PASSWORD`) — never in EAS
env. Self-service RPCs: `reset_dev_scenario()` (canonical reshape),
`set_dev_plan('free'|'active')`. **Leaderboard exception (2026-07-22,
`leaderboard_dev_preview`):** signed in as one of these 6 accounts, the
Leaders tab shows the OTHER 5 too — `get_leaderboard`'s is_dev filter is
caller-aware, so a dev caller previews a populated board using these
accounts' real dogfood data, while every non-dev user's view is unaffected
(dev accounts stay fully invisible to them).
