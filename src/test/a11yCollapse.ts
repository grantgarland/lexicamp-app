// iOS accessibility-COLLAPSE analysis, for the Maestro guard suites.
//
// The hole this closes (2026-08-04, found by a since-retired screenshot flow):
// `home.studyNow` is a live en.json leaf, referenced by live app source, and
// rendered on screen — the string guard and the orphan guard both passed it.
// The flow still failed on `assertVisible: '(?i)Study now'`, because the text
// renders inside a <Pressable> that sets its own accessibilityLabel. On iOS
// that makes the Pressable ONE accessibility element whose label is the label
// it declared ("Study now. 50 words ready for review. ..."); the child text
// nodes — and any testID on them — never appear in the hierarchy Maestro reads.
//
// So: existence + liveness + rendering are all necessary and still not
// sufficient. A string can be visible to a human and invisible to Maestro.
//
// WHAT COLLAPSES, per RN's iOS implementation:
//   • A node that is an accessibility element AND declares accessibilityLabel.
//   • Pressable / Touchable* default to accessible={true}.
//   • <Text> is an accessibility element by default on iOS (RCTText).
//   • A plain <View> is NOT, unless it passes accessible — so a View with only
//     accessibilityLabel does not collapse, and is not flagged here.
//
// The remedy is always the same and this module's error message says it: put a
// testID on the LABELLED node itself and select by `id:`.
//
// KNOWN BLIND SPOT — labels that cross a component boundary. This is a LEXICAL
// scan: it only sees `t('key')` written inside a collapsing element's JSX. When
// a component takes its label as a PROP and applies accessibilityLabel itself,
// the two halves live in different files and nothing here connects them. Real
// example (2026-08-04): ui/SegmentedPills sets
// `accessibilityLabel={pill.a11yLabel ?? pill.label}` and renders `{pill.label}`
// — a variable, not a t() call — while ProgressScreen passes
// `label: t('progress.proj.viewNext')` from outside any collapsing element. So
// "Next camp" is unmatchable on device and this guard says nothing about it.
// That one was caught by reading the component, not by this file. Closing it
// needs per-component knowledge of which props become accessibilityLabel; until
// then read a green run as "no LOCAL collapse", NOT "every selector is
// reachable".
import * as fs from 'node:fs';
import * as path from 'node:path';

 
// @babel/parser is TRANSITIVE here (via babel-preset-expo), not a declared
// devDependency. Tolerable only because it fails LOUDLY — this require throws
// and the suite goes red — rather than silently degrading to "no collapse
// found, everything passes". Promote it to an explicit devDependency the next
// time package.json is touched.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parse } = require('@babel/parser') as { parse: (src: string, opts: unknown) => AnyNode };

type AnyNode = { type?: string; [k: string]: unknown };

// Elements that are accessibility elements without being asked. Pressable and
// the Touchables set accessible={true} themselves; Text is one on iOS by
// default. RawText/UnistylesText are this app's Text wrappers.
const IMPLICITLY_ACCESSIBLE = new Set([
  'Pressable',
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableWithoutFeedback',
  'TouchableNativeFeedback',
  'Text',
  'RawText',
  'RNText',
  'UnistylesText',
]);

const KEY_CALLEES = new Set(['t', 'translate']);

// Props whose value is ANNOUNCED, not rendered as a text node.
const A11Y_TEXT_PROPS = new Set(['accessibilityLabel', 'accessibilityHint', 'accessibilityValue']);

function walk(node: unknown, visit: (n: AnyNode) => void): void {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const c of node) walk(c, visit);
    return;
  }
  const n = node as AnyNode;
  if (typeof n.type === 'string') visit(n);
  for (const [k, v] of Object.entries(n)) {
    if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments') continue;
    if (v != null && typeof v === 'object') walk(v, visit);
  }
}

function jsxName(node: AnyNode): string {
  const opening = node.openingElement as AnyNode | undefined;
  const name = opening?.name as AnyNode | undefined;
  if (name?.type === 'JSXIdentifier') return String(name.name);
  // <Animated.View> and friends — take the trailing member.
  if (name?.type === 'JSXMemberExpression') return String((name.property as AnyNode)?.name ?? '');
  return '';
}

function attrs(node: AnyNode): AnyNode[] {
  const opening = node.openingElement as AnyNode | undefined;
  return ((opening?.attributes as AnyNode[]) ?? []).filter((a) => a.type === 'JSXAttribute');
}

function attrNamed(node: AnyNode, name: string): AnyNode | undefined {
  return attrs(node).find((a) => String((a.name as AnyNode)?.name) === name);
}

/** Does this JSX element collapse its subtree into one iOS a11y element? */
function collapses(node: AnyNode): boolean {
  if (attrNamed(node, 'accessibilityLabel') == null) return false;
  const accessible = attrNamed(node, 'accessible');
  if (accessible != null) {
    // accessible={false} opts OUT even on a Pressable.
    const v = accessible.value as AnyNode | null;
    if (v?.type === 'JSXExpressionContainer') {
      const e = v.expression as AnyNode;
      return !(e?.type === 'BooleanLiteral' && e.value === false);
    }
    return true; // bare `accessible`
  }
  return IMPLICITLY_ACCESSIBLE.has(jsxName(node));
}

