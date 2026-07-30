# Lexicamp

Lexicamp is a vocabulary learning app built with Expo / React Native. It helps users memorize new words faster through optimized spaced repetition — designed for language learners who want to build deep vocabulary retention.

This repo contains the **app source code**. Business docs, architecture decisions, roadmap, and project context live in [lexicamp-project](https://github.com/grantgarland/lexicamp-project).

[![Smoke Test (Maestro + EAS)](https://github.com/grantgarland/lexicamp-app/actions/workflows/nightly-smoke.yml/badge.svg)](https://github.com/grantgarland/lexicamp-app/actions/workflows/nightly-smoke.yml)

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
├── .maestro/           # Smoke-test flows (nightly CI)
├── scripts/            # Token/asset sync + CI emulator helper
└── assets/             # Fonts, images, brand assets
```

### Verify (before any handoff)

```bash
npm run typecheck && npm run lint && npm test
```

---

## Release — production build for TestFlight

Managed workflow: `ios/` and `android/` are gitignored, so EAS runs `prebuild` on its
own servers. Nothing local is uploaded except what git tracks.

### 1. Clean the tree first

**EAS uploads committed files only.** Untracked files are silently omitted, which
produces either a red build or, worse, a green build running stale code.

```bash
npm run typecheck && npm run lint && npm test
git status --short          # untracked (??) files will NOT reach the build
git add <files> && git commit -m "..."
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
`EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`.
(`EXPO_PUBLIC_USE_SUPABASE=1` comes from `eas.json`, not from env.)

```bash
npx eas-cli env:create --name EXPO_PUBLIC_SUPABASE_URL --value <url> \
  --visibility plaintext --environment production
npx eas-cli env:create --name SENTRY_AUTH_TOKEN --value <token> \
  --visibility sensitive --environment production
```

⚠️ The `production` profile deliberately does **not** set `SENTRY_DISABLE_AUTO_UPLOAD`
(unlike `preview` / `development` / `smoke`), so a missing `SENTRY_AUTH_TOKEN` fails the
build at the JS bundle step with `Auth token is required`.

### 3. Versioning — leave it alone unless the marketing version changes

`eas.json` sets `cli.appVersionSource: "remote"` and `production.autoIncrement: true`, so
EAS owns the build number and increments it per build. Bump `expo.version` in `app.json`
only for a user-visible release. **Never add `buildNumber` to `app.json`** — it would
fight the remote source, and `appInfo.ts` is written to degrade gracefully without it.

### 4. Build

```bash
npx eas-cli build --platform ios --profile production
```

~15–25 min queued + built. Add `--auto-submit` to chain step 5 automatically.

### 5. Submit to TestFlight

```bash
npx eas-cli submit --platform ios --profile production --latest
```

Uses the stored App Store Connect API key (Key ID `3GNP9R5GZH`). Then App Store Connect
→ TestFlight: processing takes 5–20 min. Export compliance should auto-clear —
`ITSAppUsesNonExemptEncryption: false` is already in `app.json`.

### 6. Install and sanity-check on device

TestFlight app → install → verify in this order, because each failure has a different
cause: About sheet shows the expected version; sign-in works (proves the Supabase env
vars landed); one capture + one quiz round-trips (proves the edge functions and live
schema agree).

### Budget note

The EAS free tier is ~15 builds/month and the nightly Maestro smoke job draws from the
same pool. Production builds are tag-worthy events, not an iteration loop — use
`preview`/simulator builds for anything you can.

---

## Related

- [lexicamp-project](https://github.com/grantgarland/lexicamp-project) — business plan, technical architecture, data model, roadmap, and all project documentation
