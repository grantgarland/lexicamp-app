// en/es locale parity — replaces the manual "i18n parity verified" check done at
// the end of every build session. Fails if either locale is missing keys the other
// has, if leaf types disagree, or if any string is empty. Reads the JSON directly
// (no i18n/native imports) so it stays a pure node test.
import en from '../locales/en.json';
import es from '../locales/es.json';

// Leaves are strings or string arrays (e.g. date.days/months).
type Tree = { [k: string]: string | string[] | Tree };

const isLeaf = (v: Tree[string]): v is string | string[] => typeof v === 'string' || Array.isArray(v);

/** Flatten {a:{b:'x'}} → 'a.b'; records leaf kind ('string' | 'array:N') for comparison. */
function flatten(tree: Tree, prefix = '', out: Map<string, string> = new Map()): Map<string, string> {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(key, 'string');
    else if (Array.isArray(v)) out.set(key, `array:${v.length}`);
    else flatten(v, key, out);
  }
  return out;
}

const enKeys = flatten(en as Tree);
const esKeys = flatten(es as Tree);

describe('i18n locale parity (en ↔ es)', () => {
  it('es has every en key', () => {
    const missing = [...enKeys.keys()].filter((k) => !esKeys.has(k));
    expect(missing).toEqual([]);
  });

  it('en has every es key (no orphaned es keys)', () => {
    const orphaned = [...esKeys.keys()].filter((k) => !enKeys.has(k));
    expect(orphaned).toEqual([]);
  });

  it('leaf kinds match (string vs array-of-N — catches a dropped weekday/month)', () => {
    const mismatched = [...enKeys.entries()]
      .filter(([k, kind]) => esKeys.has(k) && esKeys.get(k) !== kind)
      .map(([k]) => k);
    expect(mismatched).toEqual([]);
  });

  it('no locale contains empty strings', () => {
    const emptyIn = (tree: Tree, name: string): string[] => {
      const empties: string[] = [];
      const walk = (t: Tree, prefix: string) => {
        for (const [k, v] of Object.entries(t)) {
          const key = prefix ? `${prefix}.${k}` : k;
          if (isLeaf(v)) {
            const values = typeof v === 'string' ? [v] : v;
            if (values.some((s) => s.trim() === '')) empties.push(`${name}:${key}`);
          } else walk(v, key);
        }
      };
      walk(tree, '');
      return empties;
    };
    expect([...emptyIn(en as Tree, 'en'), ...emptyIn(es as Tree, 'es')]).toEqual([]);
  });

  it('locales are non-trivial (guard against a truncated JSON landing silently)', () => {
    expect(enKeys.size).toBeGreaterThan(50);
    expect(esKeys.size).toBe(enKeys.size);
  });

  // Casey, 2026-08-03: "sense" is OUR word for a dictionary meaning. It is all
  // over the code and that is fine, but a user has no idea what it means, so it
  // must never reach the screen. Checks VALUES only — key names like
  // `quiz.senseHint` are ours to name.
  it('no user-facing string uses the word "sense" (or its es equivalents)', () => {
    const banned = /\bsenses?\b|\bsentidos?\b|\bacepci[oó]n(es)?\b/i;
    const hits: string[] = [];
    const walk = (t: Tree, name: string, prefix: string) => {
      for (const [k, v] of Object.entries(t)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (isLeaf(v)) {
          const values = typeof v === 'string' ? [v] : v;
          values.filter((str) => banned.test(str)).forEach((str) => hits.push(`${name}:${key} — ${str}`));
        } else walk(v, name, key);
      }
    };
    walk(en as Tree, 'en', '');
    walk(es as Tree, 'es', '');
    expect(hits).toEqual([]);
  });
});
