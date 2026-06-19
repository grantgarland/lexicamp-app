/**
 * Lexicamp Design Tokens
 *
 * Single source of truth for palette, type, and spacing.
 * Synced from lexicamp-design-system/tokens/ — 2026-06-19.
 * Mirror structure in colors.json for SEO site (CSS).
 *
 * Palette:
 *   blue    — ice/slate blue; primary brand, UI, sky/altitude
 *   green   — evergreen; progress, success, nature
 *   amber   — bright autumnal orange; accent, energy, CTAs
 *   slate   — cool neutral; surfaces, borders, text
 *   pika    — golden mascot color; illustration elements only
 */

export const colors = {
  // ── Ice / Slate Blue (primary brand) ─────────────────────────────────────
  blue: {
    50:  '#eef4f8',
    100: '#d7e6f0',
    200: '#aecde0',
    300: '#80b1cc',
    400: '#5491b5',
    500: '#3c7499', // primary brand
    600: '#2f5e7e',
    700: '#264c66',
    800: '#1f3d52', // dark surfaces, text on light
    900: '#182f3f', // deepest dark
  },

  // ── Evergreen (secondary) ─────────────────────────────────────────────────
  green: {
    50:  '#eaf3ed',
    100: '#cde6d6',
    200: '#a0d0b3',
    300: '#6fb78d',
    400: '#459a6b',
    500: '#2e7d52', // primary evergreen
    600: '#246541',
    700: '#1d5135',
    800: '#173f29',
    900: '#11301f',
  },

  // ── Amber (accent / energy) ───────────────────────────────────────────────
  amber: {
    50:  '#fff5ed',
    100: '#fde5cc',
    200: '#fac899',
    300: '#f7a855',
    400: '#f48d2a',
    500: '#e87722', // primary accent — CTAs, badges, haypile
    600: '#c85a1a',
    700: '#a04412',
    800: '#78330d',
    900: '#552409',
  },

  // ── Slate neutrals ────────────────────────────────────────────────────────
  slate: {
    50:  '#f7f9fa', // canvas / app background
    100: '#eef1f3',
    200: '#dde3e8',
    300: '#c2cdd4',
    400: '#9aa8b2',
    500: '#71808b',
    600: '#54616b',
    700: '#3e4951',
    800: '#2a333a',
    900: '#182026',
  },

  // ── Pika golden (mascot / illustration only) ──────────────────────────────
  // Do NOT use for UI chrome — reserved for Pika character art.
  pika: {
    50:  '#fffbea',
    100: '#fff3c0',
    200: '#ffe480',
    300: '#ffcd45', // pika-golden — primary body highlight
    400: '#f5b91e',
    500: '#e9a52a', // pika body warm tone
    600: '#c47830',
    700: '#9a5820',
    800: '#6e3c10',
    900: '#4a2608',
  },

  // ── Status ────────────────────────────────────────────────────────────────
  red: {
    100: '#f7dadd',
    500: '#d1495b', // error — warm clay red
    600: '#af3848',
  },

  // ── Semantic aliases ──────────────────────────────────────────────────────
  brand:   '#3c7499', // blue.500
  accent:  '#e87722', // amber.500
  evergreen: '#2e7d52', // green.500

  background: {
    canvas:   '#f7f9fa', // slate.50 — app background (ice white)
    surface:  '#ffffff',
    sunken:   '#eef1f3', // slate.100
    inverse:  '#1f3d52', // blue.800
  },
  text: {
    strong:    '#182026', // slate.900
    body:      '#3e4951', // slate.700
    muted:     '#71808b', // slate.500
    faint:     '#9aa8b2', // slate.400
    onBrand:   '#ffffff',
    onAccent:  '#ffffff',
    link:      '#2f5e7e', // blue.600
  },
  border: {
    default: '#dde3e8', // slate.200
    strong:  '#c2cdd4', // slate.300
    divider: '#eef1f3', // slate.100
  },
  action: {
    primary:      '#e87722', // amber.500
    primaryHover: '#c85a1a', // amber.600
    primaryFg:    '#ffffff',
  },
  progress: {
    fill:  '#2e7d52', // green.500
    track: '#cde6d6', // green.100
  },
  status: {
    success:     '#2e7d52',
    successSoft: '#cde6d6',
    warning:     '#e87722',
    warningSoft: '#fde5cc',
    danger:      '#d1495b',
    dangerSoft:  '#f7dadd',
    info:        '#3c7499',
    infoSoft:    '#d7e6f0',
  },
  overlay: {
    scrim:  'rgba(24, 47, 63, 0.45)',
    dark:   'rgba(24, 47, 63, 0.72)',
    glass:  'rgba(255, 255, 255, 0.82)',
    tint:   'rgba(60, 116, 153, 0.06)',
  },
} as const;

