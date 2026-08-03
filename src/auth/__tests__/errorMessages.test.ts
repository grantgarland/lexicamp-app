// authErrorKey — the guard that stops GoTrue's internal English reaching users.
import en from '@/i18n/locales/en.json';

import { AUTH_ERROR_FALLBACK, authErrorKey, localAuthErrorKey } from '../errorMessages';

const KEYS = Object.keys(en.auth.err).map((k) => `auth.err.${k}`);

describe('authErrorKey', () => {
  it.each([
    ['Anonymous sign-ins are disabled', 'auth.err.missingFields'],
    ['Invalid login credentials', 'auth.err.badCredentials'],
    ['User already registered', 'auth.err.emailTaken'],
    ['Password should be at least 6 characters.', 'auth.err.weakPassword'],
    ['For security purposes, you can only request this after 51 seconds.', 'auth.err.tooSoon'],
    ['Email link is invalid or has expired', 'auth.err.linkExpired'],
    ['Unacceptable audience in id_token', 'auth.err.appleConfig'],
    ['Network request failed', 'auth.err.network'],
  ])('maps %j', (raw, key) => {
    expect(authErrorKey(raw)).toBe(key);
  });

  it('is case-insensitive (GoTrue casing varies by version)', () => {
    expect(authErrorKey('INVALID LOGIN CREDENTIALS')).toBe('auth.err.badCredentials');
  });

  it('falls back rather than leaking an unrecognized server string', () => {
    expect(authErrorKey('pq: duplicate key value violates unique constraint')).toBe(AUTH_ERROR_FALLBACK);
    expect(authErrorKey(null)).toBe(AUTH_ERROR_FALLBACK);
    expect(authErrorKey('   ')).toBe(AUTH_ERROR_FALLBACK);
  });

  it('only ever returns keys that exist in en.json', () => {
    const samples = [
      'Anonymous sign-ins are disabled', 'Invalid login credentials', 'User already registered',
      'Unable to validate email address: invalid format', 'Password should be at least 6 characters.',
      'New password should be different from the old password.', 'Email rate limit exceeded',
      'otp_expired', 'provider is not enabled', 'fetch failed', 'anything unmatched',
    ];
    for (const s of samples) expect(KEYS).toContain(authErrorKey(s));
  });
});

describe('localAuthErrorKey', () => {
  it('catches an empty form before it reaches the network', () => {
    expect(localAuthErrorKey({ email: '', password: '', requirePassword: true })).toBe('auth.err.missingEmail');
  });

  it('catches a malformed email', () => {
    expect(localAuthErrorKey({ email: 'casey@', password: 'x', requirePassword: true })).toBe('auth.err.badEmail');
  });

  it('catches a missing password only when one is required', () => {
    expect(localAuthErrorKey({ email: 'a@b.co', password: '', requirePassword: true })).toBe('auth.err.missingPassword');
    expect(localAuthErrorKey({ email: 'a@b.co', requirePassword: false })).toBeNull();
  });

  it('passes a well-formed pair through', () => {
    expect(localAuthErrorKey({ email: ' a@b.co ', password: 'hunter2', requirePassword: true })).toBeNull();
  });
});
