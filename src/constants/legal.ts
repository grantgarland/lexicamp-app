// External URL registry — every off-app destination in one place so the domain
// can never drift screen-to-screen.
//
// lexicamp.com is LIVE (2026-07-29). `/support` is doubly load-bearing: it is a
// REQUIRED App Store Connect field and the site hard-asserts that it resolves at
// exactly that path — do not move it without updating both.
export const SITE_URL = 'https://lexicamp.com';

export const LEGAL_URLS = {
  terms: `${SITE_URL}/legal/terms`,
  privacy: `${SITE_URL}/legal/privacy`,
  acknowledgments: `${SITE_URL}/legal/acknowledgments`,
} as const;

export const SUPPORT_URLS = {
  /** FAQ + contact. The App Store Connect support URL. */
  help: `${SITE_URL}/support`,
  /** Long-form article library. */
  guides: `${SITE_URL}/guides`,
} as const;

/** Support mailbox. Deliberately on lexicamp.app while the site is on
 *  lexicamp.com — confirmed by Casey 2026-07-30 and matching what
 *  lexicamp-site's own `site.config.ts` publishes. */
export const SUPPORT_EMAIL = 'support@lexicamp.app';
