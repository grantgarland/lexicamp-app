import { ResetPasswordScreen } from '@/screens/ResetPasswordScreen';

// Set-a-new-password step of the recovery flow (DF-3). Reached via the emailed
// deep link — useRecoveryLink (root layout) mints the session and routes here.
export default function ResetPassword() {
  return <ResetPasswordScreen />;
}
