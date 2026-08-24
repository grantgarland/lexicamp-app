## Addendum (2026-08-21) — ✅ GREEN. The full eight-flow suite passes on Android CI.

Run [`32463594990`](https://github.com/grantgarland/lexicamp-app/actions/runs/32463594990)
— scheduled, at `5ff5f82` — went **8/8 in 13m 27s**:

| flow | time | flow | time |
|---|---|---|---|
| word-list | 2m 2s | walkthrough | 2m 33s |
| word-capture | 1m 58s | settings | 1m 17s |
| smoke | 24s | progress | 34s |
| decks | 3m 6s | quiz | 1m 33s |

Job total 41m0s; the emulator leg is 13m of that and the EAS build is the rest,
which is the right shape — adding flows is nearly free, adding builds is not.

**This is the first time the suite and the platform CI runs have been green
together, and it is a different milestone from the one the project docs have
been citing.** `00`, `README` and `02` all carried *"first fully-green scheduled
run 2026-07-17"*. That run (`29571814268`) executed **one flow** — `smoke.yaml`,
1m 1s, boot plus a handful of asserts. The other seven landed 2026-08-06,
verified on a **local iOS simulator** and never once on the Android emulator the
nightly actually drives. Every scheduled run from 2026-07-18 through 2026-08-19
was red. All three docs are now corrected.

**The last gap.** 2026-08-19 (`32232721720`) was 7/8: `settings` failed
`Assertion is false: "Email support — opens your mail app" is visible`. Closed by
`0499cbc` *(fix(e2e): centre every Settings row in the FAB's reach, not just
About)*, following `5a9b917` *(fix(e2e): unstick settings and quiz from two
stolen-tap failures)*.

**The pattern in this whole file, now that it has an end.** Every entry above is
the same class of bug and not one is app logic: a results card behind the
keyboard (07-22), a row under the FAB, a tap stolen by an overlay, a beacon
inside the status-bar window, uppercase a11y text against a case-sensitive
matcher (07-15). **Maestro on an emulator tests geometry and timing as much as
behaviour.** When a flow goes red, read it as "something moved" before reading it
as "something broke" — and read the flow's own header before suspecting the app.

⚠️ **One green run is not a trend.** Given that failure mode, the signal is a
streak, not a single pass. The next two scheduled runs (Mon/Wed) are the ones
worth watching. Do not start discounting a red nightly on the strength of this
one — per `07-ai-operating-model.md`, a red nightly still outranks the backlog.

⚠️ **Still not covered, and worth its own look:** the quiz's × exit.
`tapOn: quizClose` reports SUCCESS and the exit-confirm sheet never appears
(observed 2026-08-04), while the same logic passes in `QuizScreen.test.tsx`.
`quiz.yaml` therefore leaves the quiz only by *completing* a session. The testIDs
are correct and present — this is a native defect, not a missing test.

⚠️ **Two doc-location notes.** `02-technical-architecture.md` had this file
archived at `lexicamp-app/docs/history/SMOKE_TEST_DIAGNOSIS.md`; it is at the app
root and `docs/history/` is empty. The path in `02` is corrected — the move
itself never happened. Separately, `quiz.yaml`'s header labels itself `CI-4c`; it
is `CI-4d` (`CI-4c` is `word-capture.yaml`).

---

## Addendum (2026-07-22) — crash fixed for real; word-capture now fails on keyboard occlusion

The 07-22 run PROVES the reanimated fix: `smoke` passed, `word-capture` launched
clean (no addViewAt FATAL), and got PAST `extendedWaitUntil: volar` — the results
card that used to crash now renders. New red: `assertVisible: "mosca"`.

Diagnosis (logcat, not a guess): the mock returns two senses for 'fly' — volar
(VERB, primary/expanded) and mosca (NOUN, second/collapsed row, rendered as
"la mosca"). The expanded primary sense is tall, so the second-sense row AND the
Save button sit in the bottom third of the screen. The search input has autoFocus,
so the IME is up the whole time. In the logcat dump volar (near the top) reads
visible, while `result-save` (y≈1528) and the mosca row (y≈1715) are logged as
invisible children — behind the keyboard. mosca renders fine; it's occluded.

Fix: `.maestro/word-capture.yaml` — add `- hideKeyboard` after the volar wait,
before the mosca assert + result-save tap (both live in the occluded zone). Later
`tapOn search-input` steps re-open the keyboard on their own. `hideKeyboard` is a
command, not a text selector, so maestroStrings.test.ts ignores it (still 24/24).

Also re-applied: src/ui/TranslationCard.tsx — the 07-18 entering/exiting→View
hardening had been REVERTED by a later feature commit (SearchScreen's half
survived; TranslationCard's did not — the fix was committed to the device tree but
never git-committed, so feature work overwrote it). word-capture doesn't tap a
sense to expand, so the accordion swap wasn't exercised this run, but it's the same
latent crash — re-applied to prevent regression. LESSON: git-commit smoke fixes;
device-tree edits get clobbered.

Verified locally: maestroStrings 24/24; TranslationCard 0 tsc errors. NOT rehearsed
on an emulator (none here) — green still pending a workflow_dispatch.

Pre-existing, NOT mine, NOT the mosca blocker (flagging for a separate fix):
`tsc --noEmit` reports 1 error — src/screens/SearchScreen.tsx(43,5): the toCardResult
`example` object is inferred without `target` where Translation expects it. In a file
the recent feature commits modified (newer mtime); EAS builds via metro (no tsc gate)
so it didn't block the build, but a typecheck CI would go red on it.
