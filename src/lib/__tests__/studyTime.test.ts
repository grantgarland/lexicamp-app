import { studyTimeParts } from '@/lib/studyTime';

const MIN = 60_000;
const HOUR = 60 * MIN;

describe('studyTimeParts', () => {
  it('reports minutes below an hour', () => {
    expect(studyTimeParts(45 * MIN)).toEqual({ key: 'minutes', hours: 0, minutes: 45 });
  });

  it('splits hours and minutes above one', () => {
    expect(studyTimeParts(18 * HOUR + 40 * MIN)).toEqual({ key: 'hoursMinutes', hours: 18, minutes: 40 });
  });

  it('drops a zero minute remainder rather than printing "3h 0m"', () => {
    expect(studyTimeParts(3 * HOUR)).toEqual({ key: 'hours', hours: 3, minutes: 0 });
  });

  it('rolls 59.6 minutes up into an hour instead of reporting "60m"', () => {
    // Rounding happens on the TOTAL, so the hour/minute split can never be
    // handed a 60 it has to carry itself.
    expect(studyTimeParts(59.6 * MIN)).toEqual({ key: 'hours', hours: 1, minutes: 0 });
  });

  it('refuses to call a sub-minute session "0m"', () => {
    // The tile renders an em dash for a null key. "0m" would read as a bug, and
    // 20 seconds of study is not zero minutes of study — it is unreportable.
    expect(studyTimeParts(20_000).key).toBeNull();
    expect(studyTimeParts(0).key).toBeNull();
  });

  it('treats missing or nonsensical input as nothing to show', () => {
    expect(studyTimeParts(-5).key).toBeNull();
    expect(studyTimeParts(Number.NaN).key).toBeNull();
    expect(studyTimeParts(Number.POSITIVE_INFINITY).key).toBeNull();
  });

  it('keeps minutes in 0–59 so they never collide with the hours field', () => {
    for (const m of [61, 119, 120, 1439, 1440, 5000]) {
      const p = studyTimeParts(m * MIN);
      expect(p.minutes).toBeGreaterThanOrEqual(0);
      expect(p.minutes).toBeLessThan(60);
      expect(p.hours * 60 + p.minutes).toBe(m);
    }
  });
});
