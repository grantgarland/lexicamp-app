import { OnboardingScreen } from '@/screens/OnboardingScreen';

// Step 1 of the register-first flow (spec `24`): the one-screen value pitch.
// Hands off to /auth. The eight-step pre-auth arc it replaced is described in
// the screen header.
export default function Onboarding() {
  return <OnboardingScreen />;
}
