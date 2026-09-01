-- REPAIR. My `profiles_lock_writable_columns` migration (applied minutes ago) was
-- a DUPLICATE of 20260820150409_profiles_column_grants_lockdown.sql, which had
-- already closed P0-1 on 2026-08-20. Mine re-granted UPDATE on only
-- (display_name, quiz_length) where the real one grants
-- (display_name, quiz_length, timezone) — so the blanket revoke at the top of my
-- version silently dropped the timezone grant.
--
-- That is not cosmetic: sessionSync.reconcile() writes
-- dataSource.updateProfile({ timezone }) on every session start where the device
-- zone has moved, and it is what keeps the server-side reminder scheduler firing
-- at the user's actual local time. Losing the grant makes that write fail with
-- insufficient_privilege — silently, since the reconciliation is best-effort by
-- design and swallows its errors.
--
-- Restores the third column. is_dev stays unwritable.

grant update (timezone) on public.profiles to authenticated;

notify pgrst, 'reload schema';
