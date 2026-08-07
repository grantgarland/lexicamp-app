// Smoke-strings guard — replaces the manual "no smoke strings touched" check done
// at the end of every build session. Parses the Maestro flows in `.maestro/` at
// test time (so NEW flow assertions are guarded automatically, no list to update)
// and asserts every text selector is still backed by a real renderable string:
// an en.json leaf (templates instantiated), a mock fixture (SMOKE_FIXTURES), or a
// documented derived form (the `<phrase>·es` mock phrase path).
//
// RENDERED, not raw (2026-07-27): fixture-derived candidates must be built with
// the same helpers the UI uses — `senseDisplayWord` for lookup senses. Feeding
// this guard a raw field the screen never prints is how it green-lit
// `assertVisible: 'mosca'` against a row that reads "la mosca".
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

import { analyzeCollapse } from './a11yCollapse';
import { senseDisplayWord } from '@/domain/translation';

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
type Leaf = { key: string; text: string };

// Key-AWARE walk (2026-08-03). The old version returned bare strings, which is
// what let an orphaned leaf back a live flow selector — see the orphan-leaf
// guard at the bottom of this file.
function leaves(tree: Tree, prefix = '', out: Leaf[] = []): Leaf[] {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.push({ key, text: v });
    else if (Array.isArray(v)) v.forEach((x, i) => out.push({ key: `${key}.${i}`, text: x }));
    else leaves(v as Tree, key, out);
  }
  return out;
}

