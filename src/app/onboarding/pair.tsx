import { OnboardingPairScreen } from '@/screens/OnboardingPairScreen';

// Step 3 of the register-first flow (spec `24`): the language pair, collected
// AFTER auth. Reached only by the first-run gate in (tabs)/_layout.tsx, which
// routes here whenever there is a session but no `profiles` row.
export default function OnboardingPair() {
  return <OnboardingPairScreen />;
}
