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

## Related

- [lexicamp-project](https://github.com/grantgarland/lexicamp-project) — business plan, technical architecture, data model, roadmap, and all project documentation
