// Auth session — thin wrappers over supabase.auth + a session hook. Email
// confirmation is OFF (00 infra decision, 2026-07-05), so signUp returns a live
// session directly. Sign in with Apple is REAL as of 2026-08-01 (native flow,
// see signInWithApple). Google sign-in will not be supported (product decision
// 2026-07-27). Errors surface as thrown Error with a message the screen can
// show inline.
import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { AUTH_STORAGE_KEY, supabase } from '@/data/supabase/client';
import { unregisterForPush } from '@/notifications/push';

export async function signUpWithEmail(email: string, password: string): Promise<void> {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
  // Guard: if email confirmation were ever re-enabled, surface it rather than
  // leaving the user silently unauthenticated.
  if (!data.session) throw new Error('Account created — check your email to confirm before signing in.');
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  // Drop this device's registration BEFORE the session goes away: the delete is
  // RLS-scoped to auth.uid(), so doing it after signOut() silently no-ops.
  //
  // Without this, `push_tokens` kept a row per (account, device) forever — a
  // phone used by two accounts received two identical reminders every morning
  // (observed 2026-08-05, both at 06:00:00.223). Best-effort: `unregisterForPush`
  // swallows its own failures so a network blip can never trap a user in a
  // session they asked to leave, and the scheduler de-duplicates per device
  // anyway, so a surviving row costs a stale row rather than a repeat push.
  // `.catch` as well as the swallow inside unregisterForPush: the guarantee is
  // "sign-out always completes", and it should hold here rather than depend on
  // a callee keeping its own promise.
  await unregisterForPush().catch(() => {});

  const { error } = await supabase.auth.signOut();
  if (error == null) return;

  // RECOVERY PATH — the reason this function is not a one-liner.
  //
  // supabase-js refreshes an expired token before signing out, and if that
  // refresh fails NON-retryably (which it always does once the account is
  // deleted, and can after any long backgrounding) `_signOut` returns the error
  // and RETURNS EARLY — without removing the stored session. Nothing emits
  // SIGNED_OUT, `useSession` keeps its last value, and the tabs guard never
  // redirects: the user is left sitting in an app backed by an account that no
  // longer exists (reported 2026-08-05, account deletion on the simulator).
  //
  // So: drop the persisted session ourselves, then sign out AGAIN. With storage
  // empty the second call takes the session-missing path, which does emit
  // SIGNED_OUT — and that event is what actually moves the UI. Clearing storage
  // alone would fix the next launch and leave THIS screen stranded.
  // try/catch rather than `.catch()`: a throw HERE would propagate to the caller,
  // which swallows it — stranding the user in exactly the state this recovers.
  try {
    await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    /* keep going — the retry below is still worth attempting */
  }
  try {
    await supabase.auth.signOut();
  } catch {
    /* nothing left to try */
  }
}

/** Where recovery emails deep-link back into the app (DF-3). MUST be listed in
 *  Supabase Auth → URL Configuration → Redirect URLs, or the verify endpoint
 *  falls back to the Site URL and the app never sees the tokens. */
export const RESET_REDIRECT_URL = 'lexicampapp://reset-password';

export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: RESET_REDIRECT_URL });
  if (error) throw new Error(error.message);
}

/** Set a new password for the CURRENT session — during recovery that's the
 *  short-lived session minted by the emailed link (see useRecoveryLink). */
export async function updatePassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(error.message);
}

// ── Sign in with Apple ────────────────────────────────────────────────────────
// NATIVE flow only (Apple's Authentication Services via expo-apple-authentication):
// the OS returns a signed identity token, which Supabase verifies directly. This
// needs NO Services ID, signing key, or 6-month secret rotation — those belong to
// the web OAuth flow. Server-side requirement is just: Auth → Providers → Apple
// enabled, with the bundle id `com.lexicamp.app` listed under Client IDs.

/** The user dismissed Apple's sheet. Not an error — callers stay put silently. */
export class AppleSignInCancelled extends Error {
  constructor() {
    super('Apple sign-in cancelled');
    this.name = 'AppleSignInCancelled';
  }
}

/** Is native Sign in with Apple usable here? (iOS 13+ device; false on Android.) */
export async function isAppleSignInAvailable(): Promise<boolean> {
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/** Run the native Apple flow and exchange the identity token for a Supabase
 *  session. Returns the display name Apple supplied, which it only ever sends on
 *  the FIRST sign-in for a given Apple ID — so we also persist it to user
 *  metadata immediately; later sign-ins return null and read it back from there.
 *  Throws AppleSignInCancelled when the user dismisses the sheet. */
export async function signInWithApple(): Promise<{ displayName: string | null }> {
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') throw new AppleSignInCancelled();
    throw e;
  }

  if (credential.identityToken == null) throw new Error('Apple did not return an identity token.');

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });
  if (error) throw new Error(error.message);

  const displayName =
    [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ').trim() || null;
  if (displayName != null) {
    // Best-effort: a failure here must not sink an otherwise-good sign-in.
    await supabase.auth.updateUser({ data: { full_name: displayName } }).catch(() => {});
  }
  return { displayName };
}

/** Current session (null = signed out). Subscribes to auth state changes. */
export function useSession(): { session: Session | null; isLoading: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setLoading] = useState(true);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  return { session, isLoading };
}
