// Drift tripwire for the analytics allowlist (3.4, extended by 3.1).
//
// `SupabaseDataSource.logEvent` drops any event name not in `CLIENT_EVENTS` and
// returns — loudly in dev, SILENTLY in production. That makes a missing entry
// invisible in exactly the build that matters: the emit compiles, runs, and
// writes nothing. It is not hypothetical. Stage A shipped four purchase emits
// (`paywall_purchase_succeeded`, `paywall_purchase_cancelled`,
// `paywall_restore`, `entitlement_mirror_lag`) against a list that still held
// only 3.4's five names, so the funnel — including the one signal that would
// reveal a broken webhook — reported nothing at all.
//
// So the comment "add the name here too" is not enough. This suite parses the
// allowlist out of the DataSource source and every literal `logEvent(...)` call
// site out of `src/`, and fails CI when they separate. Same approach as
// captureGateParity.test.ts: the mirror is enforced, not requested.
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', '..', '..');
const DATA_SOURCE = join(SRC, 'data/supabase/SupabaseDataSource.ts');

/** Every .ts/.tsx under src/, excluding test files. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** The `const CLIENT_EVENTS = [...]` literal, as declared. */
function allowlist(): string[] {
  const src = readFileSync(DATA_SOURCE, 'utf8');
  const start = src.indexOf('const CLIENT_EVENTS = [');
  if (start < 0) throw new Error('CLIENT_EVENTS declaration not found in SupabaseDataSource.ts');
  const body = src.slice(start, src.indexOf('];', start));
  return [...body.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]!);
}

/**
 * Event names emitted from a `logEvent(...)` call site.
 *
 * Only the FIRST argument is scanned, so a name in the props object
 * (`{ trigger: 'auto' }`) is not mistaken for an event name — and because that
 * argument can be an expression, every literal inside it counts. The
 * walkthrough emits `completed ? 'walkthrough_completed' : 'walkthrough_skipped'`
 * in one call, and both arms need an allowlist entry.
 */
function emittedNames(src: string): string[] {
  const names: string[] = [];
  const CALL = /\blogEvent\(/g;
  for (let m = CALL.exec(src); m != null; m = CALL.exec(src)) {
    let depth = 0;
    let i = m.index + m[0].length;
    const from = i;
    for (; i < src.length; i++) {
      const c = src[i]!;
      if (c === '(' || c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') depth--;
      else if (c === ')') {
        if (depth === 0) break;
        depth--;
      } else if (c === ',' && depth === 0) break;
    }
    const firstArg = src.slice(from, i);
    names.push(...[...firstArg.matchAll(/'([a-z0-9_]+)'/g)].map((q) => q[1]!));
  }
  return names;
}

describe('client analytics allowlist parity', () => {
  const allowed = allowlist();

  it('parses a non-empty allowlist with no duplicates', () => {
    expect(allowed.length).toBeGreaterThan(0);
    expect(new Set(allowed).size).toBe(allowed.length);
  });

  it('allowlists every event name emitted from app code', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      for (const name of emittedNames(readFileSync(file, 'utf8'))) {
        if (!allowed.includes(name)) offenders.push(`${name} (${file.slice(SRC.length + 1)})`);
      }
    }
    // A name here is an emit that writes nothing in production. Add it to
    // CLIENT_EVENTS in SupabaseDataSource.ts.
    expect(offenders).toEqual([]);
  });

  it('carries the 3.1 purchase funnel, not just 3.4s five', () => {
    // Pinned by name: these are the regression that motivated the suite, and
    // `entitlement_mirror_lag` in particular is the ONLY evidence we would ever
    // get that the webhook is down — both dashboards look healthy without it.
    for (const name of [
      'paywall_viewed',
      'paywall_purchase_succeeded',
      'paywall_purchase_cancelled',
      'paywall_restore',
      'trial_started',
      'entitlement_mirror_lag',
    ]) {
      expect(allowed).toContain(name);
    }
  });

  it('finds the emits it claims to check', () => {
    // Guards the parser itself: if the regex stopped matching, the suite above
    // would pass vacuously on zero call sites, which is the failure mode of
    // every source-scanning test.
    const purchases = readFileSync(join(SRC, 'purchases/usePurchases.ts'), 'utf8');
    expect(emittedNames(purchases).sort()).toEqual([
      'entitlement_mirror_lag',
      'paywall_purchase_cancelled',
      'paywall_purchase_succeeded',
      'paywall_restore',
      'trial_started',
    ]);
    // The ternary call site, both arms, with no props-object leakage.
    const walkthrough = readFileSync(join(SRC, 'tour/walkthrough.tsx'), 'utf8');
    expect(emittedNames(walkthrough).sort()).toEqual([
      'walkthrough_completed',
      'walkthrough_skipped',
      'walkthrough_started',
      'walkthrough_started',
    ]);
  });
});
