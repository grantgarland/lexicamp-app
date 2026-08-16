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
// capitals. It cannot be set from the deploy API: use the Supabase dashboard
// (Edge Functions → revenuecat-webhook → Details) or
// `supabase functions deploy revenuecat-webhook --no-verify-jwt`.
//
// Authentication is instead the shared secret RevenueCat sends in the
// Authorization header (dashboard → Integrations → Webhooks), compared here in
// constant time against REVENUECAT_WEBHOOK_AUTH_HEADER.
//
// The apply itself lives in the `apply_revenuecat_event` RPC, not here: dedupe,
// the out-of-order guard and the mirror write have to be one transaction, and
// SQL is where that is cheap. This file is transport and auth only.
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
  return json(data ?? { result: 'ok' });
});
