// App entry shim. Guarantees Unistyles is configured (and i18n initialized) BEFORE
// expo-router's require.context evaluates any route module. Route files under app/ are
// required in path-sort order, and `app/(tabs)/…` sorts before `app/_layout.tsx`
// ('(' < '_'), so the layout's own config import runs too late for the first
// stylesheet. Keeping these side-effect imports first fixes the "no theme selected"
// error (and the cascading "missing default export" on the first route).
import './src/theme/unistyles';
import './src/i18n';

// Crash reporting (CI-3). No-op in dev or until EXPO_PUBLIC_SENTRY_DSN /
// extra.sentryDsn is configured — see src/observability/sentry.ts.
import { initSentry } from './src/observability/sentry';
// Offline outbox (2.4): replay queued quiz commits on start/foreground.
import { initOutbox } from './src/data/outboxInit';
// Push (2.5): foreground presentation + tap → deep-link routing.
import { initNotifications } from './src/notifications/push';

import 'expo-router/entry';

initSentry();
initOutbox();
initNotifications();
