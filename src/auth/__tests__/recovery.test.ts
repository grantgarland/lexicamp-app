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

// ── PKCE shape (2026-08-02) ──────────────────────────────────────────────────
// supabase-js v2 defaults to PKCE, so the REAL recovery link is `?code=…`, not
// the implicit fragment. Missing this made password reset a silent no-op.
describe('parseRecoveryUrl — PKCE code links', () => {
  it('extracts the code from the query string', () => {
    expect(parseRecoveryUrl(`${BASE}?code=8b1f2c3d-4e5f-6071-8293-a4b5c6d7e8f9`)).toEqual({
      status: 'code',
      code: '8b1f2c3d-4e5f-6071-8293-a4b5c6d7e8f9',
    });
  });

  it('extracts the code when a rewriter promotes it to the fragment', () => {
    expect(parseRecoveryUrl(`${BASE}#code=abc123`)).toEqual({ status: 'code', code: 'abc123' });
  });

  it('ignores an empty code rather than trying to exchange it', () => {
    expect(parseRecoveryUrl(`${BASE}?code=`)).toEqual({ status: 'none' });
  });

  it('does NOT claim a code on some other path (a future OAuth callback)', () => {
    expect(parseRecoveryUrl('lexicampapp://oauth-callback?code=abc123')).toEqual({ status: 'none' });
  });

  it('still prefers explicit recovery tokens when both shapes are present', () => {
    const url = `${BASE}?code=abc123#access_token=at1&refresh_token=rt1&type=recovery`;
    expect(parseRecoveryUrl(url)).toEqual({
      status: 'tokens',
      tokens: { accessToken: 'at1', refreshToken: 'rt1' },
    });
  });

  it('reports an expired PKCE link as an error, not a code', () => {
    const url = `${BASE}?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`;
    const parsed = parseRecoveryUrl(url);
    expect(parsed.status).toBe('error');
  });
});

