// revenuecat-reconcile — repair subscription mirrors that drifted (3.14).
//
// WHY THIS EXISTS. The webhook is the only thing that writes `subscriptions`,
// and RevenueCat delivery is at-least-once but not at-ALL-costs: it retries a
// failing endpoint five times and then drops the event forever. On 2026-08-17 a
// wrong shared secret ate an EXPIRATION exactly that way, and the mirror stayed
// wrong indefinitely because the correcting event was never coming again.
//
// `is_paid_state`'s period-end backstop (20260818124810) stops that costing us
// money — a lapsed period reads as unpaid — but it cannot REPAIR the row, and it
// does nothing for the opposite drift: a lost INITIAL_PURCHASE leaves a paying
// customer marked free, which the backstop happily agrees with.
//
// So this asks RevenueCat directly, for the small set of rows that look wrong.
// It is a repair job, not a sync job: `reconcile_candidates()` returns only
// suspicious rows, never the whole table, so the cost stays proportional to the
// damage rather than to the user base.
//
// ⚠️ DEPLOY WITH verify_jwt ON (the default) — unlike revenuecat-webhook. This
// endpoint is invoked by our own scheduler with the service-role key, never by
// RevenueCat, so Supabase's own JWT check is exactly the right gate and there is
// no shared secret to get wrong.
// @ts-ignore -- Deno npm: specifier resolved at runtime, not by the TS server.
import { createClient } from 'npm:@supabase/supabase-js@2';

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** RevenueCat asks for ~10 req/s; we stay far under it and cap the batch. */
const BATCH = 50;
const PAUSE_MS = 120;

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const apiKey = Deno.env.get('REVENUECAT_SECRET_API_KEY');
  if (!apiKey) {
    // Fail CLOSED and LOUD. A reconciler that quietly no-ops is worse than one
    // that is absent: the drift it exists to catch is itself silent, so a broken
    // repair job would look exactly like a healthy system.
    console.error(JSON.stringify({ at: 'config', error: 'REVENUECAT_SECRET_API_KEY unset' }));
    return json({ error: 'not configured' }, 500);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: candidates, error } = await supabase.rpc('reconcile_candidates', { p_limit: BATCH });
  if (error) {
    console.error(JSON.stringify({ at: 'candidates', message: error.message }));
    return json({ error: 'candidate query failed' }, 500);
  }

  const rows = (candidates ?? []) as { user_id: string; revenuecat_id: string | null; reason: string }[];
  const changed: unknown[] = [];
  let checked = 0;
  let failed = 0;

  for (const row of rows) {
    // `app_user_id` IS the Supabase user id (Purchases.logIn in sessionSync), so
    // no lookup table is needed — the same property the webhook depends on.
    const appUserId = row.revenuecat_id ?? row.user_id;
    try {
      const res = await fetch(
        `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
        { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } },
      );
      if (!res.ok) {
        // 404 means RevenueCat has never heard of this customer, which is a real
        // answer (no entitlement), not an error. Anything else is a fetch we
        // should not act on — acting on a 5xx would revoke a live subscriber.
        if (res.status !== 404) {
          failed++;
          console.error(JSON.stringify({ at: 'fetch', user: row.user_id, status: res.status }));
          continue;
        }
      }
      const snapshot = res.status === 404 ? { subscriber: { entitlements: {} } } : await res.json();
      const { data: applied, error: applyErr } = await supabase.rpc('apply_revenuecat_snapshot', {
        p_user_id: row.user_id,
        p_snapshot: snapshot,
      });
      if (applyErr) {
        failed++;
        console.error(JSON.stringify({ at: 'apply', user: row.user_id, message: applyErr.message }));
        continue;
      }
      checked++;
      if ((applied as { changed?: boolean })?.changed) changed.push({ ...(applied as object), reason: row.reason });
    } catch (e) {
      failed++;
      console.error(JSON.stringify({ at: 'loop', user: row.user_id, message: String(e) }));
    }
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  // Logged whole so "did reconciliation do anything last night?" is greppable
  // without opening the database.
  const summary = { candidates: rows.length, checked, changed: changed.length, failed, details: changed };
  console.log(JSON.stringify({ at: 'summary', ...summary }));
  return json(summary);
});
