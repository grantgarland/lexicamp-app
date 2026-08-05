// Unistyles themes, assembled from the generated design tokens.
// Light and dark are both real themes: `dark` swaps in the `colorDark` semantic
// set (surfaces/text/status inverted for "Alpine Night"; brand hues keep their
// identity), generated from lexicamp-design-system/project/tokens/colors.dark.css.
// Everything else (fonts/space/radius/shadow/motion) is shared. Adaptive themes
// are ON in unistyles.ts, so the device system color scheme drives the swap;
// there is no in-app toggle (14 §5).
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
// Dark semantic set (generated from colors.dark.css). Falls back to light if the
// dark file is ever removed, so the app never loses its color map.
const colorDark = ('colorDark' in tokens ? tokens.colorDark : color) as typeof color;

// Registered font-family names. RN custom fonts don't pick a weight from
// `fontWeight` reliably (esp. Android) → register ONE family per weight and select
// by name. Keys here MUST match the names passed to `useFonts` in app/_layout.
// `family` keeps the regular-weight shorthand (serif/sans/mono) for convenience.
const fonts = {
  serif: {                      // Spectral — headwords, display, reading
    regular: 'Spectral',
    medium: 'Spectral-Medium',
    semibold: 'Spectral-SemiBold',
    bold: 'Spectral-Bold',
  },
  sans: {                       // Plus Jakarta Sans — UI / body
    regular: 'PlusJakartaSans',
    medium: 'PlusJakartaSans-Medium',
    semibold: 'PlusJakartaSans-SemiBold',
    bold: 'PlusJakartaSans-Bold',
    extra: 'PlusJakartaSans-ExtraBold',
  },
  mono: {                       // Space Mono — IPA, counters, timers
    regular: 'SpaceMono',
    bold: 'SpaceMono-Bold',
  },
} as const;

const family = {
  serif: fonts.serif.regular,
  sans: fonts.sans.regular,
  mono: fonts.mono.regular,
} as const;

const base = {
  palette,
  color,
  fonts,
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

// `isDark` rides ON the theme so "which mode am I in?" has exactly ONE answer,
// reachable everywhere the theme already is. It replaces RN's `useColorScheme()`
// at every call site (see `useIsDark` in theme/appearance.ts for why the two
// disagreed). Typed as `boolean`, not the literal, so `theme.isDark` is usable
// from either theme without narrowing to a constant.
export const lightTheme = { ...base, isDark: false as boolean };
// Dark diverges ONLY in the semantic color set; all other tokens are shared.
export const darkTheme = { ...base, color: colorDark, isDark: true as boolean };

export const breakpoints = { xs: 0, sm: 360, md: 768, lg: 1024 } as const;

/** RN absolute line-height (px) from a font size + a leading token. */
export const lh = (size: number, leading: keyof typeof font.leading = 'normal') =>
  Math.round(size * font.leading[leading]);

/** RN absolute letter-spacing (px) from a font size + a tracking token (em). */
export const track = (size: number, key: keyof typeof font.tracking = 'normal') =>
  +(size * font.tracking[key]).toFixed(2);

export type AppTheme = typeof lightTheme;
