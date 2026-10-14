[![Smoke Test (Maestro + EAS)](https://github.com/grantgarland/lexicamp-app/actions/workflows/nightly-smoke.yml/badge.svg)](https://github.com/grantgarland/lexicamp-app/actions/workflows/nightly-smoke.yml)
[![Release iOS (TestFlight)](https://github.com/grantgarland/lexicamp-app/actions/workflows/release-ios.yml/badge.svg)](https://github.com/grantgarland/lexicamp-app/actions/workflows/release-ios.yml)
# Lexicamp

Lexicamp is a vocabulary learning app built with Expo / React Native. It helps users memorize new words faster through optimized spaced repetition — designed for language learners who want to build deep vocabulary retention.

This repo contains the **app source code**. Business docs, architecture decisions, roadmap, and project context live in [lexicamp-project](https://github.com/grantgarland/lexicamp-project).

Live TestFlight test build can be download [here](https://testflight.apple.com/join/fY2DtmqN)

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
**Release iOS (TestFlight)** → **Run workflow** on `main`, choosing a **bump**
(`patch` / `minor` / `major` / `none`). That is the whole procedure. The rest of this
section explains what the workflow does, what it depends on, and how to recover when a
step fails.

`.github/workflows/release-ios.yml` runs a cheap Linux preflight — `typecheck` ·
`jest --ci` · `verify:bundle` · `verify:eas-env`. Then a `version` job applies the
bump to `expo.version`, commits `chore(release): vX.Y.Z` to `main` and tags it
`vX.Y.Z` (see § 3). Only after that does it spend an EAS build slot, building that
exact commit:

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

### 3. Versioning — pick a bump on every dispatch; never edit it by hand

An iOS build carries two numbers, and each has exactly one owner:

| | Info.plist key | Owner | How it moves |
|---|---|---|---|
| **Build number** | `CFBundleVersion` | EAS (`appVersionSource: "remote"`, `autoIncrement`) | +1 on every production build, server-side |
| **Marketing version** | `CFBundleShortVersionString` | `expo.version` in `app.json` | the workflow's **bump** input |

**Once a version is approved, App Store Connect closes its train.** Every later
build has to carry a *higher* marketing version, or the upload is rejected after
the build slot is already spent. Build 17 (2026-10-14) went this way: still
`1.0.0` after `1.0.0` was approved, rejected with ITMS-90186 / ITMS-90062. So:

- **`patch`** (1.0.1 → 1.0.2): fixes. The usual choice.
- **`minor`** (1.0.2 → 1.1.0): new features. **`major`** (→ 2.0.0): a big change.
- **`none`**: rebuild the current version. Valid **only while Apple has not approved
  it yet**, i.e. retrying a build that failed or that you pulled before review.
  Every build still gets a fresh build number from EAS.

The `version` job (`scripts/bump-version.js`, unit-tested) rewrites only the
`expo.version` line, refuses a version whose `v*` tag already exists, and pushes the
commit and tag to `main` atomically. **Pull afterwards**: `main` gains a bot commit on
every bumped release. If `main` moved after you dispatched, the push is rejected and
nothing is built; just re-dispatch.

Don't bump `expo.version` in a PR. The workflow would bump it again and skip a
number. **Never add `buildNumber` to `app.json`**: it would fight the remote source,
and `appInfo.ts` is written to degrade gracefully without it. The version is excluded
from the expo-updates fingerprint (`fingerprint.config.js`), so a bump alone does not
cut older binaries off from OTA updates.

### 4. Dispatch the workflow

Actions → **Release iOS (TestFlight)** → **Run workflow** → branch `main`, then
pick the **bump** (§ 3). Preflight is ~4 min; the EAS build is ~15–25 min queued +
built, and `--auto-submit` hands the `.ipa` to App Store Connect without a second
command. Before submitting for review, create the matching version (e.g. `1.0.2`) on
App Store Connect's App Store tab and attach the build once it finishes processing.

The equivalent local path, for when you want to watch it or the runner is
unavailable. Bump first (unless retrying an unapproved version), because nothing
else will:

```bash
node scripts/bump-version.js patch   # commit + tag + push it, as the workflow would
npx eas-cli build --platform ios --profile production --auto-submit
```

### 5. Submit to TestFlight

The workflow does this via `--auto-submit`. Run it by hand only to recover a build
that succeeded and then failed at the submit stage — the `.ipa` still exists on EAS,
so this is much cheaper than rebuilding. (If the *build* failed instead, the bump is
already on `main`; re-dispatch with `bump: none`.)

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
automating it, the honest version is `push: tags: ['v*']` — not push-to-main. Note
that the workflow now *creates* the `v*` tags itself. They are pushed with
`GITHUB_TOKEN`, which never triggers other workflows, so such a trigger would only
fire on tags a human pushes.

---

## Release — OTA update (JS-only fixes)

`expo-updates` is configured with the `fingerprint` runtime policy, so an
update only reaches binaries whose native code matches. Anything that touches
native modules or native config in `app.json` still needs the store build
above. For a JS/copy/styling fix, merge to `main`, then from a clean checkout:

```bash
npm run update:ota -- --message "What changed, in a few words"
```

That publishes to the `production` channel (`--channel preview` for internal
builds; `--platform ios` to limit it) and then uploads the update's source maps
to Sentry, because `eas update` never does that itself. The script refuses to
publish without `SENTRY_AUTH_TOKEN`. It builds from the EAS `production`
environment only, never from `.env.local`, and always uploads to the
org/project in `app.json`. See the header of `scripts/ota-update.mjs` for why
each guard exists.

Users get an update on their next launch after it finishes downloading, which
can take up to two launches. Sentry symbolicates OTA crashes by debug ID, so
uploaded maps show no release, and that is expected. Each event's
`ota_updates` context names the update ID and channel. Roll back with
`eas update:republish` on the previous update group.

## Related

- [lexicamp-project](https://github.com/grantgarland/lexicamp-project) — business plan, technical architecture, data model, roadmap, and all project documentation
