// `26` B15: the search cool-down. Every branch of the 429 parsing and the
// countdown arithmetic, because a wrong number here is a countdown that lies.
import { formatCountdown, LookupBusyError, parseBusyBody, secondsUntil } from '../lookupBusy';

describe('parseBusyBody', () => {
  it('reads the new server shape', () => {
    expect(parseBusyBody({ error: 'rate limit exceeded', reason: 'rate_limited', retryAfterSeconds: 42 })).toEqual({
      reason: 'rate_limited',
      retryAfterSeconds: 42,
    });
    expect(parseBusyBody({ reason: 'service_busy', retryAfterSeconds: 30 })).toEqual({ reason: 'service_busy', retryAfterSeconds: 30 });
  });

  it('tolerates an older server: no fields → reason from the error text, no countdown', () => {
    expect(parseBusyBody({ error: 'rate limit exceeded' })).toEqual({ reason: 'rate_limited', retryAfterSeconds: null });
    expect(parseBusyBody({ error: 'translation service busy' })).toEqual({ reason: 'service_busy', retryAfterSeconds: null });
  });

  it('treats garbage as "busy, no countdown" rather than throwing', () => {
    for (const body of [null, undefined, 'nope', 42, [], {}]) {
      expect(parseBusyBody(body)).toEqual({ reason: 'service_busy', retryAfterSeconds: null });
    }
  });

  it('rejects non-positive / non-finite waits and clamps absurd ones to an hour', () => {
    expect(parseBusyBody({ reason: 'rate_limited', retryAfterSeconds: 0 }).retryAfterSeconds).toBeNull();
    expect(parseBusyBody({ reason: 'rate_limited', retryAfterSeconds: -5 }).retryAfterSeconds).toBeNull();
    expect(parseBusyBody({ reason: 'rate_limited', retryAfterSeconds: Infinity }).retryAfterSeconds).toBeNull();
    expect(parseBusyBody({ reason: 'rate_limited', retryAfterSeconds: '30' }).retryAfterSeconds).toBeNull();
    expect(parseBusyBody({ reason: 'rate_limited', retryAfterSeconds: 999_999 }).retryAfterSeconds).toBe(3600);
    expect(parseBusyBody({ reason: 'rate_limited', retryAfterSeconds: 12.2 }).retryAfterSeconds).toBe(13);
  });
});

describe('LookupBusyError', () => {
  it("keeps message 'lookup_busy' so existing checks still classify it", () => {
    const e = new LookupBusyError('rate_limited', 10);
    expect(e.message).toBe('lookup_busy');
    expect(e).toBeInstanceOf(Error);
  });
});

describe('countdown arithmetic', () => {
  it('rounds UP, so the display never reads 0:00 before the wait is actually over', () => {
    expect(secondsUntil(10_001, 0)).toBe(11);
    expect(secondsUntil(10_000, 0)).toBe(10);
    expect(secondsUntil(1, 0)).toBe(1);
    expect(secondsUntil(0, 0)).toBe(0);
    expect(secondsUntil(0, 5_000)).toBe(0); // never negative
  });

  it('formats m:ss', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(9)).toBe('0:09');
    expect(formatCountdown(75)).toBe('1:15');
    expect(formatCountdown(3600)).toBe('60:00');
  });
});
