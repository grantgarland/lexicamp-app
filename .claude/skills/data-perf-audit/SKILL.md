---
name: data-perf-audit
description: Audit and fix data-fetching and state-management performance in the Lexicamp app — TanStack Query, the AsyncStorage-persisted query cache, Zustand stores, the DataSource/Supabase read path, and the derivations that run over a user's whole word library. Use this whenever the work touches how words are fetched, cached, invalidated, persisted, or re-derived, and whenever anyone reports the app feeling slow, janky, or slow to launch — cold-start lag, a stutter after answering a quiz card, a sluggish Word List, spinners after a save, or battery/data complaints. Also use it before adding a new query hook or a new mutation's invalidation list, since those are exactly where this app's cost gets set. Triggers on "slow", "laggy", "janky", "perf", "optimize fetching", "too many refetches", "cache", "hydration", "5k words", "large library", or any question about whether a change will scale to a heavy user.
---

# Data & state performance audit

## What this skill is for

Lexicamp has one performance axis that matters: **library size**. A learner with 40 saved words will never notice anything. A veteran with 5,000+ words in one language hits every cost in the app at once — the read path, the cache, the persistence layer, the derivations, and the render tree. Everything else (animations, navigation, image loading) is comfortably within budget.

So this audit is deliberately narrow. It asks one question in five places: **what does this cost when `words.length` is 5,000 instead of 40?**

Work in evidence → diagnosis → fix → proof order. The failure mode to avoid is optimizing what feels slow rather than what is slow: this codebase is unusually well-commented, and it is easy to read a thoughtful comment about correctness and mistake it for a claim about cost. Comments explain *why* code is correct. They say nothing about how it scales.

## Step 1 — Gather evidence before forming an opinion

Run the scanner. It collects the raw material the rest of the audit reasons over, so you are not grepping the same things by hand every time:

```bash
bash .claude/skills/data-perf-audit/scripts/scan.sh
```

It reports: every query key and where it's read, every `invalidateQueries` call grouped by the mutation that fires it, `setQueryData` vs. invalidate ratio, `select:` narrowing usage, `useMemo` coverage in the hooks and derivation layers, list-rendering primitives, and the persisted-cache configuration.

Then read `references/hot-spots.md`. It is a map of this app's specific cost structure — the read path, the invalidation graph, the persistence tax, the derivation fan-out — with the measurements that were true when it was written. **Verify before you cite it.** It describes the code as of 2026-08-05; if it disagrees with what the scanner just printed, the scanner is right and the reference is stale (fix it as part of your change).

## Step 2 — Measure, don't estimate

An audit that reports "this is O(n) and n is large" is not actionable — the team can already read the code. What makes a finding land is a number attached to a user-visible moment.

Read `references/measuring.md` for how to instrument this app specifically. The short version: seed a 5,000-word library through the existing test fixtures, then time these four moments, which are the ones users actually feel:

| Moment | What it exercises |
|---|---|
| Cold launch to first paint | AsyncStorage read → JSON.parse → `reviveDates` over the whole cache |
| Answering one quiz card | The mutation's invalidation fan-out and everything it refetches |
| Opening Word List | Full-library fetch, sort/filter, and list render |
| Backgrounding the app | Cache dehydrate → `JSON.stringify` → AsyncStorage write |

Take each measurement at ~40 words and at ~5,000. The ratio between them is the finding. A step that goes 12ms → 15ms is fine no matter how ugly the code is; one that goes 12ms → 2,400ms is the report.

If you genuinely cannot measure something (needs a device, needs a real network), say so plainly and mark the finding as unquantified rather than inventing a number. An honest "suspected, unmeasured" is useful; a fabricated millisecond count poisons every decision downstream.

## Step 3 — Diagnose against the five cost centers

Every real finding in this app lands in one of these. Walk them in order — earlier ones dominate, and fixing an earlier one often makes a later one moot.

