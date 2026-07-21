// Password-recovery deep-link parsing (DF-3). Supabase's recovery email links
// hit the project's /auth/v1/verify endpoint, which then redirects to our
// `redirectTo` deep link (lexicampapp://reset-password) with the session tokens
// in the URL FRAGMENT (implicit-flow shape):
//   lexicampapp://reset-password#access_token=…&refresh_token=…&type=recovery
// or, when the link is stale/reused, with error params instead:
//   lexicampapp://reset-password#error=access_denied&error_code=otp_expired&error_description=…
// The client has `detectSessionInUrl: false` (native app), so nothing in
// supabase-js consumes these automatically — useRecoveryLink does, via this
// parser. Pure + unit-tested (recovery.test.ts); no I/O here.

export interface RecoveryTokens {
  accessToken: string;
  refreshToken: string;
}

export type RecoveryParse =
  | { status: 'tokens'; tokens: RecoveryTokens }
  | { status: 'error'; message: string }
  | { status: 'none' };

/** Collect params from BOTH the fragment and the query string — Supabase uses
 *  the fragment, but some mail-client link rewriters demote it to a query. */
function collectParams(url: string): URLSearchParams {
  const merged = new URLSearchParams();
  const hashIdx = url.indexOf('#');
  const fragment = hashIdx >= 0 ? url.slice(hashIdx + 1) : '';
  const queryMatch = (hashIdx >= 0 ? url.slice(0, hashIdx) : url).split('?')[1] ?? '';
  for (const part of [queryMatch, fragment]) {
    for (const [k, v] of new URLSearchParams(part)) merged.set(k, v);
  }
  return merged;
}

/** Parse a deep-link URL for password-recovery content. Returns:
 *  - `tokens` when it carries a recovery session (access + refresh, type=recovery),
 *  - `error` when Supabase redirected with an error (expired/used link),
 *  - `none` for anything else (not a recovery link — ignore it). */
export function parseRecoveryUrl(url: string | null | undefined): RecoveryParse {
  if (!url) return { status: 'none' };
  const params = collectParams(url);

  const errorDescription = params.get('error_description') ?? params.get('error_code') ?? params.get('error');
  if (errorDescription != null) {
    // Only claim recovery errors for our reset path — other flows (future OAuth)
    // must not be swallowed here.
    if (!url.includes('reset-password') && params.get('type') !== 'recovery') return { status: 'none' };
    return { status: 'error', message: errorDescription.replace(/\+/g, ' ') };
  }

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken != null && refreshToken != null && params.get('type') === 'recovery') {
    return { status: 'tokens', tokens: { accessToken, refreshToken } };
  }
  return { status: 'none' };
}
