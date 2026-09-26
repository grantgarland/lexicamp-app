// revenuecat-webhook — RevenueCat's subscription events → the `subscriptions`
// mirror that `save_card` and `getEntitlement()` read (3.1 Stage B, 22).
//
// ⚠️⚠️ THIS FUNCTION MUST BE DEPLOYED WITH `verify_jwt` OFF. ⚠️⚠️
// Every other Edge Function here runs with Supabase's default `verify_jwt: true`,
// which is correct for them: they are called by signed-in users. RevenueCat is
// not a user and sends no Supabase JWT, so with the default ON every delivery
// 401s, RevenueCat retries five times, gives up, and the mirror silently never
// populates — while both dashboards show a perfectly configured webhook. That
// failure is invisible from either side, which is why it is written here in
// capitals. It defaults to ON and must be turned off EXPLICITLY at deploy time —
// `supabase functions deploy revenuecat-webhook --no-verify-jwt`, or the
// verify_jwt flag on the deploy API — or afterwards in the Supabase dashboard
// under Edge Functions → revenuecat-webhook → Details. ⚠️ A REDEPLOY THAT FORGETS
// THE FLAG SILENTLY RE-ARMS IT, which is the likeliest way this breaks later.
//
// Authentication is instead the shared secret RevenueCat sends in the
// Authorization header (dashboard → Integrations → Webhooks), compared here in
// constant time against REVENUECAT_WEBHOOK_AUTH_HEADER.
//
// The apply itself lives in the `apply_revenuecat_event` RPC, not here: dedupe,
// the out-of-order guard and the mirror write have to be one transaction, and
// SQL is where that is cheap. This file is transport and auth — plus ONE
// exception, the TRANSFER recipient grant below (`26` B14).
// @ts-ignore -- Deno npm: specifier resolved at runtime, not by the TS server.
import { createClient } from 'npm:@supabase/supabase-js@2';

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Length-independent comparison. A plain `===` on a secret leaks its prefix
 *  through response timing; this is cheap enough that there is no reason not to. */
