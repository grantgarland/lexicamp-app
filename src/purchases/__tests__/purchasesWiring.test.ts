// Guard: the wiring facts that decide whether purchases work, and whether the
// nightly smoke survives them. Same rationale as sentryWiring.test.ts — these
// are properties of how modules are assembled, invisible to a test that just
// calls the functions.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PREMIUM_ENTITLEMENT, hasPremium } from '../purchases';

const ROOT = join(__dirname, '..', '..', '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('purchases wiring', () => {
  it('gates configure on the live-backend axis, never on __DEV__', () => {
    const body = src('src/purchases/purchases.ts');
    const configure = body.slice(body.indexOf('export function configurePurchases'));
    const fn = configure.slice(0, configure.indexOf('\n}\n') + 1);

    // The `smoke` EAS profile builds a RELEASE bundle (so __DEV__ is false) with
    // EXPO_PUBLIC_USE_SUPABASE=0, and it is what the nightly Maestro suite runs.
    // A __DEV__-keyed guard would configure RevenueCat there, with no API key.
    expect(fn).toContain('USE_SUPABASE');
    expect(fn).not.toContain('__DEV__');
  });

  it('never imports the native SDK at module scope', () => {
    const body = src('src/purchases/purchases.ts');
    // `import type` is erased; a value import would pull the native module into
    // every bundle including the mock/smoke one.
    expect(body).toMatch(/import type \{[^}]*\} from 'react-native-purchases'/);
    expect(body).not.toMatch(/^import \{[^}]*\} from 'react-native-purchases'/m);
    expect(body).not.toMatch(/^import Purchases from 'react-native-purchases'/m);
  });

  it('configures purchases from the app entry', () => {
    const entry = src('index.js');
    expect(entry).toMatch(/configurePurchases\(\);/);
  });

  it('binds the RevenueCat identity to the Supabase user id', () => {
    const sync = src('src/auth/sessionSync.ts');
    // app_user_id IS what the webhook writes subscriptions.user_id from, so a
    // purchase made before logIn lands against an account-less anonymous id.
    expect(sync).toContain('identifyPurchases(userId)');
    // ...and releases it, so a second account on one device does not inherit
    // the first one's entitlement.
    expect(sync).toContain('forgetPurchases()');
  });

  it('pins the entitlement identifier configured in RevenueCat', () => {
    // Renaming this in the dashboard without changing the string here silently
    // un-premiums every paying customer.
    expect(PREMIUM_ENTITLEMENT).toBe('premium');
  });

  it('reads prices from the offering, with the locale strings as a demo-only fallback', () => {
    const screen = src('src/screens/PaywallScreen.tsx');
    expect(screen).toContain('priceString');
    // The hardcoded prices may appear ONLY as the fallback argument to priceFor,
    // never as the rendered price in a live build.
    expect(screen).toMatch(/priceFor\('annual', t\('paywall\.annualPrice'\)\)/);
    expect(screen).toMatch(/priceFor\('monthly', t\('paywall\.monthlyPrice'\)\)/);
    expect(screen).not.toMatch(/price=\{t\('paywall\.(annual|monthly)Price'\)\}/);
  });

  it('treats a missing entitlement as unentitled', () => {
    expect(hasPremium(null)).toBe(false);
    expect(hasPremium(undefined)).toBe(false);
    expect(hasPremium({ entitlements: { active: {} } } as never)).toBe(false);
    expect(hasPremium({ entitlements: { active: { premium: {} } } } as never)).toBe(true);
    expect(hasPremium({ entitlements: { active: { other: {} } } } as never)).toBe(false);
  });
});
