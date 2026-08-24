# Lexicamp

Lexicamp is a vocabulary learning app built with Expo / React Native. It helps users memorize new words faster through optimized spaced repetition — designed for language learners who want to build deep vocabulary retention.

This repo contains the **app source code**. Business docs, architecture decisions, roadmap, and project context live in [lexicamp-project](https://github.com/grantgarland/lexicamp-project).

[![Smoke Test (Maestro + EAS)](https://github.com/grantgarland/lexicamp-app/actions/workflows/nightly-smoke.yml/badge.svg)](https://github.com/grantgarland/lexicamp-app/actions/workflows/nightly-smoke.yml)
[![Release iOS (TestFlight)](https://github.com/grantgarland/lexicamp-app/actions/workflows/release-ios.yml/badge.svg)](https://github.com/grantgarland/lexicamp-app/actions/workflows/release-ios.yml)

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS)
- [Expo CLI](https://docs.expo.dev/get-started/installation/)
- iOS Simulator (Xcode) or Android Emulator, or the Expo Go app on a physical device

### Install

```bash
npm install
```

### Run

```bash
npx expo start
```

Then press `i` for iOS simulator, `a` for Android emulator, or scan the QR code with Expo Go.

---

## Project Structure

All source lives under `src/` (see `CLAUDE.md` for the full architecture map):

```
lexicamp-app/
├── src/
│   ├── app/            # expo-router routes (thin — screens live in src/screens)
│   ├── screens/        # Screen components
│   ├── ui/             # Shared UI kit (composed components, icons, Portal/Sheet)
│   ├── domain/         # Pure domain logic — types, derivations, FSRS, capture gate
│   ├── data/           # DataSource seam: mock (default) + supabase/ + offline outbox
│   ├── query/          # TanStack Query client + hooks (persisted to AsyncStorage)
│   ├── store/          # Zustand stores (prefs, UI, dev knobs, onboarding buffer)
│   ├── auth/           # Supabase auth session
│   ├── i18n/           # i18next + en/es locales (parity is test-enforced)
│   ├── theme/          # Design tokens (GENERATED — never hand-edit) + tiers
│   ├── notifications/  # Push token registration
│   ├── observability/  # Sentry (inert until DSN set)
│   └── constants/      # Language registry, legal links
├── supabase/           # Edge Functions (translate, examples) + migrations mirror
├── .maestro/           # 8 Maestro E2E flows (Mon/Wed/Fri CI) — see below
├── scripts/            # Token/asset sync + CI emulator helper
└── assets/             # Fonts, images, brand assets
```

### Verify (before any handoff)

```bash
npm run typecheck && npm run lint && npm test
```

### End-to-end (Maestro)

Eight flows in `.maestro/` cover the app end to end — `smoke` (boot) ·
`word-capture` · `quiz` (the study loop) · `word-list` · `decks` · `progress` ·
`settings` · `walkthrough` (all nine tour steps). `.maestro/config.yaml` is the
manifest: CI runs `maestro test .maestro/` and executes only the flows listed
there.

**Status: 8/8 green on Android CI as of 2026-08-21** — run
[`32463594990`](https://github.com/grantgarland/lexicamp-app/actions/runs/32463594990),
13m 27s at `5ff5f82`. That was the **first** full-suite pass; the seven non-boot
flows landed 2026-08-06 and had only ever been green on a local iOS simulator.

Run a single flow locally against an emulator or simulator — free, no EAS build:

```bash
maestro test .maestro/quiz.yaml
```

Selector policy: **tap by testID, assert by text**, and Maestro matches WHOLE
text. Three jest guards keep the flows honest without a device —
`maestroStrings.test.ts` (every text selector must be backed by a real `en.json`
key or mock fixture), `maestroScreens.test.tsx` (renders the real screen and
applies Maestro's own matcher to the selector read out of the flow), and
`a11yCollapse.ts` (a self-labelled `Pressable` collapses its subtree, so a text
selector aimed inside it can never match).

⚠️ When a flow goes red, **read that flow's header before suspecting the app**.
Every failure this suite has had was geometry or timing — a row under the FAB, a
field behind the keyboard, a tap stolen by an overlay — not app logic. The
history is in `SMOKE_TEST_DIAGNOSIS.md`.

The nightly (`.github/workflows/nightly-smoke.yml`) runs Mon/Wed/Fri, builds the
APK with the `smoke` EAS profile (mock DataSource, `EXPO_PUBLIC_USE_SUPABASE=0`)
and is change-gated, so an idle week costs zero builds. **Keep flow and profile in
lockstep** — a `preview` build redirects to onboarding on first launch and every
flow fails at its first assertion.

---

## Release — production build for TestFlight

**The release path is a manual GitHub Actions dispatch:** Actions →
**Release iOS (TestFlight)** → **Run workflow**. That is the whole procedure. The
rest of this section explains what the workflow does, what it depends on, and how
to recover when a step fails.

`.github/workflows/release-ios.yml` runs a cheap Linux preflight — `typecheck` ·
`jest --ci` · `verify:bundle` — and only then spends an EAS build slot on:

```bash
eas build --platform ios --profile production --non-interactive --auto-submit --wait
```

There is deliberately **no `push:` trigger**; see the budget note at the end. A red
run files a rolling `release-failure` GitHub issue whose body carries the triage
order — the important distinction being that a *submit* failure is recoverable with
`eas submit --latest` and does not need a rebuild.

Managed workflow: `ios/` and `android/` are gitignored, so EAS runs `prebuild` on its
own servers. Nothing local is uploaded except what git tracks.

### 1. Get the work onto `main` first

**EAS uploads committed files only**, and the workflow builds whatever `main` points
at. Untracked files are silently omitted, which produces either a red build or,
worse, a green build running stale code.

```bash
npm run typecheck && npm run lint && npm test
git status --short          # untracked (??) files will NOT reach the build
git add <files> && git commit -m "..." && git push
npx expo-doctor             # optional but cheap
```

### 2. Verify the production env vars on EAS

The most common silent failure. `EXPO_PUBLIC_*` values are inlined into the bundle at
build time and `.env.local` is never uploaded, so anything missing here ships as
`undefined` — the app installs fine and then can't reach Supabase.

```bash
npx eas-cli env:list --environment production
```

Expected: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`,
`EXPO_PUBLIC_SENTRY_DSN` (all `plaintext`) and `SENTRY_AUTH_TOKEN` (`secret`).
`EXPO_PUBLIC_USE_SUPABASE=1` is set in `eas.json` *and* in the production
environment; the `eas.json` value wins, and either alone is sufficient.

```bash
npx eas-cli env:set --name EXPO_PUBLIC_SUPABASE_URL --value <url> \
  --visibility plaintext --environment production
npx eas-cli env:set --name SENTRY_AUTH_TOKEN --value <token> \
  --visibility secret --environment production
```

Two things that are easy to get wrong here:

- **`eas secret:*` no longer exists.** It was replaced by `eas env:*`, with
  visibility levels `plaintext` / `sensitive` / `secret` in place of the old
  secret/non-secret split. `env:set` both creates and updates.
- **`eas.json`'s production profile must carry `"environment": "production"`** or
  none of these reach the build at all. That field is the join between the profile
  and the environment; without it `env:list` looks perfectly healthy and the build
  still gets `undefined`.

⚠️ Never bulk-push `.env.local` with `env:push`. It also holds server-only keys
(Supabase service role, Azure Translator, Resend, RevenueCat secret) that belong in
Supabase Edge Function secrets — and anything prefixed `EXPO_PUBLIC_` is inlined
into the shipped bundle in plaintext, readable by anyone who unzips the `.ipa`.

⚠️ The `production` profile deliberately does **not** set `SENTRY_DISABLE_AUTO_UPLOAD`
(unlike `preview` / `development` / `smoke`), so a missing `SENTRY_AUTH_TOKEN` fails the
build at the JS bundle step with `Auth token is required`.

### 3. Versioning — leave it alone unless the marketing version changes

`eas.json` sets `cli.appVersionSource: "remote"` and `production.autoIncrement: true`, so
EAS owns the build number and increments it per build. Bump `expo.version` in `app.json`
only for a user-visible release. **Never add `buildNumber` to `app.json`** — it would
fight the remote source, and `appInfo.ts` is written to degrade gracefully without it.

### 4. Dispatch the workflow

Actions → **Release iOS (TestFlight)** → **Run workflow**. Preflight is ~4 min; the
EAS build is ~15–25 min queued + built, and `--auto-submit` hands the `.ipa` to App
Store Connect without a second command.

The equivalent local path, for when you want to watch it or the runner is
unavailable:

```bash
npx eas-cli build --platform ios --profile production --auto-submit
```

### 5. Submit to TestFlight

The workflow does this via `--auto-submit`. Run it by hand only to recover a build
that succeeded and then failed at the submit stage — the `.ipa` still exists on EAS,
so this is much cheaper than rebuilding:

```bash
npx eas-cli submit --platform ios --profile production --latest
```

Targets `submit.production.ios.ascAppId` (`6792857650`) in `eas.json` and
authenticates with the stored App Store Connect API key (Key ID `7Q48NHBNG2`, team
`V39Q75LCX6`). Then App Store Connect → TestFlight: processing takes 5–20 min.
Export compliance should auto-clear — `ITSAppUsesNonExemptEncryption: false` is
already in `app.json`.

Signing credentials live on EAS and must exist before any `--non-interactive` run,
which fails rather than prompting to create them. Current distribution certificate
and provisioning profile both expire **2027-06-19**; check with
`npx eas-cli credentials --platform ios`.

### 6. Install and sanity-check on device

TestFlight app → install → verify in this order, because each failure has a different
cause: About sheet shows the expected version; sign-in works (proves the Supabase env
vars landed); one capture + one quiz round-trips (proves the edge functions and live
schema agree).

### Budget note

The EAS free tier is 15 iOS + 15 Android builds/month, and the Mon/Wed/Fri Maestro
smoke job already spends ~13 of the Android half. 15 iOS builds is ~3.4/week, so
production builds are release events, not an iteration loop — use `preview` /
simulator builds for anything you can.

This is why the workflow has no `push:` trigger. A manual dispatch means a slot is
spent only when someone means to spend it, which is stricter than the tag-triggered
policy it replaced (a stray tag push can't burn a build). If cadence ever justifies
automating it, the honest version is `push: tags: ['v*']` — not push-to-main.

---

## Related

- [lexicamp-project](https://github.com/grantgarland/lexicamp-project) — business plan, technical architecture, data model, roadmap, and all project documentation
