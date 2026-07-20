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
 *  it leaves `null` (lastReviewAt / currentPeriodEnd) and non-date strings untouched. */
export function reviveDates(key: string, value: unknown): unknown {
  return typeof value === 'string' && DATE_KEYS.has(key) ? new Date(value) : value;
}
