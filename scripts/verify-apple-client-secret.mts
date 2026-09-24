// Round-trip check for the Sign in with Apple client secret (`26` B1).
//
// Signs with a THROWAWAY P-256 key and verifies with its public half, so it
// needs no real Apple secret and runs anywhere. It exists because the classic
// failure here (a DER-encoded signature where JWS wants raw r||s) makes Apple
// answer `invalid_client` — indistinguishable from a wrong Key ID or Team ID —
// and the only other way to find out is a failed revocation in production.
//
// Run: npm run verify:apple-secret   (Node >= 22.18: runs .ts without a build step)
import { appleClientSecret, pemToPkcs8, unverifiedClaims } from "../supabase/functions/apple-revoke/clientSecret.ts";
const { subtle } = globalThis.crypto;
// Throwaway P-256 key, exported the way Apple ships a .p8: PKCS#8 in PEM armour.
const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const der = new Uint8Array(await subtle.exportKey('pkcs8', kp.privateKey));
const b64 = Buffer.from(der).toString('base64');
const pem = `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----`;
let failures = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; };
for (const [label, keyText] of [['real newlines', pem], ['literal \\n', pem.replace(/\n/g, '\\n')], ['bare base64', b64]] as const) {
  const jwt = await appleClientSecret({ teamId: 'TEAM123456', keyId: 'KEY1234567', clientId: 'com.lexicamp.app', privateKeyPem: keyText, nowSeconds: 1_790_000_000 });
  const [h, p, s] = jwt.split('.');
  const sig = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const valid = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, sig, new TextEncoder().encode(`${h}.${p}`));
  check(`[${label}] signature verifies with the public key`, valid);
  check(`[${label}] signature is raw r||s (64 bytes), not DER`, sig.length === 64);
  const header = unverifiedClaims(`x.${h}.x`); const claims = unverifiedClaims(jwt)!;
  check(`[${label}] header alg=ES256 kid=KEY1234567`, header?.alg === 'ES256' && header?.kid === 'KEY1234567');
  check(`[${label}] claims iss/sub/aud/iat/exp`, claims.iss === 'TEAM123456' && claims.sub === 'com.lexicamp.app' && claims.aud === 'https://appleid.apple.com' && claims.iat === 1_790_000_000 && claims.exp === 1_790_000_300);
}
check('unverifiedClaims tolerates garbage', unverifiedClaims('not-a-jwt') === null && unverifiedClaims(undefined) === null);
check('pemToPkcs8 round-trips the DER', Buffer.from(pemToPkcs8(pem)).equals(Buffer.from(der)));
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`); process.exit(failures ? 1 : 0);
