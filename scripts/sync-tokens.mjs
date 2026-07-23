#!/usr/bin/env node
/**
 * sync-tokens.mjs — Lexicamp design-token sync (CSS → TS).
 *
 * Parses the design system's `tokens/*.css` (the single source of truth) and
 * emits `src/theme/tokens.generated.ts` for the RN app (Unistyles theme reads it).
 * Plain Node ESM — no deps. Run:  node scripts/sync-tokens.mjs  [--check]
 *
 * Source path: env TOKENS_DIR, else ../lexicamp-design-system/project/tokens
 * Keeps the app ↔ design system in sync (reconcile to the design system, per 02).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const TOKENS_DIR = process.env.TOKENS_DIR
  || path.resolve(appRoot, '../lexicamp-design-system/project/tokens');
const OUT = path.resolve(appRoot, 'src/theme/tokens.generated.ts');
const CHECK = process.argv.includes('--check');

// ── 1. Read every `--name: value;` across the token files ────────────────────
const FILES = ['colors.css', 'typography.css', 'spacing.css'];
const raw = {}; // name -> raw value (with comments stripped)
for (const f of FILES) {
  const p = path.join(TOKENS_DIR, f);
  const css = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of css.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    raw[m[1]] = m[2].trim();
  }
}

// ── 2. Resolve var() refs and color-mix() to literal values ──────────────────
const hexToRgb = (h) => {
  const x = h.replace('#', '');
  const n = x.length === 3 ? x.split('').map((c) => c + c).join('') : x;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
};
function resolve(val, seen = 0) {
  if (seen > 20) return val;
  // color-mix(in oklab, var(--x) NN%, transparent) -> rgba(x, NN/100)
  const cm = val.match(/color-mix\([^,]+,\s*([^)]+?)\s+(\d+)%\s*,\s*transparent\)/);
  if (cm) {
    const base = resolve(cm[1].trim(), seen + 1);
    const [r, g, b] = hexToRgb(base.startsWith('#') ? base : '#3c7499');
    return `rgba(${r}, ${g}, ${b}, ${(+cm[2] / 100).toFixed(2)})`;
  }
  const v = val.match(/var\(--([\w-]+)\)/);
  if (v && raw[v[1]] != null) return resolve(val.replace(v[0], raw[v[1]]), seen + 1);
  return val;
}
const lit = {};
for (const k of Object.keys(raw)) lit[k] = resolve(raw[k]);

// ── 3. Categorize into a structured object ───────────────────────────────────
const camel = (s) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const num = (s) => parseFloat(s); // strips px/ms units
const palette = {};
const color = {};
const font = { family: {}, size: {}, weight: {}, leading: {}, tracking: {} };
const space = {};
const radius = {};
const borderWidth = {};
const shadow = {};
const motion = { easing: {}, duration: {}, z: {} };

for (const [k, v] of Object.entries(lit)) {
  let m;
  if ((m = k.match(/^(blue|green|amber|slate|red|pika)-(\d+)$/))) {
    (palette[m[1]] ||= {})[m[2]] = v;
  } else if ((m = k.match(/^font-(serif|sans|mono)$/))) {
    font.family[m[1]] = (v.match(/"([^"]+)"/) || [, v])[1]; // first quoted family
  } else if (k.startsWith('text-') && /px$/.test(v)) {
    // type scale only (`--text-md: 16px`). `--text-strong` etc. are colors → fall through.
    font.size[k.slice(5)] = num(v);
  } else if ((m = k.match(/^weight-(\w+)$/))) {
    font.weight[m[1]] = String(num(v));
  } else if ((m = k.match(/^leading-(\w+)$/))) {
    font.leading[m[1]] = num(v);
  } else if ((m = k.match(/^tracking-(\w+)$/))) {
    font.tracking[m[1]] = parseFloat(v); // em value (see theme.ts note)
  } else if ((m = k.match(/^space-(\d+)$/))) {
    space[m[1]] = num(v);
  } else if ((m = k.match(/^radius-(\w+)$/))) {
    radius[m[1]] = num(v);
  } else if ((m = k.match(/^border-(thin|base|thick)$/))) {
    borderWidth[m[1]] = num(v);
  } else if ((m = k.match(/^shadow-(\w+)$/))) {
    shadow[m[1]] = v; // CSS box-shadow string (RN New-Arch `boxShadow` style prop)
  } else if ((m = k.match(/^ease-(\w[\w-]*)$/))) {
    motion.easing[camel(m[1])] = v;
  } else if ((m = k.match(/^dur-(\w+)$/))) {
    motion.duration[m[1]] = num(v);
  } else if ((m = k.match(/^z-(\w+)$/))) {
    motion.z[m[1]] = num(v);
  } else if (!/^font-(display|heading|body|reading|numeric)$/.test(k)) {
    // remaining = semantic colors / surfaces / overlays / skeleton
    color[camel(k)] = v;
  }
}

// ── 4. Dark-mode semantic overrides (colors.dark.css) ────────────────────────
// The dark file redefines ONLY the semantic aliases (surfaces/text/status/etc.);
// the base palette scales are theme-independent and stay in `palette`. var()/
// color-mix() refs resolve against the dark map first, then fall back to the
// base scales from colors.css. Emitted as `colorDark`, same keys as `color`.
const DARK_FILE = 'colors.dark.css';
const colorDark = {};
{
  const dp = path.join(TOKENS_DIR, DARK_FILE);
  if (fs.existsSync(dp)) {
    const dcss = fs.readFileSync(dp, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rawDark = {};
    for (const m of dcss.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) rawDark[m[1]] = m[2].trim();
    const lookup = { ...raw, ...rawDark }; // dark overrides base; base provides the scales
    const resolveDark = (val, seen = 0) => {
      if (seen > 20) return val;
      const cm = val.match(/color-mix\([^,]+,\s*([^)]+?)\s+(\d+)%\s*,\s*transparent\)/);
      if (cm) {
        const b = resolveDark(cm[1].trim(), seen + 1);
        const [r, g, bl] = hexToRgb(b.startsWith('#') ? b : '#3c7499');
        return `rgba(${r}, ${g}, ${bl}, ${(+cm[2] / 100).toFixed(2)})`;
      }
      const v = val.match(/var\(--([\w-]+)\)/);
      if (v && lookup[v[1]] != null) return resolveDark(val.replace(v[0], lookup[v[1]]), seen + 1);
      return val;
    };
    for (const [k, v] of Object.entries(rawDark)) {
      if (/^(blue|green|amber|slate|red|pika)-\d+$/.test(k)) continue; // scales only in `palette`
      colorDark[camel(k)] = resolveDark(v);
    }
    // Fail loudly if the dark set drifts from the light semantic set (missing/extra keys).
    const lightKeys = Object.keys(color).sort();
    const darkKeys = Object.keys(colorDark).sort();
    const missing = lightKeys.filter((k) => !(k in colorDark));
    const extra = darkKeys.filter((k) => !(k in color));
    if (missing.length || extra.length) {
      console.error(
        `✗ colors.dark.css is out of sync with colors.css semantic aliases.\n` +
          (missing.length ? `  missing in dark: ${missing.join(', ')}\n` : '') +
          (extra.length ? `  extra in dark:   ${extra.join(', ')}\n` : ''),
      );
      process.exit(1);
    }
  }
}

// ── 5. Emit TS ───────────────────────────────────────────────────────────────
const emit = { palette, color, font, space, radius, borderWidth, shadow, motion };
if (Object.keys(colorDark).length) emit.colorDark = colorDark;
const out = `// AUTO-GENERATED by scripts/sync-tokens.mjs — DO NOT EDIT.
// Source of truth: lexicamp-design-system/project/tokens/*.css
// Regenerate:  node scripts/sync-tokens.mjs
/* eslint-disable */

export const tokens = ${JSON.stringify(emit, null, 2)} as const;

export type Tokens = typeof tokens;
`;

if (CHECK) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (cur !== out) {
    console.error('✗ tokens.generated.ts is out of date — run: node scripts/sync-tokens.mjs');
    process.exit(1);
  }
  console.log('✓ tokens.generated.ts up to date');
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out);
  console.log(`✓ wrote ${path.relative(appRoot, OUT)} (${Object.keys(lit).length} tokens)`);
}
