// The Lexicamp mark, inlined as XML strings so `SvgXml` renders it with no
// svg-transformer / metro config — the same pattern as `tierBadges.ts`.
//
// Source of truth: lexicamp-design-system/project/assets/logos/logo-mark.svg
// and logo-knockout.svg, synced into assets/images by `npm run sync:assets`.
// Keep in sync if those change.
//
// Only the MARK is inlined, not the design system's stacked wordmark: that
// asset draws "Lexicamp" with an SVG <text font-family="Spectral">, which
// depends on the font resolving inside react-native-svg. The wordmark is drawn
// with a real RN <Text> in the app's own serif token instead — font-safe,
// respects Dynamic Type, and stays selectable to a screen reader.
export const BRAND_MARK_XML = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="25.5" fill="none" stroke="#1f3d52" stroke-width="2.6"></circle><circle cx="42" cy="21.5" r="4" fill="#e87722"></circle><g fill="none" stroke="#1f3d52" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 41.5 L25 26.5 L30.5 35 L37 25 L49 41.5"></path><path d="M13 41.5 L51 41.5"></path><path d="M25 26.5 L22.8 29.9"></path><path d="M37 25 L34.7 28.6"></path></g></svg>`;

/** Dark-surface variant. Per the design system's knockout convention the accent
 *  dot goes white too — it is a knockout, not a recolour. */
export const BRAND_MARK_KNOCKOUT_XML = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="25.5" fill="none" stroke="#ffffff" stroke-width="2.6"></circle><circle cx="42" cy="21.5" r="4" fill="#ffffff"></circle><g fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 41.5 L25 26.5 L30.5 35 L37 25 L49 41.5"></path><path d="M13 41.5 L51 41.5"></path><path d="M25 26.5 L22.8 29.9"></path><path d="M37 25 L34.7 28.6"></path></g></svg>`;
