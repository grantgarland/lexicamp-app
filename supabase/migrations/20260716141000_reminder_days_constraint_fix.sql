-- Fix (caught by the Phase C constraint rehearsal): array_length('{}',1) is NULL
-- and CHECK passes on NULL, so an empty days array slipped through — which would
-- silently disable a user's reminders forever. cardinality() returns 0 for empty.
alter table public.notification_prefs
  drop constraint notification_prefs_days_valid;
alter table public.notification_prefs
  add constraint notification_prefs_days_valid
    check (days <@ array[0,1,2,3,4,5,6] and cardinality(days) >= 1);
