// Pins the deletion policy from `26` B1. Each branch is a deliberate choice with
// a failure mode on either side, so each gets its own test:
//   cancel  → no deletion (the user backed out of the step we asked for)
//   failure → report and DELETE ANYWAY (never block an account deletion)
//   order   → revoke strictly before delete (the Edge Function needs the session)
import { deleteAccountWithAppleRevocation, type DeleteAccountDeps } from '../deleteAccount';

function deps(overrides: Partial<DeleteAccountDeps> = {}) {
  const calls: string[] = [];
  const d: DeleteAccountDeps = {
    provider: 'apple',
    requestAppleCode: jest.fn(async () => {
      calls.push('code');
      return 'CODE';
    }),
    revokeApple: jest.fn(async (code: string) => {
      calls.push(`revoke:${code}`);
    }),
    deleteAccount: jest.fn(async () => {
      calls.push('delete');
    }),
    report: jest.fn(),
    ...overrides,
  };
  return { d, calls };
}

describe('deleteAccountWithAppleRevocation', () => {
  it('email accounts delete directly — no Apple sheet, no revocation', async () => {
    const { d, calls } = deps({ provider: 'email' });
    await expect(deleteAccountWithAppleRevocation(d)).resolves.toBe('deleted');
    expect(calls).toEqual(['delete']);
    expect(d.requestAppleCode).not.toHaveBeenCalled();
    expect(d.report).not.toHaveBeenCalled();
  });

  it('Apple accounts revoke with the fresh code, strictly BEFORE deleting', async () => {
    const { d, calls } = deps();
    await expect(deleteAccountWithAppleRevocation(d)).resolves.toBe('deleted');
    // Order is load-bearing: apple-revoke authenticates by session; deletion ends it.
    expect(calls).toEqual(['code', 'revoke:CODE', 'delete']);
    expect(d.report).not.toHaveBeenCalled();
  });

  it('dismissing Apple’s sheet CANCELS — nothing is deleted', async () => {
    const { d } = deps({ requestAppleCode: jest.fn(async () => null) });
    await expect(deleteAccountWithAppleRevocation(d)).resolves.toBe('cancelled');
    expect(d.revokeApple).not.toHaveBeenCalled();
    expect(d.deleteAccount).not.toHaveBeenCalled();
    expect(d.report).not.toHaveBeenCalled();
  });

  it('a failure to GET the code is reported, and the account is still deleted', async () => {
    const { d } = deps({
      requestAppleCode: jest.fn(async () => {
        throw new Error('unavailable');
      }),
    });
    await expect(deleteAccountWithAppleRevocation(d)).resolves.toBe('deleted');
    expect(d.revokeApple).not.toHaveBeenCalled();
    expect(d.report).toHaveBeenCalledWith('apple_revoke_code_failed', { error: 'unavailable' });
    expect(d.deleteAccount).toHaveBeenCalledTimes(1);
  });

  it('a failed REVOCATION is reported, and the account is still deleted', async () => {
    const { d } = deps({
      revokeApple: jest.fn(async () => {
        throw new Error('apple_revoke_failed_502');
      }),
    });
    await expect(deleteAccountWithAppleRevocation(d)).resolves.toBe('deleted');
    expect(d.report).toHaveBeenCalledWith('apple_revoke_failed', { error: 'apple_revoke_failed_502' });
    expect(d.deleteAccount).toHaveBeenCalledTimes(1);
  });

  it('an unknown provider is reported and deletes without attempting revocation', async () => {
    const { d, calls } = deps({ provider: null });
    await expect(deleteAccountWithAppleRevocation(d)).resolves.toBe('deleted');
    expect(calls).toEqual(['delete']);
    expect(d.report).toHaveBeenCalledWith('account_delete_provider_unknown');
  });

  it('a DELETION failure propagates, so the screen can still refuse to sign out', async () => {
    const { d } = deps({
      deleteAccount: jest.fn(async () => {
        throw new Error('rpc failed');
      }),
    });
    await expect(deleteAccountWithAppleRevocation(d)).rejects.toThrow('rpc failed');
  });
});
