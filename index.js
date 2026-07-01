// App entry shim. Guarantees Unistyles is configured (and i18n initialized) BEFORE
// expo-router's require.context evaluates any route module. Route files under app/ are
// required in path-sort order, and `app/(tabs)/…` sorts before `app/_layout.tsx`
// ('(' < '_'), so the layout's own config import runs too late for the first
// stylesheet. Keeping these side-effect imports first fixes the "no theme selected"
// error (and the cascading "missing default export" on the first route).
import './src/theme/unistyles';
import './src/i18n';

import 'expo-router/entry';
