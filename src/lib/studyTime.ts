// "Time invested" formatting for the All-Time grid (2026-08-05).
//
// Returns an i18n KEY + params rather than a finished string: the tile has to
// read "18h 40m" in English and "18 h 40 min" in Spanish, and a formatter that
// concatenates its own unit letters can't do that. The screen calls `t()` with
// what this hands back.

export interface StudyTimeParts {
  /** i18n key under `progress.time.*`, or null when there is nothing to show. */
  key: 'hoursMinutes' | 'hours' | 'minutes' | null;
  hours: number;
  minutes: number;
}

/**
 * Split a duration into the coarsest honest unit.
 *
 * Rounds to the MINUTE and never to zero-with-a-unit: a user who has studied
 * for 20 seconds has not studied for "0m", so anything under a minute reports
 * `null` and the tile falls back to an em dash. Above an hour the minutes are
 * kept only when non-zero, so a clean total reads "3h", not "3h 0m".
 */
export function studyTimeParts(ms: number): StudyTimeParts {
  const none: StudyTimeParts = { key: null, hours: 0, minutes: 0 };
  if (!Number.isFinite(ms) || ms <= 0) return none;

  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 1) return none;
  if (totalMinutes < 60) return { key: 'minutes', hours: 0, minutes: totalMinutes };

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return { key: minutes === 0 ? 'hours' : 'hoursMinutes', hours, minutes };
}
