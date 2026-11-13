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

/** App Store listing. The numeric id is permanent for the life of the listing
 *  and is the same one lexicamp-site's `site.config.ts` links to. */
export const APP_STORE_ID = '6792857650';

export const APP_STORE_URLS = {
  /** Opens the App Store APP directly on the write-a-review sheet. `itms-apps`
   *  skips the Safari bounce an https link takes, and (unlike the in-app
   *  browser `openWebLink` uses) lands somewhere a review can actually be
   *  written. */
  writeReview: `itms-apps://apps.apple.com/app/id${APP_STORE_ID}?action=write-review`,
  /** Same destination over https — the fallback when the scheme is refused. */
  writeReviewWeb: `https://apps.apple.com/app/id${APP_STORE_ID}?action=write-review`,
} as const;

/** Support mailbox. Deliberately on lexicamp.app while the site is on
 *  lexicamp.com — confirmed by Casey 2026-07-30 and matching what
 *  lexicamp-site's own `site.config.ts` publishes. */
export const SUPPORT_EMAIL = 'support@lexicamp.app';
