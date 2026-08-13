// Side-effect module: starts Sentry. Import this FIRST in `index.js`, above
// every other import.
//
// ⚠️ WHY THIS FILE EXISTS AT ALL. `index.js` used to end with a bare
// `initSentry()` call placed after `import 'expo-router/entry'`. That reads like
// "init Sentry last", but it is worse than that: **ES import declarations are
// hoisted and fully evaluated before ANY statement in the module body runs.** So
// the real order was — unistyles, i18n, the entire expo-router route graph, the
// outbox, push, session sync — and only then Sentry. Every one of those modules
// could throw during evaluation with no handler attached, which is precisely the
// class of crash (a startup crash, on a user's device, that you cannot
// reproduce) that crash reporting exists to catch.
//
// Making it an import moves the call INTO the hoisted set, and being first in
// the list makes it the first one evaluated. The unistyles/i18n ordering
// constraint documented in `index.js` is unaffected: those two still precede
// `expo-router/entry`, which is all they ever required.
import { initSentry } from './sentry';

initSentry();
