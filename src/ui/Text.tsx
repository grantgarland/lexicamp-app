// Text — the typographic primitive. One variant per role in the design system,
// each binding a per-weight font + token size + absolute line-height (RN needs px,
// not multipliers). Mirrors the prototypes' type usage (Spectral display/reading,
// Plus Jakarta Sans UI, Space Mono numerals). Every other component composes this.
import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import { createUnistylesElement, StyleSheet, useUnistyles } from 'react-native-unistyles';

import { lh, track, type AppTheme } from '@/theme/theme';

// Cap OS Dynamic-Type scaling so fixed-height controls and tight line-heights don't
// clip/overlap at large accessibility text sizes. Generous enough to stay accessible.
// (React 19 removed Text.defaultProps, so every text path must opt in — the Text
// primitive below + RawText for bespoke RN Text usages.)
export const FONT_SCALE_MAX = 1.4;

// Unistyles updates styles by writing straight to the native ShadowNode, which it
// can only do for elements it owns. A plain function wrapper around <Text> is
// invisible to it, so RawText nodes kept the PREVIOUS theme's colors across a
// runtime light/dark switch — textStrong headings turned near-invisible on both
// canvases (TestFlight 1.0.0 (2), 2026-08-01). createUnistylesElement registers
// the host component so those nodes update with everything else.
const UnistylesText = createUnistylesElement(RNText) as typeof RNText;

/** RN <Text> with the kit's font-scale cap baked in (overridable). For bespoke,
 *  fully-styled text inside components; the variant `Text` below is preferred otherwise.
 *  Theme-aware — see the note above; do NOT swap this back to a bare RNText. */
export function RawText({ maxFontSizeMultiplier = FONT_SCALE_MAX, ...props }: RNTextProps) {
  return <UnistylesText maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} />;
}

export type TextVariant =
  | 'display' // big serif headwords / hero
  | 'title' // screen titles
  | 'heading' // section titles
  | 'subheading' // sub-section / card titles
  | 'body' // default UI body
  | 'bodyStrong' // emphasized body
  | 'caption' // secondary / supporting
  | 'footnote' // smallest supporting
  | 'label' // uppercase eyebrow
  | 'reading' // long-form passages (serif)
  | 'mono'; // numerals, IPA, counters

type ColorKey = keyof AppTheme['color'];

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  /** Semantic color token override (defaults to the variant's color). */
  color?: ColorKey;
  align?: 'auto' | 'left' | 'right' | 'center' | 'justify';
}

export function Text({ variant = 'body', color, align, style, maxFontSizeMultiplier = FONT_SCALE_MAX, ...rest }: TextProps) {
  const { theme } = useUnistyles();
  return (
    <RNText
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[
        styles[variant],
        color != null && { color: theme.color[color] },
        align != null && { textAlign: align },
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create((theme) => {
  const { fonts, size, color } = theme;
  return {
    display: {
      fontFamily: fonts.serif.bold,
      fontSize: size['3xl'],
      lineHeight: lh(size['3xl'], 'tight'),
      letterSpacing: track(size['3xl'], 'tight'),
      color: color.textStrong,
    },
    title: {
      fontFamily: fonts.sans.bold,
      fontSize: size.xl,
      lineHeight: lh(size.xl, 'snug'),
      letterSpacing: track(size.xl, 'tight'),
      color: color.textStrong,
    },
    heading: {
      fontFamily: fonts.sans.semibold,
      fontSize: size.lg,
      lineHeight: lh(size.lg, 'snug'),
      color: color.textStrong,
    },
    subheading: {
      fontFamily: fonts.sans.semibold,
      fontSize: size.md,
      lineHeight: lh(size.md, 'snug'),
      color: color.textStrong,
    },
    body: {
      fontFamily: fonts.sans.regular,
      fontSize: size.md,
      lineHeight: lh(size.md, 'normal'),
      color: color.textBody,
    },
    bodyStrong: {
      fontFamily: fonts.sans.semibold,
      fontSize: size.md,
      lineHeight: lh(size.md, 'normal'),
      color: color.textStrong,
    },
    caption: {
      fontFamily: fonts.sans.regular,
      fontSize: size.sm,
      lineHeight: lh(size.sm, 'normal'),
      color: color.textMuted,
    },
    footnote: {
      fontFamily: fonts.sans.regular,
      fontSize: size.xs,
      lineHeight: lh(size.xs, 'normal'),
      color: color.textMuted,
    },
    label: {
      fontFamily: fonts.sans.semibold,
      fontSize: size.xs,
      lineHeight: lh(size.xs, 'normal'),
      letterSpacing: track(size.xs, 'caps'),
      textTransform: 'uppercase',
      color: color.textMuted,
    },
    reading: {
      fontFamily: fonts.serif.regular,
      fontSize: size.md,
      lineHeight: lh(size.md, 'relaxed'),
      color: color.textBody,
    },
    mono: {
      fontFamily: fonts.mono.regular,
      fontSize: size.sm,
      lineHeight: lh(size.sm, 'normal'),
      color: color.textBody,
    },
  };
});