/**
 * The key a collapsing element ANNOUNCES AS ITS WHOLE LABEL, if any.
 *
 * Why this exists (2026-08-06): collapse hides a subtree behind the label the
 * element declares — but when that label IS the same string as the child text,
 * the string is still exposed, just on the parent instead of the child. Real
 * case: ProgressScreen's leaderboard chip renders `🌍 {t('progress.leaders
 * .global')}` inside a Pressable whose accessibilityLabel is exactly
 * `t('progress.leaders.global')`. iOS collapses the chip to one element reading
 * "Global", and `assertVisible: 'Global'` matches it perfectly. Without this,
 * the guard called that selector unmatchable and told the author to add a
 * testID — advice that was not just unnecessary but WRONG about the device.
 *
 * Deliberately strict: only when the attribute value is exactly one `t()` call
 * and nothing else. `accessibilityLabel={`${t('a')}. ${t('b')}`}` announces the
 * CONCATENATION, and Maestro matches WHOLE text, so neither key is reachable on
 * its own — that case must stay flagged.
 */
function soleLabelKey(node: AnyNode): string | null {
  const attr = attrNamed(node, 'accessibilityLabel');
  const value = attr?.value as AnyNode | undefined;
  if (value?.type !== 'JSXExpressionContainer') return null;
  const expr = value.expression as AnyNode;
  const calls = keyCallsIn(expr);
  // Exactly one key call, and it IS the whole expression — not a fragment of a
  // template literal, a ternary, or a concatenation.
  if (calls.length !== 1 || calls[0] !== expr) return null;
  return keyOf(expr);
}

/** i18n keys referenced by `t('x')` / `translate('x')` anywhere under `node`. */
function keyCallsIn(node: unknown): AnyNode[] {
  const out: AnyNode[] = [];
  walk(node, (n) => {
    if (n.type !== 'CallExpression') return;
    const callee = n.callee as AnyNode;
    if (callee?.type !== 'Identifier' && callee?.type !== 'MemberExpression') return;
    const name = callee.type === 'Identifier' ? String(callee.name) : String((callee.property as AnyNode)?.name ?? '');
    if (!KEY_CALLEES.has(name)) return;
    const arg = (n.arguments as AnyNode[])?.[0];
    if (arg?.type === 'StringLiteral') out.push(n);
  });
  return out;
}

function keyOf(call: AnyNode): string {
  return String(((call.arguments as AnyNode[])[0] as AnyNode).value);
}

export type CollapseReport = {
  /** key → every source file where a usage of it is collapsed. */
  collapsedOnly: Map<string, string[]>;
  /** Sanity counter: how many keys the scan saw at all. */
  keysSeen: number;
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== '__tests__' && e.name !== 'test') sourceFiles(full, out);
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

/**
 * Keys whose EVERY rendering site sits inside a collapsing element — i.e. keys
 * no Maestro text selector can ever match. A key rendered in one collapsed spot
 * and one exposed spot is fine and is not reported.
 */
export function analyzeCollapse(srcDir: string): CollapseReport {
  const total = new Map<string, number>();
  const collapsed = new Map<string, { count: number; files: Set<string> }>();

  for (const file of sourceFiles(srcDir)) {
    const code = fs.readFileSync(file, 'utf8');
    let ast: AnyNode;
    try {
      ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    } catch {
      continue; // a file babel can't parse is jest's problem, not this guard's
    }

    // Keys used to BUILD an a11y label are not render sites — they produce the
    // announced string, not a text node. Counting them as render sites is what
    // made the first version of this guard miss `home.studyNow`: the key appears
    // three times in HomeScreen, twice inside the accessibilityLabel and once as
    // the button's visible text, so "every site is collapsed" was false by 2.
    const labelCalls = new Set<AnyNode>();
    walk(ast, (n) => {
      if (n.type !== 'JSXAttribute') return;
      if (!A11Y_TEXT_PROPS.has(String((n.name as AnyNode)?.name))) return;
      for (const call of keyCallsIn(n.value)) labelCalls.add(call);
    });

    for (const call of keyCallsIn(ast)) {
      if (labelCalls.has(call)) continue;
      total.set(keyOf(call), (total.get(keyOf(call)) ?? 0) + 1);
    }

    walk(ast, (n) => {
      if (n.type !== 'JSXElement' || !collapses(n)) return;
      // A child whose key is exactly what this element ANNOUNCES is still
      // reachable — the string moved to the parent, it did not disappear.
      const announced = soleLabelKey(n);
      // Only CHILDREN collapse — and only their real render sites.
      for (const call of keyCallsIn(n.children)) {
        if (labelCalls.has(call)) continue;
        const k = keyOf(call);
        if (k === announced) continue;
        const rec = collapsed.get(k) ?? { count: 0, files: new Set<string>() };
        rec.count += 1;
        rec.files.add(path.relative(path.dirname(srcDir), file));
        collapsed.set(k, rec);
      }
    });
  }

  const collapsedOnly = new Map<string, string[]>();
  for (const [key, rec] of collapsed) {
    if (rec.count >= (total.get(key) ?? 0)) collapsedOnly.set(key, [...rec.files].sort());
  }
  return { collapsedOnly, keysSeen: total.size };
}
