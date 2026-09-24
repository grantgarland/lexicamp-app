// apple-revoke — revoke a user's Sign in with Apple authorization when they
// delete their Lexicamp account.
//
// WHY THIS EXISTS. Apple's account-deletion guidance says an app offering Sign
// in with Apple should revoke the user's tokens through the Sign in with Apple
// REST API when the account is deleted. Lexicamp offers both, and until this
// function `delete_own_account()` was a bare `delete from auth.users` — the
// account vanished but Apple still listed Lexicamp under the user's "Sign in
// with Apple" apps. Found in the 2026-09-23 launch audit (`26` B1); a known
// App Review rejection cause that no amount of manual testing can surface.
//
// THE SHAPE, AND WHY. Nothing Apple-issued is ever stored: Supabase's native
// id-token sign-in never sees a refresh token. So the client re-runs the native
// Apple sheet at deletion time, which yields a fresh single-use authorization
// code (valid ~5 minutes), and this function exchanges it and revokes at once.
// That works for accounts created before this shipped, keeps no Apple
// credentials at rest, and leaves the sign-in path completely untouched.
//
// ORDER MATTERS: the client calls this BEFORE `delete_own_account()`, because
// the caller is authenticated by their session and deletion destroys it.
// The client treats this call as best-effort — a revocation failure is reported
// and the deletion still proceeds. Blocking someone from deleting their account
// is the worse failure, and it is also a guideline violation of its own.
//
// ⚠️ DEPLOY WITH verify_jwt ON (the default), like `translate` and unlike
// `revenuecat-webhook`. The caller is always a signed-in app user.
//
// SECRETS (set by the operator — the agent never handles the key):
//   APPLE_TEAM_ID       10-character Team ID (Apple Developer → Membership)
//   APPLE_KEY_ID        10-character Key ID of the Sign in with Apple key
//   APPLE_PRIVATE_KEY   the .p8 file's contents, PEM armour included
//   APPLE_CLIENT_ID     com.lexicamp.app — native apps use the bundle ID
// @ts-ignore -- Deno npm: specifier resolved at runtime, not by the TS server.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { appleClientSecret, unverifiedClaims } from './clientSecret.ts';

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const APPLE = 'https://appleid.apple.com';
const REQUIRED_SECRETS = ['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY', 'APPLE_CLIENT_ID'] as const;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Log without ever including the authorization code, the key, or a token. */
const log = (at: string, detail: Record<string, unknown> = {}) => console.error(JSON.stringify({ at, ...detail }));

/** Apple's error bodies are `{ "error": "invalid_grant" }`-shaped. The code is
 *  the useful part: `invalid_client` means OUR config (key/team/key id) is
 *  wrong; `invalid_grant` means the authorization code is spent or expired. */
async function appleError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : `http_${res.status}`;
  } catch {
    return `http_${res.status}`;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // verify_jwt has validated the signature; require a real signed-in user —
  // the anon key passes verify_jwt too, but carries no `sub`.
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const caller = unverifiedClaims(bearer);
  const userId = caller?.role === 'authenticated' && typeof caller.sub === 'string' ? caller.sub : null;
  if (!userId) return json({ error: 'authentication required' }, 401);

  // Fail CLOSED and LOUD on missing config. A revoker that quietly no-ops looks
  // exactly like a healthy one, because a successful revocation is invisible.
  const missing = REQUIRED_SECRETS.filter((k) => !Deno.env.get(k));
  if (missing.length > 0) {
    log('config', { missing });
    return json({ error: 'not configured' }, 500);
  }

  let authorizationCode: unknown;
  try {
    ({ authorizationCode } = (await req.json()) as { authorizationCode?: unknown });
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }
  if (typeof authorizationCode !== 'string' || authorizationCode.length === 0)
    return json({ error: 'authorizationCode required' }, 400);

  // Is this account actually an Apple account, and which Apple user is it?
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user) {
    log('user_lookup', { message: error?.message ?? 'no user' });
    return json({ error: 'user lookup failed' }, 500);
  }
  const identity = (data.user.identities ?? []).find((i: { provider: string }) => i.provider === 'apple') as
    | { id?: string; identity_data?: { sub?: unknown } }
    | undefined;
  if (!identity) return json({ error: 'no apple identity' }, 409);
  const expectedSub = typeof identity.identity_data?.sub === 'string' ? identity.identity_data.sub : identity.id;

  const clientId = Deno.env.get('APPLE_CLIENT_ID')!;
  let clientSecret: string;
  try {
    clientSecret = await appleClientSecret({
      teamId: Deno.env.get('APPLE_TEAM_ID')!,
      keyId: Deno.env.get('APPLE_KEY_ID')!,
      clientId,
      privateKeyPem: Deno.env.get('APPLE_PRIVATE_KEY')!,
    });
  } catch (e) {
    // Almost always a malformed APPLE_PRIVATE_KEY. Never log the key itself.
    log('client_secret', { message: e instanceof Error ? e.name : 'unknown' });
    return json({ error: 'not configured' }, 500);
  }

  // 1. Exchange the one-time code for Apple's tokens.
  const tokenRes = await fetch(`${APPLE}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: authorizationCode,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) {
    const apple_error = await appleError(tokenRes);
    log('token_exchange', { status: tokenRes.status, apple_error });
    return json({ error: 'token exchange failed', apple_error }, 502);
  }
  const tokens = (await tokenRes.json()) as { refresh_token?: string; access_token?: string; id_token?: string };

  // 2. Refuse to revoke a DIFFERENT Apple ID. If the device is signed into
  //    another Apple ID than the one that created this account, the code belongs
  //    to that other person-or-account; revoking it would disconnect the wrong
  //    Apple ID from Lexicamp and leave the right one connected.
  const codeSub = unverifiedClaims(tokens.id_token)?.sub;
  if (typeof codeSub === 'string' && expectedSub && codeSub !== expectedSub) {
    log('apple_account_mismatch');
    return json({ error: 'apple account mismatch' }, 409);
  }

  // 3. Revoke. Apple accepts either token; the refresh token is the durable
  //    grant, so it is the one that actually ends the authorization.
  const token = tokens.refresh_token ?? tokens.access_token;
  if (!token) {
    log('token_exchange', { detail: 'no token in response' });
    return json({ error: 'token exchange failed' }, 502);
  }
  const revokeRes = await fetch(`${APPLE}/auth/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      token,
      token_type_hint: tokens.refresh_token ? 'refresh_token' : 'access_token',
    }),
  });
  if (!revokeRes.ok) {
    const apple_error = await appleError(revokeRes);
    log('revoke', { status: revokeRes.status, apple_error });
    return json({ error: 'revoke failed', apple_error }, 502);
  }

  return json({ revoked: true });
});
