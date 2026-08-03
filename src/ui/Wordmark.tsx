// Wordmark — the official horizontal lockup (mark + "Lexicamp"), rendered from
// assets/images/logo-wordmark.svg. See brandMark.ts for the one transform
// applied to the asset (font-family → the registered Spectral-SemiBold).
import { useColorScheme } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { BRAND_WORDMARK_KNOCKOUT_XML, BRAND_WORDMARK_RATIO, BRAND_WORDMARK_XML } from './brandMark';

/** `width` drives the size; height follows the asset's intrinsic ratio so the
 *  lockup can never be stretched. */
export function Wordmark({ width = 200 }: { width?: number }) {
  const isDark = useColorScheme() === 'dark';
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
