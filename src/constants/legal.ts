// UX-17c: legal link registry — ONE edit point. ⚠️ lexicamp.com is verified
// available but NOT YET REGISTERED (00 §not-decided); these URLs must be live
// before store submission (4.1). Until then the links open a parked/404 page —
// acceptable in dev builds, a release blocker for the stores.
export const LEGAL_URLS = {
  terms: 'https://lexicamp.com/legal/terms',
  privacy: 'https://lexicamp.com/legal/privacy',
  acknowledgments: 'https://lexicamp.com/legal/acknowledgments',
} as const;
