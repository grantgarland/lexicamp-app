# Measuring

The goal is a ratio: cost at a normal library size vs. cost at a veteran's. A single
absolute number tells you nothing, because the machine, the build type, and the network all
move it. The *ratio between 40 words and 5,000 words on the same machine* is stable, and
it's what identifies which code path actually scales badly.

## Contents

- [Getting a 5,000-word library](#getting-a-5000-word-library)
- [The four moments](#the-four-moments)
- [Timing in JS](#timing-in-js)
- [When you can't measure](#when-you-cant-measure)
- [Reading the numbers honestly](#reading-the-numbers-honestly)

---

## Getting a 5,000-word library

Don't create real data against a real Supabase project for this. Three options, cheapest
first:

**1. Node-level, via the mock DataSource.** `src/data/mock.ts` is scenario-driven through
the dev store. This is the fastest loop for measuring *derivations* (`homeSnapshot`,
`projection.ts`) and *serialization* (stringify/parse/`reviveDates`) — all of which are pure
functions over arrays, and all of which can be timed in a plain Jest run with no device.

The fixtures you want are already there: `DISTRIBUTION` in `mock.ts` gives `abc` = 38 words
and `veteran` = 4,300 (180+260+340+470+3050). Use those two as your small/large pair rather
than inventing sizes. Note 4,300 is under the nominal 5,000, so the mock's paging worst case
is 5 serial round trips, not 6 — don't quote 6 off the top of your head.

One gotcha: `performance.now()` under `jest-expo` resolves to whole milliseconds, which is
useless for sub-ms derivations. Use `process.hrtime.bigint()` and batch (e.g. 50 inner
iterations per sample, median of 11).

`src/data/__tests__/veteranScenario.test.ts` already exists for large-library behavior;
read it first, since it likely has the fixture-building you need.

**2. In-app, via the dev scenario knob.** For anything involving the query cache, the
persister, or real renders, run the app against a mock scenario sized to 5k. This is the
only way to measure cold launch and render fan-out.

**3. A seeded Supabase branch.** Only for measuring the network read path (`fetchAllPages`
round trips, join payload size). Use a branch, never production data.

State which one you used in the report. A parse timing from Node and a cold-launch timing
from a physical device are not comparable, and mixing them silently is how an audit ends up
recommending the wrong fix.

## The four moments

These are the ones users feel. Measure each at ~40 and ~5,000.

**Cold launch to first paint.** Kill the app, launch, time until the first screen renders
real data. This is dominated by `AsyncStorage.getItem` → `JSON.parse(cached, reviveDates)`.
To isolate the parse from everything else, time the deserialize step directly in Node with a
cache blob dumped from a seeded app.

**Answering one quiz card / committing a session.** Time from the mutation firing to the UI
settling. This is the invalidation fan-out, and it's where the biggest ratio usually lives —
one review triggering full-library refetches is a constant cost per review, so it scales
with both library size *and* session length.

**Opening Word List.** Time to first rows painted, and separately time the sort/filter work.
`FlatList` bounds how many rows mount, so if this is slow it's the fetch or the derivation,
not the list.

**Backgrounding.** Time the dehydrate + `JSON.stringify` + AsyncStorage write. Users
experience this as the app being sluggish right as they leave it, or as a dropped frame on
the way out.

## Timing in JS

`performance.now()` is available in Hermes and gives sub-millisecond resolution:

```js
const t0 = performance.now();
const snapshot = homeSnapshot(cards, states);
console.log(`homeSnapshot(${cards.length}): ${(performance.now() - t0).toFixed(1)}ms`);
```

Three things that will otherwise mislead you:

- **Run the same measurement 5+ times and take the median.** First-run numbers include
  JIT warm-up and lazy module init; a single sample regularly lands 3× off.
- **Measure release builds, not dev.** Dev mode adds React strict-mode double-renders and
  unminified code. A dev-mode ratio is directionally useful; a dev-mode absolute number is
  not something to put in a report without labeling it.
- **The dev-knob cache multiplier is not worth chasing.** Query keys include `userState`
  and `plan`, so flipping scenarios does leave several library copies in the cache — but
  measured, a blob holding `abc` + `summit` + `veteran` is **4.48 MB vs 4.38 MB for
  `veteran` alone (~2%)**, because every other scenario is tiny (38 and 60 words). An
  earlier draft of this file told you to clear the cache between measurements; that was
  caution without a number behind it. Ignore it unless you've been flipping between two
  *large* scenarios.

For render fan-out, React DevTools Profiler answers "did one word change re-render one row
or the whole screen" better than any timer will.

## When you can't measure

Say so. Mark the finding **suspected, unmeasured** and explain what would confirm it.

A reader can act on "this is O(n) over the library and I could not time it on device — a
release-build cold launch at 5k words would confirm." A reader cannot act on a number that
turns out to have been a guess, and once one number in a report is invented, none of them
can be trusted. Unmeasured findings are still worth reporting; fabricated ones destroy the
report.

## Reading the numbers honestly

- **Ratios, not absolutes, identify the problem.** 12ms → 15ms is a non-finding regardless
  of how bad the code looks. 12ms → 2,400ms is the headline.
- **A big ratio on a rare operation may not matter.** Weight by frequency: a cost paid once
  per cold launch is very different from one paid once per answered card.
- **Check the constant too.** A path that is O(1) in library size but 400ms every time is
  still a bug — it just isn't this skill's bug. Note it and move on rather than absorbing
  the whole app's performance work into a data-layer audit.
- **Correlate with the user's actual complaint.** If someone reports the Word List being
  janky and your measurements say the Word List is fine but cold launch is terrible, that
  is worth stating explicitly. You may have found a real problem and *not* the reported one,
  and conflating them means the reported one goes unfixed.
