// React bindings for the RevenueCat adapter (3.1).
//
// These live beside the adapter rather than in `src/query/hooks.ts` on purpose:
// that file is the DataSource seam's hook home, and purchases are a different
// seam with a different failure model (a native SDK that may be absent entirely).
import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { dataSource } from '@/data';
import { isPaid } from '@/domain/types';

import {
  type PaywallOffering,
  type PaywallPlan,
  type PurchaseOutcome,
  fetchRevenueCatPremium,
  getPaywallOffering,
  purchasesReady,
  purchasePlan,
  restorePurchases,
} from './purchases';

/** The offering, straight from StoreKit. `null` when the SDK is not configured
 *  (mock/smoke builds), which the paywall renders as "prices unavailable" rather
 *  than as an error — there is nothing the user can do about it. */
export function usePaywallOffering(): { offering: PaywallOffering | null; isLoading: boolean; isError: boolean } {
  const q = useQuery({
    queryKey: ['paywallOffering'],
    queryFn: getPaywallOffering,
    enabled: purchasesReady(),
    // Prices change server-side rarely, and a stale price on a paywall is worse
    // than a refetch is expensive.
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  return {
    offering: q.data ?? null,
    isLoading: purchasesReady() && q.isPending,
    isError: q.isError,
  };
}

/**
 * Wait for the SERVER to agree that this user is paid.
 *
 * ⚠️ Why this exists at all (22, ratified): `save_card` enforces the free cap by
 * reading `subscriptions` server-side, and that row only flips when RevenueCat's
 * webhook lands — typically a second or two after StoreKit returns, with no
 * guarantee. Unlocking the UI from the client's `customerInfo` would close the
 * gap but would add a second, CLIENT-CONTROLLED path to premium, which is the
 * exact shape of the P0-1 privilege-escalation bug in 21. So the server stays
 * authoritative and we spend the gap on the success screen, which is dead time
 * the user is already looking at.
 *
 * Returns whether the mirror caught up before we stopped waiting.
 */
async function waitForServerEntitlement(): Promise<boolean> {
  const backoffMs = [0, 1000, 2000, 4000, 8000];
  for (const delay of backoffMs) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      if (isPaid(await dataSource.getEntitlement())) return true;
    } catch {
      /* keep waiting — a transient read failure is not a verdict */
    }
  }
  return false;
}

export interface RestoreResult {
  /** StoreKit found an active entitlement on this Apple ID. */
  restored: boolean;
  /** ...and `subscriptions` agreed before we stopped waiting. `false` with
   *  `restored: true` means the purchase IS valid and our mirror is behind, which
   *  is a different message to the user than "nothing to restore". Returned
   *  rather than read off `mirrorLagged` because a caller that reacts imperatively
   *  (a toast, not a re-render) would see the pre-update closure value. */
  mirrored: boolean;
}

export interface PurchaseController {
  /** Runs StoreKit, then waits for the mirror. */
  buy: (plan: PaywallPlan) => Promise<PurchaseOutcome>;
  restore: () => Promise<RestoreResult>;
  /** A purchase/restore is in flight — disable the CTAs. */
  isBusy: boolean;
  /** Set when StoreKit succeeded but `subscriptions` never flipped. The purchase
   *  IS valid; our mirror is behind or broken. Surfaced so the user is not told
   *  their payment failed. */
  mirrorLagged: boolean;
}

export function usePurchaseController(
  logEvent: (event: string, props?: Record<string, unknown>) => void,
): PurchaseController {
  const qc = useQueryClient();
  const [isBusy, setBusy] = useState(false);
  const [mirrorLagged, setMirrorLagged] = useState(false);

  const settle = useCallback(
    async (source: 'purchase' | 'restore') => {
      const mirrored = await waitForServerEntitlement();
      await qc.invalidateQueries({ queryKey: ['entitlement'] });
      if (!mirrored) {
        setMirrorLagged(true);
        // The discrepancy signal. RevenueCat says paid, our mirror does not —
        // that is a webhook problem (delivery, verify_jwt, mapping) and it is
        // invisible from the dashboard, so it has to be reported from here.
        const rcPaid = await fetchRevenueCatPremium();
        logEvent('entitlement_mirror_lag', { source, revenuecatPaid: rcPaid });
      }
      return mirrored;
    },
    [qc, logEvent],
  );

  const buy = useCallback(
    async (plan: PaywallPlan): Promise<PurchaseOutcome> => {
      setBusy(true);
      setMirrorLagged(false);
      try {
        const outcome = await purchasePlan(plan);
        // A cancel is a normal outcome, not an error, and must not be reported
        // as one — treating it as a failure is the classic paywall bug.
        if (outcome === 'cancelled') {
          logEvent('paywall_purchase_cancelled', { plan: plan.id });
          return outcome;
        }
        logEvent('paywall_purchase_succeeded', { plan: plan.id, productId: plan.productId });
        // 3.4's last open emit, parked on 3.1 because it needs the purchase
        // flow. Emitted from the CLIENT, like the rest of that funnel, so
        // paywall_viewed → trial_started are comparable rows written the same
        // way. `trialEligible` is this user's own eligibility as StoreKit
        // reported it at render, not "the product has a trial" — a returning
        // subscriber buying annual is a conversion, not a trial start.
        if (plan.trialEligible) {
          logEvent('trial_started', { plan: plan.id, productId: plan.productId });
        }
        await settle('purchase');
        return outcome;
      } finally {
        setBusy(false);
      }
    },
    [settle, logEvent],
  );

  const restore = useCallback(async (): Promise<RestoreResult> => {
    setBusy(true);
    setMirrorLagged(false);
    try {
      const restored = await restorePurchases();
      logEvent('paywall_restore', { restored });
      // Nothing to mirror when StoreKit found nothing, and waiting 15s to
      // confirm an entitlement we know does not exist would just stall the CTA.
      const mirrored = restored ? await settle('restore') : false;
      return { restored, mirrored };
    } finally {
      setBusy(false);
    }
  }, [settle, logEvent]);

  return { buy, restore, isBusy, mirrorLagged };
}
