// Unistyles themes, assembled from the generated design tokens.
// Light is the real theme (prototypes are light-only). `dark` is a documented
// placeholder = light, until dark mode is designed (tracked in 14 §5). Adaptive
// themes stay OFF in unistyles.ts so the placeholder never ships by accident.
//
// RN font notes:
//  • fontFamily must be a single registered name (see App font loading in P1).
//    Token family strings ("Plus Jakarta Sans") are the load names; we map to the
//    Unistyles-friendly keys below.
//  • lineHeight in RN is absolute px, not a multiplier → use `lh(size, leading)`.
//  • letterSpacing in RN is absolute px, not em → use `track(size, key)`.
//  • shadow.* are CSS box-shadow strings; apply via the RN `boxShadow` style prop
//    (New Arch, RN ≥0.76). Use `shadow.brand`/`accent` for CTAs.
import { tokens } from './tokens.generated';

const { palette, color, font, space, radius, borderWidth, shadow, motion } = tokens;

// Registered font-family names (must match the keys passed to expo-font useFonts).
const family = {
  serif: 'Spectral',          // headwords, display, reading
  sans: 'PlusJakartaSans',    // UI / body
  mono: 'SpaceMono',          // IPA, counters, timers
} as const;

const base = {
  palette,
  color,
  family,
  weight: font.weight,
  size: font.size,
  leading: font.leading,
  tracking: font.tracking,
  space,
  radius,
  borderWidth,
  shadow,
  motion,
} as const;

export const lightTheme = base;
export const darkTheme = base; // TODO(14 §5): design dark mode, then diverge surfaces/text.

export const breakpoints = { xs: 0, sm: 360, md: 768, lg: 1024 } as const;

/** RN absolute line-height (px) from a font size + a leading token. */
export const lh = (size: number, leading: keyof typeof font.leading = 'normal') =>
  Math.round(size * font.leading[leading]);

/** RN absolute letter-spacing (px) from a font size + a tracking token (em). */
export const track = (size: number, key: keyof typeof font.tracking = 'normal') =>
  +(size * font.tracking[key]).toFixed(2);

export type AppTheme = typeof lightTheme;
