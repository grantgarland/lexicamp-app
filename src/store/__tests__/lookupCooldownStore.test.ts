import { useLookupCooldown } from '../lookupCooldownStore';

describe('lookup cool-down store (26 B15)', () => {
  beforeEach(() => useLookupCooldown.setState({ cooldown: null }));

  it('starts a cool-down', () => {
    useLookupCooldown.getState().start('rate_limited', 5_000);
    expect(useLookupCooldown.getState().cooldown).toEqual({ until: 5_000, reason: 'rate_limited' });
  });

  it('extends to a later deadline', () => {
    useLookupCooldown.getState().start('rate_limited', 5_000);
    useLookupCooldown.getState().start('service_busy', 9_000);
    expect(useLookupCooldown.getState().cooldown).toEqual({ until: 9_000, reason: 'service_busy' });
  });

  it('never shortens one already running — lookups must not resume early', () => {
    useLookupCooldown.getState().start('rate_limited', 9_000);
    useLookupCooldown.getState().start('rate_limited', 5_000);
    expect(useLookupCooldown.getState().cooldown?.until).toBe(9_000);
  });
});
