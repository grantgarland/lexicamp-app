// Auth session — thin wrappers over supabase.auth + a session hook. Email
// confirmation is OFF (00 infra decision, 2026-07-05), so signUp returns a live
// session directly. Social sign-in (Apple) is a follow-up: it needs native OAuth
// config (expo-apple-authentication) — the button stays decorative until then.
// Google sign-in will not be supported (product decision 2026-07-27). Errors
// surface as thrown Error with a message the screen can show inline.
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '@/data/supabase/client';

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
  await supabase.auth.signOut();
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
