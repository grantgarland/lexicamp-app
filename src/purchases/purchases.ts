// RevenueCat adapter (3.1). The ONLY module in the app that imports
// `react-native-purchases`; everything above it speaks the normalized shapes at
// the bottom of this file. Same reasoning as the DataSource seam — the paywall
// should not know what a `PurchasesPackage` is, and the screen stays testable
// without a native module.
//
// ⚠️ THE GUARD IS KEYED ON `USE_SUPABASE`, NOT ON `__DEV__`. The `smoke` EAS
// profile builds a RELEASE bundle (so `__DEV__` is false) with
// EXPO_PUBLIC_USE_SUPABASE=0, and that is the build the nightly Maestro suite
// drives. A `__DEV__`-keyed guard would therefore still fire there — configuring
// RevenueCat, with no API key, in the one build that must never talk to it. This
// is the same axis `metro/excludedModules.js` uses to strip the mock DataSource,
// and for the same reason: the honest question is "is this build wired to the
// live backend?", not "is this a debug build?".
//
// The SDK is `require`d lazily rather than imported at the top so a build that
// fails the guard never loads the native module at all. Types come in through
// `import type`, which is erased at compile time and pulls nothing in at runtime.
import { Platform } from 'react-native';
import type { CustomerInfo, PurchasesOffering, PurchasesPackage } from 'react-native-purchases';

import { USE_SUPABASE } from '@/data';

/** The entitlement identifier configured in RevenueCat (1.2 §5.5). Renaming it
 *  there without changing this string silently un-premiums every paying user. */
export const PREMIUM_ENTITLEMENT = 'premium';

const API_KEY =
  Platform.OS === 'ios'
    ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY
    : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;

export type PurchasesStatus =
  | 'uninitialized'
  | 'disabled-mock-build'
  | 'disabled-no-key'
  | 'ready'
  | 'failed';

/** Why the SDK is or is not running. Diagnostic only — never user-facing. */
export let purchasesStatus: PurchasesStatus = 'uninitialized';

/** True once configure() has actually run. Gates every other call in this file. */
export const purchasesReady = (): boolean => purchasesStatus === 'ready';

/** The lazily-required SDK, typed against the real module. `typeof import(...)`
 *  is a TYPE position, so this costs nothing at runtime while still checking
 *  every call below against RevenueCat's own definitions. */
function sdk(): typeof import('react-native-purchases').default {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('react-native-purchases').default;
}

/** Call once at app start, before anything reads an offering. Idempotent. */
export function configurePurchases(): void {
  if (purchasesStatus !== 'uninitialized') return;
  if (!USE_SUPABASE) {
    purchasesStatus = 'disabled-mock-build';
    return;
  }
  if (!API_KEY) {
    purchasesStatus = 'disabled-no-key';
    return;
  }
  try {
    // No appUserID here on purpose: users sign in AFTER first launch, so the SDK
    // starts anonymous and `identifyPurchases()` aliases that anonymous id to the
    // Supabase user when auth lands. Passing an id we do not have yet would mean
    // configuring later than app start, and offerings would not be warm.
    sdk().configure({ apiKey: API_KEY });
    purchasesStatus = 'ready';
  } catch {
    // A purchase SDK must never be the reason the app fails to boot.
    purchasesStatus = 'failed';
  }
}

/**
 * Bind RevenueCat's app_user_id to the Supabase user id.
 *
 * ⚠️ This is load-bearing for the whole server mirror: `app_user_id` is what the
 * webhook writes `subscriptions.user_id` from. Skip it and every purchase lands
 * against an anonymous id that maps to no account.
 */
export async function identifyPurchases(userId: string): Promise<void> {
  if (!purchasesReady()) return;
  try {
    await sdk().logIn(userId);
  } catch {
    /* best-effort: never block a sign-in on the purchase SDK */
  }
}

/** Drop back to an anonymous id so the next account on a shared device does not
 *  inherit this one's entitlement. */
export async function forgetPurchases(): Promise<void> {
  if (!purchasesReady()) return;
  try {
    await sdk().logOut();
  } catch {
    /* best-effort */
  }
}

// ── Normalized shapes ───────────────────────────────────────────────────────

export type PlanId = 'annual' | 'monthly';

export interface PaywallPlan {
  id: PlanId;
  /** Storefront-localized, straight from StoreKit. NEVER hardcode this. */
  priceString: string;
  productId: string;
  /** Whether THIS user can still get the intro offer on this product. */
  trialEligible: boolean;
  /** Opaque handle passed back to `purchasePlan`. */
  pkg: PurchasesPackage;
}

export interface PaywallOffering {
  annual: PaywallPlan | null;
  monthly: PaywallPlan | null;
}

