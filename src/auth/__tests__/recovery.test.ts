// parseRecoveryUrl — the pure half of the DF-3 recovery flow. The URL shapes
// here are the real ones Supabase's /auth/v1/verify redirect produces.
import { parseRecoveryUrl } from '../recovery';

const BASE = 'lexicampapp://reset-password';

describe('parseRecoveryUrl', () => {
  it('extracts tokens from the fragment (the standard Supabase shape)', () => {
    const url = `${BASE}#access_token=at123&expires_in=3600&refresh_token=rt456&token_type=bearer&type=recovery`;
    expect(parseRecoveryUrl(url)).toEqual({
      status: 'tokens',
      tokens: { accessToken: 'at123', refreshToken: 'rt456' },
    });
  });

  it('extracts tokens demoted to the query string (mail-client link rewriters)', () => {
    const url = `${BASE}?access_token=at123&refresh_token=rt456&type=recovery`;
    expect(parseRecoveryUrl(url)).toEqual({
      status: 'tokens',
      tokens: { accessToken: 'at123', refreshToken: 'rt456' },
    });
  });

  it('reports expired/used links as errors with a readable message', () => {
    const url = `${BASE}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`;
    const parsed = parseRecoveryUrl(url);
    expect(parsed.status).toBe('error');
    if (parsed.status === 'error') expect(parsed.message).toBe('Email link is invalid or has expired');
  });

  it('ignores token-bearing URLs that are not recovery-typed', () => {
    // e.g. a future magic-link/OAuth redirect — must not hijack into reset.
    const url = `lexicampapp://auth-callback#access_token=at&refresh_token=rt&type=magiclink`;
    expect(parseRecoveryUrl(url)).toEqual({ status: 'none' });
  });

  it('ignores error params on non-recovery paths', () => {
    const url = `lexicampapp://auth-callback#error=access_denied&error_description=nope`;
    expect(parseRecoveryUrl(url)).toEqual({ status: 'none' });
  });

  it('ignores plain launches and null', () => {
    expect(parseRecoveryUrl('lexicampapp://')).toEqual({ status: 'none' });
    expect(parseRecoveryUrl(`${BASE}`)).toEqual({ status: 'none' });
    expect(parseRecoveryUrl(null)).toEqual({ status: 'none' });
    expect(parseRecoveryUrl(undefined)).toEqual({ status: 'none' });
  });

  it('rejects a fragment missing the refresh token', () => {
    expect(parseRecoveryUrl(`${BASE}#access_token=at&type=recovery`)).toEqual({ status: 'none' });
  });
});
