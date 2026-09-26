// Search rate-limit / throttle handling (`26` B15, 2026-09-26).
//
// The `translate` Edge Function answers 429 for two different reasons, and says
// which — plus how long to wait — in its body:
//   { reason: 'rate_limited' | 'service_busy', retryAfterSeconds: number }
//   'rate_limited' = OUR per-user cap (a burst of lookups); 'service_busy' = the
//   global budget or Azure throttling us.
// The app used to collapse both into "Translation is busy" with no end in sight,
// which read as "the core feature is broken". It now shows a live countdown and
// runs the search itself when the countdown ends.
//
// Pure module: no React, no Supabase — every branch is unit-tested.

export type LookupBusyReason = 'rate_limited' | 'service_busy';

/** Thrown by the data source on a 429. `message` stays 'lookup_busy' so every
 *  existing `error.message === 'lookup_busy'` check keeps working. */
export class LookupBusyError extends Error {
  constructor(
    readonly reason: LookupBusyReason,
    /** null when the server did not say (an older deploy) — no countdown then. */
    readonly retryAfterSeconds: number | null,
  ) {
    super('lookup_busy');
    this.name = 'LookupBusyError';
  }
}

/** A countdown longer than this is a server bug, not a real wait: the longest
 *  real window is the per-hour cap. Clamped so the UI can never show days. */
const MAX_RETRY_S = 60 * 60;

/** Read a 429 body. Tolerates older servers (no `reason`/`retryAfterSeconds`,
 *  only `error` text) and anything malformed. */
export function parseBusyBody(body: unknown): { reason: LookupBusyReason; retryAfterSeconds: number | null } {
  const b = (body != null && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const reason: LookupBusyReason =
    b.reason === 'rate_limited' || (b.reason == null && b.error === 'rate limit exceeded') ? 'rate_limited' : 'service_busy';
  const raw = b.retryAfterSeconds;
  const retryAfterSeconds =
    typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.min(Math.ceil(raw), MAX_RETRY_S) : null;
  return { reason, retryAfterSeconds };
}

/** Whole seconds left until `targetMs`, never negative. Ceil, so the display
 *  reads "0:01" until the moment it is actually over, never "0:00" early. */
export function secondsUntil(targetMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
}

/** 75 → "1:15", 9 → "0:09", 3600 → "60:00". */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