// ── Typography ──────────────────────────────────────────────────────────────
// Spectral  — serif display: headwords, hero text, reading passages
// Plus Jakarta Sans — sans UI: body, chrome, all interface text
// Space Mono — mono: phonetics (IPA), streak counters, numerics
export const typography = {
  fontFamily: {
    serif:   'Spectral',
    sans:    'Plus Jakarta Sans',
    mono:    'Space Mono',
    // Semantic roles
    display: 'Spectral',       // big headwords / hero
    heading: 'Plus Jakarta Sans', // UI section titles
    body:    'Plus Jakarta Sans', // interface body
    reading: 'Spectral',       // long-form reading passages
    numeric: 'Space Mono',     // counters, IPA, timers
  },
  fontSize: {
    '2xs': 11,
    xs:    12,
    sm:    14,
    md:    16,  // base UI body
    lg:    18,
    xl:    21,
    '2xl': 26,
    '3xl': 32,
    '4xl': 40,
    '5xl': 52,
    '6xl': 64,
  },
  fontWeight: {
    regular:  '400',
    medium:   '500',
    semibold: '600',
    bold:     '700',
    extra:    '800',
  },
  lineHeight: {
    tight:   1.12,
    snug:    1.28,
    normal:  1.5,
    relaxed: 1.7,  // reading passages
  },
  letterSpacing: {
    tight:  '-0.02em',
    normal: '0',
    wide:   '0.04em',
    caps:   '0.08em', // uppercase eyebrow labels
  },
} as const;

// ── Spacing (4px base grid) ──────────────────────────────────────────────────
export const spacing = {
  0:  0,
  1:  4,
  2:  8,
  3:  12,
  4:  16,
  5:  20,
  6:  24,
  8:  32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
} as const;

// ── Border radius — generous & friendly ─────────────────────────────────────
export const radius = {
  xs:   6,
  sm:   10,
  md:   14,
  lg:   20,   // default card
  xl:   28,
  '2xl': 36,
  pill: 999,
} as const;

// ── Shadows — soft, cool slate-tinted ────────────────────────────────────────
export const shadows = {
  xs: { shadowColor: '#182f3f', shadowOffset: { width: 0, height: 1 },  shadowOpacity: 0.06, shadowRadius: 2,  elevation: 1 },
  sm: { shadowColor: '#182f3f', shadowOffset: { width: 0, height: 2 },  shadowOpacity: 0.07, shadowRadius: 6,  elevation: 2 },
  md: { shadowColor: '#182f3f', shadowOffset: { width: 0, height: 6 },  shadowOpacity: 0.09, shadowRadius: 16, elevation: 4 },
  lg: { shadowColor: '#182f3f', shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.12, shadowRadius: 32, elevation: 8 },
  xl: { shadowColor: '#182f3f', shadowOffset: { width: 0, height: 24 }, shadowOpacity: 0.16, shadowRadius: 56, elevation: 12 },
} as const;

// ── Motion ───────────────────────────────────────────────────────────────────
export const motion = {
  easeOut:   'cubic-bezier(0.22, 1, 0.36, 1)',
  easeInOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  spring:    'cubic-bezier(0.34, 1.56, 0.64, 1)',
  fast:      120,  // ms
  base:      220,
  slow:      380,
} as const;

// ── Tier system ───────────────────────────────────────────────────────────────
export const tiers = [
  { id: 1, name: 'Base Camp',    wordsRequired: 100,  color: '#80b1cc' }, // blue.300
  { id: 2, name: 'Lower Ridge',  wordsRequired: 500,  color: '#459a6b' }, // green.400
  { id: 3, name: 'High Camp',    wordsRequired: 1000, color: '#2e7d52' }, // green.500
  { id: 4, name: 'The Approach', wordsRequired: 2000, color: '#f48d2a' }, // amber.400
  { id: 5, name: 'Summit',       wordsRequired: 3000, color: '#e87722' }, // amber.500
] as const;

const theme = { colors, typography, spacing, radius, shadows, motion, tiers };
export default theme;