// Values used to instantiate {{templates}}. Counts derive from the mock summit
// distribution (the flows assert the before/after word-count of a delete), so a
// fixture resize fails HERE, not at 3am. Add values as flows grow.
const summitTotal = SMOKE_FIXTURES.DISTRIBUTION.summit.reduce((a, b) => a + b, 0);
// Per-tier counts, in registry order [bc, abc, hc, sr, summit]. `.maestro/
// word-list.yaml` filters to one tier and asserts the resulting header count,
// so the whole row is a candidate rather than just the total.
const summitPerTier = [...SMOKE_FIXTURES.DISTRIBUTION.summit];
const TEMPLATE_PARAMS: Record<string, (string | number)[]> = {
  word: ['melancólico', 'melancholic'],
  // `name` is both a word name and a DECK name (wordList.deckCreated /
  // deleteDeckTitle / deckDeleted). 'Zeta' is the literal name
  // .maestro/decks.yaml creates — keep the two in step, or that flow's
  // selectors fall back to matching the generic `.*` and stop being guarded.
  name: ['melancólico', 'Zeta'],
  // Decks the same flow taps; the fixture names come from DECK_FIXTURES, so a
  // rename there fails HERE rather than on the device.
  deck: [...SMOKE_FIXTURES.DECK_NAMES, 'Zeta'],
  lang: ['Spanish'],
  // Word counts (delete: 60 → 59), deck counts (create: 3 → 4), and 1 for the
  // picker's "(N selected)". Both count families are fixture-DERIVED on purpose:
  // resizing WORD_BANK/DISTRIBUTION or DECK_FIXTURES must fail this guard.
  count: [
    summitTotal,
    summitTotal - 1,
    ...summitPerTier,
    SMOKE_FIXTURES.DECK_COUNT,
    SMOKE_FIXTURES.DECK_COUNT + 1,
    1,
    // Quiz-length presets (settings/sheets QUIZ_OPTIONS) — `.maestro/
    // settings.yaml` switches between them and asserts the row subtitle. Listed
    // explicitly rather than relied on: they only happened to be covered because
    // the summit tier counts include 10 and 20, which is a coincidence a
    // DISTRIBUTION edit would silently remove.
    10,
    20,
  ],
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

// en.json leaves, templates instantiated, each still carrying its dotted key.
const enLeaves: Leaf[] = leaves(en as Tree).flatMap(({ key, text }) => instantiate(text).map((x) => ({ key, text: x })));

// Fixture-derived strings have no i18n key and are exempt from the orphan guard:
// they come from data/mock.ts, which the flows exercise directly.
function buildFixtureCandidates(inputs: string[]): string[] {
  const out: string[] = [];
  // Mock lookup fixtures (see SMOKE_FIXTURES export in data/mock.ts).
  for (const w of SMOKE_FIXTURES.WORD_BANK) {
    out.push(w.native, w.target);
    // The RENDERED form of a word-picker row (2026-08-06). The picker's
    // ListItem uses `subtitleInline`, which puts title and subtitle in ONE
    // <Text> separated by a space — so iOS merges the row into a single element
    // whose name ends "…melancholic melancólico" (the tier badge merges in
    // ahead of it). `.maestro/decks.yaml` selects on that tail; it is
    // fixture-backed with no i18n key, exactly like senseDisplayWord below.
    out.push(`${w.target} ${w.native}`);
  }
  // Deck names render as bare row titles (DeckRow / the Add-to-Deck ListItems),
  // so they are renderable strings with no i18n key — same class as WORD_BANK.
  // Without this, `.maestro/decks.yaml`'s 'Travel.*' only passed by accident:
  // the flow also TYPES "Travel", and typed inputs are candidates too.
  for (const n of SMOKE_FIXTURES.DECK_NAMES) out.push(n);
  for (const s of SMOKE_FIXTURES.FLY_SENSES) {
    out.push(senseDisplayWord(s));
    for (const b of s.backTranslations) out.push(b.displayText);
  }
  // The usage example, composed the way TranslationCard renders it: prefix +
  // term + suffix, one <Text> per side. `.maestro/word-capture.yaml` asserts the
  // target sentence after tapping "Show example sentence", so an edit to the
  // fixture has to fail here rather than on the device.
  const ex = SMOKE_FIXTURES.FLY_EXAMPLE;
  out.push(`${ex.sourcePrefix}${ex.sourceTerm}${ex.sourceSuffix}`);
  out.push(`${ex.targetPrefix}${ex.targetTerm}${ex.targetSuffix}`);
  // Walkthrough tooltip controls (2026-08-06). The tour's buttons are rendered
  // by @wrack/react-native-tour-guide, which COMPOSES each one's
  // accessibilityLabel from our en.json strings plus its own English connective
  // ("Next, go to step 3"). Since the Pressable declares that label, it is the
  // text iOS exposes — so `.maestro/walkthrough.yaml` has to select on the
  // composed form, and these are the only strings in the suite that are
  // half-ours, half-library. Mirrors Tooltip.tsx; if the library's wording
  // changes on an upgrade, that flow goes red and this is the line to fix.
  const w = (en as Tree).walkthrough as Record<string, string>;
  out.push(`${w.skip} tour`, `${w.back}, go to previous step`, `${w.done}, finish tour`);
  for (let step = 2; step <= 12; step += 1) out.push(`${w.next}, go to step ${step}`);
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
const fixtureCandidates = buildFixtureCandidates(allInputs);
const candidates = [...enLeaves.map((l) => l.text), ...fixtureCandidates];

// ── Is the key still USED? (2026-08-03 — the "You are here" hole) ────────────
// The failure this closes: the 2026-07-30 Progress redesign deleted the card
// that rendered `progress.youAreHere` but left the leaf in en.json, so the guard
// above found a match and passed while `.maestro/smoke.yaml` asserted a string
// the app rendered NOWHERE. Existence in the locale file is not evidence of
// renderability once copy is retired.
//
// Honest scope: this proves the key is still referenced from app source
// SOMEWHERE. It does NOT prove the screen the flow taps to renders it — that
// needs a render, which maestroScreens.test.tsx does for the smoke screens.
const SRC_DIR = path.resolve(__dirname, '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    // Test code references retired keys on purpose (ProgressScreen.test.tsx
    // asserts youAreHere is ABSENT) — counting it would defeat the guard.
    if (e.isDirectory()) {
      if (e.name !== '__tests__' && e.name !== 'test') sourceFiles(full, out);
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

const SOURCE = sourceFiles(SRC_DIR)
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n');

// Static form: t('a.b.c') / i18n.t("a.b.c") / translate('a.b.c').
// `\b(?:translate|t)\(` cannot match `format(`, `assert(` or `it(` — those have a
// word char immediately before the `t`.
// ⚠️ `translate` is load-bearing, not decoration: src/ui/QuizCard.tsx (and any
// component taking the translator as a prop) calls it under that name. Scanning
// for `t(` alone marked every such key DEAD, which turned this guard into a
// false-positive generator — it failed a flow for asserting "Reveal" while
// quizCard.reveal was very much live (2026-08-04). If another alias appears,
// add it here.
const KEY_CALL = /\b(?:translate|t)\(\s*['"]([\w.-]+)['"]/g;
const KEY_CALL_DYNAMIC = /\b(?:translate|t)\(\s*`([\w.-]*?)\$\{/g;
const usedKeys = new Set([...SOURCE.matchAll(KEY_CALL)].map((m) => m[1]));
// Dynamic form: t(`tier.${id}.name`). Only the static head is knowable, so the
// whole subtree under it is treated as used.
const usedPrefixes = [...SOURCE.matchAll(KEY_CALL_DYNAMIC)].map((m) => m[1]).filter((p) => p.length > 0);

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function keyIsLive(key: string): boolean {
  const base = key.replace(PLURAL_SUFFIX, ''); // t('x.subtitle', {count}) → x.subtitle_other
  const parent = base.replace(/\.\d+$/, ''); // array leaves are read via their parent key
  return usedKeys.has(key) || usedKeys.has(base) || usedKeys.has(parent) || usedPrefixes.some((p) => key.startsWith(p));
}

describe('flow selectors are backed by copy the app still renders', () => {
  it('the key scanner actually found usage (guard is guarding)', () => {
    expect(usedKeys.size).toBeGreaterThan(50);
    expect(keyIsLive('progress.fullRoute')).toBe(true); // a key in live use
    expect(keyIsLive('progress.youAreHere')).toBe(false); // the retired one
    // Regression: keys reached through the `translate` alias (QuizCard) are live.
    expect(keyIsLive('quizCard.reveal')).toBe(true);
  });

  for (const { file, selectors } of flows) {
    describe(file, () => {
      for (const sel of selectors) {
        it(`line ${sel.line}: ${JSON.stringify(sel.raw)} is not backed only by a retired key`, () => {
          const re = toRegex(sel.raw);
          // Fixture-backed selectors carry no i18n key; the guard above covers them.
          if (fixtureCandidates.some((c) => re.test(c))) return;
          const backing = enLeaves.filter((l) => re.test(l.text));
          if (backing.length > 0 && !backing.some((l) => keyIsLive(l.key))) {
            throw new Error(
              `${JSON.stringify(sel.raw)} (${sel.flow}:${sel.line}) is backed ONLY by en.json ` +
                `key(s) no app source references: ${JSON.stringify([...new Set(backing.map((l) => l.key))])}. ` +
                `The copy was retired from the UI but left in the locale file — the flow asserts ` +
                `a string nothing renders. Update the flow (and delete the dead key).`,
            );
          }
          expect(backing.length === 0 || backing.some((l) => keyIsLive(l.key))).toBe(true);
        });
      }
    });
  }
});

describe('Maestro flow strings are backed by en.json / mock fixtures', () => {
  it('found flows and selectors (guard is actually guarding)', () => {
    expect(flows.map((f) => f.file)).toContain('smoke.yaml');
    expect(flows.flatMap((f) => f.selectors).length).toBeGreaterThan(5);
  });

  it('senses with a determiner are asserted in their rendered form, never bare', () => {
    const bare = SMOKE_FIXTURES.FLY_SENSES.filter((s) => s.prefixWord).map((s) => s.displayTarget);
    expect(bare.length).toBeGreaterThan(0); // fixture still exercises this case
    for (const raw of flows.flatMap((f) => f.selectors)) {
      expect(bare).not.toContain(raw.raw);
    }
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


// ── Is the text REACHABLE by a text selector? (2026-08-04) ───────────────────
// The third way a live, rendered string can still be unassertable: it renders
// inside an element that declares its own accessibilityLabel. iOS collapses
// that subtree into ONE accessibility element carrying the declared label, so
// the child text nodes — and any testID on them — are absent from the hierarchy
// Maestro reads. A since-retired screenshot flow burned a device run on
// `'(?i)Study now'` for exactly this: the string is in en.json, referenced by
// HomeScreen, and plainly visible in the screenshot of the failure.
//
// See src/test/a11yCollapse.ts for which elements collapse and why.
const collapse = analyzeCollapse(SRC_DIR);

describe('flow text selectors are not aimed at a11y-collapsed text', () => {
  it('the collapse scan parsed the app (guard is guarding)', () => {
    expect(collapse.keysSeen).toBeGreaterThan(50);
    // The case that motivated the suite: HomeScreen's study card declares its
    // own accessibilityLabel, so the "Study now" text inside it is unreachable.
    // If this flips to false the analyzer has stopped seeing collapse and every
    // assertion below is vacuously green.
    expect(collapse.collapsedOnly.has('home.studyNow')).toBe(true);
    // And the control: ordinary copy under no a11y label stays reachable.
    expect(collapse.collapsedOnly.has('progress.fullRoute')).toBe(false);
    // 2026-08-06: text inside a collapsing element whose OWN label is that same
    // key is still reachable — iOS exposes it on the parent. ProgressScreen's
    // leaderboard chip renders `🌍 {t(...global)}` inside a Pressable labelled
    // exactly `t(...global)`, and 'Global' matches it on device. Before
    // a11yCollapse.soleLabelKey this was a false positive that told the author
    // to add a testID they did not need.
    expect(collapse.collapsedOnly.has('progress.leaders.global')).toBe(false);
    // The strict half of that rule: home.studyNow's label CONCATENATES several
    // keys, so nothing in it is reachable whole — it must stay flagged (it is,
    // via the assertion above).
  });

  for (const { file, selectors } of flows) {
    describe(file, () => {
      for (const sel of selectors) {
        it(`line ${sel.line}: ${JSON.stringify(sel.raw)} targets text iOS actually exposes`, () => {
          const re = toRegex(sel.raw);
          if (fixtureCandidates.some((c) => re.test(c))) return; // fixture text, no key
          const backing = [...new Set(enLeaves.filter((l) => re.test(l.text)).map((l) => l.key))];
          if (backing.length === 0) return; // the existence guard owns this case
          const unreachable = backing.filter((k) => collapse.collapsedOnly.has(k));
          if (unreachable.length === backing.length) {
            throw new Error(
              `${JSON.stringify(sel.raw)} (${sel.flow}:${sel.line}) matches only key(s) ` +
                `${JSON.stringify(unreachable)}, and EVERY render site of those keys sits inside an ` +
                `element that declares its own accessibilityLabel ` +
                `(${JSON.stringify(unreachable.flatMap((k) => collapse.collapsedOnly.get(k) ?? []))}). ` +
                `On iOS that subtree collapses into one accessibility element, so no text selector ` +
                `can ever match — the string is visible to a human and invisible to Maestro. ` +
                `Put a testID on the LABELLED element itself and select it with \`id:\`.`,
            );
          }
          expect(unreachable.length).toBeLessThan(backing.length);
        });
      }
    });
  }
});
