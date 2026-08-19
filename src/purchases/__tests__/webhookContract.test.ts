// Guard: the webhook invariants whose failure modes are SILENT.
//
// Nothing in the app imports the Edge Function or the migration, so nothing else
// would notice if these regressed — and each one fails by quietly doing nothing
// rather than by erroring. Same precedent as captureGateParity.test.ts, which
// also reads supabase/functions/ from a jest test.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const fn = readFileSync(join(ROOT, 'supabase/functions/revenuecat-webhook/index.ts'), 'utf8');

/** Resolve a migration by NAME, never by timestamp.
 *
 *  ⚠️ `npx supabase migration fetch` rewrites local files to the timestamps the
 *  remote history recorded, so a migration authored as 20260815020000 came back
 *  as 20260816020522 and a hardcoded path here broke the whole suite — the guard
 *  went dark exactly when the schema moved, which is when it is most needed. */
function migrationSource(suffix: string): string {
  const dir = join(ROOT, 'supabase/migrations');
  const file = readdirSync(dir).find((f) => f.endsWith(`_${suffix}.sql`));
  if (file == null) throw new Error(`no migration matching *_${suffix}.sql in ${dir}`);
  return readFileSync(join(dir, file), 'utf8');
}

const migration = migrationSource('revenuecat_webhook_mirror');

const reconcileFn = readFileSync(join(ROOT, 'supabase/functions/revenuecat-reconcile/index.ts'), 'utf8');
const reconcileSql = migrationSource('revenuecat_reconcile');

describe('revenuecat-reconcile contract (3.14)', () => {
  it('fails closed when the API key is unset', () => {
    // ⚠️ A reconciler that quietly no-ops is worse than an absent one: the drift
    // it exists to catch is itself silent, so a broken repair job is
    // indistinguishable from a healthy system.
    expect(reconcileFn).toContain("Deno.env.get('REVENUECAT_SECRET_API_KEY')");
    expect(reconcileFn).toMatch(/if \(!apiKey\)[\s\S]{0,400}return json\(\{ error: 'not configured' \}, 500\)/);
  });

  it('keeps verify_jwt ON, unlike the webhook', () => {
    // Invoked by our own scheduler with the service-role key, never by
    // RevenueCat — so Supabase's JWT check is the right gate and there is no
    // shared secret to misconfigure.
    expect(reconcileFn).toMatch(/verify_jwt ON/);
  });

  it('never acts on a failed fetch, but treats 404 as a real answer', () => {
    // Acting on a 5xx would revoke a live subscriber; 404 genuinely means
    // RevenueCat has no such customer.
    expect(reconcileFn).toContain('res.status !== 404');
    expect(reconcileFn).toContain('subscriber: { entitlements: {} }');
  });

  it('checks only suspicious rows, never the whole table', () => {
    // Cost proportional to the damage, not to the user base.
    expect(reconcileFn).toContain('reconcile_candidates');
    expect(reconcileSql).toContain('lapsed_but_active');
    expect(reconcileSql).toContain('client_reported_lag');
  });

  it('revokes both service-role-only functions from signed-in users', () => {
    // apply_revenuecat_snapshot can MINT subscriptions — the 21 P0-1 shape.
    expect(reconcileSql).toMatch(/revoke all on function public\.reconcile_candidates\(int\) from public, anon, authenticated/);
    expect(reconcileSql).toMatch(/revoke all on function public\.apply_revenuecat_snapshot\(uuid, jsonb\) from public, anon, authenticated/);
  });

  it('keeps the ordering guard so a snapshot cannot regress a newer event', () => {
    expect(reconcileSql).toContain('excluded.last_event_ts >= s.last_event_ts');
  });
});

describe('revenuecat-webhook contract', () => {
  it('carries the verify_jwt warning', () => {
    // With Supabase's default verify_jwt ON, RevenueCat (which sends no Supabase
    // JWT) gets 401 on every delivery, retries 5×, gives up — and the mirror never
    // populates while both dashboards look healthy. The setting lives outside the
    // repo, so this comment is the only place the next person can learn it.
    expect(fn).toMatch(/verify_jwt.{0,40}OFF/s);
    expect(fn).toContain('--no-verify-jwt');
  });

  it('fails closed when the shared secret is unset', () => {
    // An unset secret must never read as "accept everything" — that would let
    // anyone who learns the URL write subscription rows.
    const guard = fn.slice(fn.indexOf('const expected'), fn.indexOf('let body'));
    expect(guard).toMatch(/if \(!expected\)/);
    expect(guard).toMatch(/500\)/);
    expect(guard).toMatch(/401\)/);
  });

  it('compares the secret in constant time', () => {
    expect(fn).toContain('secretsMatch');
    expect(fn).not.toMatch(/Authorization'\) === expected/);
  });

  it('returns non-200 ONLY for a database failure', () => {
    // RevenueCat retries any non-200 five times. Duplicates, stale events,
    // unmapped users and unhandled types are all normal outcomes: 4xx-ing them
    // buries the real failures under noise that will never succeed.
    const statuses = [...fn.matchAll(/json\([^;]*?,\s*(\d{3})\)/gs)].map((m) => m[1]);
    // 405 method, 500 unconfigured, 401 unauthorized, 400 ×2 malformed, 500 apply.
    expect(statuses.sort()).toEqual(['400', '400', '401', '405', '500', '500']);
    expect(fn).toMatch(/result: 'skipped_sandbox'/);
  });
});

describe('apply_revenuecat_event migration', () => {
  it('does not treat CANCELLATION as immediate expiry', () => {
    // CANCELLATION means "will not renew"; access continues to expiration_at_ms.
    // Mapping it straight to 'expired' revokes premium from people who paid.
    const arm = migration.slice(migration.indexOf("when 'CANCELLATION'"));
    const clause = arm.slice(0, arm.indexOf("when 'EXPIRATION'"));
    expect(clause).toContain('v_exp');
    expect(clause).toMatch(/v_exp > now\(\)/);
  });

  it('guards against out-of-order and replayed events', () => {
    expect(migration).toMatch(/last_event_ts is null or excluded\.last_event_ts >= s\.last_event_ts/);
    expect(migration).toMatch(/on conflict \(id\) do nothing/);
  });

  it('revokes the definer function from every client role', () => {
    // A SECURITY DEFINER function reachable over PostgREST by `authenticated` is
    // the exact escalation shape of 21 §P0-1 — here it would mint subscriptions.
    expect(migration).toMatch(
      /revoke all on function public\.apply_revenuecat_event\(jsonb\) from public, anon, authenticated;/,
    );
  });

  it('leaves the event log service-role only', () => {
    // RLS enabled with NO policies = denied for anon and authenticated.
    expect(migration).toMatch(/alter table public\.revenuecat_events enable row level security;/);
    expect(migration).not.toMatch(/create policy .* on public\.revenuecat_events/);
  });
});
