// Sentry — crash reporting (CI-3, lexicamp-project/08 CI track; free dev tier).
//
// DSN sources (first match wins):
//   1. EXPO_PUBLIC_SENTRY_DSN — the EAS `production` environment / .env.local.
//   2. expo.extra.sentryDsn in app.json — COMMITTED, so it is always present.
//
// ⚠️ WHY SOURCE (2) EXISTS AND MUST NOT BE DELETED (2026-08-13). Builds
// `1.0.0+1` and `1.0.0+6` both reached TestFlight and both uploaded source maps,
// so sentry-cli, SENTRY_AUTH_TOKEN and the org/project slugs were all correct —
// and BOTH releases carry `firstEvent: null` with no release-health sessions at
// all. The SDK never phoned home once. That is the trap this file now defends
// against: **source-map upload is a BUILD-time step and proves nothing about the
// RUNTIME DSN.** The dashboard fills up with releases and looks configured while
// the app reports nothing. A Sentry DSN is a publishable identifier — it ships
// inside every client bundle by design, which is why Sentry documents it as
// public — so there is nothing protected by keeping it out of the repo, and
// keeping it IN the repo means a missing, misnamed or wrongly-scoped EAS
// environment variable can no longer silence crash reporting.
//
// ⚠️ WHY NOT `app.config.js` + `process.env` (raised in review, 2026-08-13, and
// it will be raised again): that pattern does NOT reduce extractability. Expo
// serialises `extra` into the manifest that ships inside the binary, so a DSN
// injected at build time from an env var lands in the same bundle, as the same
// string, readable with the same `strings` command. The only thing it changes is
// whether the value is in the repo (private) — and it changes one other thing
// that matters much more: **if the variable is missing, `extra.sentryDsn` is
// `undefined` and Sentry goes silent with no error.** That is precisely the
// outage described above. The proposal reintroduces the single point of failure
// this fallback exists to remove.
//
// Per-environment DSNs already work and need no config rewrite: source 1 takes
// precedence, so any build that sets `EXPO_PUBLIC_SENTRY_DSN` overrides the
// committed value. The committed DSN is the FLOOR, not the ceiling.
//
// The real risk in a public DSN is unsolicited/abusive event submission eating
// the free-tier quota, and secrecy is not the control for it — the DSN is in the
// binary either way. The controls are the per-key rate limit and spike
// protection in Sentry (project settings → Client Keys), plus rotating the key
// if it is ever abused. Mitigate there, not by hiding a public identifier.
import Constants from 'expo-constants';

const DSN: string | undefined =
  process.env.EXPO_PUBLIC_SENTRY_DSN ?? (Constants.expoConfig?.extra?.sentryDsn as string | undefined);

/** True once init() has actually started Sentry (false in dev / without a DSN). */
export let sentryEnabled = false;

/** Why Sentry is or is not running. Diagnostic only — never user-facing. */
export type SentryStatus = 'uninitialized' | 'disabled-dev' | 'disabled-no-dsn' | 'enabled' | 'failed';
export let sentryStatus: SentryStatus = 'uninitialized';

interface SentryModule {
  init: (options: {
    dsn: string;
    tracesSampleRate: number;
    sendDefaultPii: boolean;
    enableAutoSessionTracking: boolean;
    environment: string;
  }) => void;
}

/**
 * Call once from the app entry, BEFORE any other import — see `sentryInit.ts`
 * for why the import position is load-bearing. No-op in dev or without a DSN.
 */
export function initSentry(): void {
  if (__DEV__) {
    sentryStatus = 'disabled-dev';
    return;
  }
  if (!DSN) {
    sentryStatus = 'disabled-no-dsn';
    return;
  }
  try {
    // Runtime require (not a top-level import) so the module stays cheap to load
    // in dev; typed via a minimal local shape to avoid coupling to Sentry's types.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/react-native') as SentryModule;
    Sentry.init({
      dsn: DSN,
      // Crash + error reporting only — no performance tracing/replay. Keeps us
      // far inside the free tier and collects no session media.
      tracesSampleRate: 0,
      sendDefaultPii: false,
      // Explicit, though it is also the SDK default. This is the ONLY signal that
      // distinguishes "Sentry is working and nothing has crashed" from "Sentry
      // never started": a healthy install sends a session envelope on every cold
      // start, so release health is non-empty even at zero errors. Both shipped
      // releases had zero sessions, which is how the outage above was found.
      // Turning this off would remove the only proof-of-life this app has.
      enableAutoSessionTracking: true,
      // initSentry() returns early on __DEV__, so reaching here means a release
      // build by construction.
      environment: 'production',
    });
    sentryEnabled = true;
    sentryStatus = 'enabled';
  } catch {
    // Crash reporting must never be the thing that crashes startup. A missing or
    // unlinked native module used to throw straight through this call — and
    // because `initSentry()` sat at the very end of index.js, that throw would
    // have taken the entry module with it.
    sentryEnabled = false;
    sentryStatus = 'failed';
  }
}
