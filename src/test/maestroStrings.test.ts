// Smoke-strings guard — replaces the manual "no smoke strings touched" check done
// at the end of every build session. Parses the Maestro flows in `.maestro/` at
// test time (so NEW flow assertions are guarded automatically, no list to update)
// and asserts every text selector is still backed by a real renderable string:
// an en.json leaf (templates instantiated), a mock fixture (SMOKE_FIXTURES), or a
// documented derived form (the `<phrase>·es` mock phrase path).
//
// If this test fails, either (a) app copy / a mock fixture changed and the flow
// in `.maestro/` must be updated in the SAME commit (the nightly builds HEAD), or
// (b) a flow gained an assertion on text that doesn't exist — fix the flow.
//
// Matching note: selectors are compiled as CASE-INSENSITIVE regexes here even
// without `(?i)`, because `textTransform: 'uppercase'` means on-screen a11y text
// can differ in case from en.json (the 2026-07-15 nightly failure). Maestro
// itself matches case-SENSITIVELY — this guard checks existence, not case; keep
// using `(?i)` in flows for anything under a transformed style.
import * as fs from 'node:fs';
import * as path from 'node:path';

// Jest provides __dirname (CJS); expo/tsconfig.base doesn't load node GLOBALS
// (only node modules via @types/node), so declare the one global we use.
declare const __dirname: string;

import { SMOKE_FIXTURES } from '@/data/mock';

import en from '../i18n/locales/en.json';

const MAESTRO_DIR = path.resolve(__dirname, '../../.maestro');

// ── Flow parsing ──────────────────────────────────────────────────────────────
// Text-bearing selector keys. `id:` taps, gestures, timeouts etc. are ignored.
const SELECTOR_LINE = /^\s*(?:-\s*)?(assertVisible|visible|tapOn|text):\s*(['"])(.*)\2\s*(?:#.*)?$/;
const INPUT_LINE = /^\s*-\s*inputText:\s*(['"])(.*)\1\s*(?:#.*)?$/;

type Selector = { flow: string; line: number; raw: string };

function flowFiles(): string[] {
  return fs
    .readdirSync(MAESTRO_DIR)
    .filter((f) => f.endsWith('.yaml') && f !== 'config.yaml')
    .sort();
}

function parseFlow(file: string): { selectors: Selector[]; inputs: string[] } {
  const lines = fs.readFileSync(path.join(MAESTRO_DIR, file), 'utf8').split('\n');
  const selectors: Selector[] = [];
  const inputs: string[] = [];
  lines.forEach((l, i) => {
    if (/^\s*#/.test(l)) return; // full-line comment
    const sel = SELECTOR_LINE.exec(l);
    if (sel) selectors.push({ flow: file, line: i + 1, raw: sel[3] });
    const inp = INPUT_LINE.exec(l);
    if (inp) inputs.push(inp[2]);
  });
  return { selectors, inputs };
}

// ── Candidate haystack: every string the app can actually render ─────────────
type Tree = { [k: string]: string | string[] | Tree };

function leaves(tree: Tree, out: string[] = []): string[] {
  for (const v of Object.values(tree)) {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) out.push(...v);
    else leaves(v, out);
  }
  return out;
}

// Values used to instantiate {{templates}}. Counts derive from the mock summit
// distribution (the flows assert the before/after word-count of a delete), so a
// fixture resize fails HERE, not at 3am. Add values as flows grow.
const summitTotal = SMOKE_FIXTURES.DISTRIBUTION.summit.reduce((a, b) => a + b, 0);
const TEMPLATE_PARAMS: Record<string, (string | number)[]> = {
  word: ['melancólico'],
  name: ['melancólico'],
  lang: ['Spanish'],
  count: [summitTotal, summitTotal - 1],
  tier: ['Base Camp'],
};

function instantiate(template: string): string[] {
  const vars = [...template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
  if (vars.length === 0) return [template];
  let results = [template];
  for (const v of new Set(vars)) {
    const values = TEMPLATE_PARAMS[v] ?? ['x'];
    results = results.flatMap((r) => values.map((val) => r.split(`{{${v}}}`).join(String(val))));
  }
  return results;
}

function buildCandidates(inputs: string[]): string[] {
  const out: string[] = [];
  for (const leaf of leaves(en as Tree)) out.push(...instantiate(leaf));
  // Mock lookup fixtures (see SMOKE_FIXTURES export in data/mock.ts).
  for (const w of SMOKE_FIXTURES.WORD_BANK) out.push(w.native, w.target);
  for (const s of SMOKE_FIXTURES.FLY_SENSES) {
    out.push(s.displayTarget);
    for (const b of s.backTranslations) out.push(b.displayText);
  }
  // Mock phrase path fabricates `<phrase>·es`; echo/miss render i18n copy (above).
  for (const i of inputs) out.push(i, `${i}·es`);
  return out;
}

// ── The guard ────────────────────────────────────────────────────────────────
function toRegex(raw: string): RegExp {
  const body = raw.startsWith('(?i)') ? raw.slice(4) : raw;
  // Maestro matches the WHOLE element text against the pattern; mirror that.
  return new RegExp(`^(?:${body})$`, 'i');
}

const flows = flowFiles().map((f) => ({ file: f, ...parseFlow(f) }));
const allInputs = flows.flatMap((f) => f.inputs);
const candidates = buildCandidates(allInputs);

describe('Maestro flow strings are backed by en.json / mock fixtures', () => {
  it('found flows and selectors (guard is actually guarding)', () => {
    expect(flows.map((f) => f.file)).toContain('smoke.yaml');
    expect(flows.flatMap((f) => f.selectors).length).toBeGreaterThan(5);
  });

  it('every flow listed in config.yaml exists', () => {
    const manifest = fs.readFileSync(path.join(MAESTRO_DIR, 'config.yaml'), 'utf8');
    const listed = [...manifest.matchAll(/^\s*-\s*([\w.-]+\.yaml)\s*$/gm)].map((m) => m[1]);
    expect(listed.length).toBeGreaterThan(0);
    for (const f of listed) expect(fs.existsSync(path.join(MAESTRO_DIR, f))).toBe(true);
  });

  for (const { file, selectors } of flows) {
    describe(file, () => {
      for (const sel of selectors) {
        it(`line ${sel.line}: ${JSON.stringify(sel.raw)} matches a renderable string`, () => {
          const re = toRegex(sel.raw);
          const hit = candidates.find((c) => re.test(c));
          if (!hit) {
            throw new Error(
              `No en.json leaf or mock fixture matches ${JSON.stringify(sel.raw)} ` +
                `(${sel.flow}:${sel.line}). Either app copy/fixtures drifted (update the ` +
                `flow in the same commit) or the flow asserts text that no longer exists.`,
            );
          }
          expect(hit).toBeTruthy();
        });
      }
    });
  }
});
