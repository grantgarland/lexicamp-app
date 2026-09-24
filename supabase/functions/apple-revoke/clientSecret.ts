// Sign in with Apple — the pieces of the REST API handshake that are pure
// functions of their inputs. Kept dependency-free (WebCrypto, TextEncoder,
// atob/btoa only) so the exact same file runs under Deno in the Edge Function
// and under plain Node for a local round-trip check with a throwaway key.

const APPLE_AUDIENCE = 'https://appleid.apple.com';

function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The `.p8` Apple hands you is a PEM-armoured PKCS#8 EC key. Secret stores
 *  mangle newlines two ways — real newlines survive, or they arrive as the two
 *  characters `\n` — so accept both, and a bare base64 body with no armour. */
export function pemToPkcs8(pem: string): Uint8Array {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The `client_secret` Apple's token and revoke endpoints demand: an ES256 JWT
 *  signed with the Sign in with Apple key. Minted per request with a 5-minute
 *  life — Apple allows up to six months, but nothing here benefits from a
 *  long-lived secret and a short one cannot be replayed usefully. */
export async function appleClientSecret(o: {
  teamId: string;
  keyId: string;
  clientId: string;
  privateKeyPem: string;
  nowSeconds?: number;
}): Promise<string> {
  const now = o.nowSeconds ?? Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: o.keyId };
  const payload = { iss: o.teamId, iat: now, exp: now + 300, aud: APPLE_AUDIENCE, sub: o.clientId };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(o.privateKeyPem),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  // WebCrypto's ECDSA output is IEEE P1363 (r‖s, 64 bytes for P-256), which is
  // exactly what JWS ES256 requires. Do NOT DER-encode it — that is the classic
  // bug when porting from OpenSSL-based libraries, and Apple rejects the result
  // as `invalid_client`, which looks identical to a wrong Key ID or Team ID.
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput)),
  );
  return `${signingInput}.${b64url(sig)}`;
}

/** Read a JWT's claims WITHOUT verifying it. Only safe for tokens received
 *  directly from Apple over TLS in a server-to-server exchange, which is the
 *  only place this is used. Returns null on anything malformed. */
export function unverifiedClaims(jwt: string | undefined): Record<string, unknown> | null {
  if (!jwt) return null;
  try {
    const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part + '='.repeat((4 - (part.length % 4)) % 4)));
  } catch {
    return null;
  }
}