function secretsMatch(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `26` B14 (2026-09-25) — a TRANSFER must GRANT the recipient, not only revoke
 * the prior owner.
 *
 * `apply_revenuecat_event` handles TRANSFER by revoking `transferred_from` and
 * assuming "the winning side is set by the events that follow it". RevenueCat
 * sends no such event: the next thing the recipient receives is their next
 * RENEWAL — up to a year away on an annual plan. So anyone whose Apple ID
 * already held a subscription (a new account after deletion, a second account,
 * a reinstall) paid and stayed FREE until the hourly reconcile noticed —
 * observed live on 2026-09-25 (TRANSFER 12:05 → reconciled 13:00 UTC), through
 * one purchase, four restores and a re-login.
 *
 * A TRANSFER carries no product, period or expiry, so the recipient's state is
 * fetched from RevenueCat and applied through `apply_revenuecat_snapshot` —
 * the reconcile job's own path, so there is one definition of "apply RevenueCat's
 * truth" rather than two. `$RCAnonymousID`s are skipped (not Supabase users), as
 * are recipients with no profile yet (the mirror row needs one; reconcile's
 * transfer-recipient candidates pick them up later).
 */
async function grantTransferRecipients(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  event: Record<string, unknown>,
): Promise<{ granted: Record<string, unknown>[]; failed: number }> {
  const recipients = (Array.isArray(event.transferred_to) ? event.transferred_to : []).filter(
    (x): x is string => typeof x === 'string' && UUID.test(x),
  );
  const granted: Record<string, unknown>[] = [];
  if (recipients.length === 0) return { granted, failed: 0 };

  const apiKey = Deno.env.get('REVENUECAT_SECRET_API_KEY');
  if (!apiKey) {
    console.error(JSON.stringify({ at: 'transfer_grant', error: 'REVENUECAT_SECRET_API_KEY unset' }));
    return { granted, failed: recipients.length };
  }

  let failed = 0;
  for (const userId of recipients) {
    try {
      const { data: profile } = await supabase.from('profiles').select('id').eq('id', userId).maybeSingle();
      if (!profile) {
        granted.push({ user: userId, result: 'no_profile' });
        continue;
      }
      const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      });
      // Grant-only: never act on a non-OK answer. A 5xx must not become a
      // revocation, and a 404 for someone RevenueCat just transferred TO would be
      // an anomaly worth a retry, not a verdict.
      if (!res.ok) {
        failed++;
        console.error(JSON.stringify({ at: 'transfer_grant', user: userId, status: res.status }));
        continue;
      }
      const { data: applied, error } = await supabase.rpc('apply_revenuecat_snapshot', {
        p_user_id: userId,
        p_snapshot: await res.json(),
      });
      if (error) {
        failed++;
        console.error(JSON.stringify({ at: 'transfer_grant', user: userId, message: error.message }));
        continue;
      }
      granted.push({ user: userId, ...(applied as Record<string, unknown>) });
    } catch (e) {
      failed++;
      console.error(JSON.stringify({ at: 'transfer_grant', user: userId, message: String(e) }));
    }
  }
  return { granted, failed };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const expected = Deno.env.get('REVENUECAT_WEBHOOK_AUTH_HEADER');
  if (!expected) {
    // Fail CLOSED. An unset secret must never mean "accept everything" — that
    // would let anyone who learns the URL write subscription rows.
    console.error(JSON.stringify({ at: 'config', error: 'REVENUECAT_WEBHOOK_AUTH_HEADER unset' }));
    return json({ error: 'not configured' }, 500);
  }
  if (!secretsMatch(req.headers.get('Authorization') ?? '', expected)) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body: { event?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }
  const event = body?.event;
  if (event == null || typeof event !== 'object') return json({ error: 'missing event' }, 400);

  // Sandbox is how the mirror gets tested before launch (1.2 §5.7), so it is
  // accepted by default and recorded with its environment. Flip
  // REVENUECAT_ACCEPT_SANDBOX to '0' after launch to make production the only
  // thing that can move a real subscription — a config change, not a deploy.
  const isSandbox = String(event.environment ?? '').toUpperCase() === 'SANDBOX';
  if (isSandbox && Deno.env.get('REVENUECAT_ACCEPT_SANDBOX') === '0') {
    // 200, not 4xx: this is a deliberate skip, and a non-200 would make
    // RevenueCat retry it five times before giving up.
    return json({ result: 'skipped_sandbox' });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data, error } = await supabase.rpc('apply_revenuecat_event', { p_event: event });

  if (error) {
    // The ONLY path that returns non-200, and deliberately so: a database failure
    // is transient and exactly what RevenueCat's retry is for. Everything the
    // function understands — duplicates, stale events, unmapped users, event types
    // we do not handle — is a 200, because retrying those forever accomplishes
    // nothing and buries the real failures.
    console.error(JSON.stringify({
      at: 'apply', eventId: event.id, type: event.type, code: error.code, message: error.message,
    }));
    return json({ error: 'apply failed' }, 500);
  }

  // Logged at info so an unresolved app_user_id (the "purchases arrive but match
  // nobody" failure) is greppable without opening the database.
  console.log(JSON.stringify({ at: 'apply', ...(data as Record<string, unknown>) }));

  if (String(event.type ?? '').toUpperCase() === 'TRANSFER') {
    // Runs on redeliveries too — the RPC dedupes the event, but the grant is an
    // idempotent "apply RevenueCat's current truth", so repeating it is safe and
    // is exactly what makes a retry useful.
    const transfer = await grantTransferRecipients(supabase, event);
    console.log(JSON.stringify({ at: 'transfer_grant', eventId: event.id, ...transfer }));
    if (transfer.failed > 0) {
      // Non-200 ON PURPOSE, like a DB failure: a failed grant (RevenueCat API
      // down, a transient apply error) is exactly what RevenueCat's retry is for.
      // The hourly reconcile remains the backstop if every retry fails.
      return json({ error: 'transfer grant failed', ...transfer }, 500);
    }
    return json({ ...((data as Record<string, unknown>) ?? { result: 'ok' }), transfer: transfer.granted });
  }

  return json(data ?? { result: 'ok' });
});
