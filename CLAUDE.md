# lexicamp-app — agent orientation

@AGENTS.md

**Read this first, then `../lexicamp-project/00-project-context.md`** (the
business/project master context — constraints, locked decisions, current phase,
backlog). This file is the CODE map; the project docs are the WHY. Numbered
references like "03" or "16 §2" mean `../lexicamp-project/NN-*.md`.

## What this app is

Lexicamp: translate → save → spaced-repetition quiz, RN/Expo (TypeScript),
iOS+Android. "Anki for normal people." Solo-operated within hard constraints
(≤10 hrs/wk, ≤$100/mo — see 00). Design-first: every screen was prototyped in
`../lexicamp-design-system` HTML before RN; when UI questions arise, the
prototype module files are canonical.

## Architecture (layers, strictly ordered)

```
screens (src/screens, thin routes in src/app)
   ↓ read ONLY through
query hooks (src/query/hooks.ts — TanStack Query, keys include dev scenario)
   ↓
DataSource interface (src/data/DataSource.ts)          ← the swap seam
   ├─ mockDataSource (src/data/mock.ts)                ← DEFAULT: scenario-driven, offline
   └─ supabaseDataSource (src/data/supabase/)          ← EXPO_PUBLIC_USE_SUPABASE=1
        ├─ reads: PostgREST under RLS (mappers.ts = pure row→domain, unit-tested)
        ├─ lookup/examples: Edge Functions (supabase/functions/, deployed live)
        └─ writes: RPCs (save_card, delete_card, complete_onboarding,
           commit_quiz_session, set_card_suspended, add/switch/remove_learning_language)
           + direct PostgREST updates (profiles, notification_prefs, push_tokens, study_events)
   ↓ both sources speak
domain (src/domain — PURE, no I/O, no React; the contracts from 03):
   types.ts (entities) · derive.ts ("derived, not stored" formulas)
   fsrs.ts (ts-fsrs wrapper — the ONLY file importing ts-fsrs)
   capture.ts (Tier-0 gate) · quiz.ts (session view-model) · translation.ts (Azure shapes)
```

Other state: `src/store/*` (zustand: dev knobs, UI, prefs, onboarding buffer),
`src/auth/session.ts` (supabase auth), `src/ui/` (the shared kit — screens
compose it; fix a11y/behavior HERE, it propagates), `src/theme/` (tokens
GENERATED from the design system — never hand-edit tokens.generated.ts).

## Invariants (violating these breaks the product's guarantees)

1. **Capture gate (16 §2):** cards can only reference gate-approved
   `translations_cache` rows — enforced by RLS (cache is service-role-writable
   only) + the `save_card` RPC. `capture.ts` rules are MIRRORED in
   `supabase/functions/translate/index.ts`; change both or neither
   (capture.test.ts is the shared spec, and captureGateParity.test.ts FAILS CI
   if the edge-fn regexes/constants/script map drift from the client's).
2. **FSRS math is client-side** (02): `domain/fsrs.ts` computes, the
   `commit_quiz_session` RPC only validates ownership + persists atomically.
   Fuzz disabled (determinism). Tiers = stability bands (`theme/tiers.ts`
   stMin/stMax); `MASTERY_STABILITY` must equal the summit band's stMin.
3. **Derived, not stored** (03): home stats, tiers, lifecycle all compute in
   `derive.ts` from raw cards+states. Never persist a derivable number.
4. **Cost discipline:** never call Azure from the client; everything goes
   through the cached Edge Functions (negative caching included). Examples
   fetch lazily, once per translation.
5. **i18n en/es parity** is test-enforced; add keys to BOTH locale files.

## Workflows

- **Verify** (all must pass before any handoff): `npm run typecheck`,
  `npm run lint` (also a pre-commit hook), `npm test` (jest-expo; pure suites
  live under `__tests__/` next to their modules).
- **Schema changes:** author in 03 first → apply via the Supabase connector
  (project `wtscflpwxqwpciwtsdid`) → `npx supabase migration fetch` to refresh
  `supabase/migrations/` → commit. RLS on everything; run the security
  advisors after DDL.
- **Edge Functions:** source of truth is `supabase/functions/*/index.ts` in
  this repo; deploy through the connector; live-verify with a throwaway auth
  user (email confirm is OFF), then delete it.
- **CI/ops:** push/PR gate in `.github/workflows/ci.yml`; red main auto-files
  a `ci-failure` issue — those OUTRANK the backlog (07). Renovate dashboard
  gates native deps. Sentry is wired but inert in dev.
- **Session protocol:** work the top unblocked item in 08; finish by updating
  08 (handoff note) + 00/README last-updated lines. Chunks must land clean.

## Sharp edges (learned the hard way)

- `index.js` entry order: theme + i18n side-effect imports MUST precede
  `expo-router/entry` (require.context evaluates `(tabs)` before `_layout`).
- Sheets/dialogs use the in-app Portal (`ui/Portal.tsx`), NOT RN `Modal`
  (dead-screen + stacking bugs). react-hooks purity rules are enforced: no
  setState-in-effect (use render-adjust), no refs/global writes during render.
- Native deps must match Expo SDK 56 pins (`expo/bundledNativeModules.json`);
  adding one requires prebuild + rebuild, and Renovate holds them for approval.
- Metro resolves `require()` statically — no imports of not-installed packages,
  even behind conditionals. The same rule is why `__DEV__` HIDES but never
  EXCLUDES: dev-only modules must be swapped for a stub at resolution time
  (`metro/excludedModules.js`, wired in `metro.config.js`), or they ship to the
  App Store inside dead branches. `npm run verify:bundle` exports a real
  production bundle and greps it; CI runs it on every PR.
- Single-line numeric/display Text: omit lineHeight (RN clips tall glyphs).
