// The native half of Sign in with Apple revocation (`26` B1): obtain a fresh,
// single-use authorization code for the `apple-revoke` Edge Function.
//
// Kept apart from `deleteAccount.ts` so that module stays import-free and
// testable; this one is the only place that touches the native sheet.
import * as AppleAuthentication from 'expo-apple-authentication';

/**
 * Show Apple's sheet and return its authorization code, or null if the user
 * dismissed it. No scopes are requested — the code is the only thing needed,
 * and asking for name/email again would be a strange thing to do mid-deletion.
 * Throws on any other failure (unavailable, network, missing code); the caller
 * reports that and deletes anyway.
 */
export async function requestAppleAuthorizationCode(): Promise<string | null> {
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
  } catch (e) {
    // Same code `auth/session.ts` treats as a cancel on sign-in.
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return null;
    throw e;
  }
  if (credential.authorizationCode == null) throw new Error('Apple did not return an authorization code.');
  return credential.authorizationCode;
}
