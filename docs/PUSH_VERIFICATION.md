# Verifying push notifications (TestFlight / production)

## The rule

`push_log` and a `{"status":"ok"}` from Expo **do not mean a notification arrived.**
Expo's `/push/send` returns a *ticket*, which means only "accepted for delivery".
Whether Apple actually delivered it is reported separately, later, by
`/push/getReceipts`.

For 14 days (2026-07-21 → 2026-08-04) this system logged 16 successful sends while
Apple rejected **every one** with `InvalidProviderToken` — a bad APNs auth key.
Nothing in the pipeline could see it. That is what `push_send` now exists to catch.

**The only evidence push works is `receipt_status = 'ok'` on a `push_send` row.**

## Verify in 60 seconds

Supabase dashboard → SQL Editor. Replace the email with the account whose device
you're holding.

```sql
-- 1. Fire a test push at every device registered to that account.
select public.admin_send_test_push('you@example.com');
```

Optional second argument overrides the body:
`select public.admin_send_test_push('you@example.com', 'Checking APNs after the key swap');`

It returns the device count it sent to, and raises a readable error rather than
returning zero rows when the email is unknown or the account has no registered
device — those are different problems and used to look identical.

> **Admin-only.** `admin_send_test_push` is granted to `service_role` and
> `postgres` ONLY. It must never be granted to `authenticated`: it sends
> arbitrary text to any account's devices, so that grant would let any signed-in
> user push anything to any other user. The in-app equivalent is
> `send_test_push()`, which resolves `auth.uid()` and can only reach the caller.

<details><summary>The long form, if you'd rather not use the helper</summary>

```sql
select public.push_send_to_token(
         u.id, pt.token, 'Lexicamp test',
         'Push is working. Nothing is due - this was a test.', '/', 'test')
from auth.users u
join public.push_tokens pt on pt.user_id = u.id
where u.email = 'you@example.com';
```
</details>

### Other places you can send from

| Where | Good for | Caveat |
|---|---|---|
| **Supabase → SQL Editor** (above) | The real path: your own scheduler code, your logging, receipts. | — |
| **expo.dev/notifications** (Expo's web tool) | Bisecting. If Expo's tool delivers but yours doesn't, the fault is in this pipeline; if BOTH fail, it's the APNs credential. | Needs the raw `ExponentPushToken[…]`; bypasses `push_send`, so nothing is logged and receipts aren't swept. |
| **In-app** (Settings → test push) | End-to-end from a real user's session. | Requires being signed in as that user on the device. |

Get a token for Expo's web tool with:

```sql
select u.email, pt.platform, pt.token
from public.push_tokens pt join auth.users u on u.id = pt.user_id
where u.email = 'you@example.com';
```

```sql
-- 2. Wait ~10 seconds, then resolve it. (Cron does this every 5 min anyway;
--    calling it by hand just skips the wait.) Run it TWICE: the first call
--    collects the ticket and requests the receipt, the second reads the receipt
--    back. pg_net is async, so a response cannot be read in the transaction that
--    made the request.
select public.sweep_push_delivery();
select public.sweep_push_delivery();
```

```sql
-- 3. The verdict.
select id, kind, receipt_status, receipt_error, left(receipt_message, 120) as message
from public.push_send order by id desc limit 5;
```

| `receipt_status` | Meaning | Action |
|---|---|---|
| `ok` | Apple accepted it. Check the phone. | Done — if no banner appeared, the problem is device-side (Focus mode, notification settings, app foregrounded). |
| `error` + `InvalidCredentials` / `InvalidProviderToken` | The project's APNs key is bad. | `npx eas-cli credentials -p ios` → production → Push Notifications → replace the key. **No app rebuild needed** — the key lives on Expo's servers. |
| `error` + `DeviceNotRegistered` | Token is dead (app deleted, notifications revoked). | Nothing — the sweep prunes it automatically. |
| `error` + `MessageTooBig` / `MessageRateExceeded` | Payload or rate problem. | Fix the payload / back off. |
| `null` (pending) | Not resolved yet. | Run the sweep again. If it stays null for >1h, `net._http_response` was pruned before collection — that row is unresolvable, send a fresh test. |

## The failure is INTERMITTENT

2026-08-04: the 12:30Z scheduled sends were rejected with `InvalidProviderToken`.
A 21:56Z send succeeded. **Nothing was changed in between** -- the APNs key was
not touched. So this path fails in windows and recovers on its own.

That is worse than a hard outage, because any manual test landing in a good
window reports "fixed" while the next morning's real notification silently does
not arrive. `push_canary()` samples the credential path every 15 minutes with a
content-free push (no title/body, `_contentAvailable`, so iOS shows nothing) for
exactly this reason.

```sql
select * from public.push_canary_health;   -- hourly ok/failed
```

Any hour with `failed > 0` is an hour real users got nothing. Disable the probe
with `select cron.unschedule('lexicamp-push-canary');`.

Leading hypothesis, unconfirmed: Expo caches an APNs provider JWT signed from the
`.p8`, and Apple 403s a stale or over-refreshed one until it is regenerated. A
genuinely invalid key looks identical from receipts alone -- so re-verify the key
in EAS regardless.

## Ongoing health

```sql
select * from public.push_delivery_health;
```

`delivered > 0` is the only column that proves anything. `attempts` and `pending`
prove nothing — that was the whole failure mode.

Worth glancing at after any change to: APNs credentials, the Apple Developer
account, the bundle id, or the EAS project.

## If the account has no token

`push_send_to_token` returns no rows when the account has never registered a
device. That is its own bug, upstream of delivery — the app registers on
`registerForPush()`, which requires a real device (not a simulator), granted
notification permission, and `USE_SUPABASE`. Check:

```sql
select u.email, pt.platform, pt.updated_at
from public.push_tokens pt join auth.users u on u.id = pt.user_id;
```

## Known sharp edges

- **One device, several accounts — FIXED 2026-08-05.** `push_tokens` is keyed
  `(user_id, token)` and signing out used to leave the row behind, so a phone used
  by two accounts got *two* identical pushes a day. Observed in production: two
  `scheduled` sends at `06:00:00.223234`, same token, two user_ids, both
  `receipt_status = ok`. Fixed at both ends:
  - `signOut()` now deletes this account's row first, while the session is still
    valid (the delete is RLS-scoped to `auth.uid()`, so doing it after
    `auth.signOut()` silently no-ops).
  - `run_push_scheduler()` de-duplicates per DEVICE: a token belongs to whichever
    account registered it most recently, and a token that already got a
    `scheduled` push in its own local day is skipped. This half works on builds
    already shipped and on rows already in the table.

  To confirm a device is registered once:

  ```sql
  select right(token, 12) as token_tail, count(*) as accounts
  from public.push_tokens group by token having count(*) > 1;
  ```

  Rows left behind by sign-outs that happened BEFORE this fix are harmless (the
  scheduler ignores the losing one) but can be cleared:

  ```sql
  delete from public.push_tokens pt
  where exists (select 1 from public.push_tokens o
                where o.token = pt.token
                  and (o.updated_at, o.user_id) > (pt.updated_at, pt.user_id));
  ```
- **Receipts expire.** Expo keeps them ~24h; `net._http_response` is pruned in
  hours. The sweep runs every 5 minutes for that reason. Do not lengthen it.
- **`send_test_push()` needs a session.** It resolves `auth.uid()`, so it works
  from the app (`supabase.rpc('send_test_push')`) but NOT from the SQL editor,
  where `auth.uid()` is null. That is why the recipe above calls
  `push_send_to_token` directly instead.
