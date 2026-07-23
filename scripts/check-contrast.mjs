#!/usr/bin/env node
/**
 * check-contrast.mjs — WCAG 2.1 AA contrast guard (3.11).
 *
 * Checks the real foreground/background token PAIRS the `src/ui/` kit actually
 * renders (text-on-surface, button labels, badges) against WCAG AA thresholds:
 * 4.5:1 for normal text, 3:1 for large text (≥18pt / ≥14pt bold) and for
 * non-text UI components/graphics. Reads `src/theme/tokens.generated.ts`
 * directly (the single source of truth — see `sync-tokens.mjs`), so it always
 * checks the CURRENT tokens, not a hand-copied snapshot.
 *
 * This is deliberately a curated pair list, not an all-combinations sweep:
 * most color × color combinations in the palette are never actually composed
 * as text-on-background, and flagging those would just be noise. When a new
 * fg/bg combination is introduced in `src/ui/`, add it to PAIRS below.
 *
 * Run: node scripts/check-contrast.mjs   (wired into the pre-commit hook
 * alongside the token-drift guard — runs whenever tokens.generated.ts is staged).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const TOKENS_PATH = path.resolve(appRoot, 'src/theme/tokens.generated.ts');

// ── 1. Load tokens.generated.ts's `tokens` object (JSON-shaped literal) ──────
const src = fs.readFileSync(TOKENS_PATH, 'utf8');
const m = src.match(/export const tokens = (\{[\s\S]*\n\})\s*as const;/);
if (!m) {
  console.error('check-contrast: could not locate `export const tokens = {...} as const;` in tokens.generated.ts');
  process.exit(1);
}
const tokens = JSON.parse(m[1]);
const { color } = tokens;

// ── 2. WCAG relative luminance + contrast ratio (solid hex colors only) ──────
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const int = parseInt(n, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}
function relLuminance([r, g, b]) {
  const chan = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [rl, gl, bl] = [chan(r), chan(g), chan(b)];
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}
function contrastRatio(hexA, hexB) {
  const la = relLuminance(hexToRgb(hexA));
  const lb = relLuminance(hexToRgb(hexB));
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

// ── 3. The real fg/bg pairs the app actually composes ────────────────────────
// Every pair below was verified against a real call site this session (grep
// through src/ui + src/screens), not assumed from naming — an earlier draft
// guessed at "badge text on *Soft background" pairs (accent/warning/success/
// info/brandStrong on their tint) that turned out to not exist anywhere in
// the app (the *Soft tokens are only ever used as borders/tints, never paired
// with matching darker text on top), so those were dropped as noise.
//
// `kind`: 'text' → AA 4.5:1 (body/labels, including bold button labels — none
// of ours currently qualify as "large text" at ≥18pt/≥14pt-bold) · 'ui' → AA
// 3:1 (icons/graphics only, no case in PAIRS currently needs this tier).
const PAIRS = [
  // Body text on the three surface tones (Text component's variant defaults —
  // src/ui/Text.tsx: title/heading/label variants → textStrong, body →
  // textBody, caption/footnote/eyebrow → textMuted).
  { fg: 'textStrong', bg: 'canvas', kind: 'text' },
  { fg: 'textStrong', bg: 'surfaceCard', kind: 'text' },
  { fg: 'textStrong', bg: 'surfaceSunken', kind: 'text' },
  { fg: 'textBody', bg: 'canvas', kind: 'text' },
  { fg: 'textBody', bg: 'surfaceCard', kind: 'text' },
  { fg: 'textBody', bg: 'surfaceSunken', kind: 'text' },
  { fg: 'textMuted', bg: 'canvas', kind: 'text' },
  { fg: 'textMuted', bg: 'surfaceCard', kind: 'text' },
  { fg: 'textMuted', bg: 'surfaceSunken', kind: 'text' },
  // Links.
  { fg: 'textLink', bg: 'canvas', kind: 'text' },
  { fg: 'textLink', bg: 'surfaceCard', kind: 'text' },
  // Solid-fill CTA labels: Button primary/pill + PaywallScreen crest/badge
  // icons all sit on `color.accent` via `textOnAccent` (src/ui/Button.tsx).
  { fg: 'textOnAccent', bg: 'accent', kind: 'text' },
  // Button `destructive` variant — split from textOnAccent in 3.11b (the two
  // only shared a value by coincidence before).
  { fg: 'textOnDanger', bg: 'danger', kind: 'text' },
  // WordRow/SearchScreen solid-brand action buttons + active segments.
  { fg: '#ffffff', bg: 'brand', kind: 'text' },
  // Amber used as TEXT/icon directly on a light card (not a solid fill) — the
  // walkthrough replay link (src/ui/HowItWorksList.tsx) + the About screen's
  // logo star (src/screens/settings/sheets.tsx). Needs the darker
  // `accentStrong` alias; the vivid `accent` fill itself fails here.
  { fg: 'accentStrong', bg: 'surfaceCard', kind: 'text' },
  // Amber sort-direction pill text/icon on its amber-50 tint background
  // (src/screens/WordListScreen.tsx) — a literal palette step, not a `color.*`
  // semantic alias, so referenced by hex directly.
  { fg: 'accentStrong', bg: '#fff5ed', kind: 'text' },
  // Danger as error/validation copy (Input, Auth/Reset/Quiz screens, Settings
  // sheets all render `color.danger` directly as text on these 2 surfaces).
  { fg: 'danger', bg: 'canvas', kind: 'text' },
  { fg: 'danger', bg: 'surfaceCard', kind: 'text' },
];

const AA = { text: 4.5, ui: 3 };

// ── 4. Known, tracked debt ────────────────────────────────────────────────
// Empty as of 3.11b — the 7 gaps 3.11 found were all fixed at the palette
// level (lexicamp-design-system/project/tokens/colors.css: textMuted →
// slate-600, danger → red-600, textOnAccent → slate-900 + new textOnDanger/
// accentStrong aliases) rather than muted here. Kept as a mechanism for
// future gaps that turn out to need a deliberate, tracked design tradeoff
// instead of an immediate fix.
const KNOWN_EXCEPTIONS = [];

let failed = 0;
let excepted = 0;
for (const { fg, bg, kind } of PAIRS) {
  const fgHex = fg.startsWith('#') ? fg : color[fg];
  const bgHex = bg.startsWith('#') ? bg : color[bg];
  if (fgHex == null || bgHex == null) {
    console.error(`check-contrast: unknown token in pair {fg: ${fg}, bg: ${bg}} — a token was renamed/removed; update PAIRS.`);
    failed++;
    continue;
  }
  const ratio = contrastRatio(fgHex, bgHex);
  const min = AA[kind];
  if (ratio >= min) continue;

  const known = KNOWN_EXCEPTIONS.find((e) => e.fg === fg && e.bg === bg);
  if (known && ratio >= known.floor - 0.01) {
    console.warn(
      `check-contrast: known gap  ${fg} (${fgHex}) on ${bg} (${bgHex}) = ${ratio.toFixed(2)}:1, needs ≥${min}:1 (${kind}) — tracked in 08, needs a design-system palette fix, not an app change.`,
    );
    excepted++;
    continue;
  }
  console.error(
    `check-contrast: FAIL  ${fg} (${fgHex}) on ${bg} (${bgHex}) = ${ratio.toFixed(2)}:1, needs ≥${min}:1 (${kind})` +
      (known ? ` — WORSE than the recorded floor of ${known.floor}:1; this regressed.` : ''),
  );
  failed++;
}

if (failed > 0) {
  console.error(`\ncheck-contrast: ${failed} pair(s) below WCAG AA. Fix at the src/ui/ kit layer (all screens compose it).`);
  process.exit(1);
}
console.log(`check-contrast: ${PAIRS.length - excepted}/${PAIRS.length} fg/bg pairs meet WCAG AA ✓ (${excepted} known, tracked gap(s) — see 08-execution-backlog.md 3.11)`);
