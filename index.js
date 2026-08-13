// App entry shim.
//
// ⚠️ `./src/observability/sentryInit` MUST STAY THE FIRST IMPORT. Imports are
// hoisted, so whatever sits at the top of this list is the first code that runs
// in the app — and Sentry has to be listening before the modules below it are
// evaluated, or a startup crash in any of them goes unreported. See that file.
import './src/observability/sentryInit';

// Guarantees Unistyles is configured (and i18n initialized) BEFORE
// expo-router's require.context evaluates any route module. Route files under app/ are
// required in path-sort order, and `app/(tabs)/…` sorts before `app/_layout.tsx`
// ('(' < '_'), so the layout's own config import runs too late for the first
// stylesheet. Keeping these side-effect imports first fixes the "no theme selected"
// error (and the cascading "missing default export" on the first route).
import './src/theme/unistyles';
import './src/i18n';

// Offline outbox (2.4): replay queued quiz commits on start/foreground.
import { initOutbox } from './src/data/outboxInit';
// Push (2.5): foreground presentation + tap → deep-link routing.
import { initNotifications } from './src/notifications/push';
// Session reconciliation (2026-08-12): keep the reminder scheduler's device
// inputs — push-token ownership and the profile timezone — true on every
// session start and foreground.
import { initSessionSync } from './src/auth/sessionSync';

import 'expo-router/entry';

initOutbox();
initNotifications();
initSessionSync();
