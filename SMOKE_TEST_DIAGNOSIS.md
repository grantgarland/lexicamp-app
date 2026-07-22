
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
