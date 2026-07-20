-- Advisor fix: extensions don't belong in public. (pg_net's callable functions
-- live in their own `net` schema either way — run_push_scheduler is unaffected.)
drop extension if exists pg_net;
create extension pg_net with schema extensions;;
