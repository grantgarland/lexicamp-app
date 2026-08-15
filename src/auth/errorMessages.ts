// Supabase auth error → audience-appropriate copy (2026-08-01).
//
// WHY: supabase-js surfaces GoTrue's internal English strings, and AuthScreen was
// painting them straight into the UI. Submitting an empty form showed "Anonymous
// sign-ins are disabled" — technically accurate (empty credentials read as an
// anonymous sign-in attempt) and completely baffling to a learner.
//
// Matching is on SUBSTRINGS, lowercased, because GoTrue varies wording and
// punctuation across versions. Order matters: first match wins, so put the
// specific patterns above the general ones. Anything unmatched falls back to the
// generic message rather than leaking server text.
export const AUTH_ERROR_FALLBACK = 'auth.err.generic';

const PATTERNS: readonly (readonly [string, string])[] = [
  // Empty/!valid credentials. "Anonymous sign-ins are disabled" is what an empty
  // email+password pair actually produces — never show it verbatim.
  ['anonymous sign-ins are disabled', 'auth.err.missingFields'],
  ['invalid login credentials', 'auth.err.badCredentials'],
  ['email not confirmed', 'auth.err.emailNotConfirmed'],
  ['user already registered', 'auth.err.emailTaken'],
  ['already been registered', 'auth.err.emailTaken'],
  ['unable to validate email address', 'auth.err.badEmail'],
  ['invalid email', 'auth.err.badEmail'],
  ['password should be at least', 'auth.err.weakPassword'],
  ['password should contain', 'auth.err.weakPassword'],
  ['should be different from the old password', 'auth.err.samePassword'],
  // Rate limits — GoTrue phrases these several ways.
  ['for security purposes', 'auth.err.tooSoon'],
  ['email rate limit exceeded', 'auth.err.rateLimited'],
  ['over_email_send_rate_limit', 'auth.err.rateLimited'],
  ['too many requests', 'auth.err.rateLimited'],
  // Recovery links.
  ['token has expired', 'auth.err.linkExpired'],
  ['otp_expired', 'auth.err.linkExpired'],
  ['invalid or has expired', 'auth.err.linkExpired'],
  // Apple / OIDC.
  ['unacceptable audience', 'auth.err.appleConfig'],
  ['provider is not enabled', 'auth.err.appleConfig'],
  // Transport.
  ['network request failed', 'auth.err.network'],
  ['fetch failed', 'auth.err.network'],
];

/** Map a raw Supabase/GoTrue error message to an i18n key. Never returns the
 *  server string — unrecognized errors get the generic fallback. */
export function authErrorKey(message: string | null | undefined): string {
  if (message == null || message.trim() === '') return AUTH_ERROR_FALLBACK;
  const haystack = message.toLowerCase();
  for (const [needle, key] of PATTERNS) {
    if (haystack.includes(needle)) return key;
  }
  return AUTH_ERROR_FALLBACK;
}

/** GoTrue's minimum password length (Supabase → Auth → Providers → Email).
 *  THREE things quote this number and must move together: the server enforces
 *  it, `auth.err.weakPassword` names it in the refusal, and `auth.passwordHint`
 *  states it up front so the user meets it on the first try. */
export const MIN_PASSWORD_LENGTH = 6;

/** Client-side pre-flight for the set-a-new-password form (DF-3), the sibling of
 *  `localAuthErrorKey`. Same job: name what's wrong precisely instead of
 *  spending a round trip to be told, or — worse — leaving a dead Save button to
 *  explain itself. Order matters: the empty field is the likeliest mistake, and
 *  a mismatch is only worth reporting once the password itself is valid. */
export function localPasswordErrorKey(opts: { password: string; confirm: string }): string | null {
  if (opts.password === '') return 'auth.err.missingPassword';
  if (opts.password.length < MIN_PASSWORD_LENGTH) return 'auth.err.weakPassword';
  if (opts.confirm !== opts.password) return 'auth.passwordMismatch';
  return null;
}

/** Client-side pre-flight so the obvious cases never reach the network (and so
 *  the user gets a precise message instead of a generic server refusal). */
export function localAuthErrorKey(opts: {
  email: string;
  password?: string;
  requirePassword: boolean;
}): string | null {
  const email = opts.email.trim();
  if (email === '') return 'auth.err.missingEmail';
  // Deliberately permissive: real validation is the server's job, this only
  // catches the typo-obvious cases before a round trip.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'auth.err.badEmail';
  if (opts.requirePassword && (opts.password ?? '') === '') return 'auth.err.missingPassword';
  return null;
}
