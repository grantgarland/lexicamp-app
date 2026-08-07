# Hot spots — Lexicamp's actual cost structure

Written 2026-08-05 against `main`. This is a map, not a verdict: it tells you where to
look and what was true then. Re-verify with `scripts/scan.sh` before citing any of it —
if the scanner disagrees, the scanner wins, and you should update this file as part of
your change so the next audit starts from truth.

## Contents

- [The read path](#the-read-path)
- [The invalidation graph](#the-invalidation-graph)
- [The persistence tax](#the-persistence-tax)
- [Derivations](#derivations)
- [Render fan-out](#render-fan-out)
- [Things that are already fine](#things-that-are-already-fine)

---

## The read path

`src/data/supabase/SupabaseDataSource.ts`

Three methods page a library-sized set, all through `fetchAllPages` (`PAGE_SIZE = 1000`,
`MAX_PAGES = 200`):

- `getDeckCards(lang)` — every card + FSRS state for the active language. Feeds Home and
  Progress via `homeSnapshot`.
- `getWords(lang)` — every card, mapped to `WordListItem`. Feeds Word List.
- `getDeckWords(deckId, lang)` — one custom deck's membership. Usually far smaller, but
  membership is additive and a deck can hold the whole library, so it carries the same
  worst case.

Three things to notice:

**Paging is sequential.** `fetchAllPages` awaits each page before requesting the next, so
5,000 words is 6 serial round trips (5 full pages + one short page to prove it's the last).
On a slow connection that's the dominant term, and it's latency, not bandwidth — the pages
are independent and could overlap. The one caveat: the loop's early exit depends on seeing
a short page, so parallelizing means deciding how many pages to speculate on.

**The join is wide.** `CARD_JOIN` pulls `translations_cache(… examples, alt_translations,
back_translations …)` — JSON blobs — for every row. Word List uses one example sentence per
row; `getDeckCards` → `homeSnapshot` uses none of it. So the Home/Progress read is paying
full example-payload cost for data it discards. This is the single widest gap between what
is fetched and what is used.

**The same rows are fetched twice.** `getWords` and `getDeckCards` hit the same table with
the same join and the same language filter, differing only in ordering, and land in two
separate cache entries (`['words', …]` and `['deckCards', …]`). A user who opens Home and
then Word List pays for the library twice.

## The invalidation graph

`src/query/hooks.ts`

Query keys in use: `profile`, `learningLanguages`, `accountIdentity`, `leaderboard`,
`entitlement`, `deckCards`, `engagement`, `dueCards`, `progressStats`, `words`, `decks`,
`deckWords`, `cardDecks`, `lookup`, `examples`, `notificationPrefs`, `sessionPace`.

The pattern that matters: nearly every mutation ends with the same invalidation triple.

```js
qc.invalidateQueries({ queryKey: ['deckCards'] });
qc.invalidateQueries({ queryKey: ['words'] });
qc.invalidateQueries({ queryKey: ['dueCards'] });
```

`useSaveCard` fires exactly this triple. `useSetCardSuspended` and
`useSetCardTargetOverride` add `['deckWords']` (archived rows still render in deck lists),
`useDeleteCard` adds the four-key `invalidateDeckReads` helper, and `useCommitQuizSession`
invalidates seven keys. So "the triple" is the floor, not the typical case — run `scan.sh`
section 2 for the current per-mutation fan-out rather than trusting this paragraph.

Because these are key *prefixes*, they match every language and user variant in the cache,
not just the active one.

Concretely: **finishing a quiz session invalidates two full-library reads plus the due
queue plus four stat queries**, and each invalidated full-library read is those 6 serial
round trips again. The mutation already knows exactly which cards changed — the buffered
ratings are right there — so this is the highest-leverage place in the app to replace
"go refetch everything" with "patch what changed."

Note the deliberate exceptions, which are correct and should stay: `usePullToRefresh` uses
`refetchQueries` on a screen's own key prefixes rather than a global invalidate, precisely
to avoid dragging the paid-for `lookup`/`examples` caches along. Language switch
(`useSwitchLanguage`) genuinely does invalidate everything, because everything changed.

All 6 `setQueryData` calls in the app target `['profile']` (language switch, quiz length,
username) against 37 `invalidateQueries` calls. So the one query that is cheap to refetch is
the only one patched surgically, and the expensive word-shaped queries are always
invalidated. That inversion is the headline finding unless the scanner says it's been fixed.

Concretely, and measured: `useSetCardSuspended` has no `onMutate` and no `setQueryData`, so
an archived row cannot leave the Word List until a fresh `['words']` array arrives from the
server — 2.06 MB over 5 serial round trips at 4,300 words, plus a concurrent 1.81 MB
`['deckCards']` refetch whenever Home or Progress has been visited this session. That is the
"pause after archiving" users report, and it is ~15 lines of `setQueriesData` to fix.

## The persistence tax

`src/query/queryClient.ts`, `src/query/reviveDates.ts`

The whole client persists to AsyncStorage under `lexicamp_query_cache_v1`, `maxAge` 7 days,
`gcTime` 7 days. There is no `shouldDehydrateQuery` filter, so everything cached gets
written — including both full-library entries and the `lookup`/`examples` results.

The cost lands in two places the user is watching:

- **Cold launch:** `AsyncStorage.getItem` → `JSON.parse` with the `reviveDates` reviver.
  The reviver is called once per key in the entire cache, and allocates a `Date` for every
  `dueAt`, `createdAt`, `lastReviewAt`, `reviewedAt` — at 5,000 words that is tens of
  thousands of `Date` allocations before first paint, on the JS thread.
- **Backgrounding / persist ticks:** `JSON.stringify` over the same structure.

**Measured 2026-08-05 at `veteran` (4,300 words), Node/V8:**

| | Value |
|---|---|
| Persisted blob | **4.38 MB** (`['words']` 1.98 + `['deckCards']` 1.73 = 85%) |
| `JSON.parse` + `reviveDates` | **74.2 ms** (0.74 ms at 38 words — **100×**) |
| Same parse, no reviver | 9.3 ms — so the reviver is a **7.9× tax** |
| Reviver invocations | 188,149, of which **24,391 (13%)** produce a Date |
| `JSON.stringify` per persist tick | 19.4–26.2 ms |

⚠️ **An earlier draft of this file said "the lever here is not making the reviver faster —
it's persisting less." That was wrong, and it steered readers off the cheapest available
win.** The reviver's *body* is indeed near-optimal (a `Set` lookup, no ISO sniffing). Its
*invocation count* is the problem: `JSON.parse` calls a reviver once per node in the
document — every field of every card — so cost scales with total JSON nodes (~44 per word),
not with the number of dates. Parsing plain and then walking only the hydrated results costs
a measured **74.2 ms → 19.3 ms (3.8×)** with identical semantics and no cache-shape change.
See `fixes.md` → *Replace the parse reviver with an explicit walk*.

Two more things this section missed until they were measured:

- **`dehydrate` runs unthrottled.** `query-async-storage-persister` throttles `serialize` +
  `setItem` (1/s) but not `dehydrate`, which runs on every cache event. Hydration itself
  fires `added` events, so startup writes the blob back out at least once for nothing.
- **`persistQueryClient()` runs at module-eval time**, before `expo-router/entry`, because
  `index.js` → `outboxInit` → `queryClient`. So the parse blocks the JS thread while
  `RootLayout` is still returning `null` waiting on 11 Google fonts. That is why the
  symptom is a *blank* screen rather than a skeleton — the font callback can't run on a
  blocked thread.

**⚠️ Android has a hard ceiling here.** `@react-native-async-storage/async-storage` 2.2.0
defaults its Android SQLite DB to 6 MB (`android/config.gradle`), and `gradle.properties`
sets no `AsyncStorage_db_size_in_MB` override. At ~1.02 KB/word the blob hits 6 MB around
**5,900 words** — and the persister swallows the write failure into a retry loop with no
`retry` handler, so the cache silently stops persisting. That surfaces as "offline mode
broke for no reason", not a crash. Unmeasured (needs an Android build) but structural.

## Derivations

`src/domain/derive.ts`, `src/domain/projection.ts` — zero `useMemo` between them, though both
are libraries of pure functions, so any memoization has to happen at the call sites in
`query/hooks.ts` and the screens. (Run `scan.sh` for current line counts and `useMemo`
totals; they're deliberately not repeated here, because a hardcoded count goes stale on the
next commit and a stale number in a reference doc is worse than no number.)

`useHomeData` computes its snapshot inline in the hook body:

```js
const snapshot = deck.data != null ? homeSnapshot(deck.data.cards, deck.data.states) : null;
```

There is no explicit `useMemo` here, and `hooks.ts` has exactly one across its whole length.

**⚠️ This is NOT a cost center. Measured 2026-08-05: `homeSnapshot` costs 0.1–0.6 ms at
4,300 cards** (Node/jest against the `veteran` mock; two independent audits got 0.098 ms and
0.611 ms — different machines and batching, and the spread doesn't matter because both are
noise). Recomputing it every render is real and irrelevant.

Two reasons it looked like a problem and isn't:

1. `app.json` sets `experiments.reactCompiler: true`, so this build is auto-memoized and
   the call is very likely already cached on `deck.data` identity.
2. Even with zero memoization, 0.098 ms is nothing.

This entry is kept — rather than deleted — as the cost center's cautionary tale. An
unmemoized full-library derivation *looks* like an obvious O(n)-per-render bug, and it is
the easiest thing in this audit to write up confidently and be wrong about. The first draft
of this file called it a finding; measurement killed it.

So: adding `useMemo` here for referential stability is defensible, but calling it a
performance win is not. Put it in the report's *Deliberately not recommended* section with
the number attached. That is more useful than silence, because it stops the next audit from
re-proposing the same non-fix.

The transferable lesson for the rest of `derive.ts` / `projection.ts`: a derivation being
O(n) over the library does not make it expensive. Get the number first.

`projection.ts` is the largest derivation surface; check what triggers it and how often
before assuming it's cheap — the same profile-first rule applies.

## Render fan-out

- `WordListScreen` uses `FlatList` — virtualized, which is the right call. **But all three
  follow-up checks fail as of 2026-08-05, and this is where the Word List's scroll cost
  actually lives:** `React.memo` appears nowhere in `src/ui` at all, `keyExtractor` and
  `renderItem` are inline closures rebuilt every render (which defeats VirtualizedList's
  own `PureComponent` cell wrapper), and there is no `getItemLayout` despite rows being
  fixed-height. At `windowSize={7}` that's ~80-90 mounted `ReanimatedSwipeable` subtrees
  re-rendering on every parent render — including every toast, every sheet open, and every
  search keystroke.

  Virtualization bounds how many rows are *mounted*, never how many *re-render*. Reaching
  for `FlashList` before fixing the row identity discipline is treating the wrong layer —
  and it's a native dependency needing a prebuild, so it costs far more than the memo.

  One caveat on `getItemLayout`: a hardcoded row height lies under Dynamic Type, since
  `Text` scales by default. Derive it from `PixelRatio.getFontScale()` or leave it alone.
- **No `useQuery({ select })` narrowing exists anywhere in the app.** Every consumer of a
  word query receives the full array and derives from it, so any change to any word
  re-renders every consumer.
- Zustand stores (`devStore`, `uiStore`, `onboardingStore`, `appearanceStore`,
  `prefsStore`) are small and mostly read with selectors (`useDevStore((s) => s.plan)`),
  which is the right pattern. These are not the problem; don't spend time here unless the
  scanner shows a store being read whole.
- Note the dev-knob-in-query-key pattern (`userState`, `plan` from `devStore` are part of
  most keys). That's intentional — flipping a dev toggle should refetch — but it does mean
  the cache holds a full copy per scenario in development. Don't mistake dev-mode cache
  size for production cache size when measuring.

## Things that are already fine

Don't spend audit budget here:

- The outbox (`src/data/outbox.ts`) — serialized through a promise chain, capped at 20
  entries, with a documented double-replay bug behind it. Correct and small.
- `reviveDates` — already keyed on field names rather than sniffing every string.
- `usePullToRefresh` — throttled, in-flight guarded, scoped to the screen's own keys.
- The `DataSource` interface itself — the indirection costs nothing at runtime and is what
  makes the mock/Supabase contract tests possible.
