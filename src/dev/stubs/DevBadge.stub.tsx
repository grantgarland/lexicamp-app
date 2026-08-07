// Production stand-in for `src/dev/DevBadge.tsx`.
//
// Metro substitutes this file for the real badge in every non-dev bundle — see
// `metro/excludedModules.js` for why the `__DEV__` guard at the call site is not
// enough on its own. Nothing imports this directly; the swap happens at
// resolution time, so `import { DevBadge } from '@/dev/DevBadge'` lands here.
//
// It must keep the real module's export shape (a named `DevBadge` component).
// Rendering `null` rather than throwing is deliberate: if the runtime guard in
// `src/app/_layout.tsx` is ever removed, a production build should quietly show
// nothing, not crash.
export function DevBadge(): null {
  return null;
}
