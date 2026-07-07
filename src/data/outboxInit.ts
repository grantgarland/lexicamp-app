// Outbox replay triggers (2.4): flush queued quiz commits on app start and on
// every return to foreground. Kept separate from outbox.ts so the queue logic
// itself has no react-native imports (plain-node testable).
import { AppState } from 'react-native';

import { dataSource } from './index';
import { flushOutbox } from './outbox';

export function initOutbox(): void {
  void flushOutbox((p) => dataSource.commitQuizSession(p));
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void flushOutbox((p) => dataSource.commitQuizSession(p));
  });
}
