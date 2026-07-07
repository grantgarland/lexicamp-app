# Supabase — lexicamp-prod (`wtscflpwxqwpciwtsdid`)

Schema source of truth: `lexicamp-project/03-data-model.md` (+ `16-…` for the
translation cache/gate). Applied to the project as named migrations
(2026-07-04): `create_core_schema`, `enable_rls_policies`, `save_card_rpcs`,
`seed_languages`, `fix_set_updated_at_security`.

Migration files in `migrations/` are the committed mirror of the remote history
(materialized via `npx supabase migration fetch`, 2026-07-05). **Rule:** any
session that applies a migration through the Supabase connector ends by
refreshing the mirror (`npx supabase migration fetch`) and committing it.
Verify sync with `npx supabase migration list`.

Auth decision (2026-07-05): email confirmation is **OFF** (fast TTFV; OAuth
emails pre-verified; see `00` infra decisions).

`functions/translate/` is deployed (v1, verify_jwt ON). It requires an
authenticated user JWT (anon key → 401), enforces the Tier-0/1 capture gate,
caches everything (incl. negative results), and rate-limits uncached lookups
to 60/hr/user via `study_events`. Secrets used: `AZURE_TRANSLATOR_KEY`,
`AZURE_TRANSLATOR_REGION`.

Known nuance: the `lookup_uncached` rate-limit event insert no-ops for users
without a `profiles` row (FK) — real users always have one after onboarding.

**Dev scenario accounts** (DevBadge live-mode): `dev-{empty,bc,abc,hc,sr,summit}
@lexicamp.app`, targets ru/zh-Hans/ar/ko/hi/ru, `profiles.is_dev = true`
(**exclude from all analytics**: `where not is_dev`). Password in `.env.local`
(`EXPO_PUBLIC_DEV_SCENARIO_PASSWORD`) — never in EAS env. Self-service RPCs:
`reset_dev_scenario()` (canonical reshape), `set_dev_plan('free'|'active')`.
