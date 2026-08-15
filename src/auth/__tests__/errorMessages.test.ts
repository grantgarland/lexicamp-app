// authErrorKey — the guard that stops GoTrue's internal English reaching users.
import en from '@/i18n/locales/en.json';

import {
  AUTH_ERROR_FALLBACK,
  authErrorKey,
  localAuthErrorKey,
  localPasswordErrorKey,
  MIN_PASSWORD_LENGTH,
} from '../errorMessages';

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

describe('localPasswordErrorKey', () => {
  const long = 'x'.repeat(MIN_PASSWORD_LENGTH);
  const short = 'x'.repeat(MIN_PASSWORD_LENGTH - 1);

  it('catches an empty field before the dead-button era returns', () => {
    expect(localPasswordErrorKey({ password: '', confirm: '' })).toBe('auth.err.missingPassword');
  });

  it('catches a too-short password locally — the same refusal GoTrue would send', () => {
    expect(localPasswordErrorKey({ password: short, confirm: short })).toBe('auth.err.weakPassword');
  });

  it('reports the mismatch only once the password itself is valid', () => {
    expect(localPasswordErrorKey({ password: long, confirm: `${long}!` })).toBe('auth.passwordMismatch');
    // A short password that also mismatches reports the SHORT one: fixing the
    // length is the step that has to happen either way.
    expect(localPasswordErrorKey({ password: short, confirm: 'different' })).toBe('auth.err.weakPassword');
  });

  it('passes a valid, matching pair through', () => {
    expect(localPasswordErrorKey({ password: long, confirm: long })).toBeNull();
  });

  it('never invents a key that is missing from en.json', () => {
    const KEY_PATHS = [...KEYS, 'auth.passwordMismatch'];
    const cases = [
      { password: '', confirm: '' },
      { password: short, confirm: short },
      { password: long, confirm: 'nope' },
    ];
    for (const c of cases) expect(KEY_PATHS).toContain(localPasswordErrorKey(c));
  });

  it('does not trim — a leading/trailing space is a legitimate password character', () => {
    const spaced = ` ${long} `;
    expect(localPasswordErrorKey({ password: spaced, confirm: spaced })).toBeNull();
    expect(localPasswordErrorKey({ password: spaced, confirm: long })).toBe('auth.passwordMismatch');
  });
});
