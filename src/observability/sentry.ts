// Sentry — crash reporting (CI-3, lexicamp-project/08 CI track; free dev tier).
// INERT until a DSN is provided: with no DSN, init() is skipped entirely, so this
// ships safely before the Sentry account exists and in dev.
//
// DSN sources (first match wins):
//   1. EXPO_PUBLIC_SENTRY_DSN env var (EAS build env / .env.local — DSNs are
//      publishable identifiers, safe in a client bundle)
//   2. expo.extra.sentryDsn in app.json
//
// Activation checklist (Casey):
//   1. Create the free Sentry account + a react-native project → copy the DSN.
//   2. Put EXPO_PUBLIC_SENTRY_DSN in .env.local (dev) and in EAS build env (prod),
//      or drop it in app.json extra.sentryDsn.
//   3. `npx expo install @sentry/react-native` (native module → prebuild + rebuild).
//   4. Uncomment the `@sentry/react-native/expo` plugin line in app.json (uploads
//      source maps on EAS builds; needs SENTRY_AUTH_TOKEN in EAS secrets).
//   5. Alerts: Sentry → Alerts → "new issue" → email. (CI-6 follow-up: forward to
//      a `crash`-labeled GitHub issue via Sentry's GitHub integration, free tier.)
import Constants from 'expo-constants';

const DSN: string | undefined =
  process.env.EXPO_PUBLIC_SENTRY_DSN ?? (Constants.expoConfig?.extra?.sentryDsn as string | undefined);

/** True once init() has actually started Sentry (false in dev / without a DSN). */
export let sentryEnabled = false;

/** Call once from the app entry, before anything renders. No-op without a DSN. */
export function initSentry(): void {
  if (!DSN || __DEV__) return;
  // Runtime require (not a top-level import) so the module stays cheap to load
  // in dev; typed via a minimal local shape to avoid coupling to Sentry's types.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sentry = require('@sentry/react-native') as {
    init: (options: { dsn: string; tracesSampleRate: number; sendDefaultPii: boolean }) => void;
  };
  Sentry.init({
    dsn: DSN,
    // Crash + error reporting only — no performance tracing/replay. Keeps us
    // far inside the free tier and collects no session media.
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
  sentryEnabled = true;
}