**1. Read amplification.** How many rows cross the wire, how many round trips, and how wide each row is. The `DataSource` methods are param-light by design, which is good for call sites and dangerous for cost: `getWords()` and `getDeckCards()` both page the entire library through the same wide join. Ask whether the caller needs every row, every column, and whether the work could happen in Postgres instead of in JS.

**2. Invalidation fan-out.** What one write costs. This is where the app's cost is really set: a mutation that invalidates `['words']`, `['deckCards']`, and `['dueCards']` has just scheduled multiple full-library refetches in response to a single card review. The question is always whether the mutation *knows* what changed — if it does, patching the cache with `setQueryData` is both faster and less flickery than telling Query to go find out.

**3. Persistence tax.** The whole query cache serializes to AsyncStorage. That means every persisted byte is paid for twice per session (stringify on write, parse plus `reviveDates` on read), on the JS thread, at times when the user is watching. Ask what actually needs to survive a cold launch and what is merely in the cache because it was fetched.

**4. Derivation fan-out.** `domain/derive.ts` and `domain/projection.ts` compute over full card arrays. Ask how often they run, whether the result is memoized, and whether a render-path recomputation is happening on every parent render rather than when the data changes.

**5. Render fan-out.** Whether one word changing re-renders one row or the whole screen. Zustand selector granularity, `useQuery`'s `select` option for narrowing, list virtualization, and row memoization.

## Step 4 — Propose fixes in cost-to-benefit order

Read `references/fixes.md` for the concrete patterns — it has worked examples for surgical cache updates, `select` narrowing, splitting a wide read into a list read and a stats read, filtering what gets persisted, and moving aggregation into Postgres.

Rank proposals by benefit-per-unit-of-risk, and say the risk out loud. In this codebase specifically:

- **Correctness beats speed, always.** The comments in `usePullToRefresh`, `outbox.ts`, and `SupabaseDataSource.getDueCards` document bugs that were painful to find — a double-replay that double-advanced a card's schedule, an embed ordering that silently skipped overdue words. Any optimization that touches FSRS scheduling, the outbox, or the due-queue ordering needs to explain why it cannot resurrect those. If it can't be explained, don't propose it.
- **Prefer reversible changes first.** Adding `select` narrowing or a `useMemo` is local and easy to revisit. Restructuring query keys or moving the cache off AsyncStorage is a migration with a rollout question attached. Sequence accordingly, and don't bundle a cheap fix with an expensive one in the same change — it makes the expensive one un-revertable.
- **A cache-shape change needs the `buster`.** `query/queryClient.ts` has a `buster: 'v1'` for exactly this. If your change makes previously persisted data un-rehydratable, bump it in the same change, or users get a crash on the launch after upgrade.

## Step 5 — Report

Use this structure. It is short on purpose: the value is in the numbers and the ranking, not in the prose.

```markdown
# Data & state perf audit — <scope>

## Headline
<one sentence: the single thing most worth fixing, and what it costs today>

## Measurements
| Moment | ~40 words | ~5,000 words | Ratio |
|---|---|---|---|
<measured numbers only; write "not measured" where you could not measure>

## Findings
### F1 — <title> · <cost center> · <measured impact>
**What happens:** <the mechanism, with file:line>
**Why it costs:** <what scales with library size>
**Fix:** <the change, and what it does NOT change>
**Risk:** <what could break, especially correctness invariants>

## Recommended order
1. <cheapest high-impact fix first>
...

## Deliberately not recommended
<things that look like wins but aren't, and why — this section prevents the
next audit from re-proposing them>
```

The last section earns its place. Without it, every audit re-litigates the same rejected ideas.

## Step 6 — If you're implementing, prove it

A fix without an after-measurement is a hypothesis. Re-run the same four timings from Step 2 and put before/after in the change description.

Also confirm you didn't trade a perf win for a correctness loss: `npm test` covers the data-source contract, the outbox serialization, and the veteran-scale scenario (`src/data/__tests__/veteranScenario.test.ts`) — that last one exists precisely because large libraries are where this app breaks. If your change makes it pass faster, good. If it makes it fail, the change is wrong, not the test.
