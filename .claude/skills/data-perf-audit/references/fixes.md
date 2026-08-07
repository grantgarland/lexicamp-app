# Fix patterns

Worked patterns for the five cost centers, written for this codebase's conventions. Each
one states what it does *not* change, because in an app where a mis-scheduled card is worse
than a slow screen, the blast radius is the important half of the proposal.

Adapt rather than paste — these show the shape, not the final code.

## Contents

- [Surgical cache updates instead of invalidation](#surgical-cache-updates-instead-of-invalidation)
- [Narrow what a consumer subscribes to](#narrow-what-a-consumer-subscribes-to)
- [Split a wide read into the reads each screen needs](#split-a-wide-read-into-the-reads-each-screen-needs)
- [Persist less](#persist-less)
- [Memoize derivations](#memoize-derivations)
- [Push aggregation into Postgres](#push-aggregation-into-postgres)
- [Parallelize paging](#parallelize-paging)

---

## Surgical cache updates instead of invalidation

**When:** the mutation knows what changed. That is most of them here — `setCardSuspended`
knows the card id and the new flag; `commitQuizSession` knows every rated card.

**Why it wins:** `invalidateQueries({ queryKey: ['words'] })` tells Query "this might be
wrong, go find out," which costs a full paged refetch. `setQueryData` says "here is exactly
what changed," which costs an array map. It also removes the refetch flicker, so the UI gets
better and cheaper at the same time.

```js
// Before — one archive toggle refetches the entire library, twice over.
onSuccess: () => {
  qc.invalidateQueries({ queryKey: ['deckCards'] });
  qc.invalidateQueries({ queryKey: ['words'] });
  qc.invalidateQueries({ queryKey: ['dueCards'] });
}

// After — patch the row we changed; only re-fetch what we genuinely can't derive.
onSuccess: (_res, { cardId, suspended }) => {
  qc.setQueriesData({ queryKey: ['words'] }, (prev) =>
    prev == null ? prev : prev.map((w) => (w.id === cardId ? { ...w, suspended } : w)),
  );
  // dueCards is a server-ordered, server-limited queue with fill semantics
  // (18 §2c) — the client cannot recompute which card fills the freed slot,
  // so this one stays an invalidate.
  qc.invalidateQueries({ queryKey: ['dueCards'] });
}
```

Use `setQueriesData` (plural) rather than `setQueryData`, because the keys carry
`userState`, `activeLang`, and `uid` — the singular form would need the exact key and would
silently miss every variant.

**Does not change:** what the server stores, or FSRS scheduling. The cache converges on the
next natural refetch regardless, so a patch that is subtly wrong self-heals rather than
corrupting anything. That asymmetry is what makes this the safe direction.

**Watch out:** anything with server-side ordering, limiting, or fill semantics cannot be
patched client-side. `dueCards` is the clear example — `getDueCards` does two ordered pulls
and tops up to `limit`, and the comment at `SupabaseDataSource.getDueCards` documents a real
bug from getting that ordering wrong. Leave it as an invalidate and say why in a comment.

## Narrow what a consumer subscribes to

**When:** a component needs a count, a single word, or a filtered slice, but subscribes to
the whole array.

`select` runs after the query resolves and its result is what triggers the re-render, so a
consumer selecting a number only re-renders when that number changes — even if every other
word in the library was replaced.

```js
// A header that shows "1,284 words" should not re-render when word #900's
// stability changes.
const count = useQuery({
  queryKey: ['words', userState, activeLang, uid],
  queryFn: () => ds.getWords(activeLang),
  select: (words) => words.length,
}).data ?? 0;
```

There is no `select` usage in the app today, so this is unclaimed ground with a low risk
profile. Keep the `select` function referentially stable (module scope or `useCallback`)
or it re-runs every render, which quietly gives back the win.

**Does not change:** the fetch, the cache, or the key. Purely a subscription narrowing.

## Split a wide read into the reads each screen needs

**When:** one method serves consumers with very different needs — `CARD_JOIN` today serves
both Word List (needs examples) and Home/Progress (needs FSRS state and counts only).

```js
// A stats-shaped read: same rows, a fraction of the bytes.
const STATS_JOIN =
  'id, suspended, created_at, decks!cards_deck_id_fkey!inner ( target_lang ), ' +
  'card_fsrs_state ( stability, difficulty, due_at, last_review_at, state, reps, lapses )';
```

**Does not change:** the row set, so counts and totals stay consistent — which matters
here, because the 07-17c ruling in `getDeckCards` exists to keep Home, Progress, Settings,
and the Words header agreeing with each other. Verify `homeSnapshot` and `projection.ts`
touch no field you dropped; the contract tests in `src/data/__tests__/` are the check.

**Cost:** a new `DataSource` method means updating the mock, the Supabase implementation,
and `dataSourceContract.ts`. Worth it for the Home read; not worth it for a marginal one.

## Replace the parse reviver with an explicit walk

**When:** cold launch is slow and the persisted cache is large. Measured **74.2 ms → 19.3 ms
(3.8×)** at 4,300 words — the cheapest win in this playbook, and the one the reference doc
originally told people to skip.

**Why it wins:** `JSON.parse` invokes a reviver once per *node* in the document, not once
per date. At `veteran` that is 188,149 calls to produce 24,391 `Date`s — 87% pure callback
overhead. The reviver's body is already minimal; the fix is to stop calling it 164,000
unnecessary times.

```js
// Before — queryClient.ts: the reviver visits every field of every card.
deserialize: (cached) => JSON.parse(cached, reviveDates),

// After — parse plain, then convert only the known date fields in the hydrated
// results. Same DATE_KEYS, same semantics, and arguably safer: an explicit walk
// cannot be reached by a `dueAt` key that happens to appear inside React Query's
// cache envelope, which is the exact hazard reviveDates' own comment describes.
deserialize: (cached) => reviveInPlace(JSON.parse(cached)),
```

**Does not change:** the persisted shape, so **no `buster` bump**. `DATE_KEYS` stays the
single source of truth for which fields are dates.

**Risk:** low and local. The failure mode is the documented one — `dueAt.getTime is not a
function` inside `homeSnapshot` — which `npm test` already catches via the veteran-scale
suite. Ship it on its own so it stays independently revertable.

## Persist less

**When:** the persisted cache is large and cold launch is slow.

The question to answer first is which queries actually need to survive a cold launch. The
offline-read guarantee (2.4) is about words, decks, and home stats — not about `lookup` and
`examples` results, which are per-search and re-fetchable.

```js
persistQueryClient({
  queryClient,
  persister: createAsyncStoragePersister({ /* … */ }),
  maxAge: 7 * DAY,
  buster: 'v1',
  dehydrateOptions: {
    shouldDehydrateQuery: (q) => {
      const root = q.queryKey[0];
      // Search results are cheap to re-fetch and unbounded in count; keeping
      // them out of the persisted blob keeps cold-launch parse time tied to
      // library size rather than to how much the user has searched.
      return root !== 'lookup' && root !== 'examples';
    },
  },
});
```

**Does not change:** in-memory caching. Those queries still cache normally within a session;
they just don't get written to disk.

**Bump `buster` if the persisted shape changes incompatibly.** Dropping keys is safe (a
missing entry just refetches). Changing the *shape* of a retained entry is not — a stale
blob rehydrating into new code is a crash on the launch after upgrade.

**The bigger version of this fix** — moving word data out of the JSON cache entirely, to
SQLite or MMKV — removes the parse cost rather than shrinking it. It is a genuine migration
with a rollout question, so propose it only with a measurement showing the parse is actually
the bottleneck, and never bundled with a smaller fix.

## Memoize derivations

**⚠️ Profile before proposing this.** `app.json` sets `experiments.reactCompiler: true`, so
the React Compiler is already auto-memoizing this build and a hand-written `useMemo` is
probably redundant. An unmemoized full-library derivation is the most inviting-looking
finding in this app and the easiest one to be confidently wrong about. Confirm with React
DevTools Profiler that the derivation actually re-runs on an unrelated re-render; if it
doesn't, put that in *Deliberately not recommended* rather than shipping a no-op.

The pattern below still applies where profiling shows a genuine re-run — the compiler bails
out on code it can't prove safe, so "compiler is on" is not the same as "everything is
memoized."

**When:** a full-library derivation runs in a hook or render body **and the profiler shows
it re-running**.

```js
// Before: re-runs over 5,000 cards on every render of every consumer.
const snapshot = deck.data != null ? homeSnapshot(deck.data.cards, deck.data.states) : null;

// After: re-runs only when the query hands back new data.
const snapshot = useMemo(
  () => (deck.data != null ? homeSnapshot(deck.data.cards, deck.data.states) : null),
  [deck.data],
);
```

`deck.data` is referentially stable across renders until the query updates, so it is a
sound dependency. The change itself is local and cannot alter behavior — the risk here is
not breaking something, it's spending a reviewer's attention on a no-op.

Doing it via `select` instead is often better still — then the derivation lives with the
query and consumers re-render only when the *snapshot* changes, not whenever the underlying
array is replaced with an equal one.

**Does not change:** the derivation's output. If memoizing changes what renders, the
derivation was reading something outside its arguments, and that's the real bug.

## Push aggregation into Postgres

**When:** the client fetches N rows to produce a handful of numbers.

`getEngagement` and `getProgressStats` already do this correctly — both call the
`get_study_stats` RPC rather than counting rows client-side. That is the model to follow.
The gap is `getDeckCards`, which pulls the whole library so `homeSnapshot` can derive
counts and a due breakdown.

**Does not change:** the numbers, if the SQL mirrors `homeSnapshot`'s logic — which is the
whole risk. Two implementations of the same derivation drift, and drift here shows up as
Home and Word List disagreeing, which is exactly the class of bug the 07-17c ruling was
about. Only propose this with a test that runs both against the same fixture and asserts
they agree.

## Parallelize paging

**When:** `fetchAllPages` is the measured bottleneck and the library is large.

The loop is serial because a short page is how it learns it's done. Requesting a few pages
concurrently trades round trips for possible over-fetching:

```js
// Fetch pages in batches of 3; stop at the first short page in the batch.
// At 5k words this is ~2 sequential waits instead of 6.
```

**Does not change:** the row set or its ordering — the `ORDER BY` guarantee that makes
paging stable is unaffected, and that guarantee is load-bearing (an unordered paged read
can duplicate one row and skip another, which the comment on `fetchAllPages` calls out as
worse than truncation because it looks plausible).

**Measure first.** If the payload rather than the latency is dominant, narrowing the join
is the better fix and this one adds concurrency for nothing.
