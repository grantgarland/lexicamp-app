// isPaid — the single client-side definition of "premium unlocked".
//
// The period-end backstop exists because of a real incident (2026-08-17): a
// broken webhook secret ate one EXPIRATION event, and the mirror sat on
// `status: 'active'` with a period end 16 hours in the past. Without the
// backstop that account keeps premium forever, because `status` is only ever
// corrected by an inbound event that is now never coming.
import { isPaid, type Entitlement } from '../types';

const HOUR = 60 * 60 * 1000;
const ent = (over: Partial<Entitlement> = {}): Entitlement => ({
  status: 'active',
  plan: 'annual',
  platform: 'ios',
  currentPeriodEnd: new Date(Date.now() + HOUR),
  autoRenew: true,
  ...over,
});

describe('isPaid', () => {
  it('unlocks an active or trial subscription inside its period', () => {
    expect(isPaid(ent({ status: 'active' }))).toBe(true);
    expect(isPaid(ent({ status: 'trial' }))).toBe(true);
  });

  it('does NOT unlock once the period has ended, even while status says active', () => {
    // The exact shape of the 2026-08-17 leak.
    expect(isPaid(ent({ status: 'active', currentPeriodEnd: new Date(Date.now() - 16 * HOUR) }))).toBe(false);
    expect(isPaid(ent({ status: 'trial', currentPeriodEnd: new Date(Date.now() - 1000) }))).toBe(false);
  });

  it('keeps grace unlocked despite a past period end', () => {
    // BILLING_ISSUE means "payment failed, keep access while it retries". Its
    // period end is already past by definition, so applying the backstop here
    // would revoke access the instant grace began, deleting the concept.
    expect(isPaid(ent({ status: 'grace', currentPeriodEnd: new Date(Date.now() - 5 * HOUR) }))).toBe(true);
  });

  it('treats a missing period end as paid', () => {
    // set_dev_plan writes status with no date, and a real subscriber missing the
    // field should not lose access over absent data.
    expect(isPaid(ent({ status: 'active', currentPeriodEnd: null }))).toBe(true);
  });

  it('ignores autoRenew — a cancelled plan is still PAID until it lapses', () => {
    // 3.15's column drives COPY ("Renews" vs "Cancelled"), never access. A user
    // who cancels has paid through the period end and keeps premium until then;
    // gating on autoRenew here would revoke access at the moment of cancelling,
    // which is the same bug the CANCELLATION mapping exists to avoid.
    expect(isPaid(ent({ status: 'active', autoRenew: false }))).toBe(true);
    expect(isPaid(ent({ status: 'active', autoRenew: null }))).toBe(true);
  });

  it('never unlocks free or expired, whatever the date says', () => {
    expect(isPaid(ent({ status: 'free', currentPeriodEnd: new Date(Date.now() + HOUR) }))).toBe(false);
    expect(isPaid(ent({ status: 'expired', currentPeriodEnd: new Date(Date.now() + HOUR) }))).toBe(false);
  });
});
