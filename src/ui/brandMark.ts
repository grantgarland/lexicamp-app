// The Lexicamp mark, inlined as XML strings so `SvgXml` renders it with no
// svg-transformer / metro config — the same pattern as `tierBadges.ts`.
//
// Source of truth: lexicamp-design-system/project/assets/logos/logo-mark.svg
// and logo-knockout.svg, synced into assets/images by `npm run sync:assets`.
// Keep in sync if those change.
//
// The horizontal WORDMARK lockup is inlined too, straight from
// assets/images/logo-wordmark.svg (Casey 2026-08-02 — the asset is the source of
// truth, not a hand-rebuilt approximation). One transform is applied on the way
// in: the asset's `font-family="Spectral, Georgia, serif" font-weight="600"` is
// rewritten to the REGISTERED family name `Spectral-SemiBold`. react-native-svg
// resolves font-family against registered fonts only, so the original string
// silently falls back to the system serif on device. Re-apply that rewrite if
// you re-sync the asset via `npm run sync:assets`.
export const BRAND_MARK_XML = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="25.5" fill="none" stroke="#1f3d52" stroke-width="2.6"></circle><circle cx="42" cy="21.5" r="4" fill="#e87722"></circle><g fill="none" stroke="#1f3d52" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 41.5 L25 26.5 L30.5 35 L37 25 L49 41.5"></path><path d="M13 41.5 L51 41.5"></path><path d="M25 26.5 L22.8 29.9"></path><path d="M37 25 L34.7 28.6"></path></g></svg>`;

/** Dark-surface variant. Per the design system's knockout convention the accent
 *  dot goes white too — it is a knockout, not a recolour. */
export const BRAND_MARK_KNOCKOUT_XML = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="25.5" fill="none" stroke="#ffffff" stroke-width="2.6"></circle><circle cx="42" cy="21.5" r="4" fill="#ffffff"></circle><g fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 41.5 L25 26.5 L30.5 35 L37 25 L49 41.5"></path><path d="M13 41.5 L51 41.5"></path><path d="M25 26.5 L22.8 29.9"></path><path d="M37 25 L34.7 28.6"></path></g></svg>`;

/** Horizontal lockup (mark + wordmark), 318x80. Source: assets/images/logo-wordmark.svg. */
export const BRAND_WORDMARK_XML = `<svg xmlns="http://www.w3.org/2000/svg" width="318" height="80" viewBox="0 0 318 80"><defs></defs>
<g transform="translate(8,8)"><circle cx="32" cy="32" r="25.5" fill="none" stroke="#1f3d52" stroke-width="2.6"></circle><circle cx="42" cy="21.5" r="4" fill="#e87722"></circle><g fill="none" stroke="#1f3d52" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 41.5 L25 26.5 L30.5 35 L37 25 L49 41.5"></path><path d="M13 41.5 L51 41.5"></path><path d="M25 26.5 L22.8 29.9"></path><path d="M37 25 L34.7 28.6"></path></g></g><text x="84" y="55" font-family="Spectral-SemiBold" letter-spacing="-0.5" font-size="44"><tspan fill="#1f3d52">Lexi</tspan><tspan fill="#e87722">camp</tspan></text>
</svg>`;

/** Dark-surface lockup — deep-blue strokes and "Lexi" knocked to the dark
 *  theme's textStrong; the accent "camp" is unchanged (it reads on dark). */
export const BRAND_WORDMARK_KNOCKOUT_XML = `<svg xmlns="http://www.w3.org/2000/svg" width="318" height="80" viewBox="0 0 318 80"><defs></defs>
<g transform="translate(8,8)"><circle cx="32" cy="32" r="25.5" fill="none" stroke="#f4f7f9" stroke-width="2.6"></circle><circle cx="42" cy="21.5" r="4" fill="#e87722"></circle><g fill="none" stroke="#f4f7f9" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 41.5 L25 26.5 L30.5 35 L37 25 L49 41.5"></path><path d="M13 41.5 L51 41.5"></path><path d="M25 26.5 L22.8 29.9"></path><path d="M37 25 L34.7 28.6"></path></g></g><text x="84" y="55" font-family="Spectral-SemiBold" letter-spacing="-0.5" font-size="44"><tspan fill="#f4f7f9">Lexi</tspan><tspan fill="#e87722">camp</tspan></text>
</svg>`;

/** Intrinsic aspect ratio of the lockup, for width-driven sizing. */
export const BRAND_WORDMARK_RATIO = 318 / 80;

