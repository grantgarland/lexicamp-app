// Account deletion, with Sign in with Apple revocation first (`26` B1).
//
// Pure orchestration — no imports — so every branch is unit-testable without
// the native Apple module or a Supabase client. The screen supplies the real
// dependencies; see `screens/settings/sheets.tsx`.
//
// THE POLICY, which the tests pin:
//   • Apple accounts get a revocation attempt BEFORE deletion. Order is not
//     cosmetic: the Edge Function authenticates the caller by their session,
//     and deletion destroys it.
//   • Dismissing Apple's sheet CANCELS the deletion. The user backed out of the
//     one extra step we asked for; deleting anyway would ignore that.
//   • Any OTHER revocation failure is reported and deletion PROCEEDS. Blocking
//     someone from deleting their account is the worse failure — and it is a
//     guideline violation of its own.
//   • A deletion failure propagates, exactly as before this existed, so the
//     screen still surfaces it instead of signing out over a live account.

export type AccountProvider = 'apple' | 'email';
export type DeleteAccountOutcome = 'deleted' | 'cancelled';

export interface DeleteAccountDeps {
  /** The account's sign-in provider, or null if it could not be determined. */
  provider: AccountProvider | null;
  /** A fresh Apple authorization code, or null if the user dismissed the sheet. */
  requestAppleCode: () => Promise<string | null>;
  revokeApple: (authorizationCode: string) => Promise<void>;
  deleteAccount: () => Promise<void>;
  /** Handled-failure telemetry. Must outlive the account (Sentry, not `study_events`). */
  report: (event: string, extra?: Record<string, unknown>) => void;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function deleteAccountWithAppleRevocation(d: DeleteAccountDeps): Promise<DeleteAccountOutcome> {
  if (d.provider == null) {
    // Cannot tell whether this is an Apple account. Deleting without revoking is
    // strictly better than refusing to delete — but make the gap visible.
    d.report('account_delete_provider_unknown');
  } else if (d.provider === 'apple') {
    let code: string | null = null;
    let codeFailed = false;
    try {
      code = await d.requestAppleCode();
    } catch (e) {
      codeFailed = true;
      d.report('apple_revoke_code_failed', { error: errorText(e) });
    }
    if (code == null && !codeFailed) return 'cancelled';
    if (code != null) {
      try {
        await d.revokeApple(code);
      } catch (e) {
        d.report('apple_revoke_failed', { error: errorText(e) });
      }
    }
  }
  await d.deleteAccount();
  return 'deleted';
}