/** Read the CURRENT offering (not the `default` identifier) so the paywall can be
 *  changed server-side without an app release — 1.2 §5.6. */
export async function getPaywallOffering(): Promise<PaywallOffering | null> {
  if (!purchasesReady()) return null;
  const offerings = await sdk().getOfferings();
  const current: PurchasesOffering | null = offerings?.current ?? null;
  if (current == null) return null;

  const pick = (id: PlanId): PurchasesPackage | null => {
    const direct = id === 'annual' ? current.annual : current.monthly;
    if (direct != null) return direct;
    // Fallback by package type, in case the dashboard packages are ever renamed
    // away from the $rc_annual / $rc_monthly conventions.
    const wanted = id === 'annual' ? 'ANNUAL' : 'MONTHLY';
    return current.availablePackages?.find((p) => p.packageType === wanted) ?? null;
  };

  const annualPkg = pick('annual');
  const monthlyPkg = pick('monthly');
  const productIds = [annualPkg, monthlyPkg]
    .filter((p): p is PurchasesPackage => p != null)
    .map((p) => p.product.identifier);

  const eligibility = await checkTrialEligibility(productIds);
  const toPlan = (id: PlanId, pkg: PurchasesPackage | null): PaywallPlan | null =>
    pkg == null
      ? null
      : {
          id,
          priceString: pkg.product.priceString,
          productId: pkg.product.identifier,
          trialEligible: eligibility.has(pkg.product.identifier),
          pkg,
        };

  return { annual: toPlan('annual', annualPkg), monthly: toPlan('monthly', monthlyPkg) };
}

/**
 * Product ids this user can still get an intro offer on.
 *
 * ⚠️ Only the ANNUAL product carries the 7-day trial (1.2 §5.4), and a returning
 * subscriber is ineligible even on that one. The paywall's copy is conditional on
 * this: promising a trial StoreKit will not honour is both a bad surprise at the
 * confirmation sheet and a review risk. UNKNOWN is treated as ineligible — the
 * SDK's own guidance is to show the non-intro price when it cannot tell, because
 * over-promising is the worse error.
 */
async function checkTrialEligibility(productIds: string[]): Promise<Set<string>> {
  const eligible = new Set<string>();
  if (productIds.length === 0) return eligible;
  try {
    const Purchases = sdk();
    const result = await Purchases.checkTrialOrIntroductoryPriceEligibility(productIds);
    const ELIGIBLE = Purchases.INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE;
    for (const [productId, info] of Object.entries(result ?? {})) {
      if ((info as { status?: unknown })?.status === ELIGIBLE) eligible.add(productId);
    }
  } catch {
    /* leave the set empty — no trial promised */
  }
  return eligible;
}

export type PurchaseOutcome = 'purchased' | 'cancelled';

/**
 * Run the StoreKit purchase. Returns 'cancelled' when the user backs out, which
 * is a normal outcome and not an error — surfacing it as one is the single most
 * common paywall bug. Anything else throws and the caller shows a message.
 */
export async function purchasePlan(plan: PaywallPlan): Promise<PurchaseOutcome> {
  if (!purchasesReady()) throw new Error('purchases_unavailable');
  try {
    await sdk().purchasePackage(plan.pkg);
    return 'purchased';
  } catch (e) {
    if ((e as { userCancelled?: boolean })?.userCancelled === true) return 'cancelled';
    throw e;
  }
}

/** Apple requires this to exist and to work (guideline 3.1.1). Returns whether
 *  the restore actually produced an active entitlement. */
export async function restorePurchases(): Promise<boolean> {
  if (!purchasesReady()) throw new Error('purchases_unavailable');
  const info: CustomerInfo = await sdk().restorePurchases();
  return hasPremium(info);
}

/** Whether RevenueCat currently considers this customer entitled.
 *
 *  ⚠️ NOT an entitlement source. `subscriptions` (written by the webhook) stays
 *  authoritative — see 22 §"the one architectural decision". This exists so a
 *  disagreement between RevenueCat and our mirror can be DETECTED and logged,
 *  because the alternative (a second, client-controlled path to premium) is the
 *  shape of the P0-1 bug in 21. */
export function hasPremium(info: CustomerInfo | null | undefined): boolean {
  return info?.entitlements?.active?.[PREMIUM_ENTITLEMENT] != null;
}

/** RevenueCat's own view, for the post-purchase discrepancy check. */
export async function fetchRevenueCatPremium(): Promise<boolean | null> {
  if (!purchasesReady()) return null;
  try {
    return hasPremium(await sdk().getCustomerInfo());
  } catch {
    return null;
  }
}
