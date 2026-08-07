// Date revival for the persisted query cache. Domain query results carry real `Date`
// fields (03: dueAt, createdAt, …); JSON persistence stringifies them, so a cold-launch
// rehydrate would hand the derivations ISO strings — e.g. `dueAt.getTime()` throws
// "undefined is not a function" (derive.ts homeSnapshot). This reviver runs as the
// JSON.parse reviver when deserializing from AsyncStorage. Kept pure + side-effect-free
// so it's unit-testable without booting the persistent client.

/** Domain fields that are `Date` on the wire and must be revived after JSON.parse. */
export const DATE_KEYS = new Set(['dueAt', 'lastReviewAt', 'createdAt', 'currentPeriodEnd', 'reviewedAt', 'lastReviewedAt']);

/** JSON.parse reviver: turn known date-field strings back into `Date`. Keyed by field
 *  name (not a blanket ISO sniff) so it never touches React Query's cache envelope, and
 *  it leaves `null` (lastReviewAt / currentPeriodEnd) and non-date strings untouched.
 *
 *  ⚠️ Correct but SLOW at scale — kept for tests and as the reference definition of the
 *  rule. Prefer `reviveDatesInPlace` on the hot path; see its comment for why. */
export function reviveDates(key: string, value: unknown): unknown {
  return typeof value === 'string' && DATE_KEYS.has(key) ? new Date(value) : value;
}

/** Walk a parsed cache payload and convert `DATE_KEYS` string fields to `Date`, in place.
 *
 *  WHY THIS EXISTS (data-perf audit, 2026-08-06). Passing `reviveDates` to `JSON.parse`
 *  applies the SAME rule, but `JSON.parse` invokes a reviver once per NODE in the
 *  document — every field of every card, every array index — not once per date. Measured
 *  at 4,300 saved words: 236,569 invocations to produce 30,100 Dates (13% hit rate), and
 *  96.9 ms of blocked JS thread against 12.7 ms for the same parse without a reviver.
 *  That is a 7.6x tax paid during cold launch, while the splash screen is up.
 *
 *  The reviver's BODY was never the problem — it is a `Set` lookup. Its invocation count
 *  is, and that scales with total JSON nodes (~55 per word), not with how many dates
 *  exist. Parsing plain and walking afterwards costs one cheap pass instead.
 *
 *  Semantics are identical to `reviveDates` (same DATE_KEYS, same string-only rule), and
 *  the guarantee its comment describes is strengthened rather than weakened: an explicit
 *  walk can be pointed at the query payloads alone, so a `dueAt` key appearing inside
 *  React Query's own envelope can never be rewritten.
 *
 *  Mutates and returns `root` — the value has just been parsed from a string and has no
 *  other referent, so copying it would only re-pay the allocation cost this exists to
 *  avoid. */
export function reviveDatesInPlace<T>(root: T): T {
  walk(root, 0);
  return root;
}

/** Depth guard: the persisted payload is query results, not arbitrary user JSON, so real
 *  nesting is shallow (client → queries → state → data → rows → fields ≈ 8). 64 is far
 *  past that while still bounding a pathological or cyclic structure, which would
 *  otherwise blow the stack on a path that runs before any error boundary is mounted. */
const MAX_DEPTH = 64;

function walk(node: unknown, depth: number): void {
  if (node === null || typeof node !== 'object' || depth > MAX_DEPTH) return;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i += 1) walk(node[i], depth + 1);
    return;
  }
  const obj = node as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (typeof v === 'string') {
      // Only own string fields can be dates; skipping the recursive call for them is
      // most of the win, since leaf strings dominate the node count.
      if (DATE_KEYS.has(key)) obj[key] = new Date(v);
    } else if (v !== null && typeof v === 'object') {
      walk(v, depth + 1);
    }
  }
}
