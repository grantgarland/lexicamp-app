// Session-start reconciliation (2026-08-12).
//
// Two facts about a phone go stale the moment the app stops looking at them,
// and the server-side reminder scheduler reads BOTH:
//
//   1. WHICH ACCOUNT owns this device's push token. `push_tokens` is keyed by
//      token — one device, one account — so the phone belongs to whoever
//      registered last. Registration only ever ran at onboarding and on a
//      Settings → Reminders save, so signing into another account left the
//      device registered to the PREVIOUS one indefinitely. Reminders then
//      arrived on that account's schedule with its due-count, while Settings
//      showed the signed-in account's time.
//   2. WHICH TIMEZONE the profile claims. It was written once by
//      complete_onboarding and never again, so onboarding in the wrong zone (or
//      simply moving) skewed every reminder by that offset forever.
//
// Both failures look identical from the user's side — "my reminder arrives at
// the wrong time" — and neither is visible anywhere in the UI, which is why
// they survived so long. Reconciling on every session start is what keeps the
// scheduler's inputs true; nothing here is user-facing.
//
// Lives beside session.ts rather than inside it so the auth wrappers stay free
// of data/query imports, and is wired from index.js next to initOutbox: this is
// app-lifecycle work, not screen work, and must run whether or not any screen
// mounts.
import { AppState } from 'react-native';

import { USE_SUPABASE, dataSource } from '@/data';
import { supabase } from '@/data/supabase/client';
import { syncPushRegistration } from '@/notifications/push';
import { forgetPurchases, identifyPurchases } from '@/purchases/purchases';
import { queryClient } from '@/query/queryClient';

/** The device's current IANA zone, or null when the runtime cannot say. */
function deviceTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

// What the last SUCCESSFUL pass reconciled. Auth emits TOKEN_REFRESHED (and the
// app emits foreground) far more often than either of these actually changes,
// so re-running the same (user, zone) pair is skipped outright — after the
// first pass the steady state costs zero network. A pass that throws leaves
// this unset, so the next foreground retries it.
let lastSync: { userId: string; tz: string | null } | null = null;
let inFlight = false;

async function reconcile(userId: string): Promise<void> {
  const tz = deviceTimezone();
  if (inFlight) return;
  if (lastSync != null && lastSync.userId === userId && lastSync.tz === tz) return;
  inFlight = true;
  try {
    // FIRST, and before anything that can fail: bind RevenueCat's app_user_id to
    // this Supabase user. That id is what the webhook writes
    // `subscriptions.user_id` from, so a purchase made before this runs lands
    // against an anonymous customer that maps to no account. `identifyPurchases`
    // swallows its own errors and no-ops when the SDK is not configured, so it
    // cannot break the reconciliation below.
    await identifyPurchases(userId);

    // Silent by contract: syncPushRegistration returns early unless the OS
    // permission is ALREADY granted, so this can never raise a system prompt
    // the user did not ask for.
    await syncPushRegistration();

    if (tz != null) {
      const profile = await dataSource.getProfile();
      // Only write on a real difference — the common case is "nothing moved".
      if (profile.timezone !== tz) {
        await dataSource.updateProfile({ timezone: tz });
        void queryClient.invalidateQueries({ queryKey: ['profile'] });
      }
    }
    lastSync = { userId, tz };
  } finally {
    inFlight = false;
  }
}

/** Subscribe to auth + foreground and reconcile the scheduler's device inputs. */
export function initSessionSync(): void {
  if (!USE_SUPABASE) return; // mock mode has no session and no server to reconcile with

  // Best-effort throughout: background reconciliation must never surface to the
  // user, block a sign-in, or reject into an unhandled promise.
  const run = (userId: string | null | undefined): void => {
    if (userId == null) return;
    void reconcile(userId).catch(() => {});
  };

  void supabase.auth.getSession().then(({ data }) => run(data.session?.user.id));

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      // signOut() has already dropped this device's row; forget the memo so the
      // NEXT account in gets a full pass instead of being skipped as unchanged.
      lastSync = null;
      // Back to an anonymous RevenueCat id, so the next account signed in on this
      // device does not inherit this one's entitlement. Same hazard the push-token
      // note above describes, one layer over.
      void forgetPurchases();
      return;
    }
    run(session?.user.id);
  });

  // Travel and OS clock changes happen while the app is backgrounded, so a
  // foreground is the only moment we can notice them.
  AppState.addEventListener('change', (state) => {
    if (state !== 'active') return;
    void supabase.auth.getSession().then(({ data }) => run(data.session?.user.id));
  });
}
