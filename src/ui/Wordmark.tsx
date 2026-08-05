// Wordmark — the official horizontal lockup (mark + "Lexicamp"), rendered from
// assets/images/logo-wordmark.svg. See brandMark.ts for the one transform
// applied to the asset (font-family → the registered Spectral-SemiBold).
import { SvgXml } from 'react-native-svg';

import { useIsDark } from '@/theme/appearance';

import { BRAND_MARK_KNOCKOUT_XML, BRAND_MARK_XML, BRAND_WORDMARK_KNOCKOUT_XML, BRAND_WORDMARK_RATIO, BRAND_WORDMARK_XML } from './brandMark';

/** The mark alone (mountain in a circle), square, theme-aware. For places that
 *  want the brand without the word — currently the Home header, where it is the
 *  centre element between the streak badge and the language toggle.
 *
 *  Knockout in dark mode for the same reason `Wordmark` does it: the standard
 *  mark is navy-on-nothing and disappears against the dark canvas. */
export function BrandMark({ size = 28, label }: { size?: number; label?: string }) {
  const isDark = useIsDark();
  return (
    <SvgXml
      xml={isDark ? BRAND_MARK_KNOCKOUT_XML : BRAND_MARK_XML}
      width={size}
      height={size}
      accessibilityRole="image"
      accessibilityLabel={label ?? 'Lexicamp'}
    />
  );
}

/** `width` drives the size; height follows the asset's intrinsic ratio so the
 *  lockup can never be stretched. */
export function Wordmark({ width = 200 }: { width?: number }) {
  const isDark = useIsDark();
  return (
    <SvgXml
      xml={isDark ? BRAND_WORDMARK_KNOCKOUT_XML : BRAND_WORDMARK_XML}
      width={width}
      height={width / BRAND_WORDMARK_RATIO}
      accessibilityRole="image"
      accessibilityLabel="Lexicamp"
    />
  );
}
