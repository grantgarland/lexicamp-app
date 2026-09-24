// Guard: the `apple-revoke` invariants whose failure modes are SILENT.
//
// A successful revocation is invisible — nothing in the app changes — so a
// revoker that quietly no-ops looks exactly like a working one. Nothing in the
// app imports the Edge Function, so, like webhookContract.test.ts, this reads
// supabase/functions/ as text and pins the parts that must not drift.
// The ES256 signing itself is verified by actually signing and verifying with a
// throwaway key: `npm run verify:apple-secret` (scripts/verify-apple-client-secret.mts).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const fn = readFileSync(join(ROOT, 'supabase/functions/apple-revoke/index.ts'), 'utf8');
const secret = readFileSync(join(ROOT, 'supabase/functions/apple-revoke/clientSecret.ts'), 'utf8');
const client = readFileSync(join(ROOT, 'src/data/supabase/SupabaseDataSource.ts'), 'utf8');

describe('apple-revoke Edge Function (26 B1)', () => {
  it('is the function the client actually invokes — a rename on either side fails here', () => {
    expect(client).toMatch(/functions\.invoke\('apple-revoke'/);
  });

  it('requires a signed-in caller, not merely a valid JWT (the anon key passes verify_jwt)', () => {
    expect(fn).toMatch(/role === 'authenticated'/);
    expect(fn).toMatch(/authentication required' \}, 401/);
  });

  it('fails CLOSED on every missing secret rather than no-opping', () => {
    for (const name of ['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY', 'APPLE_CLIENT_ID']) {
      expect(fn).toContain(`'${name}'`);
    }
    expect(fn).toMatch(/not configured' \}, 500/);
  });

  it('exchanges the code, then revokes — against Apple’s real endpoints', () => {
    expect(fn).toContain("const APPLE = 'https://appleid.apple.com'");
    expect(fn).toMatch(/\$\{APPLE\}\/auth\/token/);
    expect(fn).toMatch(/grant_type: 'authorization_code'/);
    expect(fn).toMatch(/\$\{APPLE\}\/auth\/revoke/);
    expect(fn).toMatch(/token_type_hint:/);
    // Exchange strictly before revoke.
    expect(fn.indexOf('/auth/token')).toBeLessThan(fn.indexOf('/auth/revoke'));
  });

  it('refuses to revoke a different Apple ID than the account’s own', () => {
    expect(fn).toMatch(/codeSub !== expectedSub/);
    expect(fn).toMatch(/apple account mismatch' \}, 409/);
  });

  it('never logs the authorization code or the key', () => {
    const logCalls = fn.match(/log\([^)]*\)/g) ?? [];
    expect(logCalls.length).toBeGreaterThan(0);
    for (const call of logCalls) {
      // Strip quoted text first: the WORD "token" in a message is fine; passing a
      // variable that holds one is not.
      const code = call.replace(/'[^']*'/g, "''");
      expect(code).not.toMatch(/\b(authorizationCode|clientSecret|tokens?|bearer|APPLE_PRIVATE_KEY)\b/);
    }
  });

  it('signs ES256 over P-256 with the raw (not DER) signature Apple requires', () => {
    expect(secret).toMatch(/alg: 'ES256'/);
    expect(secret).toMatch(/namedCurve: 'P-256'/);
    expect(secret).toMatch(/aud: APPLE_AUDIENCE/);
    expect(secret).toContain("const APPLE_AUDIENCE = 'https://appleid.apple.com'");
  });
});
