// `26` B15 wiring the unit tests cannot reach: the Edge Function's limits and
// 429 shape, and the app's finished-word + cool-down gates. Read as source, the
// house pattern for supabase/functions/ (see webhookContract.test.ts).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (rel: string) => readFileSync(join(__dirname, '..', '..', '..', rel), 'utf8');

describe('translate rate limits (server)', () => {
  const fn = src('supabase/functions/translate/index.ts');

  it('raises the per-user caps and leaves the global Azure guard alone', () => {
    expect(fn).toMatch(/const RATE_LIMIT_PER_MINUTE = 20;/);
    expect(fn).toMatch(/const RATE_LIMIT_PER_HOUR = 120;/);
    expect(fn).toMatch(/const GLOBAL_LIMIT_PER_HOUR = 600;/);
  });

  it('every 429 says why and for how long, including the Retry-After header', () => {
    expect(fn).toMatch(/\{ 'Retry-After': String\(retryAfterSeconds\) \}/);
    expect(fn).not.toMatch(/json\(\{ error: '(rate limit exceeded|translation service busy)' \}, 429\)/);
    expect(fn).toMatch(/tooMany\('rate_limited', perMinute\)/);
    expect(fn).toMatch(/tooMany\('rate_limited', perHour\)/);
    expect(fn).toMatch(/tooMany\('service_busy', global\)/);
    expect(fn).toMatch(/if \(dict === 'busy'\) return tooMany\('service_busy', AZURE_BUSY_RETRY_S\)/);
    expect(fn).toMatch(/if \(mt === 'busy'\) return tooMany\('service_busy', AZURE_BUSY_RETRY_S\)/);
  });

  it('computes the wait from the lookup that must age out, not simply the oldest', () => {
    expect(fn).toMatch(/\.range\(count - opts\.limit, count - opts\.limit\)/);
  });
});

describe('search lookup gates (app)', () => {
  const screen = src('src/screens/SearchScreen.tsx');

  it('waits for a finished word: a 1s pause, or the Search key at once', () => {
    expect(screen).toMatch(/const LOOKUP_PAUSE_MS = 1000;/);
    expect(screen).toMatch(/onSubmitEditing=\{onSubmit\}/);
    expect(screen).toMatch(/const lookupQ = submittedQ === q \? q : debouncedQ;/);
  });

  it('fires no lookups while cooling down, and retries when the countdown ends', () => {
    expect(screen).toMatch(/!coolingDown && lookupQ === q && verdict\?\.ok === true/);
    expect(screen).toMatch(/if \(wasCooling\.current && !coolingDown\) retryLookup\(\);/);
  });

  it('records the deadline where the 429 arrives, not by copying state in an effect', () => {
    const hooks = src('src/query/hooks.ts');
    expect(hooks).toMatch(/e instanceof LookupBusyError && e\.retryAfterSeconds != null/);
    expect(hooks).toMatch(/useLookupCooldown\.getState\(\)\.start\(/);
  });

  it('the data source turns a 429 into a LookupBusyError built from the body', () => {
    const ds = src('src/data/supabase/SupabaseDataSource.ts');
    expect(ds).toMatch(/context\?\.status === 429/);
    expect(ds).toMatch(/throw new LookupBusyError\(reason, retryAfterSeconds\)/);
  });
});
