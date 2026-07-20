# Supabase — lexicamp-prod (`wtscflpwxqwpciwtsdid`)

Schema source of truth: `lexicamp-project/03-data-model.md` (+ `16-…` for the
translation cache/gate).

## Migrations mirror (`migrations/`)

The committed mirror of the remote migration history. **Rule:** any session
that applies a migration through the Supabase connector ends by refreshing the
mirror (`npx supabase migration fetch`) and committing it. Verify sync with
`npx supabase migration list`.

**Mirror status (audited 2026-07-18):** 19 of the 25 live migrations are
mirrored, with version numbers matched to the live history. **Six live
migrations are NOT yet mirrored** (applied 2026-07-06/07 but never fetched):

| Live version | Name | What it does (per 08/session-36) |
|---|---|---|
| `20260706234028` | `study_stats_rpc` | `get_study_stats` (streak + study-stat derivations) |
| `20260706234126` | `free_tier_word_cap` | original 50-word cap in `save_card` (later dropped by the 07-16 rewrites; re-shipped as `restore_free_word_cap`) |
| `20260706234351` | `push_tokens_and_scheduler` | `push_tokens` + `push_log` tables, `run_push_scheduler()` |
| `20260706234602` | `move_pg_net_to_extensions_schema` | advisor fix |
| `20260707134105` | `push_copy_fix` | scheduler push copy |
| `20260707152322` | `dev_scenarios` | dev accounts + `reset_dev_scenario`/`set_dev_plan` RPCs |

To close the gap: `npx supabase migration fetch` (authenticated), then commit.
Until then, later mirrored files reference objects (e.g. `push_tokens`) whose
CREATE lives only in the live DB.

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
`set_dev_plan('free'|'active')`.
