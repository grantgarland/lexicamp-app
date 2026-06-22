# Lexicamp

Lexicamp is a vocabulary learning app built with Expo / React Native. It helps users memorize new words faster through optimized spaced repetition — designed for language learners who want to build deep vocabulary retention.

This repo contains the **app source code**. Business docs, architecture decisions, roadmap, and project context live in [lexicamp-project](https://github.com/grantgarland/lexicamp-project).

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

```
lexicamp-app/
├── app/          # Expo Router screens
├── components/   # Shared UI components
├── hooks/        # Custom React hooks
├── lib/          # API clients, utilities
├── assets/       # Fonts, images
└── constants/    # Theme, config
```

---

## Related

- [lexicamp-project](https://github.com/grantgarland/lexicamp-project) — business plan, technical architecture, data model, roadmap, and all project documentation
