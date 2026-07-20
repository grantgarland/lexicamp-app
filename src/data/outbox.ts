// Offline outbox (2.4, ratified 2026-07-06: lighter path over the SQLite
// mirror). Two halves:
//   READS  — the query cache persists to AsyncStorage (see query/queryClient),
//            so a cold offline launch still renders the last-known data.
//   WRITES — quiz commits that fail on TRANSPORT errors are queued here and
//            replayed on app foreground / next commit. Replay safety: the
//            SupabaseDataSource re-reads current FSRS states inside
//            commitQuizSession, so a stale queued session recomputes against
//            the freshest state instead of clobbering it.
// Server/gate errors (auth, validation, caps) are NOT queued — they rethrow,
// because retrying them would fail identically.
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { BufferedRating } from '@/domain/quiz';

const KEY = 'lexicamp_commit_outbox_v1';
const MAX_QUEUED = 20; // a runaway queue means something else is wrong

export interface OutboxEntry {
  ratings: BufferedRating[];
  queuedAt: string;
}

/** Transport-level failure (offline, DNS, timeouts) vs a server verdict. */
export function isTransportError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return /network request failed|failed to fetch|fetch failed|timeout|abort|ENOTFOUND|ECONNREFUSED/i.test(e.message);
}

export async function readOutbox(): Promise<OutboxEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
  } catch {
    return [];
  }
}

async function writeOutbox(entries: OutboxEntry[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(entries.slice(-MAX_QUEUED)));
}

// ── Serialization ────────────────────────────────────────────────────────────
// The outbox is a read-modify-write over a single AsyncStorage key, and it has
// two independent triggers (AppState foreground replay in outboxInit + the
// pre-commit flush in commitWithOutbox). Without a lock, overlapping calls read
// the same queued entries and BOTH replay them — commitQuizSession appends
// review_logs and advances the schedule, so a double-replay double-advances a
// card. All queue mutations therefore run through this in-module promise chain.
let queueTail: Promise<unknown> = Promise.resolve();
function serialized<T>(op: () => Promise<T>): Promise<T> {
  const next = queueTail.then(op, op);
  queueTail = next.catch(() => undefined); // keep the chain alive past failures
  return next;
}

export function enqueueCommit(ratings: BufferedRating[]): Promise<void> {
  return serialized(async () => {
    const entries = await readOutbox();
    entries.push({ ratings, queuedAt: new Date().toISOString() });
    await writeOutbox(entries);
  });
}

/** Replay queued commits FIFO. Stops on the first transport failure (still
 *  offline); drops entries the server rejects outright (won't ever succeed).
 *  Serialized: concurrent calls run one-after-another, never over the same
 *  snapshot of the queue. */
export function flushOutbox(commit: (payload: { ratings: BufferedRating[] }) => Promise<void>): Promise<number> {
  return serialized(async () => {
    const entries = await readOutbox();
    if (entries.length === 0) return 0;
    let flushed = 0;
    const remaining = [...entries];
    for (const entry of entries) {
      try {
        await commit({ ratings: entry.ratings });
        remaining.shift();
        flushed += 1;
      } catch (e) {
        if (isTransportError(e)) break; // still offline — keep the rest queued
        remaining.shift(); // server verdict — drop, it will never succeed
      }
    }
    await writeOutbox(remaining);
    return flushed;
  });
}

/** Commit with offline resilience: transport failure → queue + resolve (the
 *  session UX proceeds; data lands on reconnect). Server errors rethrow. */
export async function commitWithOutbox(
  commit: (payload: { ratings: BufferedRating[] }) => Promise<void>,
  payload: { ratings: BufferedRating[] },
): Promise<void> {
  // Older queued sessions first, so review_logs stay chronological-ish.
  await flushOutbox(commit);
  try {
    await commit(payload);
  } catch (e) {
    if (isTransportError(e)) {
      await enqueueCommit(payload.ratings);
      return;
    }
    throw e;
  }
}

// (The AppState foreground-replay trigger lives in outboxInit.ts so this
// module stays free of react-native imports and unit-tests in plain node.)
