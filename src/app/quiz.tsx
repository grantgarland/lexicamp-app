import { useLocalSearchParams } from 'expo-router';

import { QuizScreen } from '@/screens/QuizScreen';

// Study session (full-screen modal). Pushed from Home "Study now" with no params
// (the whole active language), or from a deck's "Study Deck" with `deckId` +
// `deckName` — the deck-scoped session (2026-07-30). The name rides along so the
// quiz can title itself without a second fetch; it is display-only, and the
// SESSION is composed server-side from `deckId`, never from the name.
export default function Quiz() {
  const { deckId, deckName } = useLocalSearchParams<{ deckId?: string; deckName?: string }>();
  return <QuizScreen deckId={deckId} deckName={deckName} />;
}
